import './style.css';
import { netCounter } from '../lib/counters.mjs';

// Same-origin API in production (Vercel functions); Vite proxies /api in dev.
const API = import.meta.env.VITE_API_URL || '';

document.querySelector('#app').innerHTML = `
  <h1>LoL <span>Matchmaking Fairness</span> <span class="h1-right"><a href="/scoring.html" class="algo-link">ⓘ <span class="algo-full">How we score</span><span class="algo-short">Scoring</span></a><span id="clerkBtn"></span></span></h1>
  <div class="sub"><span class="sub-short">Was your game winnable? Ranked Solo/Duo · pre-game form · duo detection · GA scores</span><span class="sub-more"> for all 10 players · proven by shared matches · official Riot API</span></div>
  <form id="f" autocomplete="off">
    <div class="combo">
      <input id="riotId" name="riot-search" placeholder="Game name #TAG — e.g. xDevilStreet#EUW" required autocomplete="off">
      <button type="button" id="bmStar" title="Bookmark this profile">☆</button>
      <div id="bmDrop"></div>
    </div>
    <select id="games"><option>3</option><option selected>5</option><option>10</option></select>
    <select id="region"><option selected>euw</option><option>eune</option><option>na</option><option>kr</option></select>
    <button id="go">Find games</button>
    <button type="button" id="liveBtn" class="live">🔴 Live game</button>
    <div class="keyrow">
      <div class="keywrap">
        <input id="apiKey" name="riot-api-key" placeholder="Your Riot API key (optional)" type="text" autocomplete="off" data-1p-ignore data-lpignore="true" data-bwignore>
        <span id="keyValid" title=""></span>
        <button type="button" id="clearKey" title="Clear saved key">✕</button>
      </div>
      <div class="note">
        <a href="#" id="howKey">How to get your own free key (2 min) ▾</a>
        <div id="keyHelp" style="display:none">
          1. Go to <a href="https://developer.riotgames.com" target="_blank" rel="noreferrer">developer.riotgames.com</a> and sign in with your Riot account.<br>
          2. Copy the <b>Development API Key</b> on the dashboard and paste it here.<br>
          3. It expires every 24h (Riot's rule) — just grab a new one. The key stays in your browser and is only used for your own requests.
          <div>No key? <b>3 free analyses/day</b><span class="note-more"> (may queue). Analyzed games are always free & instant.</span></div>
        </div>
      </div>
    </div>
  </form>
  <div id="status"></div>
  <div id="list"></div>
  <div id="histWrap" style="display:none">
    <h3 style="margin:24px 0 8px">📜 Analyzed history</h3>
    <div id="hist"></div>
    <div id="histNav" class="dim" style="display:flex;gap:12px;align-items:center"></div>
  </div>
  <footer class="foot"><a href="https://github.com/angelstreet/lol-matchmaking-fairness" target="_blank" rel="noreferrer">⭐ Open source — star it on GitHub</a><span class="dim"> · MIT · not endorsed by Riot Games · </span><a href="/scoring.html" class="algo-link">ⓘ How we score</a></footer>`;

const $ = s => document.querySelector(s);
$('#apiKey').value = localStorage.getItem('rgapi') || '';
$('#riotId').value = localStorage.getItem('riotId') || '';
$('#howKey').addEventListener('click', e => { e.preventDefault(); const k = $('#keyHelp'); k.style.display = k.style.display === 'none' ? 'block' : 'none'; });

// The key field used to only persist on form submit, so pasting a fresh key without hitting
// "Find games" (or reloading the page right after) would silently keep using the stale one
// — dots look the same either way. Persist on every keystroke instead, with a brief green-border
// flash for feedback that the new value actually took, plus a one-click way to wipe it clean.
let keyFlashTimer = null;
function flashKeyField() {
  const el = $('#apiKey');
  el.classList.add('key-updated');
  clearTimeout(keyFlashTimer);
  keyFlashTimer = setTimeout(() => el.classList.remove('key-updated'), 900);
}
// Self-diagnosis for the "key disappears" confusion: rather than the user only finding out a
// key is bad when some later search/analyze fails (and possibly getting blamed for a failure
// that was actually the shared server key's, see handleKeyError below), validate whatever's in
// the field directly against Riot as soon as it looks like a real key, and show the result
// inline (✓/✗) right there. Debounced so it doesn't fire on every keystroke while pasting/typing.
let keyCheckTimer = null;
const looksLikeKey = v => /^RGAPI-/i.test(v);
async function checkKeyValidity() {
  const el = $('#keyValid');
  const val = $('#apiKey').value.trim();
  if (!looksLikeKey(val)) { el.textContent = ''; el.title = ''; el.className = ''; return; }
  el.textContent = '…'; el.title = 'Checking…'; el.className = 'checking';
  try {
    const r = await fetch(`${API}/api/keycheck`, { headers: { 'x-api-key': val } });
    const data = await r.json();
    if (data.valid) { el.textContent = '✓'; el.title = 'This key is valid'; el.className = 'ok'; }
    else { el.textContent = '✗'; el.title = `Riot rejected this key (status ${data.status || '?'}) — it may be expired or mistyped`; el.className = 'bad'; }
  } catch { el.textContent = ''; el.title = ''; el.className = ''; } // network hiccup — not the key's fault, stay silent
}
$('#apiKey').addEventListener('input', () => {
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  flashKeyField();
  clearTimeout(keyCheckTimer);
  keyCheckTimer = setTimeout(checkKeyValidity, 800);
});
if ($('#apiKey').value.trim()) checkKeyValidity(); // validate a key restored from localStorage on load too
$('#clearKey').addEventListener('click', () => {
  $('#apiKey').value = '';
  localStorage.removeItem('rgapi');
  $('#keyValid').textContent = ''; $('#keyValid').title = ''; $('#keyValid').className = '';
  $('#apiKey').focus();
});

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// op.gg profile URL for a Riot ID ("Name#TAG" -> https://op.gg/lol/summoners/{region}/Name-TAG).
// The # becomes a literal -, and the whole Name-TAG segment is encodeURIComponent'd so spaces/
// unicode in the name are handled — encodeURIComponent leaves '-' alone (it's unreserved), which
// is exactly the literal separator op.gg's URL scheme expects.
function opggUrl(riotId, region) {
  if (!riotId) return null;
  const [name, tag] = String(riotId).split('#');
  if (!name) return null;
  const seg = encodeURIComponent(tag ? `${name}-${tag}` : name);
  return `https://op.gg/lol/summoners/${(region || CTX.region || 'euw').toLowerCase()}/${seg}`;
}

