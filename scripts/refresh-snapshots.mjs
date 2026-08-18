#!/usr/bin/env node
// scripts/refresh-snapshots.mjs — one-command per-patch refresh for the two static op.gg
// snapshots this app uses for "for context" champion-meta and bot-lane-synergy signals:
// lib/champstats.mjs and lib/duosynergy.mjs. Zero deps (built-in fetch/fs only), reuses the exact
// fetch+parse logic used to build both files by hand (see their own header comments for the full
// rationale — this script is that same process, automated).
//
// Usage:
//   node scripts/refresh-snapshots.mjs             # fetch fresh data, overwrite the two lib files
//   node scripts/refresh-snapshots.mjs --dry-run    # fetch + parse + diff, but write to a temp
//                                                    # dir instead of touching lib/ — use this to
//                                                    # sanity-check the fetch/parse path still
//                                                    # works against op.gg's current page shape
//                                                    # before trusting a real overwrite.
//
// What it does, in order:
//   1. Data Dragon: latest version + champion.json -> name->id map (Jade_-prefix pseudo-champion
//      entries filtered out by their tell, numeric key >= 10000 — see both lib files' comments).
//   2. op.gg champion-statistics page (https://op.gg/lol/statistics/champions) -> per-champion
//      wr/pick/ban, joined against the Data Dragon map -> champstats.mjs's STATS.
//   3. Per-ADC op.gg synergy page (https://op.gg/lol/champions/{slug}/synergies/adc) for the same
//      27 curated real bot-lane ADCs duosynergy.mjs already documents -> duosynergy.mjs's PAIRS.
//   4. Diffs the freshly parsed data against whatever lib/champstats.mjs + lib/duosynergy.mjs
//      currently export (dynamic import of the CURRENT file, before any overwrite) and prints a
//      compact summary: patch old->new, champ/pair counts old->new, biggest winrate movers.
//   5. Rewrites both files (or, in --dry-run, writes matching files under a temp dir only).
//
// Not part of the fairness verdict's request path — this only touches two "for context" data
// files (champion-meta hover, bot-lane synergy chip/score term), so a stale or skipped refresh
// degrades gracefully to "no context shown for that champ/pair," never a wrong verdict.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHAMPSTATS_PATH = path.join(REPO_ROOT, 'lib', 'champstats.mjs');
const DUOSYNERGY_PATH = path.join(REPO_ROOT, 'lib', 'duosynergy.mjs');

const DRY_RUN = process.argv.includes('--dry-run');
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; lol-matchmaking-fairness snapshot refresh)' };

// Curated real bot-lane ADC pool — Data Dragon's "Marksman" tag also includes off-role picks
// (Azir/Jayce/Kayle/Quinn/Teemo/TwistedFate) that go mid/top, deliberately excluded. Same 27 as
// duosynergy.mjs's header documents.
const ADC_NAMES = ['Aphelios', 'Ashe', 'Caitlyn', 'Draven', 'Ezreal', 'Graves', 'Jhin', 'Jinx', "Kai'Sa",
  'Kalista', 'Kindred', "Kog'Maw", 'Lucian', 'Miss Fortune', 'Samira', 'Senna', 'Sivir', 'Smolder',
  'Tristana', 'Twitch', 'Varus', 'Vayne', 'Xayah', 'Yunara', 'Zeri', 'Akshan', 'Corki'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

// ---- 1. Data Dragon: version + champion.json -> name->id map (Jade_ filter) ----
async function loadDataDragon() {
  const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json());
  const version = versions[0];
  const champJson = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).then(r => r.json());
  // Exclude "Jade_"-prefixed pseudo-champion entries (60 alternate-universe skin-line duplicates
  // that share a real champion's display `name`, all with numeric `key` >= 10000) before building
  // the name -> id map, so a real champion's name never gets shadowed by its Jade_ variant.
  const champs = Object.values(champJson.data).filter(c => Number(c.key) < 10000);
  const nameToId = new Map(champs.map(c => [c.name, c.id]));
  return { ddragonVersion: version, nameToId, totalChamps: champs.length };
}

