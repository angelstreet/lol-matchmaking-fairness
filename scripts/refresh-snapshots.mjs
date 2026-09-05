#!/usr/bin/env node
// scripts/refresh-snapshots.mjs — one-command per-patch refresh for the four static, curated
// snapshots this app uses for "for context" signals: lib/champstats.mjs (champion meta),
// lib/duosynergy.mjs (bot-lane duo synergy), lib/builds.mjs (recommended build per champion+role),
// and lib/proExamples.mjs (pro/high-elo example games per champion). Zero deps (built-in fetch/fs
// only), reuses the exact fetch+parse logic used to build all four files by hand (see their own
// header comments for the full rationale — this script is that same process, automated).
//
// Usage:
//   node scripts/refresh-snapshots.mjs             # fetch fresh data, overwrite the four lib files
//   node scripts/refresh-snapshots.mjs --dry-run    # fetch + parse + diff, but write to a temp
//                                                    # dir instead of touching lib/ — use this to
//                                                    # sanity-check the fetch/parse path still
//                                                    # works against each source's current page/
//                                                    # response shape before trusting a real
//                                                    # overwrite.
//
// What it does, in order:
//   1. Data Dragon: latest version + champion.json -> name->id map + numeric key->id map + full
//      champion list (Jade_-prefix pseudo-champion entries filtered out by their tell, numeric
//      key >= 10000 — see the lib files' own comments), plus item.json + runesReforged.json ->
//      id->name maps used by steps 4-5.
//   2. op.gg champion-statistics page (https://op.gg/lol/statistics/champions) -> per-champion
//      wr/pick/ban, joined against the Data Dragon map -> champstats.mjs's STATS.
//   3. Per-ADC op.gg synergy page (https://op.gg/lol/champions/{slug}/synergies/adc) for the same
//      27 curated real bot-lane ADCs duosynergy.mjs already documents -> duosynergy.mjs's PAIRS.
//   4. deeplol.gg's public per-champion build endpoint (b2c-api-cdn.deeplol.gg/champion/build,
//      KR/Emerald+, no key) for every real champion -> builds.mjs's BUILDS (keystone/core items/
//      boots/skill order/win_rate/games per champion+role).
//   5. lolvvv.com's per-champion probuilds page (embedded __NEXT_DATA__ JSON) for every real
//      champion -> proExamples.mjs's EXAMPLES (up to 10 recent pro-tracked games per champion).
//   6. Diffs the freshly parsed data against whatever the four lib files currently export
//      (dynamic import of the CURRENT files, before any overwrite) and prints a compact summary:
//      patch old->new, champ/pair/build/example counts old->new, biggest winrate movers.
//   7. Rewrites all four files (or, in --dry-run, writes matching files under a temp dir only).
//
// Not part of the fairness verdict's request path — this only touches "for context" data files
// (champion-meta hover, bot-lane synergy chip/score term, recommended-build reveal, pro example
// callout), so a stale or skipped refresh degrades gracefully to "no context shown for that
// champ/pair/role," never a wrong verdict.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHAMPSTATS_PATH = path.join(REPO_ROOT, 'lib', 'champstats.mjs');
const DUOSYNERGY_PATH = path.join(REPO_ROOT, 'lib', 'duosynergy.mjs');
const BUILDS_PATH = path.join(REPO_ROOT, 'lib', 'builds.mjs');
const PROEXAMPLES_PATH = path.join(REPO_ROOT, 'lib', 'proExamples.mjs');

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
  // keyToId: Riot's numeric champion key (Data Dragon's `key`, e.g. Warwick=19) -> internal
  // championName (`id`, e.g. "MonkeyKing" for Wukong). deeplol.gg's build endpoint and lolvvv's
  // match payloads both address champions by this numeric key (champion_id / championId /
  // opponentChampionId), so this is the join key for both new sources below.
  const keyToId = new Map(champs.map(c => [Number(c.key), c.id]));
  // champList: {id (internal), key (numeric), name (display)} for iterating every real champion —
  // `name` (the display name, e.g. "Kai'Sa", "Nunu & Willump", "Wukong") is what lolvvv.com's
  // /champion/<name>/probuilds URL expects, confirmed against the live site including apostrophes
  // and "&" (both work unescaped or percent-encoded).
  const champList = champs.map(c => ({ id: c.id, key: Number(c.key), name: c.name }));
  return { ddragonVersion: version, nameToId, keyToId, champList, totalChamps: champs.length };
}