// Renders a player Riot ID as a link to their op.gg profile (new tab), keeping the exact same
// esc()'d text used everywhere names already render. Falls back to plain escaped text if the
// name is missing/unparseable rather than emitting a dead link.
function nameLink(riotId, region) {
  const label = esc(riotId);
  const url = opggUrl(riotId, region);
  if (!url) return label;
  return `<a class="plink" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

// Win probability, poker-style — a logistic on the same effective team-GA gap the fairness check
// itself uses (lib/riot.mjs's fairness()), so it never disagrees with everything else on the page.
// Team-colored, and whichever side is favored reads slightly bolder (nudges the eye toward the
// more confident number without shouting over the verdict badge it sits under). Legacy entries
// analyzed before this feature shipped don't have g.winProb — omitted entirely rather than
// showing a fake 50/50. Defined up here (not near its callers further down) because renderRows
// below is invoked synchronously at module load time (via the restoreLastSearch IIFE) and needs
// winProbCompact already initialized — a `const` declared after that call site would still be in
// its temporal dead zone when renderRows actually runs.
function winProbHTML(wp) {
  if (!wp) return '';
  const blueHi = wp.blue >= wp.red;
  return `<div class="wp-line"><span class="wp-blue${blueHi ? ' wp-hi' : ''}">BLUE ${wp.blue}%</span> · <span class="wp-red${!blueHi ? ' wp-hi' : ''}">RED ${wp.red}%</span></div>`;
}
// Compact "55–45" form for tight spaces (row one-liners) — same null-safe convention as above.
const winProbCompact = wp => wp ? `${wp.blue}–${wp.red}` : '';

// Game-row date/duration is squeezed into a fixed column (see .col-date), so it needs to be as
// short as possible: duration drops the seconds ("38m 24s" -> "38m", "12m (in progress)"
// unaffected since it has no seconds token to strip). The date itself is shown as a short
// relative timestamp (relativeDate) — "23m ago" reads at a glance in a way an absolute date never
// does in a scan-a-list context — with the full absolute date/time (absoluteDate) moved to the
// cell's title tooltip so precision isn't lost, just deprioritized.
const shortDuration = d => {
  if (!d) return '';
  const m = /^(\d+)m/.exec(d);
  if (!m) return d;
  const rest = d.slice(m[0].length).trim().replace(/^\d+s\s*/, '');
  return rest ? `${m[1]}m ${rest}` : `${m[1]}m`;
};
// "Xm ago" under an hour, "Xh ago" under a day, "Xd ago" beyond that (weeks read fine as e.g.
// "12d ago" — no need for month/year granularity for a recent-games list).
const relativeDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};
const absoluteDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const two = n => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
// Riot IDs are typed inconsistently ("Name #TAG" vs "Name#TAG") — normalize whitespace around
// the '#' everywhere before it's used as a cache/history key, so both forms resolve the same entry.
const normRiotId = s => String(s || '').trim().replace(/\s*#\s*/, '#');
// Returns both the fetch headers AND the exact key string that went into them, so a caller that
// later needs to react to a failed request (handleKeyError below) can tell whether THIS key is
// still the one sitting in the field, instead of assuming it still is.
const hdrs = () => { const k = $('#apiKey').value.trim(); return { headers: k ? { 'x-api-key': k } : {}, key: k }; };
// A request that SENT the user's stored key can fail because that key expired/was revoked
// (lib/riot.mjs's friendly 401/403 message contains 'key invalid or expired') — when that
// happens, auto-clear the dead key instead of leaving the user stuck retrying with it.
// Critically, the api/*.mjs handlers now append '(your pasted key)' or '(the shared server key)'
// to every caught error depending on which key was actually in play server-side — only the
// former should ever clear the user's field. Without this, a failure that was really the
// server's own expired shared key (e.g. because the client's key header happened to be empty for
// that one request) would get mislabeled and wipe out the user's perfectly valid key instead.
// Race fix: `sentKeyValue` is the EXACT key string this particular request sent (from hdrs()
// above), not just a boolean. A slow in-flight request can resolve its 401 well after the user
// has already pasted a new key over the old one — if the field no longer holds the key that
// actually failed, that failure says nothing about the key sitting there now, so don't clear it
// or tell the user their (perfectly fine, newly pasted) key was removed. Just silently re-check
// the new one so its ✓/✗ indicator is accurate.
function handleKeyError(err, sentKeyValue) {
  const msg = String(err?.message || '');
  if (!sentKeyValue || !msg.includes('key invalid or expired') || !msg.includes('(your pasted key)')) return false;
  if ($('#apiKey').value.trim() !== sentKeyValue) { checkKeyValidity(); return true; }
  $('#apiKey').value = '';
  localStorage.removeItem('rgapi');
  $('#keyValid').textContent = ''; $('#keyValid').title = ''; $('#keyValid').className = '';
  $('#status').textContent = 'Your saved Riot API key was expired and has been removed — paste a fresh one from developer.riotgames.com, or continue keyless (3/day).';
  return true;
}
// Verdict is binary (FAIR / NOT FAIR — echoing the app name). Legacy cached entries may still
// carry the old 'OK' / 'NOT OK' / 'BORDERLINE' values — map those to the same two states.
const isFairVerdict = v => v === 'OK' || v === 'FAIR';
// NOT FAIR is further qualified by `direction` (lib/riot.mjs's fairness().direction, persisted on
// the entry) — which team the imbalance actually favors, relative to the analyzed profile. Used
// to be spelled out in the badge text too ("NOT FAIR · THEIR FAVOR" / "· YOUR FAVOR"), but that
// took too much space — now that against/favor already have distinct colors (red/amber), color
// alone carries the direction and the label always just reads "NOT FAIR"; the wording lives only
// in the tooltip (verdictTitle). v4.1: the engine no longer ever emits 'mixed' (every verdict is
// now FAIR or a clearly-directed NOT FAIR — see fairness()'s net-direction logic) — 'mixed' can
// only appear on a legacy cached entry analyzed before that change, and is treated as red/needs
// re-analysis rather than its own real category.
const verdictCls = (v, dir) => isFairVerdict(v) ? 'b-ok' : dir === 'favor' ? 'b-mid' : 'b-bad';
const verdictLabel = (v) => isFairVerdict(v) ? 'FAIR' : 'NOT FAIR';
// tooltip is the engine's verdictTooltip — the actual fired reasons (NOT FAIR) or the offsetting
// explanation (FAIR-but-imbalanced), terse, straight from lib/riot.mjs. Legacy entries analyzed
// before that field existed (or that still carry the retired 'mixed' direction) fall back to a
// generic message pointing at re-analysis instead of guessing at content that isn't stored.
const verdictTitle = (v, dir, tooltip) => {
  if (dir === 'mixed') return 'Re-analyze for updated verdict';
  if (tooltip) return tooltip;
  if (isFairVerdict(v)) return '';
  return dir === 'against' ? "The lobby was stacked in the enemy team's favor" : dir === 'favor' ? "The lobby was stacked in your team's favor" : 'Re-analyze for updated verdict';
};
let CTX = { riotId: '', region: 'euw' };

// ---- bookmarks: localStorage always; synced to the Clerk account when signed in ----
// Riot IDs must be normalized (normRiotId, above) at every read/write/compare here — bookmarks
// used to be saved with whatever raw string was in the field, so "Name #TAG" (typed with a
// space) and "Name#TAG" would end up as two separate entries pointing at the same account.
let clerk = null;
const dedupeBookmarks = list => {
  const seen = new Map();
  for (const b of list || []) {
    const riotId = normRiotId(b?.riotId);
    if (!riotId) continue;
    const key = riotId.toLowerCase();
    if (!seen.has(key)) seen.set(key, { riotId, region: b.region });
  }
  return [...seen.values()];
};
const getBM = () => { try { return JSON.parse(localStorage.getItem('bookmarks') || '[]'); } catch { return []; } };
const isBM = id => getBM().some(b => normRiotId(b.riotId).toLowerCase() === normRiotId(id).toLowerCase());
const setBM = l => { localStorage.setItem('bookmarks', JSON.stringify(dedupeBookmarks(l))); renderBM(); };
// One-time migration for bookmarks saved before normalization was applied everywhere: clean up
// space variants already sitting in localStorage (keeps the first of each, case-insensitive)
// and write the deduped list straight back.
(() => {
  const raw = getBM();
  const cleaned = dedupeBookmarks(raw);
  if (cleaned.length !== raw.length || cleaned.some((c, i) => c.riotId !== raw[i]?.riotId)) {
    localStorage.setItem('bookmarks', JSON.stringify(cleaned));
  }
})();
function renderBM() {
  $('#bmDrop').innerHTML = getBM().map(b => `<div class="bmItem" data-riotid="${esc(b.riotId)}" data-region="${esc(b.region)}">★ ${esc(b.riotId)} <span class="dim">(${esc(b.region)})</span></div>`).join('');
  updateStar();
}
function openDrop() { if (getBM().length) $('#bmDrop').classList.add('open'); }
function closeDrop() { $('#bmDrop').classList.remove('open'); }
function updateStar() {
  const on = isBM(normRiotId($('#riotId').value));
  $('#bmStar').textContent = on ? '★' : '☆';
  $('#bmStar').classList.toggle('starred', on);
}
async function authHdr() { try { const t = clerk?.session ? await clerk.session.getToken() : null; return t ? { Authorization: 'Bearer ' + t } : {}; } catch { return {}; } }
async function serverBM(op, riotId, region) {
  const h = await authHdr(); if (!h.Authorization) return null;
  try {
    const r = await fetch(`${API}/api/bookmarks`, op
      ? { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ op, riotId, region }) }
      : { headers: h });
    if (!r.ok) return null;
    return (await r.json()).bookmarks;
  } catch { return null; }
}
$('#bmStar').addEventListener('click', async () => {
  const riotId = normRiotId($('#riotId').value);
  if (!riotId.includes('#')) return;
  const region = $('#region').value, on = isBM(riotId);
  setBM(on ? getBM().filter(b => normRiotId(b.riotId).toLowerCase() !== riotId.toLowerCase()) : [...getBM(), { riotId, region }]);
  const synced = await serverBM(on ? 'remove' : 'add', riotId, region);
  if (synced) setBM(synced);
});
$('#bmDrop').addEventListener('click', e => {
  const item = e.target.closest('.bmItem'); if (!item) return;
  $('#riotId').value = normRiotId(item.dataset.riotid);
  $('#region').value = item.dataset.region || 'euw';
  closeDrop();
  updateStar();
  $('#f').requestSubmit();
});
$('#riotId').addEventListener('focus', openDrop);
$('#riotId').addEventListener('click', openDrop);
document.addEventListener('click', e => { if (!e.target.closest('.combo')) closeDrop(); });
$('#riotId').addEventListener('input', updateStar);
renderBM();

// Keep the lastSearch cache (used to restore the list on page load) in sync with what actually
// got analyzed — otherwise a refresh right after analyzing a game shows that row back as
// "Analyze" (stale) even though it's genuinely already analyzed and shows correctly in history,
// since the cache was only ever written at search time. No-ops if the cache doesn't match this
// riotId, or doesn't have this matchId (e.g. a live game not yet in the recent-games list).
function syncLastSearchAnalyzed(riotId, matchId, entry) {
  let cached;
  try { cached = JSON.parse(localStorage.getItem('lastSearch') || 'null'); } catch { cached = null; }
  if (!cached || cached.riotId !== riotId || !Array.isArray(cached.games)) return;
  const idx = cached.games.findIndex(g => g.matchId === matchId);
  if (idx === -1) return;
  cached.games[idx] = { ...cached.games[idx], cached: true, matchmaking: entry.matchmaking, direction: entry.direction, verdictTooltip: entry.verdictTooltip, oneLiner: entry.oneLiner };
  localStorage.setItem('lastSearch', JSON.stringify(cached));
}

// Restore the last search from cache on load so a refresh doesn't lose the list — the cached
// list renders instantly, then a silent background refetch catches up on anything that changed
// since. Failures during that background refetch are swallowed: errors only surface for
// user-initiated searches, the cached view is a perfectly fine thing to keep showing.
(function restoreLastSearch() {
  let cached;
  try { cached = JSON.parse(localStorage.getItem('lastSearch') || 'null'); } catch { cached = null; }
  if (!cached || !cached.riotId || !Array.isArray(cached.games)) return;
  CTX = { riotId: cached.riotId, region: cached.region || 'euw' };
  $('#riotId').value = cached.riotId;
  $('#region').value = cached.region || 'euw';
  updateStar();
  renderRows(cached.games, $('#list'), 'm', cached.riotId);
  loadHistory(0);
  if (Date.now() - (cached.ts || 0) < 60000) return; // cache is fresh enough, skip the refetch
  fetch(`${API}/api/matches?riotId=${encodeURIComponent(cached.riotId)}&games=${$('#games').value}&region=${cached.region}`, { headers: hdrs().headers })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(data => {
      renderRows(data.games, $('#list'), 'm', cached.riotId);
      localStorage.setItem('lastSearch', JSON.stringify({ riotId: cached.riotId, region: cached.region, games: data.games, ts: Date.now() }));
    })
    .catch(() => {}); // silent — keep the cached view as-is
})();

// After a live analysis (see checkLive's liveWatch marker below), the finished game should
// surface at the top of the last-games list on its own — Riot's match-v5 indexing lags ~1-2min
// behind the actual game end, so even right when the user is back it may not show up yet. Poll
// for it a few times instead of requiring a manual re-search, bypassing restoreLastSearch's own
// 60s-freshness guard above since this is a distinct, deliberate refresh. Triggered on page load
// and whenever the tab regains focus; liveWatchActive stops repeated focus events from stacking
// multiple retry chains on top of each other.
let liveWatchActive = false;
const LIVE_WATCH_MAX_AGE = 6 * 60 * 60 * 1000; // stale after 6h — give up and let it be cleared
const LIVE_WATCH_MAX_TRIES = 5;
// Auto-upgrading a live-scouted game must fire at most once per matchId — a small capped
// localStorage list, checked (and written to) before ever calling analyze() automatically, so
// even a page reload or an overlapping poll mid-analysis can't trigger a second auto-run for the
// same game. Capped at 20 so this never grows unbounded; oldest entries drop first.
const AUTO_FINAL_CAP = 20;
function autoFinalDoneHas(matchId) {
  let list;
  try { list = JSON.parse(localStorage.getItem('autoFinalDone') || '[]'); } catch { list = null; }
  return Array.isArray(list) && list.includes(matchId);
}
function autoFinalDoneAdd(matchId) {
  let list;
  try { list = JSON.parse(localStorage.getItem('autoFinalDone') || '[]'); } catch { list = null; }
  if (!Array.isArray(list)) list = [];
  if (!list.includes(matchId)) list.push(matchId);
  while (list.length > AUTO_FINAL_CAP) list.shift();
  try { localStorage.setItem('autoFinalDone', JSON.stringify(list)); } catch {}
}
async function pollLiveWatch(attempt = 0) {
  let marker;
  try { marker = JSON.parse(localStorage.getItem('liveWatch') || 'null'); } catch { marker = null; }
  if (!marker || !marker.matchId || !marker.riotId) { liveWatchActive = false; return; }
  if (Date.now() - (marker.ts || 0) > LIVE_WATCH_MAX_AGE) { localStorage.removeItem('liveWatch'); liveWatchActive = false; return; }
  liveWatchActive = true;
  try {
    const r = await fetch(`${API}/api/matches?riotId=${encodeURIComponent(marker.riotId)}&games=${$('#games').value}&region=${marker.region}`, { headers: hdrs().headers });
    if (r.ok) {
      const data = await r.json();
      CTX = { riotId: marker.riotId, region: marker.region };
      $('#riotId').value = marker.riotId;
      $('#region').value = marker.region;
      updateStar();
      renderRows(data.games, $('#list'), 'm', marker.riotId);
      localStorage.setItem('lastSearch', JSON.stringify({ riotId: marker.riotId, region: marker.region, games: data.games, ts: Date.now() }));
      const idx = data.games.findIndex(g => g.matchId === marker.matchId);
      if (idx !== -1) {
        // Found it — the game finished and Riot has it indexed. Automatically run the final
        // analysis (user explicitly asked for this — "then after the game we need to update it
        // automatically"), reusing analyze() exactly as a manual click on this row's button
        // would: same key/quota fallback, same 409-queued retry, same spinner/error UI on the
        // button itself. Marked done BEFORE firing so nothing can double-trigger it. The
        // liveWatch marker only clears once analyze() fully settles (success or a definitive,
        // non-retrying failure — analyze() already exhausts its own 409 retries internally
        // before its promise resolves) — if it fails (expired key, quota), the marker is gone
        // but the row keeps its amber wasLive-ready highlight regardless (that comes from
        // g.wasLive at render time, not from the marker), so manual recovery still works.
        if (!autoFinalDoneHas(marker.matchId)) {
          autoFinalDoneAdd(marker.matchId);
          const rowKey = 'm' + idx;
          const btn = document.getElementById('v' + rowKey);
          if (btn) { analyze(marker.matchId, btn, rowKey).finally(() => localStorage.removeItem('liveWatch')); }
          else localStorage.removeItem('liveWatch'); // shouldn't happen — row just rendered above
        } else {
          localStorage.removeItem('liveWatch'); // already auto-attempted this game before
        }
        liveWatchActive = false;
        return;
      }
    }
  } catch {} // quiet — this is a background convenience poll, never surface an error for it
  if (attempt < LIVE_WATCH_MAX_TRIES - 1) setTimeout(() => pollLiveWatch(attempt + 1), 60000);
  else liveWatchActive = false; // exhausted retries this session — marker stays for next load/focus
}
function triggerLiveWatch() { if (!liveWatchActive) pollLiveWatch(0); }
triggerLiveWatch();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') triggerLiveWatch(); });

// ---- optional Clerk sign-in: accounts, cross-device bookmarks, per-user quota ----
const CLERK_PK = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (CLERK_PK) {
  import('@clerk/clerk-js').then(async ({ Clerk }) => {
    clerk = new Clerk(CLERK_PK);
    await clerk.load();
    const el = $('#clerkBtn');
    if (clerk.user) {
      clerk.mountUserButton(el);
      const synced = await serverBM(null);
      if (synced) {
        const merged = [...synced];
        for (const b of getBM()) if (!merged.some(m => normRiotId(m.riotId).toLowerCase() === normRiotId(b.riotId).toLowerCase())) { merged.push(b); await serverBM('add', b.riotId, b.region); }
        setBM(merged);
      }
    } else {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'mini'; btn.textContent = 'Sign in';
      btn.addEventListener('click', () => clerk.openSignIn());
      el.appendChild(btn);
    }
  }).catch(() => {});
}

// Top-level buttons (#go / #liveBtn) are locked for the duration of ANY in-flight operation —
// the initial search, a per-game analyze, or a live-game check — using a small refcount so
// overlapping operations (e.g. two "Analyze" clicks on different rows) don't unlock early.
let busyCount = 0;
function beginBusy() { busyCount++; $('#go').disabled = true; $('#liveBtn').disabled = true; }
function endBusy() { busyCount = Math.max(0, busyCount - 1); if (busyCount === 0) { $('#go').disabled = false; $('#liveBtn').disabled = false; } }

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  // CTX (and localStorage's 'riotId') must NOT be reassigned until the search actually succeeds
  // — otherwise a failed lookup (e.g. expired key) leaves CTX pointing at the new account while
  // the rows/history still on screen belong to the previous one, and every subsequent "View"
  // click on those rows targets the wrong account. Use a local attempt for the fetch instead.
  const attempt = { riotId: normRiotId($('#riotId').value), region: $('#region').value };
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  const goLabel = $('#go').textContent;
  beginBusy();
  $('#go').innerHTML = '<span class="spinner"></span>';
  $('#status').textContent = '';
  let sentKey = false;
  try {
    const { headers: h, key: hKey } = hdrs(); sentKey = hKey;
    const r = await fetch(`${API}/api/matches?riotId=${encodeURIComponent(attempt.riotId)}&games=${$('#games').value}&region=${attempt.region}`, { headers: h });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    CTX = attempt;
    localStorage.setItem('riotId', CTX.riotId);
    $('#list').innerHTML = ''; // only clear the previous list once the new one is ready to replace it
    renderRows(data.games, $('#list'), 'm', CTX.riotId);
    // The rows speak for themselves (✓ badges already mark analyzed games) — no instructional
    // sentence needed once there's a list to look at; only the empty-results case still needs a
    // status message, since there's nothing on screen to explain otherwise.
    $('#status').textContent = data.games.length ? '' : 'No ranked solo games found.';
    localStorage.setItem('lastSearch', JSON.stringify({ riotId: CTX.riotId, region: CTX.region, games: data.games, ts: Date.now() }));
    loadHistory(0);
  } catch (err) { if (!handleKeyError(err, sentKey)) $('#status').innerHTML = '❌ ' + esc(err.message); }
  finally { endBusy(); $('#go').textContent = goLabel; }
});

$('#liveBtn').addEventListener('click', async () => {
  const riotId = normRiotId($('#riotId').value), region = $('#region').value;
  if (!riotId.includes('#')) return;
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  localStorage.setItem('riotId', riotId);
  const liveLabel = $('#liveBtn').innerHTML;
  beginBusy();
  $('#liveBtn').innerHTML = '<span class="spinner"></span>';
  $('#status').textContent = '';
  try {
    await checkLive(riotId, region);
  } finally { endBusy(); $('#liveBtn').innerHTML = liveLabel; }
});

async function checkLive(riotId, region, attempt = 0) {
  let sentKey = false;
  try {
    const { headers: h, key: hKey } = hdrs(); sentKey = hKey;
    const r = await fetch(`${API}/api/live?riotId=${encodeURIComponent(riotId)}&region=${region}`, { headers: h });
    const data = await r.json();
    if (r.status === 409 && attempt < 15) { // shared analyzer busy — auto retry, shown on the button
      $('#liveBtn').innerHTML = `<span class="spinner"></span> #${attempt + 1}`;
      await new Promise(res => setTimeout(res, 20000));
      return checkLive(riotId, region, attempt + 1);
    }
    if (!r.ok) throw new Error(data.error || r.status);
    if (data.inGame === false) { $('#status').textContent = 'Not in a game right now.'; }
    else if (data.unsupported) { $('#status').textContent = 'In game, but not Ranked Solo/Duo.'; }
    else {
      CTX = { riotId, region };
      syncLastSearchAnalyzed(riotId, data.entry.matchId, data.entry);
      renderLive(data.entry);
      $('#status').textContent = '';
      // Remember this game so that once it ends (Riot's match-v5 indexing lags 1-2min behind
      // the actual game end), the next time the user opens or refocuses the app, their finished
      // live-reviewed game surfaces at the top of the last-games list on its own — see
      // pollLiveWatch below — instead of requiring a manual re-search.
      try { localStorage.setItem('liveWatch', JSON.stringify({ matchId: data.entry.matchId, riotId, region, ts: Date.now() })); } catch {}
    }
  } catch (err) {
    if (!handleKeyError(err, sentKey)) $('#status').innerHTML = '❌ ' + esc(err.message);
  }
}