// ---- 2. op.gg champion-statistics page -> STATS ----
const CHAMP_STAT_RE = /\{\\"champion\\":\{\\"image_url\\":\\"([^"]*?)\\",\\"name\\":\\"([^"\\]*?)\\",\\"key\\":\\"([^"\\]*?)\\"\},\\"play\\":(\d+),\\"kda\\":([\d.]+),\\"kill\\":\d+,\\"death\\":\d+,\\"assist\\":\d+,\\"win_rate\\":([\d.]+),\\"pick_rate\\":([\d.]+),\\"ban_rate\\":([\d.]+)/g;
async function fetchChampStats(nameToId) {
  const html = await fetchText('https://op.gg/lol/statistics/champions');
  const rows = [];
  let m;
  CHAMP_STAT_RE.lastIndex = 0;
  while ((m = CHAMP_STAT_RE.exec(html))) {
    const [, imgUrl, name, , , , wr, pr, br] = m;
    const patchMatch = /\/lol\/([\d.]+)\/champion\//.exec(imgUrl);
    rows.push({ name, wr: +wr, pr: +pr, br: +br, patch: patchMatch ? patchMatch[1] : null });
  }
  // Patch = the most common patch value seen across rows (defends against a stray/odd URL).
  const patchCounts = new Map();
  for (const r of rows) if (r.patch) patchCounts.set(r.patch, (patchCounts.get(r.patch) || 0) + 1);
  const patch = [...patchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const STATS = {};
  const unmatched = [];
  for (const r of rows) {
    const id = nameToId.get(r.name);
    if (!id) { unmatched.push(r.name); continue; }
    STATS[id] = { wr: +r.wr.toFixed(1), pick: +r.pr.toFixed(1), ban: +r.br.toFixed(1) };
  }
  return { patch, STATS, matched: Object.keys(STATS).length, unmatched };
}

// ---- 3. per-ADC op.gg synergy page -> PAIRS ----
const SUPPORT_ENTRY_RE = /\{\\"play\\":(\d+),\\"synergy_position\\":\\"SUPPORT\\",\\"win_rate\\":([\d.]+),\\"pick_rate\\":[\d.]+,\\"synergy_champion_name\\":\\"([^"\\]*?)\\"/g;
async function fetchDuoSynergy(nameToId) {
  const PAIRS = {};
  const missing = [];
  let patch = null;
  for (const adcName of ADC_NAMES) {
    const adcId = nameToId.get(adcName);
    if (!adcId) { console.error(`  ADC not found in Data Dragon: ${adcName}`); continue; }
    const slug = adcName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const html = await fetchText(`https://op.gg/lol/champions/${slug}/synergies/adc`);
    if (!patch) {
      const vm = /images\/lol\/([\d.]+)\/champion\//.exec(html);
      if (vm) patch = vm[1];
    }
    const supportIdx = html.indexOf('synergyPosition\\":\\"support');
    if (supportIdx === -1) { console.error(`  no support section for ${adcId}`); await sleep(300); continue; }
    const nextSection = html.indexOf('synergy-section', supportIdx + 50);
    const window = html.slice(supportIdx, nextSection > -1 ? nextSection : supportIdx + 20000);
    SUPPORT_ENTRY_RE.lastIndex = 0;
    let m, n = 0;
    while ((m = SUPPORT_ENTRY_RE.exec(window))) {
      const [, games, wr, suppName] = m;
      const suppId = nameToId.get(suppName);
      if (!suppId) { missing.push(`${adcId}+${suppName}`); continue; }
      PAIRS[`${adcId}+${suppId}`] = { wr: +(Number(wr) * 100).toFixed(3), games: +games };
      n++;
    }
    console.error(`  ${adcId}: ${n} support partners`);
    await sleep(300); // polite pacing — op.gg has no documented rate limit, but no reason to hammer it
  }
  return { patch, PAIRS, pairCount: Object.keys(PAIRS).length, missing };
}

// ---- file templates (mirror the hand-written headers, patch/date/counts filled in) ----
const today = () => new Date().toISOString().slice(0, 10);