// ---- Data Dragon item.json -> id->name map, runesReforged.json -> id->name map (flattened) ----
async function loadItemNames(patch) {
  const itemJson = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`).then(r => r.json());
  return new Map(Object.entries(itemJson.data).map(([id, item]) => [Number(id), item.name]));
}
async function loadRuneNames(patch) {
  const styles = await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/runesReforged.json`).then(r => r.json());
  const names = new Map();
  for (const style of styles) {
    names.set(style.id, style.name); // e.g. 8000 -> "Precision" (perkPrimaryStyle/perkSubStyle ids)
    for (const slot of style.slots) for (const rune of slot.runes) names.set(rune.id, rune.name);
  }
  return names;
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

// ---- 4. deeplol.gg per-champion build endpoint -> BUILDS ----
// deeplol.gg lane names -> Riot's teamPosition values (same vocabulary src/main.js and lib/riot.mjs
// already key everything by: TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY). "Aram" is deliberately excluded —
// it's a different queue/map, not a Summoner's Rift role, and would never match a real player's
// teamPosition.
const DEEPLOL_LANE_TO_POS = { Top: 'TOP', Jungle: 'JUNGLE', Middle: 'MIDDLE', Bot: 'BOTTOM', Supporter: 'UTILITY' };
const SKILL_LETTER = { 1: 'Q', 2: 'W', 3: 'E' };

async function fetchBuilds(champList, gameVersion, itemNames, runeNames) {
  const BUILDS = {};
  let roleCount = 0;
  const skipped = [];
  for (const c of champList) {
    const url = `https://b2c-api-cdn.deeplol.gg/champion/build?platform_id=KR&champion_id=${c.key}&game_version=${gameVersion}&tier=Emerald%2B`;
    let json;
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) { skipped.push(`${c.id} (HTTP ${res.status})`); await sleep(150); continue; }
      json = await res.json();
    } catch (e) { skipped.push(`${c.id} (${e.message})`); await sleep(150); continue; }

    const roles = {};
    for (const [laneName, laneData] of Object.entries(json.build_by_lane || {})) {
      const pos = DEEPLOL_LANE_TO_POS[laneName];
      if (!pos) continue; // Aram or an unrecognized lane name -> not a role we can display against
      const variant = laneData.build_lst?.[0]; // most-played variant for this champion+lane
      if (!variant) continue;

      const keystoneId = variant.main_rune ?? variant.rune?.main_build?.[0];
      const keystone = keystoneId != null ? runeNames.get(keystoneId) : null;

      const bootsId = variant.boots?.item ?? null;
      const boots = bootsId != null ? (itemNames.get(bootsId) || null) : null;

      // Core items: main_item first (deeplol's own pick for "the" build-defining item), then fill
      // to 2 from the rest of item.build in order, skipping boots and any duplicate of main_item.
      const mainItemId = variant.main_item ?? variant.item?.build?.[0] ?? null;
      const coreIds = [];
      if (mainItemId != null) coreIds.push(mainItemId);
      for (const id of variant.item?.build || []) {
        if (coreIds.length >= 2) break;
        if (id === bootsId || coreIds.includes(id)) continue;
        coreIds.push(id);
      }
      const items = coreIds.map(id => itemNames.get(id)).filter(Boolean);

      const skillOrder = (variant.skill?.build || []).map(n => SKILL_LETTER[n]).filter(Boolean);

      // Incomplete resolution (a rune/item id Data Dragon's current patch doesn't know about, e.g.
      // a brand-new item mid-patch) -> skip this role entirely rather than store a partial/wrong
      // build. Same "missing data -> no display, never a fabricated number" rule as champstats.mjs.
      if (!keystone || !items.length) continue;

      roles[pos] = {
        keystone, items, boots, skillOrder,
        winRate: +((variant.win_rate || 0) * 100).toFixed(1),
        games: variant.games || 0,
      };
      roleCount++;
    }
    if (Object.keys(roles).length) BUILDS[c.id] = roles;
    await sleep(150); // polite pacing — no documented rate limit, but no reason to hammer it
  }
  return { BUILDS, matched: Object.keys(BUILDS).length, roleCount, skipped };
}