// Compact single-row live header: a player mid-loading-screen wants LIVE status, champ, time,
// the lane recommendation and the fairness note at a glance — not a two-row banner. reco is
// built from reco.lane/reco.delta directly (not reco.text, which is the old wordier "your bot
// lane is +19 GA ahead" sentence used elsewhere) so it can be kept to "PLAY FOR BOT +19 GA".
function liveRecoHTML(reco) {
  if (!reco) return '';
  if (reco.delta > 0) return `<b class="reco-inline">PLAY FOR ${esc(reco.lane)} +${reco.delta} GA</b>`;
  return `<span class="reco-inline dim">No favored lane · best ${esc(reco.lane)} (${reco.delta})</span>`;
}
// User-team win% for the live header, dim, tacked on after the lane recommendation ("· 58% you")
// — kept to the same single line as everything else in .live-head. Omitted for legacy/incomplete
// entries without g.winProb rather than showing a fake number.
function liveWinProbHTML(wp, userTeam) {
  if (!wp || !userTeam) return '';
  const pct = userTeam === 'blue' ? wp.blue : wp.red;
  return `<span class="dim">· ${pct}% you</span>`;
}

function renderLive(g) {
  document.getElementById('liveCard')?.remove();
  const mins = Math.max(0, Math.round((Date.now() - new Date(g.when).getTime()) / 60000));
  const card = document.createElement('div');
  card.className = 'gcard open';
  card.id = 'liveCard';
  card.innerHTML = `
    <div class="row">
      <span class="live-head">
        <span class="badge b-live">LIVE</span>
        <span>${esc(g.user?.champ || '')}</span>
        <span class="dim">· ${mins} min</span>
        ${g.recommendation ? '<span class="dim">—</span>' : ''}
        ${liveRecoHTML(g.recommendation)}
        ${liveWinProbHTML(g.winProb, g.userTeam)}
      </span>
      <span class="one-h" title="${esc(g.oneLiner || '')}">${esc(g.oneLiner || '')}</span>
    </div>
    <div class="details">
      ${detailsHTML(g, 'live')}
    </div>`;
  $('#list').insertBefore(card, $('#list').firstChild);
}