function champstatsFile({ patch, date, STATS, matched, totalChamps }) {
  const body = Object.keys(STATS).sort().map(id => {
    const s = STATS[id];
    return `  ${id}: { wr: ${s.wr}, pick: ${s.pick}, ban: ${s.ban} },`;
  }).join('\n');
  return `// lib/champstats.mjs — static per-patch champion meta snapshot (same philosophy as
// lib/counters.mjs: a curated, community-editable data file rather than a live API call — no key
// needed, no rate limit, no per-request latency for a number that only meaningfully changes once
// per patch anyway).
//
// Source: https://op.gg/lol/statistics/champions (Ranked Solo/Duo, all ranks, all regions
// aggregate — op.gg's default view). Fetched ${date} via scripts/refresh-snapshots.mjs.
// Patch: ${patch} (read directly from the champion splash-art URLs embedded in the page's own
// data, so it's exactly the patch op.gg was reporting on at fetch time — not guessed).
//
// Keyed by match-v5's internal championName (see lib/counters.mjs's header comment for the
// Wukong -> MonkeyKing style id quirks — same ids used here, cross-checked against Data Dragon's
// champion.json for this patch so every key is guaranteed to match what pStats()/analyzeLive
// actually put in a player's .champ field).
//
// ${matched} of ${totalChamps} real champions matched. wr/pick/ban are percentages, rounded to 1
// decimal. Missing from this map -> the champion meta hover just doesn't render for that champ
// (see src/main.js), never a fabricated number.
//
// Refresh cadence: once per patch is plenty (meta shifts are gradual, and this is a "for context"
// signal, not something the fairness verdict depends on). Run \`node scripts/refresh-snapshots.mjs\`
// to regenerate this file (and lib/duosynergy.mjs) from op.gg's current data.
export const PATCH = '${patch}';

export const STATS = {
${body}
};
`;
}

function duosynergyFile({ patch, date, PAIRS, pairCount }) {
  const body = Object.keys(PAIRS).sort().map(key => {
    const p = PAIRS[key];
    return `  "${key}": { wr: ${p.wr}, games: ${p.games} },`;
  }).join('\n');
  return `// lib/duosynergy.mjs — static per-patch bot-lane (ADC+SUPPORT) duo synergy snapshot, same
// philosophy as lib/counters.mjs and lib/champstats.mjs: a curated, community-editable data file
// rather than a live API call.
//
// Source: https://op.gg/lol/champions/{champ}/synergies/adc — each ADC's own page (support-role
// section) lists their top-10 support partners by play count, with pair winrate + games. Fetched
// ${date} via scripts/refresh-snapshots.mjs, for the 27 champions that are actually played
// bot-lane ADC in practice (Data Dragon's "Marksman" tag also includes off-role picks like
// Azir/Jayce/Kayle/Quinn/Teemo/TwistedFate that go mid/top, deliberately excluded here). One page
// fetch per ADC — this data isn't in a single aggregate table the way champstats.mjs's
// champion-stats page was, since synergy is inherently pairwise.
// Patch: ${patch} (same source as champstats.mjs, read from the embedded data's own image URLs).
//
// Keyed "Adc+Supp" using match-v5's internal championName for both halves (cross-joined against
// Data Dragon's champion.json exactly like champstats.mjs — including the same Jade_-prefix
// pseudo-champion filter: Data Dragon lists 60 alternate-universe duplicate entries sharing a
// real champion's display name, e.g. both "Ezreal" and "Jade_Ezreal" have name="Ezreal"; excluded
// by their tell, numeric key >= 10000, before building the name-lookup).
//
// Coverage is inherently a top-10-per-ADC list, not exhaustive — ${pairCount} pairs across 27
// ADCs. A pairing missing here just means no synergy chip/tag renders and no scoring adjustment
// applies for that lane — same "missing data -> no display, never a fabricated number" rule as
// champstats.mjs.
//
// \`games\` is included specifically so a low-sample pair isn't presented with false confidence:
// it's shown directly in the tooltip alongside the winrate.
//
// synergyDelta (pair wr minus the mean of both champs' solo wr, from lib/champstats.mjs) is
// deliberately NOT stored here — it's computed at the point of use (lib/riot.mjs and its
// src/main.js mirror) so it always reflects whatever champstats.mjs's solo-wr numbers currently
// are, rather than baking in a delta that could silently drift out of sync with a champstats.mjs
// update.
//
// Refresh cadence: once per patch, alongside champstats.mjs. Run
// \`node scripts/refresh-snapshots.mjs\` to regenerate both files from op.gg's current data.
export const PATCH = '${patch}';

export const PAIRS = {
${body}
};
`;
}