// ---- 5. lolvvv.com per-champion probuilds page -> EXAMPLES ----
async function fetchProExamples(champList, keyToId, itemNames, runeNames) {
  const EXAMPLES = {};
  let matchCount = 0;
  const skipped = [];
  for (const c of champList) {
    const url = `https://www.lolvvv.com/champion/${encodeURIComponent(c.name)}/probuilds`;
    let html;
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) { skipped.push(`${c.id} (HTTP ${res.status})`); await sleep(150); continue; }
      html = await res.text();
    } catch (e) { skipped.push(`${c.id} (${e.message})`); await sleep(150); continue; }

    const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) { skipped.push(`${c.id} (no __NEXT_DATA__)`); await sleep(150); continue; }
    let matches;
    try {
      matches = JSON.parse(m[1])?.props?.pageProps?.initialData?.prosMatchesCollection?.matches;
    } catch (e) { skipped.push(`${c.id} (bad JSON: ${e.message})`); await sleep(150); continue; }
    if (!matches || !matches.length) { await sleep(150); continue; } // no pro-tracked games -> no entry, not an empty array

    const examples = [];
    for (const match of matches.slice(0, 10)) {
      const p = match.participant;
      if (!p) continue;
      const opponent = keyToId.get(p.opponentChampionId) || null;
      const items = [p.stats?.item0, p.stats?.item1, p.stats?.item2, p.stats?.item3, p.stats?.item4, p.stats?.item5, p.stats?.item6]
        .filter(id => id) // drop 0/empty slots
        .map(id => itemNames.get(id)).filter(Boolean);
      const keystone = p.stats?.perk0 != null ? runeNames.get(p.stats.perk0) : null;
      const primaryStyle = p.stats?.perkPrimaryStyle != null ? runeNames.get(p.stats.perkPrimaryStyle) : null;
      const subStyle = p.stats?.perkSubStyle != null ? runeNames.get(p.stats.perkSubStyle) : null;
      if (!opponent || !items.length) continue; // can't resolve the matchup or the build -> skip, don't fabricate
      examples.push({
        opponent, win: !!p.stats?.win, patch: match.patch || null, position: p.position || null,
        items, keystone, primaryStyle, subStyle,
      });
    }
    if (examples.length) { EXAMPLES[c.id] = examples; matchCount += examples.length; }
    await sleep(150);
  }
  return { EXAMPLES, matched: Object.keys(EXAMPLES).length, matchCount, skipped };
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

function buildsFile({ patch, date, BUILDS, matched, totalChamps, roleCount }) {
  const body = Object.keys(BUILDS).sort().map(champ => {
    const roles = BUILDS[champ];
    const roleBody = Object.keys(roles).sort().map(pos => {
      const r = roles[pos];
      const items = JSON.stringify(r.items);
      const skillOrder = JSON.stringify(r.skillOrder);
      return `    ${pos}: { keystone: ${JSON.stringify(r.keystone)}, items: ${items}, boots: ${JSON.stringify(r.boots)}, skillOrder: ${skillOrder}, winRate: ${r.winRate}, games: ${r.games} },`;
    }).join('\n');
    return `  ${champ}: {\n${roleBody}\n  },`;
  }).join('\n');
  return `// lib/builds.mjs — static per-patch recommended-build snapshot (same philosophy as
// lib/champstats.mjs and lib/duosynergy.mjs: a curated, community-editable data file rather than
// a live API call).
//
// Source: https://b2c-api-cdn.deeplol.gg/champion/build (deeplol.gg's public soloq-build API,
// platform_id=KR, tier=Emerald+ — no auth/key required). Fetched ${date} via
// scripts/refresh-snapshots.mjs. Patch: ${patch} (the game_version sent in the request, derived
// from Data Dragon's current version at fetch time).
//
// Keyed by match-v5's internal championName (see lib/counters.mjs's header for the Wukong ->
// MonkeyKing style id quirks — same id space used here), then by Riot's teamPosition
// (TOP/JUNGLE/MIDDLE/BOTTOM/UTILITY — deeplol.gg's own lane labels are Top/Jungle/Middle/Bot/
// Supporter/Aram; Aram is dropped since it's a different map/queue, not a Summoner's Rift role).
// Only the roles a champion's own deeplol.gg response actually lists are present — no role
// assumptions hardcoded here.
//
// Each role stores the single most-played build variant: keystone name, up to 2 core items
// (deeplol's own "main item" first, then the next distinct item from its build order), boots,
// skill-max order (Q/W/E, R excluded), and that variant's own win_rate/games — so a low-sample
// build isn't shown with false confidence. Rune/item ids are resolved to names via Data Dragon's
// item.json and runesReforged.json for this same patch; an id that patch doesn't recognize
// (e.g. a brand-new item) drops that whole role rather than storing a partial or wrong build —
// same "missing data -> no display, never a fabricated number" rule as champstats.mjs.
//
// ${matched} of ${totalChamps} real champions matched, ${roleCount} champion+role builds total.
//
// Refresh cadence: once per patch, alongside champstats.mjs/duosynergy.mjs. Run
// \`node scripts/refresh-snapshots.mjs\` to regenerate all four files from their live sources.
export const PATCH = '${patch}';

export const BUILDS = {
${body}
};
`;
}