// v4.11: a game can show up in BOTH the top #list (the search's last-N-games results) and this
// "analyzed history" list below it (history is an independent, older-inclusive query) — read as
// the same 5 rows appearing twice. Read the matchIds currently rendered in #list live from the
// DOM (rather than threading the search results through every loadHistory call site) so it works
// regardless of which path populated #list: a search submit, the live-watch auto-upgrade, or
// restoreLastSearch on page load.
function listedMatchIds() {
  return new Set(Array.from($('#list').querySelectorAll('[data-mid]')).map(el => el.dataset.mid));
}

async function loadHistory(offset) {
  try {
    const r = await fetch(`${API}/api/history?riotId=${encodeURIComponent(CTX.riotId)}&offset=${offset}&limit=10`);
    const d = await r.json();
    if (!r.ok || !d.total) { $('#histWrap').style.display = 'none'; return; }
    // Only the newest page can possibly overlap with #list (both sort newest-first, so a game
    // shared between them can only ever be among #list's most recent handful) — the exclusion
    // filter is scoped to offset 0 for that reason; older pages render/count exactly as before.
    const listedIds = offset === 0 ? listedMatchIds() : new Set();
    const games = d.games.filter(g => !listedIds.has(g.matchId));
    const hidden = d.games.length - games.length;
    const total = Math.max(0, d.total - hidden); // count reflects the filtered view
    if (!games.length && !total) { $('#histWrap').style.display = 'none'; return; }
    $('#histWrap').style.display = 'block';
    renderRows(games, $('#hist'), 'h' + offset + '_', CTX.riotId);
    if (total <= 10) { $('#histNav').innerHTML = ''; return; }
    const from = offset + 1, to = offset + games.length;
    $('#histNav').innerHTML =
      (offset > 0 ? `<button class="mini" id="hNewer">◀ 10 newer</button>` : '') +
      `<span>${from}–${to} of ${total} analyzed games</span>` +
      (to < total ? `<button class="mini" id="hOlder">10 older ▶</button>` : '');
    const newer = $('#hNewer'), older = $('#hOlder');
    if (newer) newer.addEventListener('click', () => loadHistory(Math.max(0, offset - 10)));
    if (older) older.addEventListener('click', () => loadHistory(offset + 10));
  } catch { $('#histWrap').style.display = 'none'; }
}