// ---- diff helpers ----
function diffCounts(label, oldN, newN) {
  const arrow = oldN === newN ? '(unchanged)' : oldN < newN ? `(+${newN - oldN})` : `(${newN - oldN})`;
  console.log(`  ${label}: ${oldN} -> ${newN} ${arrow}`);
}
function topMovers(label, oldMap, newMap, wrOf, nameOf, n = 5) {
  const moves = [];
  for (const key of Object.keys(newMap)) {
    if (!(key in oldMap)) continue;
    const oldWr = wrOf(oldMap[key]), newWr = wrOf(newMap[key]);
    const delta = +(newWr - oldWr).toFixed(1);
    if (delta !== 0) moves.push({ key: nameOf(key), oldWr, newWr, delta });
  }
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`  ${label} top movers (${moves.length} changed of ${Object.keys(newMap).length} in both old+new):`);
  for (const mv of moves.slice(0, n)) {
    console.log(`    ${mv.key}: ${mv.oldWr}% -> ${mv.newWr}% (${mv.delta > 0 ? '+' : ''}${mv.delta})`);
  }
  if (!moves.length) console.log('    (no overlapping entries changed)');
}

async function main() {
  console.error(`${DRY_RUN ? '[DRY RUN] ' : ''}Fetching Data Dragon champion list...`);
  const { ddragonVersion, nameToId, totalChamps } = await loadDataDragon();
  console.error(`  Data Dragon ${ddragonVersion}: ${totalChamps} real champions`);

  console.error('Fetching op.gg champion statistics...');
  const champStats = await fetchChampStats(nameToId);
  console.error(`  patch ${champStats.patch}: ${champStats.matched} matched, ${champStats.unmatched.length} unmatched (${champStats.unmatched.join(', ')})`);

  console.error('Fetching op.gg per-ADC bot-lane synergy pages (27 ADCs)...');
  const duoSynergy = await fetchDuoSynergy(nameToId);
  console.error(`  patch ${duoSynergy.patch}: ${duoSynergy.pairCount} pairs, ${duoSynergy.missing.length} unmatched support names`);
  if (duoSynergy.patch && champStats.patch && duoSynergy.patch !== champStats.patch) {
    console.error(`  WARNING: synergy pages report patch ${duoSynergy.patch}, champion-stats page reports ${champStats.patch} — using ${champStats.patch} for both file headers`);
  }
  const patch = champStats.patch;
  if (!patch) { console.error('FATAL: could not determine patch from op.gg — aborting without writing anything'); process.exit(1); }

  // ---- diff against what's currently in the repo (import BEFORE any overwrite) ----
  const oldChampstats = await import(pathToFileURL(CHAMPSTATS_PATH).href);
  const oldDuosynergy = await import(pathToFileURL(DUOSYNERGY_PATH).href);

  console.log('\n=== REFRESH SUMMARY ===');
  console.log(`patch: ${oldChampstats.PATCH} -> ${patch}`);
  diffCounts('champstats champs', Object.keys(oldChampstats.STATS).length, champStats.matched);
  diffCounts('duosynergy pairs', Object.keys(oldDuosynergy.PAIRS).length, duoSynergy.pairCount);
  topMovers('champstats wr', oldChampstats.STATS, champStats.STATS, s => s.wr, id => id);
  topMovers('duosynergy pair wr', oldDuosynergy.PAIRS, duoSynergy.PAIRS, p => p.wr, key => key);

  const date = today();
  const champstatsOut = champstatsFile({ patch, date, STATS: champStats.STATS, matched: champStats.matched, totalChamps });
  const duosynergyOut = duosynergyFile({ patch, date, PAIRS: duoSynergy.PAIRS, pairCount: duoSynergy.pairCount });

  if (DRY_RUN) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-snapshots-dryrun-'));
    fs.writeFileSync(path.join(tmpDir, 'champstats.mjs'), champstatsOut);
    fs.writeFileSync(path.join(tmpDir, 'duosynergy.mjs'), duosynergyOut);
    console.log(`\n[DRY RUN] Wrote parsed output for comparison to:\n  ${path.join(tmpDir, 'champstats.mjs')}\n  ${path.join(tmpDir, 'duosynergy.mjs')}`);
    console.log('[DRY RUN] lib/champstats.mjs and lib/duosynergy.mjs were NOT touched.');
  } else {
    fs.writeFileSync(CHAMPSTATS_PATH, champstatsOut);
    fs.writeFileSync(DUOSYNERGY_PATH, duosynergyOut);
    console.log(`\nWrote lib/champstats.mjs and lib/duosynergy.mjs (patch ${patch}, ${date}).`);
  }
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