function proExamplesFile({ date, EXAMPLES, matched, totalChamps, matchCount }) {
  const body = Object.keys(EXAMPLES).sort().map(champ => {
    const rows = EXAMPLES[champ].map(ex => `    { opponent: ${JSON.stringify(ex.opponent)}, win: ${ex.win}, patch: ${JSON.stringify(ex.patch)}, position: ${JSON.stringify(ex.position)}, items: ${JSON.stringify(ex.items)}, keystone: ${JSON.stringify(ex.keystone)}, primaryStyle: ${JSON.stringify(ex.primaryStyle)}, subStyle: ${JSON.stringify(ex.subStyle)} },`).join('\n');
    return `  ${champ}: [\n${rows}\n  ],`;
  }).join('\n');
  return `// lib/proExamples.mjs — trimmed pro/high-elo example games per champion, same "curated static
// snapshot, not a live call" philosophy as lib/champstats.mjs/lib/duosynergy.mjs/lib/builds.mjs.
//
// Source: https://www.lolvvv.com/champion/<DisplayName>/probuilds (a Next.js page; the games
// live in its embedded __NEXT_DATA__ script, props.pageProps.initialData.prosMatchesCollection.
// matches — no auth/key required). <DisplayName> is Data Dragon's champion display name (e.g.
// "Kai'Sa", "Nunu & Willump", "Wukong"), not the match-v5 internal id. Fetched ${date} via
// scripts/refresh-snapshots.mjs.
//
// Keyed by match-v5's internal championName (cross-joined against Data Dragon's champion.json,
// same id space as champstats.mjs/builds.mjs). Up to the 10 most recent pro-tracked games per
// champion, each with the enemy laner (opponentChampionId), win/loss, patch, final item set,
// keystone + rune-style summary — ids resolved to names via Data Dragon's item.json/
// runesReforged.json. A game whose opponent or items can't be resolved is dropped rather than
// stored partially.
//
// THIS IS A THIN, ILLUSTRATIVE DATA SOURCE, NOT A STATISTICAL ONE: lolvvv only tracks games
// involving pro-associated accounts, so a niche or off-meta champion can have a single-digit
// number of games total (confirmed while building this: several champions here have well under
// 10). Shown in the UI as "a pro example," never as a win-rate claim — that's what lib/builds.mjs
// (deeplol.gg, real sample sizes) is for. A champion absent here just means lolvvv has no
// pro-tracked games for it at all -> no display, never a fabricated example.
//
// ${matched} of ${totalChamps} real champions have at least one example, ${matchCount} example
// games total.
//
// Refresh cadence: once per patch, alongside the other three snapshot files. Run
// \`node scripts/refresh-snapshots.mjs\` to regenerate all of them from their live sources.
export const EXAMPLES = {
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
  const { ddragonVersion, nameToId, keyToId, champList, totalChamps } = await loadDataDragon();
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

  const gameVersion = ddragonVersion.split('.').slice(0, 2).join('.'); // "16.17.1" -> "16.17"
  console.error(`Fetching Data Dragon item.json + runesReforged.json (patch ${ddragonVersion})...`);
  const itemNames = await loadItemNames(ddragonVersion);
  const runeNames = await loadRuneNames(ddragonVersion);
  console.error(`  ${itemNames.size} items, ${runeNames.size} runes/styles`);

  console.error(`Fetching deeplol.gg builds for ${champList.length} champions (game_version=${gameVersion})...`);
  const builds = await fetchBuilds(champList, gameVersion, itemNames, runeNames);
  console.error(`  ${builds.matched}/${champList.length} champions matched, ${builds.roleCount} champion+role builds, ${builds.skipped.length} skipped`);
  if (builds.skipped.length) console.error(`    skipped: ${builds.skipped.slice(0, 10).join(', ')}${builds.skipped.length > 10 ? ', ...' : ''}`);

  console.error(`Fetching lolvvv.com pro examples for ${champList.length} champions...`);
  const proExamples = await fetchProExamples(champList, keyToId, itemNames, runeNames);
  console.error(`  ${proExamples.matched}/${champList.length} champions have examples, ${proExamples.matchCount} example games total, ${proExamples.skipped.length} skipped`);
  if (proExamples.skipped.length) console.error(`    skipped: ${proExamples.skipped.slice(0, 10).join(', ')}${proExamples.skipped.length > 10 ? ', ...' : ''}`);

  // ---- diff against what's currently in the repo (import BEFORE any overwrite) ----
  const oldChampstats = await import(pathToFileURL(CHAMPSTATS_PATH).href);
  const oldDuosynergy = await import(pathToFileURL(DUOSYNERGY_PATH).href);
  // builds.mjs/proExamples.mjs may not exist yet on a first run — default to empty so the diff
  // step below degrades to "0 -> N" instead of throwing.
  const oldBuilds = await import(pathToFileURL(BUILDS_PATH).href).catch(() => ({ PATCH: null, BUILDS: {} }));
  const oldProExamples = await import(pathToFileURL(PROEXAMPLES_PATH).href).catch(() => ({ EXAMPLES: {} }));

  console.log('\n=== REFRESH SUMMARY ===');
  console.log(`patch: ${oldChampstats.PATCH} -> ${patch}`);
  diffCounts('champstats champs', Object.keys(oldChampstats.STATS).length, champStats.matched);
  diffCounts('duosynergy pairs', Object.keys(oldDuosynergy.PAIRS).length, duoSynergy.pairCount);
  diffCounts('builds champions', Object.keys(oldBuilds.BUILDS).length, builds.matched);
  diffCounts('proExamples champions', Object.keys(oldProExamples.EXAMPLES).length, proExamples.matched);
  topMovers('champstats wr', oldChampstats.STATS, champStats.STATS, s => s.wr, id => id);
  topMovers('duosynergy pair wr', oldDuosynergy.PAIRS, duoSynergy.PAIRS, p => p.wr, key => key);

  const date = today();
  const champstatsOut = champstatsFile({ patch, date, STATS: champStats.STATS, matched: champStats.matched, totalChamps });
  const duosynergyOut = duosynergyFile({ patch, date, PAIRS: duoSynergy.PAIRS, pairCount: duoSynergy.pairCount });
  const buildsOut = buildsFile({ patch: gameVersion, date, BUILDS: builds.BUILDS, matched: builds.matched, totalChamps, roleCount: builds.roleCount });
  const proExamplesOut = proExamplesFile({ date, EXAMPLES: proExamples.EXAMPLES, matched: proExamples.matched, totalChamps, matchCount: proExamples.matchCount });

  if (DRY_RUN) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-snapshots-dryrun-'));
    fs.writeFileSync(path.join(tmpDir, 'champstats.mjs'), champstatsOut);
    fs.writeFileSync(path.join(tmpDir, 'duosynergy.mjs'), duosynergyOut);
    fs.writeFileSync(path.join(tmpDir, 'builds.mjs'), buildsOut);
    fs.writeFileSync(path.join(tmpDir, 'proExamples.mjs'), proExamplesOut);
    console.log(`\n[DRY RUN] Wrote parsed output for comparison to:\n  ${tmpDir}`);
    console.log('[DRY RUN] lib/champstats.mjs, lib/duosynergy.mjs, lib/builds.mjs, lib/proExamples.mjs were NOT touched.');
  } else {
    fs.writeFileSync(CHAMPSTATS_PATH, champstatsOut);
    fs.writeFileSync(DUOSYNERGY_PATH, duosynergyOut);
    fs.writeFileSync(BUILDS_PATH, buildsOut);
    fs.writeFileSync(PROEXAMPLES_PATH, proExamplesOut);
    console.log(`\nWrote lib/champstats.mjs, lib/duosynergy.mjs, lib/builds.mjs, lib/proExamples.mjs (patch ${patch}, ${date}).`);
  }
}

main().catch(e => { console.error('FATAL', e.message, e.stack); process.exit(1); });