function renderRows(games, container, prefix, rid) {
  container.innerHTML = games.map((g, i) => {
    if (g.remake) return ''; // server no longer sends remakes; guard is only for legacy lastSearch cache
    const key = prefix + i;
    const badge = g.cached && g.matchmaking ? `<span class="badge ${verdictCls(g.matchmaking, g.direction)}" id="b${key}" title="${esc(verdictTitle(g.matchmaking, g.direction, g.verdictTooltip))}">${verdictLabel(g.matchmaking, g.direction)}</span>` : `<span id="b${key}"></span>`;
    const oneLiner = g.cached ? esc(g.oneLiner || '') : '';
    // Compact win% tag appended into the (already-flexible, already-truncating) one-liner area
    // rather than as a new fixed sibling column — the row's other columns are deliberately tight
    // (see .col-* below), so this only ever grows the one element already designed to absorb
    // extra content. Row-summary data (this initial render) never carries winProb — kept out of
    // the lightweight /api/matches and /api/history payloads on purpose — so this is empty here
    // and only appears once a row has actually been analyzed/viewed (see analyze()'s DOM update).
    const wpCompact = winProbCompact(g.winProb);
    const oneLinerHTML = oneLiner + (wpCompact ? ` <span class="wp-compact" title="Estimated pre-game win chance BLUE–RED">${esc(wpCompact)}</span>` : '');
    // A live-snapshot entry (g.live — only ever set on rows coming through /api/history; the
    // search-list path via /api/matches never marks a cached row live, it falls through to the
    // uncached/wasLive branch instead) is still pre-game, not a finished game with an unknown-yet
    // result — "there is no live in history, a game is a game". So no LIVE badge here (that's
    // reserved for the actual current in-progress card, renderLive, untouched by any of this) —
    // just a dim placeholder where the result would go, and no fake "0m (in progress)" duration.
    const resultEl = g.live
      ? '<span class="dim">—</span>'
      : (g.result === 'Live' ? '<span class="badge b-live">LIVE</span>' : `<span class="res-${(g.result || '?')[0]}">${esc(g.result)}</span>`);
    const dateHTML = g.live ? esc(relativeDate(g.when)) : `${esc(shortDuration(g.duration))} · ${esc(relativeDate(g.when))}`;
    // Result/champ/KDA/badge/date are fixed-width columns (see .col-* in style.css) so every
    // row lines up vertically and none of them ever wraps internally — only the one-liner
    // flexes/truncates. .col-badge is deliberately wider than the badge itself (150px) to leave
    // room for a possible favored/against indicator alongside it later; empty for unanalyzed rows.
    // Each row's button remembers the account it belongs to (data-rid) rather than relying on
    // whatever CTX happens to be at click time — CTX can drift (e.g. a failed later search that
    // leaves the previous rows on screen), but the row itself always knows its own account.
    // data-force marks rows that came back as a live-only snapshot (g.wasLive from /api/matches)
    // — their "Analyze" click must force a fresh deep analysis rather than re-serving the snapshot.
    // Cached rows additionally get a small "↻" re-analyze button next to View, so an already
    // -analyzed game can be re-judged with whatever the scoring engine looks like today (or, for
    // a still-live history row, upgraded to its final analysis — same amber wasLive-ready
    // highlight either way). It carries its own data-force="1" (independent of data-wasLive), and
    // shares the row's key so analyze() can look up the View button (id v${key}) and keep the
    // two in sync. Re-analyzing a live row calls the same putAnalysis PK, so it overwrites this
    // row in place — no duplicate entry, it just becomes a normal final row next render.
    const reanalyzeBtn = g.cached
      ? `<button class="mini icon-btn${g.live ? ' wasLive-ready' : ''}" data-mid="${esc(g.matchId)}" data-key="${key}" data-rid="${esc(rid)}" data-force="1" title="${g.live ? 'Game finished? Get the final analysis' : 'Re-analyze with the latest scoring (needs a key or a free slot)'}">↻</button>`
      : '';
    return `<div class="gcard" id="g${key}">
      <div class="row">
        <span class="col-res">${resultEl}</span>
        <span class="col-champ" title="${esc(g.champ)}">${esc(g.champ)}</span>
        <span class="col-kda">${esc(g.kda)}</span>
        <span class="col-badge">${badge}</span>
        <span class="col-date dim" title="${esc(absoluteDate(g.when))}">${dateHTML}</span>
        <span class="one-h" id="o${key}" title="${oneLiner}">${oneLinerHTML}</span>
        <button class="mini${g.wasLive ? ' wasLive-ready' : ''}" id="v${key}" data-mid="${esc(g.matchId)}" data-key="${key}" data-rid="${esc(rid)}"${g.wasLive ? ' data-force="1" title="Your live-reviewed game just ended — click for the final analysis"' : ''}>${g.cached ? '✓ View' : 'Analyze'}</button>
        ${reanalyzeBtn}
      </div>
      <div class="details" id="d${key}"></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.mini').forEach(b => b.addEventListener('click', () => analyze(b.dataset.mid, b, b.dataset.key)));
}

async function analyze(matchId, btn, i, attempt = 0) {
  const card = document.getElementById('g' + i);
  // The re-analyze "↻" button is a separate element from the row's View button — it always
  // fetches fresh (its own data-force="1") and never toggles collapse/expand the way View does,
  // it only ever re-renders the details panel in place. The actual "loaded/open" bookkeeping
  // still belongs to the View button (found by row key, since a re-analyze click comes from a
  // different <button>), so success below updates that one too and a later View click reads
  // correctly.
  const isReanalyze = btn.classList.contains('icon-btn');
  if (!isReanalyze && btn.dataset.loaded) { card.classList.toggle('open'); btn.textContent = card.classList.contains('open') ? '▴ Hide' : '✓ View'; return; }
  // The row's own account (set at render time), not CTX — CTX may have moved on since these
  // rows were rendered (a failed later search leaves stale rows on screen without touching CTX).
  const rid = btn.dataset.rid || CTX.riotId;
  const force = btn.dataset.force === '1' ? '&force=1' : '';
  const viewBtn = isReanalyze ? document.getElementById('v' + i) : btn;
  const prevIcon = isReanalyze ? btn.innerHTML : null;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  if (isReanalyze && viewBtn) viewBtn.disabled = true;
  beginBusy();
  let sentKey = false;
  try {
    const { headers: h, key: hKey } = hdrs(); sentKey = hKey;
    const r = await fetch(`${API}/api/analyze?riotId=${encodeURIComponent(rid)}&matchId=${encodeURIComponent(matchId)}&region=${CTX.region}${force}`, { headers: h });
    const data = await r.json();
    if (r.status === 409 && attempt < 15) { // shared analyzer busy — auto retry, shown on the button
      btn.innerHTML = `<span class="spinner"></span> #${attempt + 1}`;
      await new Promise(res => setTimeout(res, 20000));
      return await analyze(matchId, btn, i, attempt + 1);
    }
    if (!r.ok) throw new Error(data.error || r.status);
    const g = data.entry;
    syncLastSearchAnalyzed(rid, matchId, g);
    // Replace the details panel unconditionally — even if it was already open from a previous
    // View, a re-analyze must overwrite the stale content with the fresh entry, not skip it.
    document.getElementById('d' + i).innerHTML = detailsHTML(g, i, rid);
    const badgeEl = document.getElementById('b' + i);
    if (badgeEl) { badgeEl.className = 'badge ' + verdictCls(g.matchmaking, g.direction); badgeEl.textContent = verdictLabel(g.matchmaking, g.direction); badgeEl.title = verdictTitle(g.matchmaking, g.direction, g.verdictTooltip); }
    const oneEl = document.getElementById('o' + i);
    if (oneEl) {
      const wpCompact = winProbCompact(g.winProb);
      oneEl.innerHTML = esc(g.oneLiner || '') + (wpCompact ? ` <span class="wp-compact" title="Estimated pre-game win chance BLUE–RED">${esc(wpCompact)}</span>` : '');
      oneEl.title = g.oneLiner || '';
    }
    if (viewBtn) { viewBtn.dataset.loaded = '1'; viewBtn.textContent = '▴ Hide'; viewBtn.disabled = false; }
    card.classList.add('open');
    $('#status').textContent = '';
    // A forced (re-)analysis can change what history shows for this game — most importantly, a
    // live snapshot upgrading to its final analysis (same putAnalysis row, overwritten in place)
    // needs its history row to stop looking like a live snapshot too. Plain View on an
    // already-final cached entry doesn't change anything history would show, so skip this
    // entirely then — loadHistory(0) fully replaces #hist's DOM, which would otherwise silently
    // "close" whatever history card the user had open (a plain View never touches #hist at all,
    // so it never had this problem).
    if (force) {
      // If this same game currently has an OPEN row in history (it can appear in both the search
      // list and history at once, and either one's button can be what triggered this call),
      // snapshot that before the rebuild wipes #hist, then restore it afterward on the fresh DOM
      // — re-run detailsHTML for the new element, since the old one no longer exists. If the row
      // has fallen off page 1 by the time loadHistory(0) resets there, there's nothing to
      // restore, which is fine (page-reset-on-refresh is unchanged, pre-existing behavior).
      const histBtn = document.querySelector(`#hist .mini[data-mid="${CSS.escape(matchId)}"]:not(.icon-btn)`);
      const wasHistOpen = !!histBtn?.dataset.loaded;
      await loadHistory(0);
      if (wasHistOpen) {
        const freshBtn = document.querySelector(`#hist .mini[data-mid="${CSS.escape(matchId)}"]:not(.icon-btn)`);
        const freshKey = freshBtn?.id.slice(1); // id="v${key}" -> key
        const freshCard = freshKey && document.getElementById('g' + freshKey);
        const freshDetails = freshKey && document.getElementById('d' + freshKey);
        if (freshBtn && freshCard && freshDetails) {
          freshDetails.innerHTML = detailsHTML(g, freshKey, rid);
          freshCard.classList.add('open');
          freshBtn.dataset.loaded = '1';
          freshBtn.textContent = '▴ Hide';
        }
      }
    }
  } catch (err) {
    if (!handleKeyError(err, sentKey)) $('#status').innerHTML = '❌ ' + esc(err.message);
    if (!isReanalyze) { btn.textContent = 'Analyze'; btn.disabled = false; }
    else if (viewBtn) viewBtn.disabled = false;
  } finally {
    if (isReanalyze) { btn.innerHTML = prevIcon; btn.disabled = false; }
    endBusy();
  }
}

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const badgeHTML = p => p?.badge ? `<span class="badge-${p.badge.toLowerCase()}" title="${p.badge === 'MVP' ? 'Best performance of the winning team' : 'Best performance of the losing team'}">${p.badge}</span>` : '';

// Legacy cached entries may predate the duoWith/duoShared fields (or even the duo flag) on
// player objects, since those were added after duo detection itself. g.duos is always present
// though, so backfill from it — mutates g.players in place and is safe to call on every render.
function enrichDuos(g) {
  if (!g?.duos?.length || !g.players?.length) return g;
  for (const [a, b, sharedText] of g.duos) {
    const n = parseInt(sharedText, 10);
    const pa = g.players.find(p => p.n === a), pb = g.players.find(p => p.n === b);
    if (pa) { pa.duo = true; if (pa.duoWith == null) pa.duoWith = b; if (pa.duoShared == null) pa.duoShared = n; }
    if (pb) { pb.duo = true; if (pb.duoWith == null) pb.duoWith = a; if (pb.duoShared == null) pb.duoShared = n; }
  }
  return g;
}

// Shared compact chip group for a player's flags/duo/streak/cspm — used identically in the
// summary matchup table and the per-team details tables so both views render the same way.
// oppChamp (matchup view only — the details tables don't pair opposing lanes, so they call this
// without it and simply never show the countered chip there) drives the one chip that needs
// opponent context: a known lane counter against them (see lib/counters.mjs).
function chipsHTML(p, oppChamp) {
  if (!p) return '';
  const c = [];
  // Every chip gets a semantic color — no grey/default chips. Neutral/informational facts
  // (DUO, OTP) are blue; risk signals that hurt confidence in the GA number (autofill, rusty) are
  // amber, same family as tilt. Streaks are green (win) / red (loss).
  // v4.3: autofill/tilt are noise on a detected smurf — a fresh account's thin role and champ
  // history says nothing about a player who's actually experienced, so those chips are suppressed
  // for smurf-flagged players at the source (lib/riot.mjs's flags array). Re-checked here too,
  // defensively, in case a legacy cached entry from before that fix still carries them alongside
  // 'smurf'. (A "first-time" chip used to live in this same suppression list — removed entirely,
  // it was reading as a lure rather than a real signal. Any legacy cached entry still carrying
  // the flag is simply ignored below; nothing renders it anymore.)
  const isSmurf = p.flags?.includes('smurf');
  if (p.flags?.includes('autofill') && !isSmurf) c.push(['autofill', 'Playing outside their usual role', 'flag-autofill']);
  // otp and otp-denied are mutually exclusive at the engine level (see gaScore in lib/riot.mjs),
  // but a legacy cached analysis from before that fix can still carry both — defensively prefer
  // otp-denied (the risk signal) if a stale entry ever has both set.
  const isDenied = p.flags?.includes('otp-denied');
  if (p.flags?.includes('otp') && !isDenied) c.push(['OTP', 'Plays this champion a lot and masters it', 'flag-otp']);
  if (isDenied) c.push(['OTP denied', `One-trick on ${p.deniedChamp} but not playing it this game`, 'flag-otp-denied']);
  // v4.4: OTP's mastery branch is now relative (dominant in the player's pool, not just >=150k
  // absolute) — a player with real career mastery on this champ who ISN'T currently a one-trick
  // on it (e.g. it's their 3rd-most-played champ, not their #1) gets this informational chip
  // instead of OTP, so the raw skill signal isn't lost even though it doesn't earn the OTP label.
  if (p.flags?.includes('mastery')) c.push([`${Math.round((p.masteryPts || 0) / 1000)}k mastery`, 'Skilled on this champion but not playing it much lately', 'flag-mastery']);
  // Goes through netCounter, not a raw counterPenalty(p.champ, oppChamp) call — a curated
  // bidirectional matchup (a handful exist in lib/counters.mjs) is a wash for this specific
  // head-to-head, not a "countered" chip for both laners at once.
  if (oppChamp && netCounter(p.champ, oppChamp) === p.champ) c.push(['countered', `${p.champ} is countered by ${oppChamp}`, 'flag-countered']);
  // Session-history warning flags — computed from the player's prior games / league entry,
  // shown compactly; each is rare enough that a plain chip (no icon) reads fine.
  if (p.flags?.includes('tilt') && !isSmurf) c.push(['tilt?', '3+ games in the last ~3h with at least 2 losses — possible session tilt', 'flag-tilt']);
  if (p.flags?.includes('rusty')) c.push(['rusty', "Hasn't played this queue in 14+ days — recent form may be less predictive", 'flag-rusty']);
  if (p.flags?.includes('smurf')) c.push(['SMURF?', 'Low account level with a strong season winrate or recent KDA — likely outclasses their displayed rank', 'flag-smurf']);
  if (p.flags?.includes('afk-risk')) c.push(['AFK risk', 'A recent game ended in an early surrender for this player — possible AFK/DC pattern', 'flag-afk']);
  if (p.duo) {
    const tip = p.duoWith
      ? `Duo with ${p.duoWith} — ${p.duoRecord ? p.duoRecord + ' together in their last 5 shared games' : (p.duoShared != null ? p.duoShared + '/5 previous games together' : 'proven by shared pre-game matches')}`
      : 'Queued with a teammate — proven by shared pre-game matches';
    c.push(['DUO', tip, 'flag-duo']);
  }
  if (p.streak) {
    const n = parseInt(p.streak), w = p.streak.endsWith('W');
    if (n >= 3) c.push([w ? `🔥 ${n}W` : `❄️ ${n}L`, (w ? 'Win' : 'Loss') + ' streak entering this game', w ? 'streak-win' : 'streak-loss']);
  }
  if (p.cspm != null && p.pos !== 'UTILITY') {
    const v = p.cspm;
    const [cls, tip] = v >= 9 ? ['cs-elite', 'Elite farming (9+ per minute)']
      : v >= 8 ? ['cs-good', 'Good farming (8+ per minute)']
      : v >= 7 ? ['cs-ok', 'Decent farming (7+ per minute)']
      : v >= 5.5 ? ['', 'Average farming']
      : ['cs-low', 'Low farming (under 5.5 per minute)'];
    c.push([`${v} cs`, tip, cls]);
  }
  // Season winrate only shows up as a chip when it's extreme (and the sample is big enough to
  // mean something) — otherwise it's just noise; the routine case lives in the Rank column text.
  if (p.seasonGames >= 20 && p.wr != null && (p.wr >= 58 || p.wr <= 44)) {
    c.push([`${p.wr}% wr`, `Season winrate over ${p.seasonGames} games`, p.wr >= 58 ? 'wr-hi' : 'wr-lo']);
  }
  return c.map(([l, t, cls]) => `<span class="chip${cls ? ' ' + cls : ''}" title="${esc(t)}">${l}</span>`).join('');
}

// Off-role (autofill) picks are risk, not skill — mirrors riskOf in lib/riot.mjs so a lane with
// an autofilled player never reads EVEN against a clean opponent just because the raw GAs
// happened to land close together. Smurf-flagged players are exempt — a fresh account's thin role
// history says nothing about a player who is demonstrably experienced; counter penalties (handled
// separately via roleCounterPenalty below) still apply since those are about the matchup, not the
// account.
const riskOf = p => p?.flags?.includes('smurf') ? 0 : (p?.flags?.includes('autofill') ? 5 : 0);

// v4.5: mirrors lib/riot.mjs's role-weighted counter penalty — a countered solo lane (top/mid)
// has no one to bail them out; jungle/bot/support have a partner who can offset a bad matchup, so
// the same "known bad matchup" costs less there. The "countered" CHIP (chipsHTML above,
// laneDifferentiators below) stays a flat yes/no regardless of role or size — only the
// GA-affecting lane math (matchupHTML's bAdj/rAdj) uses this role-scaled version. Goes through
// netCounter (lib/counters.mjs), not a raw counterPenalty(champ, oppChamp) call — mirrors the
// engine's mutual-counter cancellation (a curated bidirectional matchup is a wash, not a double
// penalty for the same lane).
const COUNTER_ROLE_PENALTY = { TOP: 8, MIDDLE: 8, JUNGLE: 4, BOTTOM: 3, UTILITY: 3 };
const roleCounterPenalty = (champ, oppChamp, pos) => netCounter(champ, oppChamp) === champ ? (COUNTER_ROLE_PENALTY[pos] ?? 8) : 0;

// v4.2: mirrors lib/riot.mjs's duoLaneBonusMap — a duo'd player's lane reads a bit stronger than
// their solo GA alone, since they can coordinate with a teammate elsewhere on the map. v4.4: a
// duo that includes a jungler bleeds harder (+5 instead of +3) — a jungler can gank/path with
// their duo partner on demand, more impactful than most same-lane duos; applies to BOTH members,
// so the partner's position (looked up in allPlayers by p.duoWith's name) matters too, not just
// p's own.
const LANE_DUO_BONUS = 3;
const JUNGLE_DUO_LANE_BONUS = 5;
function duoAdjOf(p, allPlayers) {
  if (!p?.duo) return 0;
  const partner = p.duoWith && allPlayers ? allPlayers.find(x => x.n === p.duoWith) : null;
  return (p.pos === 'JUNGLE' || partner?.pos === 'JUNGLE') ? JUNGLE_DUO_LANE_BONUS : LANE_DUO_BONUS;
}

// v4.1.1: lane tooltips must explain the GA GAP, not just list flags — a trait shared by BOTH
// laners (both OTP, both autofilled) explains nothing about why one side is ahead, so it's
// dropped entirely rather than shown as if it mattered. Only genuine differentiators — present
// on exactly one side, or a real comparative gap — are returned, dominant first. `side` ('b'/'r')
// records which player each differentiator's text is actually about (the "winner" for
// comparative factors, the flag-holder for one-sided ones), so laneEvenNote below can pick one
// differentiator favoring each side for an "X offset by Y" pairing.
function laneDifferentiators(b, r) {
  if (!b || !r) return [];
  const short = p => (p?.n || '').split('#')[0];
  const out = [];

  // One-sided flags: only a differentiator when EXACTLY one side has it — both (or neither)
  // cancels out, since a shared trait can't be what's tipping THIS lane specifically. Named by
  // whichever identity reads more naturally: champion for matchup-flavored facts (OTP, denied
  // OTP — "is OTP ON THIS CHAMP" is fundamentally about the pick), player for account/session
  // facts (autofill, smurf — these are about the PERSON, not the champion).
  const oneSidedFlag = (flag, text, w) => {
    const bHas = !!b.flags?.includes(flag), rHas = !!r.flags?.includes(flag);
    if (bHas === rHas) return;
    const p = bHas ? b : r;
    out.push({ text: text(p), w, side: bHas ? 'b' : 'r' });
  };
  oneSidedFlag('otp-denied', p => `${p.champ} denied their OTP`, 9);
  oneSidedFlag('otp', p => `${p.champ} is OTP on this champ`, 8);
  oneSidedFlag('smurf', p => `${short(p)} looks like a smurf`, 9);
  oneSidedFlag('autofill', p => `${short(p)} is autofilled`, 6);

  // Streak: one-sided only — a qualifying 3+ streak on BOTH sides is a genuine coincidence that
  // cancels the same way, since neither streak explains the gap over the other. Player name — a
  // streak is about the person's recent games, not tied to this specific champion.
  const streakInfo = p => { const m = /^(\d+)([WL])$/.exec(p?.streak || ''); return m && +m[1] >= 3 ? { n: +m[1], win: m[2] === 'W' } : null; };
  const bStreak = streakInfo(b), rStreak = streakInfo(r);
  if (bStreak && !rStreak) out.push({ text: bStreak.win ? `${short(b)} on a ${bStreak.n}-win streak` : `${short(b)} lost ${bStreak.n} in a row`, w: 5, side: 'b' });
  else if (rStreak && !bStreak) out.push({ text: rStreak.win ? `${short(r)} on a ${rStreak.n}-win streak` : `${short(r)} lost ${rStreak.n} in a row`, w: 5, side: 'r' });

  // Countered: netCounter (lib/counters.mjs) resolves which side, if either, is the NET-countered
  // one — a curated bidirectional matchup (a few exist in the matrix) cancels out here the same
  // way a shared flag does elsewhere in this function, rather than naming both champions as
  // countered by each other in the same lane.
  if (b.champ && r.champ) {
    const countered = netCounter(b.champ, r.champ);
    if (countered === b.champ) out.push({ text: `${b.champ} countered by ${r.champ}`, w: 12, side: 'b' });
    else if (countered === r.champ) out.push({ text: `${r.champ} countered by ${b.champ}`, w: 12, side: 'r' });
  }

  // Form gap (last-5 win count, from the "3W-2L" form string) — the dominant differentiator
  // whenever the win counts differ by >=2; smaller gaps are too close to call. Champion name
  // (e.g. "Shaco in better form (4W-1L vs 2W-3L)") — validated against a real cached entry.
  const wins = p => { const m = /^(\d+)W-(\d+)L$/.exec(p?.form || ''); return m ? +m[1] : null; };
  const bWins = wins(b), rWins = wins(r);
  if (bWins != null && rWins != null && Math.abs(bWins - rWins) >= 2) {
    const better = bWins > rWins ? b : r, worse = better === b ? r : b;
    out.push({ text: `${better.champ} in better form (${better.form} vs ${worse.form})`, w: 100, side: better === b ? 'b' : 'r' });
  }

  // Rank gap: >=1 tier (4 division-units on this scale) or >=2 divisions within the same tier —
  // both collapse to the same "unit gap >= 2" check. Player name — rank is account-level.
  const RANK_TIER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
  const RANK_DIV = { I: 3, II: 2, III: 1, IV: 0 };
  const rankValue = p => {
    if (!p?.rank || p.rank === 'Unranked') return null;
    const [tierWord, div] = p.rank.split(' ');
    const tier = RANK_TIER.indexOf(tierWord);
    return tier === -1 ? null : tier * 4 + (RANK_DIV[div] ?? 0);
  };
  const rankLabel = rk => rk ? rk.replace(/\s*\d+LP$/, '') : rk;
  const bRank = rankValue(b), rRank = rankValue(r);
  if (bRank != null && rRank != null && Math.abs(bRank - rRank) >= 2) {
    const better = bRank > rRank ? b : r, worse = better === b ? r : b;
    out.push({ text: `${short(better)} ranks above (${rankLabel(better.rank)} vs ${rankLabel(worse.rank)})`, w: 7, side: better === b ? 'b' : 'r' });
  }

  // cs/min gap — skipped for UTILITY (support farm isn't a meaningful lane-strength signal,
  // same exclusion chipsHTML already applies to the cs/min chip). Player name — this game's
  // farming execution, not an inherent champion trait.
  if (b.pos !== 'UTILITY' && b.cspm != null && r.cspm != null && Math.abs(b.cspm - r.cspm) >= 2) {
    const better = b.cspm > r.cspm ? b : r, worse = better === b ? r : b;
    out.push({ text: `${short(better)} farms much better (${better.cspm} vs ${worse.cspm} cs)`, w: 6, side: better === b ? 'b' : 'r' });
  }

  return out.sort((x, y) => y.w - x.w);
}

// Favored (non-EVEN) lane tooltip: top 1-2 differentiators, dominant first. Falls back to null
// (caller uses the generic "+N GA advantage" wording) when nothing differentiates — plenty of
// favored lanes are just "somewhat ahead on raw rank/form" without crossing any threshold here.
function laneFactorTooltip(b, r) {
  const diffs = laneDifferentiators(b, r);
  return diffs.length ? diffs.slice(0, 2).map(d => d.text).join('; ') : null;
}

// EVEN lane tooltip: same shared-trait-cancels differentiator list, framed as an offset — one
// factor favoring each side if both exist ("X offset by Y"), else just the lone factor found (a
// small edge that existed but didn't swing the numeric outcome either way). Null when there's
// nothing to say beyond the plain "Even matchup" wording.
function laneEvenNote(b, r) {
  const diffs = laneDifferentiators(b, r);
  if (!diffs.length) return null;
  const bSide = diffs.find(d => d.side === 'b');
  const rSide = diffs.find(d => d.side === 'r');
  if (bSide && rSide) return `${bSide.text} offset by ${rSide.text}`;
  return diffs[0].text;
}

// a and b are risk-adjusted GAs (see riskOf above) — callers no longer pass raw p.ga directly,
// so a lane where one side is autofilled/first-timing never reads EVEN just because the raw GAs
// happened to be close. riskNote (v4.1.1: from laneEvenNote, an "X offset by Y" shared-trait-
// cancels explanation) REPLACES the generic "Even matchup..." wording when present, same as
// favorTooltip (from laneFactorTooltip) replaces the generic "+N GA advantage" wording for a
// favored lane — both fall back to their own generic phrasing when nothing differentiates.
// skipEvenSide (v4.9): the non-autofilled side's color ('blue'/'red') when EXACTLY one of the two
// laners carries autofill risk — real case: Rakan (autofill, 58-5=53) vs Trundle (58) read EVEN
// because the adjusted +5 gap sat inside the band, even though the autofill itself is an inherent
// edge for the clean side. When set, the EVEN band is skipped for this lane entirely: the actual
// favored side still wins if the adjusted numbers say so (autofill risk doesn't GUARANTEE a loss,
// it's just skipped from the EVEN-masking check), and only a genuine 0 delta falls back to
// crediting the non-autofilled side +1 — enough to never read as a tie.
function laneVerdict(a, b, riskNote, favorTooltip, skipEvenSide) {
  if (a == null || b == null) return '<span class="dim">·</span>';
  const d = a - b, ad = Math.abs(d);
  // v4 (backtest-driven): EVEN band narrowed 8 -> 5 — a backtest of 17 cached analyses found
  // EVEN-band lanes were only right 27% of the time, the widest miss of any band. Favored is now
  // 6-18 (heavy stays >=19, unchanged).
  if (ad <= 5) {
    if (skipEvenSide) {
      const side = d !== 0 ? (d > 0 ? 'blue' : 'red') : skipEvenSide;
      const shown = d !== 0 ? ad : 1; // exact wash: non-autofilled side still gets a nominal +1
      const sideLabel = side === 'blue' ? 'Blue' : 'Red';
      const title = favorTooltip || riskNote || `${sideLabel} side favored: one-sided autofill risk keeps this lane from reading even`;
      return `<span class="lv-${side}" title="${esc(title)}">${side.toUpperCase()} +${shown}</span>`;
    }
    const evenTitle = riskNote || `Even matchup — pre-game GA gap of only ${ad} points`;
    return `<span class="lv-even" title="${esc(evenTitle)}">EVEN</span>`;
  }
  const heavy = ad > 18;
  const strength = heavy ? 'HEAVILY favored' : 'favored';
  const side = d > 0 ? 'blue' : 'red', sideLabel = side === 'blue' ? 'Blue' : 'Red';
  const title = favorTooltip || `${sideLabel} side ${strength}: +${ad} GA advantage before the game started`;
  return `<span class="lv-${side}" title="${esc(title)}">${side.toUpperCase()} +${ad}</span>`;
}

// Which side (if any) a lane is favored toward, for tinting that side's cells — kept separate
// from laneVerdict's HTML/text so the middle "Favored" column only ever shows the centered
// EVEN/BLUE +n/RED +n text. The favored/heavily-favored severity itself is no longer shown as
// a chip on the player — it's explained by the Favored-column value's own tooltip instead.
// Takes the same risk-adjusted values as laneVerdict so the tinting always agrees with the text.
// skipEvenSide: see laneVerdict above — same one-sided-autofill EVEN-band bypass, mirrored here so
// the row's fav-blue/fav-red/even-* CSS classes agree with what laneVerdict actually rendered.
function laneFavor(a, b, skipEvenSide) {
  if (a == null || b == null) return null;
  const d = a - b, ad = Math.abs(d);
  if (ad <= 5) return skipEvenSide ? { side: d !== 0 ? (d > 0 ? 'blue' : 'red') : skipEvenSide } : null; // v4: EVEN band narrowed 8 -> 5, same threshold as laneVerdict above
  return { side: d > 0 ? 'blue' : 'red' };
}

function matchupHTML(g, rid) {
  const meName = (rid || CTX.riotId).replace('#', '-').toLowerCase();
  const by = (t, role) => (g.players || []).find(p => p.team === t && p.pos === role);
  // Two lines per player: line one is #place + name + this game's KDA + bold GA; line two is
  // every chip (MVP/ACE leading, then flags/duo/streak/cs). Same element order on both sides —
  // the red column's .rgt text-align (and .p-chips' justify-content override) handles the
  // mirroring, so there's no need to special-case the DOM order per side anymore. Lane-favor
  // severity (favored/heavily favored) is NOT shown here — it's the Favored-column value's own
  // tooltip below (laneVerdict), so it isn't duplicated per player.
  const cellName = (p, oppChamp) => {
    if (!p) return '<span class="dim">—</span>';
    const place = p.place ? `<span class="place">#${p.place}</span>` : '';
    const name = `<span class="pname">${nameLink(p.n)}</span>`;
    const kda = p.kda ? `<span class="dim">${esc(p.kda)}</span>` : '';
    const ga = `<b>GA ${p.ga ?? '–'}</b>`;
    const main = [place, name, kda, ga].filter(Boolean).join(' ');
    const chips = badgeHTML(p) + chipsHTML(p, oppChamp);
    return `<div class="p-main">${main}</div>` + (chips ? `<div class="p-chips">${chips}</div>` : '');
  };
  const rows = ROLES.map(role => {
    const b = by('blue', role), r = by('red', role);
    if (!b && !r) return '';
    const bRisk = riskOf(b), rRisk = riskOf(r);
    const bRiskAdj = b?.ga != null ? b.ga - bRisk : null;
    const rRiskAdj = r?.ga != null ? r.ga - rRisk : null;
    // Known lane counters (lib/counters.mjs, shared with the engine's fairness() lane rules) are
    // subtracted the same way as autofill risk — a countered lane never reads EVEN just because
    // the raw GAs happened to be close. v4.5: role-weighted (roleCounterPenalty above), not flat.
    const bCounter = (b && r) ? roleCounterPenalty(b.champ, r.champ, role) : 0;
    const rCounter = (b && r) ? roleCounterPenalty(r.champ, b.champ, role) : 0;
    const bAdj = bRiskAdj != null ? bRiskAdj - bCounter + duoAdjOf(b, g.players) : null;
    const rAdj = rRiskAdj != null ? rRiskAdj - rCounter + duoAdjOf(r, g.players) : null;
    // v4.9: a lane where EXACTLY one side carries autofill risk (bRisk/rRisk above, smurf-exempt
    // as always) must never read EVEN — that side has an inherent edge even if the risk-adjusted
    // numbers happen to land close. skipEvenSide names the non-autofilled side, used as the
    // fallback winner only for a genuine 0 delta (see laneVerdict/laneFavor).
    const skipEvenSide = (bRisk > 0) !== (rRisk > 0) ? (bRisk > 0 ? 'red' : 'blue') : null;
    const fav = laneFavor(bAdj, rAdj, skipEvenSide);
    // v4.1.1: both the EVEN offsetting note and the favored-lane tooltip come from the same
    // shared-trait-cancels differentiator list (laneDifferentiators) — only whichever applies to
    // this lane's actual read (EVEN vs favored) is computed. laneVerdict falls back to its own
    // generic wording ("Even matchup..." / "+N GA advantage...") when either comes back null.
    const riskNote = !fav ? laneEvenNote(b, r) : null;
    const favorTooltip = fav ? laneFactorTooltip(b, r) : null;
    const rowCls = (base, p, side) => {
      const c = base ? [base] : [];
      if (fav) { if (fav.side === side) c.push(`fav-${side}`); }
      else c.push(`even-${side}`);
      if (p && p.n.replace('#', '-').toLowerCase() === meName) c.push('you');
      return c.length ? ` class="${c.join(' ')}"` : '';
    };
    const champCell = (p) => {
      if (!p) return '<span class="dim">—</span>';
      return `<span class="champ">${esc(p.champ)}</span>`;
    };
    return `<tr><td${rowCls('champ-c', b, 'blue')}>${champCell(b)}</td><td${rowCls('', b, 'blue')}>${cellName(b, r?.champ)}</td><td class="mid-v">${laneVerdict(bAdj, rAdj, riskNote, favorTooltip, skipEvenSide)}</td><td${rowCls('rgt', r, 'red')}>${cellName(r, b?.champ)}</td><td${rowCls('champ-c rgt', r, 'red')}>${champCell(r)}</td></tr>`;
  }).join('');
  const gB = g.teamGA?.blue, gR = g.teamGA?.red;
  const blueWon = (g.result === 'Victory') === (g.userTeam === 'blue');
  // Legacy entries analyzed before duo synergy scoring don't have g.duoBonus — the (+N duo)
  // tag is simply omitted for them rather than showing a bogus +0. "team GA" (not "avg GA") since
  // v4: it's a top-weighted blend (65% team mean + 35% mean of the top 2 GAs), not a flat average
  // — see weightedGA in lib/riot.mjs's fairness(). v4.8: autofill count joins the duo suffix, amber
  // (risk-family color) when a team has any — autofill asymmetry now has its own weight in the net
  // formula (see scoring.html), so it needs to be visible here too, not just implied by the badge.
  // Same "omit for legacy entries" treatment as duo: g.autofillCounts may be undefined on older
  // cached analyses.
  const teamGaText = (teamGa, bonus, autofillN) => {
    const tags = [];
    if (bonus > 0) tags.push(`<span title="GA bonus for proven duo synergy">+${bonus} duo</span>`);
    if (autofillN > 0) tags.push(`<span class="af-count" title="${autofillN} autofilled player${autofillN === 1 ? '' : 's'} on this team — off-role risk, weighed into the net">${autofillN} autofill</span>`);
    return `<span title="65% team average + 35% average of the top 2 GAs">team GA</span> ${teamGa ?? '–'}` + (tags.length ? ` (${tags.join(' · ')})` : '');
  };
  return `<table class="matchup">
    <tr><th class="champ-c"></th><th><span class="tm-blue">BLUE</span>${g.userTeam === 'blue' ? ' <span class="gold">YOU</span>' : ''}</th><th class="mid-v">Favored</th><th class="rgt"><span class="tm-red">RED</span>${g.userTeam === 'red' ? ' <span class="gold">YOU</span>' : ''}</th><th class="champ-c"></th></tr>
    ${rows}
    <tr class="teamrow"><td colspan="2"><b><span class="tm-blue">TEAM</span> · ${blueWon ? 'win' : 'loss'} · ${teamGaText(gB, g.duoBonus?.blue, g.autofillCounts?.blue)}</b></td><td class="mid-v"><span class="badge ${verdictCls(g.matchmaking, g.direction)}" title="${esc(verdictTitle(g.matchmaking, g.direction, g.verdictTooltip))}">${verdictLabel(g.matchmaking, g.direction)}</span>${winProbHTML(g.winProb)}</td><td colspan="2" class="rgt"><b><span class="tm-red">TEAM</span> · ${blueWon ? 'loss' : 'win'} · ${teamGaText(gR, g.duoBonus?.red, g.autofillCounts?.red)}</b></td></tr>
  </table>`;
}

// Column widths shared by both team tables (via an identical <colgroup> in each) so BLUE and
// RED line up vertically — table-layout:fixed makes the browser honor these instead of sizing
// columns to content, which is what caused the two tables to drift apart before.
const DETAILS_COLS = [26, 15, 9, 10, 8, 8, 6, 5, 13];
const detailsColgroup = '<colgroup>' + DETAILS_COLS.map(w => `<col style="width:${w}%">`).join('') + '</colgroup>';

function detailsHTML(g, key = 'x', rid) {
  enrichDuos(g);
  const meName = (rid || CTX.riotId).replace('#', '-').toLowerCase();
  const teams = ['blue', 'red'].map(t => {
    const rows = (g.players || []).filter(p => p.team === t);
    if (!rows.length) return '';
    const won = (g.result === 'Victory') === (g.userTeam === t);
    return '<h4><span class="tm-' + t + '">' + t.toUpperCase() + '</span>' + (g.userTeam === t ? ' <span class="gold">YOU</span>' : '') + ' · ' + (won ? 'win' : 'loss') +
      (g.teamGA && g.teamGA[t] ? ' · team GA ' + g.teamGA[t] : '') + '</h4>' +
      '<table class="details-table">' + detailsColgroup + '<tr><th>Player</th><th>Rank</th><th>Pos</th><th>Champ</th><th>KDA</th><th>Dmg</th><th>CS</th><th>GA</th><th title="Wins-losses in their last 5 ranked games before this one">Form (last 5 before game)</th></tr>' +
      rows.map(p => {
        const isMe = p.n.replace('#', '-').toLowerCase() === meName;
        const gaCls = p.ga == null ? '' : p.ga >= 70 ? 'ga-hi' : p.ga <= 45 ? 'ga-lo' : '';
        const badge = badgeHTML(p);
        const chips = chipsHTML(p);
        // MVP/ACE and the flag/duo/streak/cspm chips all live in the Player cell's chip group —
        // keeping the other columns plain text is what makes the fixed-width alignment hold up.
        const nameCell = `<span class="pcell"><span class="pname">${nameLink(p.n)}</span>${badge}${chips}</span>`;
        // Season winrate appended dim, only once there's a real sample (20+ games) behind it.
        const rankCell = esc(p.rank) + (p.seasonGames >= 20 ? ` <span class="dim">· ${p.wr}% (${p.seasonGames}g)</span>` : '');
        return '<tr class="t-' + t + (isMe ? ' you' : '') + '"><td>' + nameCell + '</td><td>' + rankCell + '</td><td>' + esc(p.pos) +
          '</td><td>' + esc(p.champ) + '</td><td>' + esc(p.kda) + '</td><td>' + (p.dmg || 0).toLocaleString() + '</td><td>' + p.cs +
          '</td><td class="' + gaCls + '">' + (p.ga ?? '–') + '</td><td>' + esc(p.form || '–') + '</td></tr>';
      }).join('') + '</table>';
  }).join('');
  const mId = 'sm' + key, dId = 'sd' + key;
  // Matchup summary is the primary view (expanded); full team tables are on-demand (collapsed).
  // Sections are toggled by the delegated .sec-h handler below.
  return `<div class="sec-h first" data-target="${mId}">▾ Matchup</div>` +
    `<div class="sec-b" id="${mId}">${matchupHTML(g, rid)}</div>` +
    `<div class="sec-h" data-target="${dId}">▸ Details</div>` +
    `<div class="sec-b" id="${dId}" style="display:none">${teams}</div>`;
}

document.addEventListener('click', e => {
  const h = e.target.closest('.sec-h');
  if (!h) return;
  const body = document.getElementById(h.dataset.target);
  if (!body) return;
  const willShow = body.style.display === 'none';
  body.style.display = willShow ? '' : 'none';
  h.textContent = h.textContent.replace(/^./, willShow ? '▾' : '▸');
});

// PWA: registers the static-shell service worker (public/sw.js) so the app is installable
// ("Add to Home Screen") and the shell still loads offline. Never blocks page load, and
// silently no-ops wherever it's unsupported or fails (e.g. non-HTTPS dev origins).
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
