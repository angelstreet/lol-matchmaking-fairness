import './style.css';
import { netCounter } from '../lib/counters.mjs';
import { STATS as CHAMP_STATS, PATCH as CHAMP_STATS_PATCH } from '../lib/champstats.mjs';
import { PAIRS as DUO_PAIRS, PATCH as DUO_SYNERGY_PATCH } from '../lib/duosynergy.mjs';

// Same-origin API in production (Vercel functions); Vite proxies /api in dev.
const API = import.meta.env.VITE_API_URL || '';

// v4.31: SECURITY — <form id="f"> below carries an inline onsubmit="return false" IN THE HTML
// STRING itself, not just the addEventListener('submit', ...) handler further down. A real user
// hit this: the search form natively GET-submitted (Enter, pressed before/during a JS crash
// window — e.g. the TDZ bug fixed earlier) with no script having called preventDefault yet,
// producing a URL like /?riot-search=Name%23TAG&riot-api-key=RGAPI-... — the pasted Riot key
// leaked straight into the URL bar and browser history. Inline HTML event-handler attributes are
// compiled by the parser as soon as the element exists — for innerHTML-injected markup like this,
// that's the instant THIS assignment statement runs (the very first line of this module), so the
// form is submit-proof before any later code in this file has a chance to run, let alone crash.
// The addEventListener('submit', ...) handler (search below) is unaffected — onsubmit="return
// false" blocks the browser's OWN default action, it doesn't stop other listeners from also
// firing, so the real search logic still runs exactly as before; only the native GET-navigation
// fallback is gone. See consumeLeakedParams below for cleaning up a URL that already leaked.
document.querySelector('#app').innerHTML = `
  <div class="site-header">
    <img class="lol-logo" src="https://upload.wikimedia.org/wikipedia/commons/d/d8/League_of_Legends_2019_vector.svg" alt="League of Legends">
    <h1><span>Losing Queue</span> <span class="unofficial-badge">Unofficial</span> <span class="h1-right"><a href="/scoring.html" class="algo-link">ⓘ <span class="algo-full">How we score</span><span class="algo-short">Scoring</span></a><span id="clerkBtn"></span></span></h1>
  </div>
  <div class="sub"><span class="sub-short">Was your game winnable or are you in a losing queue? Ranked Solo/Duo · pre-game form · duo detection · GA scores</span><span class="sub-more"> for all 10 players · proven by shared matches · official Riot API</span></div>
  <form id="f" autocomplete="off" onsubmit="return false">
    <div class="combo">
      <input id="riotId" name="riot-search" placeholder="Game name #TAG — e.g. xDevilStreet#EUW" required autocomplete="off">
      <button type="button" id="bmStar" title="Bookmark this profile">☆</button>
      <button type="button" id="copyProfileLink" title="Copy a shareable link to this profile">🔗</button>
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
  <div id="losingBadge" style="display:none"></div>
  <div id="list"></div>
  <div id="histWrap" style="display:none">
    <h3 style="margin:24px 0 8px">📜 Analyzed history</h3>
    <div id="hist"></div>
    <div id="histNav" class="dim" style="display:flex;gap:12px;align-items:center"></div>
  </div>
  <div id="shareModal" class="modal-backdrop"></div>
  <div id="toast" class="toast"></div>
  <footer class="foot"><a href="https://github.com/angelstreet/lol-matchmaking-fairness" target="_blank" rel="noreferrer">⭐ Open source — star it on GitHub</a><span class="dim"> · MIT · not endorsed by Riot Games · </span><a href="/scoring.html" class="algo-link">ⓘ How we score</a></footer>`;

const $ = s => document.querySelector(s);
$('#apiKey').value = localStorage.getItem('rgapi') || '';
$('#riotId').value = localStorage.getItem('riotId') || '';

// v4.35: set by consumeLeakedParams below when the URL is a SHARE deep link (?riot-search=...&
// match=...) — restoreLastSearch (further down) checks this BEFORE its own localStorage-based
// restore, so a deliberately-visited share link fully controls what's shown on load rather than
// merging with (or losing to) whatever this browser had cached from before. `let`, not `const`:
// consumeLeakedParams (an IIFE, runs immediately below) WRITES it, restoreLastSearch (also an
// IIFE, declared much further down but still running synchronously at module load) READS it — so
// this has to exist, even if still null, before either runs. Same TDZ concern already documented
// elsewhere in this file re: champSplashUrl — `let` here, not `const`, is deliberate.
let deepLinkParams = null;

// v4.31: defensive recovery for a URL that already leaked (see the onsubmit="return false" fix
// above) — a bookmark, a shared link, or a stale browser-history entry could still carry
// ?riot-search=...&riot-api-key=... today, from before that fix shipped. Consumes both params
// (prefilling the inputs, same as the plain localStorage-based prefill just above — this simply
// runs after it and wins if a param is actually present) and ALWAYS scrubs the URL via
// history.replaceState, even if neither param was present, so a leaked key never lingers visibly
// for even one extra render. Deliberately does NOT depend on normRiotId (declared much further
// down this file) — a small inline trim/normalize instead, so this can run at the very top of the
// module with zero risk of the exact TDZ-ordering mistake already fixed elsewhere in this file
// (champSplashUrl) — this recovery path is a security fix, not a place to gamble on hoisting.
// v4.35: now also recognizes a `match` param riding alongside riot-search — that combination is a
// deliberate SHARE deep link (see loadDeepLink and the Share button, further down), not a leaked
// URL, and per the feature brief it must NOT be scrubbed: those two params are shareable by
// design, so consumeLeakedParams leaves them right where they are and just records them into
// deepLinkParams for restoreLastSearch to pick up. riot-api-key is the one exception either way —
// key material never legitimately rides along on a share link, but if it's somehow present
// (a manually hand-edited URL, say) it still gets stripped, deep link or not.
(function consumeLeakedParams() {
  const params = new URLSearchParams(location.search);
  const leakedRiotId = params.get('riot-search');
  const leakedKey = params.get('riot-api-key');
  const shareMatch = params.get('match');
  if (leakedRiotId) {
    const normalized = String(leakedRiotId).trim().replace(/\s*#\s*/, '#');
    $('#riotId').value = normalized;
    localStorage.setItem('riotId', normalized);
  }
  if (leakedKey) {
    const trimmedKey = String(leakedKey).trim();
    $('#apiKey').value = trimmedKey;
    localStorage.setItem('rgapi', trimmedKey);
  }
  if (leakedRiotId && shareMatch) {
    deepLinkParams = { riotId: String(leakedRiotId).trim().replace(/\s*#\s*/, '#'), matchId: shareMatch };
    if (leakedKey) {
      params.delete('riot-api-key');
      history.replaceState(null, '', location.pathname + '?' + params.toString());
    }
  } else if (params.has('riot-search') || params.has('riot-api-key')) {
    history.replaceState(null, '', location.pathname);
  }
})();
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
// v4.13: #status can be showing a KEY-related message (handleKeyError below sets this flag
// whenever it does) that has nothing to do with whatever the user just typed/pasted — e.g. the
// OLD key's "was expired and has been removed" text lingering while a brand-new, actually-valid
// key sits in the field. Tracked with this flag (not string-matching #status's text, which is
// fragile and duplicates the message strings) so both the input listener and a fresh ✓ can clear
// it precisely, without touching any OTHER unrelated status text (e.g. "No ranked solo games
// found.") that might legitimately still be showing.
let statusHasKeyError = false;
// v4.32: tracks whether the list currently on screen is a keylessFallback() render (cached/
// history games standing in for a failed live search) rather than a real /api/matches result —
// set true at the end of a successful keylessFallback(), set false by liveSearch (the shared
// success path both the #f submit handler and refreshWithValidKey below use) and by
// restoreLastSearch's own cached-render branch. Read by checkKeyValidity to know whether a
// freshly-validated key should trigger an automatic upgrade from the fallback to the live list.
let listIsKeylessFallback = false;
async function checkKeyValidity(isRetry = false) {
  const el = $('#keyValid');
  const val = $('#apiKey').value.trim();
  if (!looksLikeKey(val)) { el.textContent = ''; el.title = ''; el.className = ''; return; }
  el.textContent = '…'; el.title = 'Checking…'; el.className = 'checking';
  try {
    const r = await fetch(`${API}/api/keycheck`, { headers: { 'x-api-key': val } });
    const data = await r.json();
    if (data.valid) {
      el.textContent = '✓'; el.title = 'This key is valid'; el.className = 'ok';
      if (statusHasKeyError) { $('#status').textContent = ''; statusHasKeyError = false; }
      // v4.32: a fresh, now-valid key upgrades a standing keylessFallback() list (cached/history
      // games shown after a dead-key search) to the real live one automatically — same
      // riotId/region/games the fallback was already showing (CTX + the #games select), no need
      // for the user to notice and re-click "Find games" themselves.
      if (listIsKeylessFallback) await refreshWithValidKey();
    } else if (data.status === 429 || (data.status >= 500 && data.status < 600)) {
      // Real case: a freshly pasted, genuinely valid key got a transient 429 from lol-status-v4
      // (briefly saturated, e.g. mid-search burst) and read as a flat-out invalid ✗ — Riot being
      // momentarily unavailable says nothing about the key itself. Stay in the neutral "checking"
      // state and retry ONCE, ~4s later; only 401/403 (the actual "this key is bad" responses)
      // ever produce ✗. Guard against a stale retry firing after the user has since changed the
      // field, same race-safety pattern as handleKeyError's sentKeyValue check below.
      el.title = 'Riot is momentarily unavailable — rechecking…';
      if (!isRetry) setTimeout(() => { if ($('#apiKey').value.trim() === val) checkKeyValidity(true); }, 4000);
    } else {
      el.textContent = '✗'; el.title = `Riot rejected this key (status ${data.status || '?'}) — it may be expired or mistyped`; el.className = 'bad';
    }
  } catch { el.textContent = ''; el.title = ''; el.className = ''; } // network hiccup — not the key's fault, stay silent
}
$('#apiKey').addEventListener('input', () => {
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  flashKeyField();
  // New input always supersedes whatever key-error text was showing — a lingering "was expired
  // and has been removed" from the OLD key's failure must not read as a verdict on what's in the
  // field right now.
  if (statusHasKeyError) { $('#status').textContent = ''; statusHasKeyError = false; }
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
// v4.27: the TEAM footer's win% is now a horizontal bar (was a "BLUE 19% · RED 81%" text line) —
// one slim rounded track, a blue segment sized to wp.blue% and a red one sized to wp.red% (they
// always sum to 100), each label centered in ITS OWN segment. A segment under NARROW_PCT can't fit
// its own label without clipping (the track itself is overflow:hidden, for the rounded-pill
// shape), so below that threshold the label is dropped from inside the segment and rendered
// instead as a .wp-label-out span pinned just past the bar's outer edge on that side, in the
// team's own color against the page background — "outside/adjacent... with contrast" per the
// design brief. Both wp.blue/wp.red can't be narrow at once (they sum to 100, NARROW_PCT<50).
// Legacy entries analyzed before winProb shipped don't have g.winProb — omitted entirely rather
// than showing a fake 50/50. Defined up here (not near its callers further down) because
// renderRows below is invoked synchronously at module load time (via the restoreLastSearch IIFE)
// and needs winProbCompact already initialized — a `const` declared after that call site would
// still be in its temporal dead zone when renderRows actually runs.
const WP_NARROW_PCT = 12;
function winProbHTML(wp) {
  if (!wp) return '';
  const seg = (pct, side) => {
    const inside = pct >= WP_NARROW_PCT ? `<span class="wp-seg-label">${pct}%</span>` : '';
    return `<div class="wp-seg wp-seg-${side}" style="width:${pct}%">${inside}</div>`;
  };
  const outside = (pct, side) => pct < WP_NARROW_PCT ? `<span class="wp-label-out wp-label-out-${side}">${pct}%</span>` : '';
  return `<div class="wp-bar-wrap" title="Estimated pre-game win chance BLUE–RED">
    <div class="wp-bar">${seg(wp.blue, 'blue')}${seg(wp.red, 'red')}</div>
    ${outside(wp.blue, 'blue')}${outside(wp.red, 'red')}
  </div>`;
}
// Compact "55%–45%" form for tight spaces (row one-liners) — same null-safe convention as above.
const winProbCompact = wp => wp ? `${wp.blue}%–${wp.red}%` : '';

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
  statusHasKeyError = true; // cleared by the #apiKey input listener or a fresh ✓ (checkKeyValidity)
  return true;
}
// Verdict is binary (FAIR / NOT FAIR — echoing the app name). Legacy cached entries may still
// carry the old 'OK' / 'NOT OK' / 'BORDERLINE' values — map those to the same two states.
const isFairVerdict = v => v === 'OK' || v === 'FAIR';
// A non-fair verdict is further qualified by `direction` (lib/riot.mjs's fairness().direction,
// persisted on the entry) — which team the imbalance actually favors, relative to the analyzed
// profile. Used to be spelled out in the badge text too ("NOT FAIR · THEIR FAVOR" / "· YOUR
// FAVOR"), then collapsed to color-only (red/amber) with the label always reading "NOT FAIR"
// regardless of direction — v4.33 gives the amber (favor) case its own label, "FAVORED" (see
// verdictLabel below), rather than relying on color alone to say a stacked-in-your-favor lobby
// isn't the same thing as a stacked-against-you one. Full wording either way still lives in the
// tooltip (verdictTitle). v4.1: the engine no longer ever emits 'mixed' (every verdict is now FAIR
// or a clearly-directed non-fair one — see fairness()'s net-direction logic) — 'mixed' can only
// appear on a legacy cached entry analyzed before that change, and is treated as red/needs
// re-analysis rather than its own real category.
const verdictCls = (v, dir) => isFairVerdict(v) ? 'b-ok' : dir === 'favor' ? 'b-mid' : 'b-bad';
// v4.33: the amber (favor) case reads "FAVORED" now, not "NOT FAIR" — a lobby stacked IN your
// favor was reading as a negative-sounding "NOT FAIR" label with only the color (amber vs red)
// distinguishing it from the genuinely-against case, easy to misread at a glance. "FAVORED" is
// short (fits the same 90px .col-badge column NOT FAIR did, with room to spare) and unambiguous:
// the lobby leaned your way. Tooltips/reasons unchanged (verdictTitle below still does the real
// explaining) — this only touches the three-word label itself. Losing-queue badge logic is keyed
// on `direction === 'against'`, not this label text, so it's unaffected.
const verdictLabel = (v, dir) => isFairVerdict(v) ? 'FAIR' : dir === 'favor' ? 'FAVORED' : 'NOT FAIR';
// tooltip is the engine's verdictTooltip — the actual fired reasons (NOT FAIR) or the offsetting
// explanation (FAIR-but-imbalanced), terse, straight from lib/riot.mjs. Legacy entries analyzed
// before that field existed (or that still carry the retired 'mixed' direction) fall back to a
// generic message pointing at re-analysis instead of guessing at content that isn't stored.
// v4.12: legacy-cache scrub — "first-time" was fully removed as a scoring signal/flag/chip
// (66c630d), but an analysis stored BEFORE that commit still has it baked verbatim into its
// verdictTooltip/oneLiner strings (they're frozen text from analysis time, never regenerated just
// because the engine changed) — e.g. the old "autofill/first-time risk against you" reason
// wording. Rather than force a re-analysis just to fix display text, strip the token wherever
// these stored strings render. Cheap string replace, not a real parser — good enough for a
// wording leftover, not meant to handle arbitrary future flag renames.
const scrubLegacy = s => (s || '')
  .replace(/\s*\/\s*first-time(rs?)?/gi, '') // "autofill/first-time" -> "autofill"
  .replace(/\bfirst-time(rs?)?\b\s*/gi, '')  // standalone "first-time"/"first-timers" tokens
  .replace(/\s{2,}/g, ' ')
  .trim();
const verdictTitle = (v, dir, tooltip) => {
  if (dir === 'mixed') return 'Re-analyze for updated verdict';
  if (tooltip) return scrubLegacy(tooltip);
  if (isFairVerdict(v)) return '';
  return dir === 'against' ? "The lobby was stacked in the enemy team's favor" : dir === 'favor' ? "The lobby was stacked in your team's favor" : 'Re-analyze for updated verdict';
};
// v4.21: the DRAFT verdict — champ-select quality (counter picks, bot synergy), entirely separate
// from the matchmaking verdict above. Card-level only (not shown on list rows — those keep just
// the fairness badge, per the same "row is a quick scan, card is the detail" split the matchup
// table itself already follows). Legacy entries analyzed before this split have no g.draft field
// at all; net===0 (nothing fired) renders nothing either way — never a bogus "DRAFT · EVEN" badge
// for a game where no draft factor actually mattered.
// v4.22: merged into ONE bordered pill — previously two stacked plain-text lines ("bot synergy
// +2.3% vs +3.8%" then "DRAFT · EVEN") read as two unrelated rows under the fairness badge.
// `components` is the caller-built list of terse factor strings (countered-lane notes, the bot
// synergy comparison) — folded inline after an em-dash when the whole line stays within
// DRAFT_PILL_INLINE_BUDGET chars, otherwise the pill collapses to "details on hover" and the full
// breakdown lives in the tooltip only.
const DRAFT_PILL_INLINE_BUDGET = 60;
// v4.23: the tooltip must explain what the verdict MEANS, not just restate the component list — a
// bare "Ashe countered by Caitlyn -8" told a player WHAT fired but not what GOOD/BAD/EVEN actually
// means for their game, or whose "fault" it is (BAD is a drafting mistake by the players, not a
// Riot matchmaking failure — worth saying explicitly so it doesn't read as another fairness gripe).
const DRAFT_VERDICT_EXPLAIN = {
  GOOD: 'Your team gained an edge at champion select (counters/synergy) — before the game even started.',
  BAD: "Your team lost champion select — picked into counters or a weak duo. This is on the players, not Riot's matchmaking.",
  EVEN: 'Champion select gave neither team a meaningful edge — the picks roughly cancel out.',
};
const draftPillHTML = (draft, components) => {
  if (!draft || draft.net === 0) return '';
  const cls = draft.verdict === 'GOOD' ? 'draft-good' : draft.verdict === 'BAD' ? 'draft-bad' : 'draft-even';
  const sign = draft.net >= 0 ? '+' : '';
  // v4.22: engine already rounds draft.net to 1 decimal, but display-side rounding shouldn't
  // depend on that staying true forever (or on a legacy cached entry predating it) — fmt1 here
  // too, same as every other computed-delta render site.
  const verdictLabel = draft.verdict === 'EVEN' ? 'DRAFT · EVEN' : `DRAFT · ${draft.verdict} ${sign}${fmt1(draft.net)}`;
  const compStr = (components || []).filter(Boolean).join(' · ');
  const fits = compStr && (verdictLabel.length + 3 + compStr.length) <= DRAFT_PILL_INLINE_BUDGET;
  const compTail = compStr ? (fits ? compStr : 'details on hover') : '';
  // v4.23: explanation sentence first, components (if any) after — replaces the old
  // draft.tooltip/component-list-only title.
  const explain = DRAFT_VERDICT_EXPLAIN[draft.verdict] || DRAFT_VERDICT_EXPLAIN.EVEN;
  const title = compStr ? `${explain} ${compStr}` : explain;
  const tail = compTail ? `<span class="draft-comp"> — ${esc(compTail)}</span>` : '';
  return `<div class="draft-pill ${cls}" title="${esc(title)}"><span class="draft-verdict">${esc(verdictLabel)}</span>${tail}</div>`;
};
let CTX = { riotId: '', region: 'euw' };

// ---- bookmarks: localStorage always; synced to the Clerk account when signed in ----
// Riot IDs must be normalized (normRiotId, above) at every read/write/compare here — bookmarks
// used to be saved with whatever raw string was in the field, so "Name #TAG" (typed with a
// space) and "Name#TAG" would end up as two separate entries pointing at the same account.
let clerk = null;
// v4.34: a bookmark someone tried to ADD while signed out (see the #bmStar click handler below) —
// completed automatically by the Clerk listener further down if they finish signing in, so they
// don't have to notice and re-click the star themselves. Best-effort only ("re-click is fine" is
// an acceptable fallback per the design brief) — a page reload or switching riotId before signing
// in just drops it, same as never having clicked at all.
let pendingBookmark = null;
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
  // v4.34: bookmarking now requires sign-in (see the click handler below) — signed out, the star
  // says so directly rather than leaving the click's actual behavior (open the sign-in modal
  // instead of saving) as a surprise.
  $('#bmStar').title = clerk?.user ? 'Bookmark this profile' : 'Sign in to save favorites';
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
  // v4.34: ADDING a new bookmark requires sign-in — existing localStorage bookmarks (saved
  // before this gate, or by an anonymous visitor) keep showing read-only in the dropdown and
  // stay fully removable regardless of sign-in state (removal is never gated, only new adds —
  // an anonymous "favorite" can't sync across devices anyway, and silently accumulating
  // client-only ones was the actual problem this closes). Opens Clerk's sign-in modal when
  // available; if this deployment has no Clerk key configured at all, there's no modal to open,
  // so a status hint explains why the click did nothing instead.
  if (!on && !clerk?.user) {
    pendingBookmark = { riotId, region };
    if (clerk) clerk.openSignIn();
    else $('#status').textContent = 'Sign in to save favorites.';
    return;
  }
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

// ---- v4.36: small transient toast (Copy link / Copy image confirmations) ----
let toastTimer = null;
function showToast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
async function copyToClipboardOrToast(text, successMsg) {
  try { await navigator.clipboard.writeText(text); showToast(successMsg); }
  catch { showToast(text); } // clipboard permission denied/unavailable — surface the text itself so it's still visible/selectable
}
// v4.36: profile-level share link — .../?riot-search=Name%23TAG, no match param. Landing on it
// prefills #riotId (see the plain riot-search handling in consumeLeakedParams, unchanged from
// before this feature) and the page's own normal load flow (restoreLastSearch -> live fetch,
// falling back to keylessFallback) takes it from there — no new load-time code needed for this,
// only the button that produces the link.
function profileLinkFor(riotId) { return `${location.origin}${location.pathname}?riot-search=${encodeURIComponent(riotId)}`; }
$('#copyProfileLink').addEventListener('click', () => {
  const riotId = normRiotId($('#riotId').value);
  if (!riotId.includes('#')) { showToast('Search a profile first'); return; }
  copyToClipboardOrToast(profileLinkFor(riotId), 'Link copied to clipboard');
});

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
  // v4.35: a SHARE deep link (?riot-search=...&match=..., see consumeLeakedParams above) wins
  // over the normal lastSearch-cache restore below entirely — a deliberately-visited share link
  // should show exactly that profile + that game, not get silently merged with (or overridden by)
  // whatever this browser happens to have cached from a previous session. loadDeepLink is a
  // `function` declaration (defined near keylessFallback further down, after this IIFE textually —
  // harmless, function declarations hoist their full body regardless of source order, same as
  // keylessFallback itself already relies on a few lines below).
  if (deepLinkParams) { loadDeepLink(deepLinkParams.riotId, deepLinkParams.matchId); return; }
  let cached;
  try { cached = JSON.parse(localStorage.getItem('lastSearch') || 'null'); } catch { cached = null; }
  // v4.30: "known riotId" now covers TWO sources — a real lastSearch cache (games ready to render
  // immediately), or just the plain riotId remembered from any prior successful lookup/live-check
  // (see the simple 'riotId' localStorage key set elsewhere) with no games cached alongside it.
  // Previously only the first case did anything at all — a returning profile with no lastSearch
  // (or a stale/empty one) rendered NOTHING at page load, not even an attempt, leaving the search
  // box showing a name over a blank page. Both cases now at least attempt the same silent
  // /api/matches refresh below.
  const knownRiotId = (cached && cached.riotId) || localStorage.getItem('riotId') || '';
  // v4.34: nothing remembered at all (first-ever visit, or every trace cleared) — nothing to
  // restore, but the background must still show SOMETHING rather than sitting plain indefinitely
  // waiting for a search that may not come for a while. A resolved profile's own splash always
  // replaces this the moment one becomes known (any later updateBgSplash call just overwrites the
  // CSS var), same "preload first, 404 stays plain" contract either way.
  if (!knownRiotId) { showRandomSplash(); return; }

  let renderedRows = false;
  if (cached && cached.riotId && Array.isArray(cached.games) && cached.games.length) {
    CTX = { riotId: cached.riotId, region: cached.region || 'euw' };
    $('#riotId').value = cached.riotId;
    $('#region').value = cached.region || 'euw';
    updateStar();
    // v4.28: explicit, not just implied by renderRows' own container-gated hook below — the
    // background must come up immediately from whatever's in localStorage, independent of that
    // hook staying wired correctly forever. (renderRows fires it too; calling it twice here is
    // harmless — same computation, same result, just belt-and-suspenders.)
    updateBgSplash(cached.games);
    renderRows(cached.games, $('#list'), 'm', cached.riotId);
    loadHistory(0);
    renderedRows = true;
    listIsKeylessFallback = false; // a real (if possibly stale) cached list, not a keylessFallback() stand-in
    if (Date.now() - (cached.ts || 0) < 60000) return; // cache is fresh enough, skip the refetch
  } else {
    $('#riotId').value = knownRiotId; // already the input's default value (see the top of the file) — explicit here too since this branch may run instead of that assignment ever mattering
  }
  const attemptRegion = (cached && cached.region) || $('#region').value || 'euw';
  fetch(`${API}/api/matches?riotId=${encodeURIComponent(knownRiotId)}&games=${$('#games').value}&region=${attemptRegion}`, { headers: hdrs().headers })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(data => {
      renderRows(data.games, $('#list'), 'm', knownRiotId);
      listIsKeylessFallback = false; // a genuine live refresh succeeded
      localStorage.setItem('lastSearch', JSON.stringify({ riotId: knownRiotId, region: attemptRegion, games: data.games, ts: Date.now() }));
    })
    .catch(async () => {
      // v4.30: previously silent — this whole IIFE runs before any user interaction, so unlike
      // the #f submit handler there's no key-error UI feedback loop to fall into; a dead/missing
      // key here used to just leave the page as whatever was already rendered (fine when
      // renderedRows is true — "keep the cached view as-is" is still correct there) or, when
      // nothing had rendered yet, leave it completely blank. Only fall back when there's truly
      // nothing on screen already, so a real (if stale) cached list is never replaced/duplicated.
      if (!renderedRows && await keylessFallback({ riotId: knownRiotId, region: attemptRegion })) {
        // Same notice the #f submit handler shows on this same fallback — no raw key-error text
        // to prepend here (this runs before any user action, there's nothing to soften), just the
        // one calm line explaining why they're looking at cached games instead of a live list.
        // v4.32: flagged so a freshly typed/pasted key clears it (see the #apiKey input listener)
        // instead of leaving it stuck on screen forever.
        $('#status').innerHTML = '<span class="dim">Live game list unavailable (no valid key) — showing analyzed games from cache.</span>';
        statusHasKeyError = true;
      }
    });
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
    // v4.34: completes a bookmark ADD the user started while signed out (see the #bmStar click
    // handler) as soon as sign-in actually finishes, so they don't have to notice the star didn't
    // fill in and re-click it themselves. Registered unconditionally (harmless if they were
    // already signed in, or never click the star while signed out at all — pendingBookmark just
    // stays null and this never fires).
    clerk.addListener(({ user }) => {
      if (!user || !pendingBookmark) return;
      const { riotId, region } = pendingBookmark;
      pendingBookmark = null;
      if (!isBM(riotId)) setBM([...getBM(), { riotId, region }]);
      serverBM('add', riotId, region).then(synced => { if (synced) setBM(synced); });
    });
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

// v4.28: when a live search fails (dead/missing key, on either the user's own key or the shared
// server key), a PROFILE ALREADY ANALYZED before is still reachable via /api/history — Turso
// cache only, no Riot call, no key needed (see api/history.mjs). Renders those games into #list
// as a stand-in for the failed live list so the app stays usable keyless for known profiles,
// rather than dead-ending on the raw error. Reuses renderRows unchanged — /api/history's game
// shape ({matchId, cached:true, live, result, champ, kda, when, duration, matchmaking, direction,
// verdictTooltip, oneLiner}) is exactly what renderRows already expects (it just won't carry
// winProb, which renderRows already treats as optional). Firing renderRows($('#list'), ...) also
// drives the background splash for free, via that function's own updateBgSplash hook — the same
// mechanism a successful search or restoreLastSearch uses. Doesn't touch localStorage's
// 'lastSearch' cache (this is a degraded, possibly-incomplete stand-in view, not a confirmed
// fresh result worth overwriting the real cache with).
async function keylessFallback(attempt) {
  try {
    const r = await fetch(`${API}/api/history?riotId=${encodeURIComponent(attempt.riotId)}&offset=0&limit=${$('#games').value}`);
    const d = await r.json();
    if (!r.ok || !d.games?.length) return false;
    CTX = attempt;
    localStorage.setItem('riotId', CTX.riotId);
    $('#list').innerHTML = '';
    renderRows(d.games, $('#list'), 'm', CTX.riotId);
    loadHistory(0);
    listIsKeylessFallback = true;
    return true;
  } catch { return false; }
}

// v4.35: plain function, no module-level const backing it — regionFromMatchId is called
// SYNCHRONOUSLY from loadDeepLink below, itself called synchronously from restoreLastSearch's
// IIFE at module-load time, well before a `const` declared this far down the file would have been
// evaluated by the normal top-to-bottom pass (same TDZ crash class already fixed elsewhere in
// this file re: champSplashUrl — a `const REGION_BY_MATCH_PREFIX` here threw exactly that
// "Cannot access before initialization" in testing). The lookup table lives inside the function
// body instead, built fresh on each call, so there's nothing anywhere else in the module that
// could still be in its temporal dead zone when this runs.
function regionFromMatchId(matchId) {
  const prefix = String(matchId || '').split('_')[0];
  return { EUW1: 'euw', EUN1: 'eune', NA1: 'na', KR: 'kr' }[prefix] || 'euw';
}
// v4.35: SHARE deep links — .../?riot-search=Name%23TAG&match=EUW1_xxx (see consumeLeakedParams
// above, which parses the URL into deepLinkParams, and the Share button further down, which
// builds this exact URL via shareLinkFor). Loads that profile + that ONE game keylessly — the
// same cached/Turso-only path keylessFallback above already uses (a shareable game is, by
// definition, already analyzed and cached — neither fetch below needs a Riot key) — then
// auto-expands its card, same as a manual View click. The shared game might not be on the
// profile's most-recent page of history (an old shared link still has to work), so it's fetched
// directly by matchId via /api/analyze (which ignores paging entirely) and prepended to whatever
// /api/history's first page returns, rather than trusting that page alone to contain it.
async function loadDeepLink(riotId, matchId) {
  const region = regionFromMatchId(matchId);
  $('#riotId').value = riotId;
  $('#region').value = region;
  updateStar();
  try {
    const [entryRes, histRes] = await Promise.all([
      fetch(`${API}/api/analyze?riotId=${encodeURIComponent(riotId)}&matchId=${encodeURIComponent(matchId)}&region=${region}`),
      fetch(`${API}/api/history?riotId=${encodeURIComponent(riotId)}&offset=0&limit=10`),
    ]);
    const entryData = entryRes.ok ? await entryRes.json() : null;
    const histData = histRes.ok ? await histRes.json() : null;
    let games = histData?.games || [];
    // Not already on the fetched page — synthesize a row for it in the exact shape /api/history's
    // own rows already carry (renderRows expects nothing more than this from any row).
    if (entryData?.entry && !games.some(g => g.matchId === matchId)) {
      const e = entryData.entry;
      games = [{
        matchId, cached: true, live: !!e.live, result: e.result, champ: e.user?.champ, kda: e.user?.kda,
        when: e.when, duration: e.duration, matchmaking: e.matchmaking, direction: e.direction,
        verdictTooltip: e.verdictTooltip, oneLiner: e.oneLiner,
      }, ...games];
    }
    if (!games.length) { $('#status').textContent = "This shared game couldn't be found — it may not be analyzed yet."; return; }
    CTX = { riotId, region };
    localStorage.setItem('riotId', riotId);
    $('#list').innerHTML = '';
    renderRows(games, $('#list'), 'm', riotId);
    loadHistory(0);
    const viewBtn = document.querySelector(`#list .mini[data-mid="${CSS.escape(matchId)}"]:not(.icon-btn)`);
    if (viewBtn) viewBtn.click(); // same code path a manual View click takes — no duplicated render logic
  } catch {
    $('#status').textContent = 'Could not load the shared game — try refreshing.';
  }
}

// v4.32: the actual live-search request+render, factored out of the #f submit handler so
// refreshWithValidKey (below) can reuse the exact same success path — throws on failure (same
// contract the submit handler's try block always had), so both callers share one error story.
// Always resets listIsKeylessFallback — a successful live fetch means whatever's on screen is no
// longer a keylessFallback() stand-in, regardless of which caller triggered it.
async function liveSearch(attempt, headers) {
  const r = await fetch(`${API}/api/matches?riotId=${encodeURIComponent(attempt.riotId)}&games=${$('#games').value}&region=${attempt.region}`, { headers });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.status);
  CTX = attempt;
  localStorage.setItem('riotId', CTX.riotId);
  $('#list').innerHTML = ''; // only clear the previous list once the new one is ready to replace it
  renderRows(data.games, $('#list'), 'm', CTX.riotId);
  listIsKeylessFallback = false;
  // The rows speak for themselves (✓ badges already mark analyzed games) — no instructional
  // sentence needed once there's a list to look at; only the empty-results case still needs a
  // status message, since there's nothing on screen to explain otherwise.
  $('#status').textContent = data.games.length ? '' : 'No ranked solo games found.';
  localStorage.setItem('lastSearch', JSON.stringify({ riotId: CTX.riotId, region: CTX.region, games: data.games, ts: Date.now() }));
  loadHistory(0);
}

// v4.32: called from checkKeyValidity when a freshly typed/pasted key validates WHILE the list on
// screen is a keylessFallback() render — upgrades it to the real live list automatically, same
// riotId/region CTX already holds (keylessFallback sets it) and the current #games count, no need
// for the user to notice and re-click "Find games". Same loading-state treatment (spinner on #go,
// beginBusy/endBusy) as a manual submit, even though nothing was actually submitted here.
async function refreshWithValidKey() {
  if (!CTX.riotId) return;
  const attempt = { riotId: CTX.riotId, region: CTX.region };
  const goLabel = $('#go').textContent;
  beginBusy();
  $('#go').innerHTML = '<span class="spinner"></span>';
  try {
    await liveSearch(attempt, hdrs().headers);
  } catch {
    // Silent — the key just validated successfully via checkKeyValidity, so a failure here is
    // some other transient hiccup; leave the still-good fallback list exactly as it was rather
    // than replace it with a scary error the user didn't ask for.
  } finally { endBusy(); $('#go').textContent = goLabel; }
}

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
    await liveSearch(attempt, h);
  } catch (err) {
    // v4.28: handleKeyError may already have written its own status message (a dead PASTED key
    // gets cleared with its own explanation) — captured before the fallback runs so it can be
    // combined with (not clobbered by) the fallback's own notice. A shared-key failure (handled
    // === false) gets a softened, dim restatement of the raw error instead of the harsher ❌ —
    // that treatment is only for the genuine dead-end case (no fallback available either).
    const handled = handleKeyError(err, sentKey);
    const keyNote = handled ? $('#status').innerHTML : `<span class="dim">${esc(err.message)}</span>`;
    const gotFallback = await keylessFallback(attempt);
    if (gotFallback) {
      // v4.32: ALL key-related status writes must flag statusHasKeyError, not just the ones
      // handleKeyError itself covers — this fallback notice is itself always about a dead/missing
      // key regardless of what specifically triggered it, so the input listener's "new key
      // typed, clear the stale message" logic needs to see it too.
      $('#status').innerHTML = keyNote + '<br><span class="dim">Live game list unavailable (no valid key) — showing analyzed games from cache.</span>';
      statusHasKeyError = true;
    } else if (!handled) {
      $('#status').innerHTML = '❌ ' + esc(err.message);
      // v4.32: only flag as a clearable key-error status if the underlying failure actually WAS
      // about a dead/missing key (both the pasted-key and shared-key 401 paths share this exact
      // "key invalid or expired" wording — see lib/riot.mjs) — a genuinely unrelated failure (bad
      // riotId, a Riot outage) must not get silently wiped the next time the user edits the key
      // field.
      if (String(err?.message || '').includes('key invalid or expired')) statusHasKeyError = true;
    }
  }
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

// v4.11: "LOSING QUEUE?" badge — a real pattern the user flagged: 3+ consecutive analyzed games,
// newest first, all NOT FAIR *against* them, suggests the matchmaker may be pushing them down
// rather than just a run of bad luck. v4.15: user-reported concern this was (or looked like it
// was) keying off the game's RESULT — audited, and it never has: isUnfairAgainst below checks
// ONLY matchmaking/direction, never g.result/g.win, and this is the single source of truth
// losingStreak calls per game (no other comparison exists in this function). Wins/losses are
// deliberately irrelevant: a lost-but-FAIR game breaks the streak just as a won-but-NOT-FAIR-
// against game continues it — the badge is about matchmaking imbalance, not the scoreboard.
// Extracted into a named predicate specifically so this invariant is easy to audit at a glance,
// not buried inside the loop.
const isUnfairAgainst = g => g.matchmaking === 'NOT FAIR' && g.direction === 'against';
// Live snapshots (g.live) are excluded — they're pre-game, not a finished, judged result. Counts
// the FULL streak (not capped at 3) so ×4/×5 etc. can be shown; breaks (and returns) at the first
// analyzed game that doesn't match, so it only ever counts a genuinely unbroken run ending at the
// most recent game.
function losingStreak(games) {
  let n = 0;
  for (const g of games) {
    if (g.live) continue; // final analyses only
    if (isUnfairAgainst(g)) n++;
    else break;
  }
  return n;
}
function renderLosingBadge(games) {
  const el = $('#losingBadge');
  const n = losingStreak(games);
  if (n < 3) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const label = n > 3 ? `LOSING QUEUE? ×${n}` : 'LOSING QUEUE?';
  el.innerHTML = `<span class="badge b-bad" title="Last ${n} analyzed games were all stacked AGAINST this player (regardless of result) — the matchmaker may be pushing them down">${esc(label)}</span>`;
  el.style.display = 'block';
}

async function loadHistory(offset) {
  try {
    const r = await fetch(`${API}/api/history?riotId=${encodeURIComponent(CTX.riotId)}&offset=${offset}&limit=10`);
    const d = await r.json();
    if (!r.ok || !d.total) {
      $('#histWrap').style.display = 'none';
      if (offset === 0) renderLosingBadge([]); // no history at all -> badge can't apply
      return;
    }
    // v4.16: user-reported concern (with a repro mechanism, verified real via a standalone
    // simulation: feeding losingStreak() the POST-dedupe set instead of this one does produce a
    // false positive when the newest game is FAIR but happens to also be displayed in #list) that
    // the badge might be evaluated on the DEDUPED display set (below) rather than the raw,
    // newest-first /api/history page. Re-verified end-to-end against the live deployed bundle with
    // that exact scenario (newest game FAIR, present in #list, followed by older NOT-FAIR-against
    // games) and the badge stayed correctly hidden -- rawHistoryGames below has always been passed
    // to renderLosingBadge BEFORE any filtering exists (confirmed back to the feature's original
    // commit, ac587fc), so this failure mode was never actually wired up. Kept as its own
    // const, computed and consumed here before the dedupe filter is even defined, specifically so
    // this can never regress by accident — the badge's data dependency is structural, not just
    // ordering-by-convention. The exclusion filter and the "3 most recent" losing-streak read are
    // both scoped to offset 0: only the newest page can possibly overlap with #list (both sort
    // newest-first, so a shared game can only ever be among #list's most recent handful); older
    // pages render/count exactly as before, unaffected.
    const rawHistoryGames = d.games; // newest-first, straight from the API -- never filtered
    if (offset === 0) renderLosingBadge(rawHistoryGames);
    const listedIds = offset === 0 ? listedMatchIds() : new Set();
    const games = rawHistoryGames.filter(g => !listedIds.has(g.matchId)); // display-only dedupe
    const hidden = rawHistoryGames.length - games.length;
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
  // v4.27: the main search-results list ($('#list'), prefix 'm') drives the full-page background
  // splash — gated to that one container so the "analyzed history" list ($('#hist'), prefix 'h...')
  // re-rendering doesn't fight it. Every current call site (a fresh search, restoreLastSearch's
  // both the instant cached-render and its background refetch, the live-watch auto-upgrade retry)
  // already goes through here, so this one gate covers all of them without touching each call site.
  if (container === $('#list')) updateBgSplash(games);
  container.innerHTML = games.map((g, i) => {
    if (g.remake) return ''; // server no longer sends remakes; guard is only for legacy lastSearch cache
    const key = prefix + i;
    const badge = g.cached && g.matchmaking ? `<span class="badge ${verdictCls(g.matchmaking, g.direction)}" id="b${key}" title="${esc(verdictTitle(g.matchmaking, g.direction, g.verdictTooltip))}">${verdictLabel(g.matchmaking, g.direction)}</span>` : `<span id="b${key}"></span>`;
    const oneLiner = g.cached ? esc(scrubLegacy(g.oneLiner)) : '';
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
    // v4.35/v4.36: Share — only makes sense once a game actually has an analysis to share (same
    // gate as the re-analyze button above). Deliberately NOT given the .mini class: that class is
    // what the delegated listener just below wires up to analyze() — a share click must never
    // trigger an analyze/toggle on the card, so it gets its own class (.share-btn) and its own
    // listener. Carries data-key (unlike the other row buttons above, which can find their own row
    // by id="v${key}"/"g${key}" once clicked) because onShareClick needs to look up the row's View
    // button and card BEFORE doing anything else, to make sure the game is actually loaded/open
    // before it gets captured into an image.
    const shareBtn = g.cached
      ? `<button type="button" class="icon-btn share-btn" data-mid="${esc(g.matchId)}" data-key="${key}" data-rid="${esc(rid)}" title="Share this game">📤</button>`
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
        ${shareBtn}
      </div>
      <div class="details" id="d${key}"></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.mini').forEach(b => b.addEventListener('click', () => analyze(b.dataset.mid, b, b.dataset.key)));
  container.querySelectorAll('.share-btn').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); onShareClick(b, b.dataset.mid, b.dataset.rid, b.dataset.key); }));
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
      const cleanOneLiner = scrubLegacy(g.oneLiner);
      oneEl.innerHTML = esc(cleanOneLiner) + (wpCompact ? ` <span class="wp-compact" title="Estimated pre-game win chance BLUE–RED">${esc(wpCompact)}</span>` : '');
      oneEl.title = cleanOneLiner;
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

// ---- v4.36: Share — real-DOM capture (primary) into a modal, with a hand-drawn canvas as a
// last-resort fallback only. User feedback on the first cut of this (a fully hand-drawn canvas
// card) was explicit: "don't reinvent the wheel" — the exported image must be the ACTUAL page
// layout (header + the real matchup card, verbatim), not a separately-designed graphic that will
// drift from the app's real look over time. So the primary path below clones the live header +
// the specific game's live .gcard, strips out anything interactive, inlines every image as a
// data: URI (so nothing the exported canvas depends on is a live cross-origin fetch — see
// inlineImages), serializes that into an SVG <foreignObject>, and rasterizes THAT. Only if this
// whole pipeline throws or produces a suspiciously blank result does captureShareImage fall back
// to the old hand-drawn renderResultCardFallback further below.
function shareLinkFor(riotId, matchId) {
  return `${location.origin}${location.pathname}?riot-search=${encodeURIComponent(riotId)}&match=${encodeURIComponent(matchId)}`;
}

// A 1x1 transparent GIF — swapped in for any image inlineImages can't fetch (network hiccup,
// unexpectedly missing CORS headers), so a broken-image box never gets baked into the exported
// PNG and the layout doesn't shift the way img.remove() would.
const BLANK_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
async function toDataUri(url) {
  const r = await fetch(url, { mode: 'cors' });
  if (!r.ok) throw new Error('fetch failed: ' + r.status);
  const blob = await r.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
// Every <img> inside `root` (champ icons, role icons, the LoL wordmark) is a cross-origin raster
// resource — left as a live src, foreignObject content rendered to canvas taints the canvas on
// export (Chrome flags the whole composited SVG as non-origin-clean the moment ANY embedded
// raster came from elsewhere, regardless of that resource's own CORS headers). Inlining every one
// as a base64 data: URI up front means the final rasterize step never touches the network at all,
// so there's nothing left that CAN taint it.
async function inlineImages(root) {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(async img => {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) return;
    try { img.setAttribute('src', await toDataUri(new URL(src, location.href).href)); }
    catch { img.setAttribute('src', BLANK_PIXEL); }
  }));
}
// The app's own compiled stylesheet, fetched once and cached — inlined into a <style> tag inside
// the foreignObject below so the cloned header/card get the EXACT real cascade (colors, badge
// classes, table layout, spinner keyframes, all of it), not a hand-approximated subset. An
// isolated SVG "document" loaded via new Image() doesn't inherit the host page's <link
// rel="stylesheet">, so this has to be inlined as text.
let appCssTextCache = null;
async function fetchAppCss() {
  if (appCssTextCache != null) return appCssTextCache;
  const link = document.querySelector('link[rel="stylesheet"]');
  try { appCssTextCache = link ? await (await fetch(link.href)).text() : ''; }
  catch { appCssTextCache = ''; }
  return appCssTextCache;
}
// Root CSS custom properties (--bg, --mid, etc.), redeclared directly as inline styles on the
// capture root rather than trusted to the injected stylesheet's own `:root` rule — whether `:root`
// inside an isolated foreignObject SVG document resolves the way it does in the real page is
// implementation-dependent; an inline declaration on the actual ancestor element is unambiguous
// and every var(--x) reference in the inlined stylesheet still resolves via normal inheritance.
const ROOT_VARS_CSS = '--bg:#0e1015;--card:#181b22;--line:#262b36;--txt:#e8eaf0;--dim:#8a91a3;--ok:#3fb68b;--mid:#e0a63d;--bad:#e05d5d;--blue:#4a90d9;--red:#d97a4a;';
// Cheap "did this actually render anything" check — samples a block of pixels from the middle of
// the canvas and bails if every one of them is (near-)identical to the first, which a card this
// dense with text/table content should never legitimately be. Not foolproof, but good enough to
// catch the foreignObject pipeline silently producing a blank frame (a known risk of this
// technique in some browsers) and route to the fallback instead of shipping an empty image.
function looksBlank(canvas) {
  const ctx = canvas.getContext('2d');
  const w = Math.min(canvas.width, 60), h = Math.min(canvas.height, 60);
  const x = Math.floor((canvas.width - w) / 2), y = Math.floor((canvas.height - h) / 2);
  const data = ctx.getImageData(x, y, w, h).data;
  const [r0, g0, b0] = data;
  for (let i = 4; i < data.length; i += 4) {
    if (Math.abs(data[i] - r0) > 4 || Math.abs(data[i + 1] - g0) > 4 || Math.abs(data[i + 2] - b0) > 4) return false;
  }
  return true;
}
// Renders `node` (already fully built, not yet attached) off-screen at a fixed width, inlines its
// images, measures its natural height, serializes it into an SVG foreignObject, and rasterizes
// that into a PNG blob. Throws if the pipeline fails outright or looks blank — callers fall back
// to renderResultCardFallback when this throws.
async function domToPngBlob(node, width) {
  node.style.position = 'fixed';
  node.style.left = '-99999px';
  node.style.top = '0';
  node.style.width = width + 'px';
  node.style.boxSizing = 'border-box';
  node.style.background = '#0e1015';
  node.style.color = '#e8eaf0';
  node.style.font = '15px/1.5 system-ui, sans-serif';
  node.style.padding = '28px';
  node.style.cssText += ROOT_VARS_CSS;
  document.body.appendChild(node);
  try {
    await inlineImages(node);
    // Two rAFs: one for the browser to apply the just-swapped data: URI srcs, one to let layout
    // actually settle before measuring — a single frame occasionally still read a pre-image height.
    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
    const height = Math.max(1, Math.ceil(node.getBoundingClientRect().height));
    const cssText = await fetchAppCss();
    const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
      + `<foreignObject x="0" y="0" width="${width}" height="${height}">`
      + `<div xmlns="http://www.w3.org/1999/xhtml"><style>${cssText}</style>${node.outerHTML}</div>`
      + `</foreignObject></svg>`;
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const img = await loadCardImage(svgUrl);
      if (!img) throw new Error('SVG failed to decode');
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0e1015';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      if (looksBlank(canvas)) throw new Error('Capture looks blank');
      return await canvasToBlob(canvas);
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
  } finally {
    node.remove();
  }
}
// Assembles the exact content the redesign asked for: the real header (logo/title/UNOFFICIAL
// pill, with the "How we score" link + account button stripped — those are navigation, not result
// content), the profile name as a plain text label (not the live search input), and the specific
// game's live .gcard verbatim (matchup table, rank tags, chips, Favored column, TEAM footer with
// its win% bar and DRAFT line) with only the row header's action buttons (Hide/↻/📤) removed.
function buildShareCaptureNode(cardEl, riotId) {
  const wrap = document.createElement('div');

  const headerClone = document.querySelector('.site-header').cloneNode(true);
  headerClone.querySelector('.h1-right')?.remove(); // "How we score" link + account button — navigation, not result content
  wrap.appendChild(headerClone);

  const label = document.createElement('div');
  label.textContent = riotId;
  label.style.cssText = 'font-size:20px; font-weight:700; color:#e8eaf0; margin:14px 0 18px;';
  wrap.appendChild(label);

  const cardClone = cardEl.cloneNode(true);
  cardClone.classList.add('open'); // defensive — the caller already ensures this on the live element before cloning
  cardClone.querySelectorAll('.row > button').forEach(b => b.remove()); // Hide/View, ↻ re-analyze, 📤 share
  wrap.appendChild(cardClone);

  return wrap;
}
// Real-DOM capture, primary path — throws (see domToPngBlob) if the pipeline fails outright or
// produces a blank frame. The caller (onShareClick) is the one that decides what to do about that
// (fall back to renderResultCardFallback) since it already has matchId/riotId/region in scope.
function captureShareImage(cardEl, riotId) {
  return domToPngBlob(buildShareCaptureNode(cardEl, riotId), 1160);
}

const CARD_W = 1200, CARD_H = 630;
function canvasRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
// Greedy word-wrap, capped at maxLines with an ellipsis on the last line if it overflows —
// canvas has no native text-wrapping, unlike the DOM one-liner it mirrors. Returns the pixel
// height actually used so the caller can stack the next element below it.
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines && shown.length) shown[shown.length - 1] = shown[shown.length - 1].replace(/\s*\S*$/, '') + '…';
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return Math.max(shown.length, 1) * lineHeight;
}
function loadCardImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // ddragon serves permissive CORS headers — needed so the canvas this gets drawn into can still be exported (toBlob) below
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // a 404'd/unmapped champ icon just leaves that space blank, not a fatal error for the whole card
    img.src = url;
  });
}
function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))), 'image/png'); }
    catch (err) { reject(err); }
  });
}
// v4.36: LAST-RESORT fallback only, used exclusively when captureShareImage's real-DOM capture
// throws — see the big comment above that function for why hand-drawing isn't the primary path
// anymore. Kept otherwise unchanged from the original implementation: a self-contained 1200x630
// PNG drawn with the Canvas API directly, mirroring the same verdict color/label
// (verdictCls/verdictLabel), win% bar (see winProbHTML) and duo-evidence phrasing (lib/riot.mjs's
// fairness(), "N enemy duos") the real page shows. `withIcon=false` skips the ddragon champion-
// icon fetch/draw entirely — used as this function's OWN internal retry if drawing/exporting the
// icon version taints the canvas a second time (see onShareClick below).
async function renderResultCardFallback(e, riotId, withIcon) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W; canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  const PAD = 56;

  ctx.fillStyle = '#0e1015';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.strokeStyle = '#262b36';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);

  // Wordmark + UNOFFICIAL pill, same gold (--mid) and pill styling as the real header.
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e0a63d';
  ctx.font = '800 40px Arial, sans-serif';
  ctx.fillText('LOSING QUEUE', PAD, 80);
  const wmWidth = ctx.measureText('LOSING QUEUE').width;
  ctx.font = '800 13px Arial, sans-serif';
  const pillText = 'UNOFFICIAL';
  const pillW = ctx.measureText(pillText).width + 24, pillH = 26;
  const pillX = PAD + wmWidth + 16, pillY = 56;
  ctx.strokeStyle = '#e0a63d'; ctx.lineWidth = 1.5;
  canvasRoundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2); ctx.stroke();
  ctx.fillStyle = '#e0a63d';
  ctx.fillText(pillText, pillX + 12, pillY + 18);

  // Verdict badge, top-right — same three colors as .b-ok/.b-mid/.b-bad in style.css.
  const VERDICT_COLORS = { 'b-ok': ['#123527', '#3fb68b'], 'b-mid': ['#3a2d10', '#e0a63d'], 'b-bad': ['#3a1616', '#e05d5d'] };
  const vCls = verdictCls(e.matchmaking, e.direction);
  const [badgeBg, badgeFg] = VERDICT_COLORS[vCls] || VERDICT_COLORS['b-ok'];
  const vLabel = verdictLabel(e.matchmaking, e.direction);
  ctx.font = '800 22px Arial, sans-serif';
  const badgeW = ctx.measureText(vLabel).width + 40, badgeH = 40;
  const badgeX = CARD_W - PAD - badgeW, badgeY = 48;
  ctx.fillStyle = badgeBg; canvasRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2); ctx.fill();
  ctx.fillStyle = badgeFg;
  ctx.textAlign = 'center';
  ctx.fillText(vLabel, badgeX + badgeW / 2, badgeY + 27);
  ctx.textAlign = 'left';

  // Champion icon (best-effort) + result/champ/KDA.
  const iconSize = 120, iconX = PAD, iconY = 130, textX = iconX + iconSize + 28;
  ctx.fillStyle = '#181b22';
  canvasRoundRect(ctx, iconX, iconY, iconSize, iconSize, 14); ctx.fill();
  if (withIcon && e.user?.champ) {
    const img = await loadCardImage(`https://ddragon.leagueoflegends.com/cdn/${CHAMP_STATS_PATCH}/img/champion/${encodeURIComponent(e.user.champ)}.png`);
    if (img) {
      ctx.save();
      canvasRoundRect(ctx, iconX, iconY, iconSize, iconSize, 14); ctx.clip();
      ctx.drawImage(img, iconX, iconY, iconSize, iconSize);
      ctx.restore();
    }
  }
  const isWin = e.result === 'Victory';
  ctx.font = '800 44px Arial, sans-serif';
  ctx.fillStyle = isWin ? '#3fb68b' : '#e05d5d';
  ctx.fillText(isWin ? 'VICTORY' : 'DEFEAT', textX, iconY + 48);
  ctx.font = '600 26px Arial, sans-serif';
  ctx.fillStyle = '#e8eaf0';
  ctx.fillText(e.user?.champ || '', textX, iconY + 84);
  ctx.font = '400 18px Arial, sans-serif';
  ctx.fillStyle = '#8a91a3';
  ctx.fillText(e.user?.kda || '', textX, iconY + 112);

  // Win% bar — same blue/red segment-with-labels language as winProbHTML's DOM bar.
  const barY = 300, barH = 36, barW = CARD_W - PAD * 2;
  const wp = e.winProb;
  if (wp) {
    ctx.save();
    canvasRoundRect(ctx, PAD, barY, barW, barH, barH / 2); ctx.clip();
    const blueW = Math.round(barW * wp.blue / 100);
    ctx.fillStyle = '#4a90d9'; ctx.fillRect(PAD, barY, blueW, barH);
    ctx.fillStyle = '#d97a4a'; ctx.fillRect(PAD + blueW, barY, barW - blueW, barH);
    ctx.restore();
    ctx.font = '700 16px Arial, sans-serif';
    ctx.fillStyle = '#fff';
    if (wp.blue >= WP_NARROW_PCT) { ctx.textAlign = 'left'; ctx.fillText(`${wp.blue}%`, PAD + 12, barY + 23); }
    if (wp.red >= WP_NARROW_PCT) { ctx.textAlign = 'right'; ctx.fillText(`${wp.red}%`, PAD + barW - 12, barY + 23); }
    ctx.textAlign = 'left';
  }

  // One-liner, then the duo-evidence line (if the fairness engine actually flagged a relevant
  // duo) directly below it — same "N enemy duos" / "N your duos" phrasing lib/riot.mjs's
  // fairness() already produces (g.duos: [name, name, "X/5 pre-game games together", side]).
  // Side picked to match whichever direction the verdict itself points: a verdict that favors
  // the user cites THEIR duos as evidence, everything else cites the enemy's.
  ctx.font = '400 24px Arial, sans-serif';
  ctx.fillStyle = '#e8eaf0';
  const oneLinerY = 380;
  const usedH = wrapCanvasText(ctx, scrubLegacy(e.oneLiner), PAD, oneLinerY, barW, 32, 3);
  const side = e.direction === 'favor' ? 'ally' : 'enemy';
  const relevantDuos = (e.duos || []).filter(d => d[3] === side);
  if (relevantDuos.length) {
    const duoLabel = `${relevantDuos.length} ${side === 'ally' ? 'your' : 'enemy'} duo${relevantDuos.length > 1 ? 's' : ''} · ${relevantDuos[0][2]}`;
    ctx.font = '400 18px Arial, sans-serif';
    ctx.fillStyle = '#8a91a3';
    ctx.fillText(duoLabel, PAD, oneLinerY + usedH + 12);
  }

  // Footer branding.
  ctx.font = '700 18px Arial, sans-serif';
  ctx.fillStyle = '#e0a63d';
  ctx.fillText('losingqueue.lol', PAD, CARD_H - 36);
  ctx.font = '400 15px Arial, sans-serif';
  ctx.fillStyle = '#8a91a3';
  ctx.textAlign = 'right';
  ctx.fillText(riotId || '', CARD_W - PAD, CARD_H - 36);
  ctx.textAlign = 'left';

  return canvas;
}
async function renderResultCardFallbackBlob(riotId, matchId, region) {
  const r = await fetch(`${API}/api/analyze?riotId=${encodeURIComponent(riotId)}&matchId=${encodeURIComponent(matchId)}&region=${region}`);
  const data = await r.json();
  if (!r.ok || !data.entry) throw new Error(data.error || 'Game not found');
  try {
    return await canvasToBlob(await renderResultCardFallback(data.entry, riotId, true));
  } catch {
    // Tainted-canvas export failure — the ddragon icon loaded but didn't actually carry a CORS
    // header permissive enough for export (or some other draw-time hiccup). Retry with nothing
    // but locally-drawn shapes/text on the canvas, which can't taint it a second time.
    return await canvasToBlob(await renderResultCardFallback(data.entry, riotId, false));
  }
}
// v4.36: the Share button's click handler. No "Generating image..." page text anywhere — the
// loading state lives entirely in the button itself (spinner, same pattern analyze() already uses
// for View/↻), and the result opens in a modal rather than triggering an immediate download.
async function onShareClick(btn, matchId, riotId, key) {
  if (btn.disabled) return;
  const prevHTML = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const viewBtn = document.getElementById('v' + key);
    const card = document.getElementById('g' + key);
    if (!card || !viewBtn) throw new Error('Card not found');
    // The captured card must actually be loaded+open — a Share click doesn't require a prior View
    // click. Calling analyze() directly (not simulating a click) when it's not loaded yet is safe:
    // that's its normal fetch-and-open path, not the loaded-toggle short-circuit, so it can never
    // accidentally COLLAPSE an already-open card the way a second click/analyze() call would.
    if (!viewBtn.dataset.loaded) {
      await analyze(matchId, viewBtn, key);
    } else if (!card.classList.contains('open')) {
      card.classList.add('open');
      viewBtn.textContent = '▴ Hide';
    }
    const region = CTX.riotId === riotId ? CTX.region : regionFromMatchId(matchId);
    let blob;
    try {
      blob = await captureShareImage(card, riotId);
    } catch {
      blob = await renderResultCardFallbackBlob(riotId, matchId, region);
    }
    openShareModal(blob, riotId, matchId);
  } catch {
    showToast('Could not generate the image.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = prevHTML;
  }
}

let shareModalObjUrl = null;
function closeShareModal() {
  $('#shareModal').classList.remove('open');
  $('#shareModal').innerHTML = '';
  if (shareModalObjUrl) { URL.revokeObjectURL(shareModalObjUrl); shareModalObjUrl = null; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeShareModal(); });
// Large image preview + Download / native Share (with the actual image file, where supported) /
// Copy image to clipboard (ClipboardItem, feature-detected — Firefox/older Safari just don't get
// the button rather than a broken one), plus a small secondary "copy game link instead" for
// whoever specifically wants the deep link (?riot-search&match=) to this one game rather than the
// profile-level link the header's 🔗 button copies.
function openShareModal(blob, riotId, matchId) {
  closeShareModal();
  shareModalObjUrl = URL.createObjectURL(blob);
  const fileName = `losingqueue-${matchId}.png`;
  let canNativeShareFile = false;
  try { canNativeShareFile = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([blob], fileName, { type: 'image/png' })] }); } catch {}
  const canCopyImage = typeof window.ClipboardItem === 'function' && !!navigator.clipboard?.write;
  const modal = $('#shareModal');
  modal.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Share this game">
      <div class="modal-header">
        <span class="modal-title">Share this game</span>
        <button type="button" class="modal-x" id="shModalClose" aria-label="Close">✕</button>
      </div>
      <img id="shModalImg" src="${shareModalObjUrl}" alt="Result card preview">
      <div class="modal-actions">
        <button type="button" id="shModalDownload">⬇ Download</button>
        ${canNativeShareFile ? `<button type="button" id="shModalNative">📱 Share…</button>` : ''}
        ${canCopyImage ? `<button type="button" id="shModalCopyImg">📋 Copy image</button>` : ''}
      </div>
      <div class="modal-secondary"><button type="button" class="linklike" id="shModalGameLink">Copy game link instead</button></div>
    </div>`;
  modal.classList.add('open');
  $('#shModalClose').addEventListener('click', closeShareModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeShareModal(); });
  $('#shModalDownload').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = shareModalObjUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
  if (canNativeShareFile) {
    $('#shModalNative').addEventListener('click', async () => {
      try { await navigator.share({ files: [new File([blob], fileName, { type: 'image/png' })], title: 'Losing Queue', text: 'Was this game fair? Check it out:' }); } catch {} // AbortError on user-cancel, etc. — nothing to report either way
    });
  }
  if (canCopyImage) {
    $('#shModalCopyImg').addEventListener('click', async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); showToast('Image copied to clipboard'); }
      catch { showToast('Could not copy image'); }
    });
  }
  $('#shModalGameLink').addEventListener('click', () => copyToClipboardOrToast(shareLinkFor(riotId, matchId), 'Game link copied to clipboard'));
}

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
// v4.27: CommunityDragon's clash position-selector icon set — small (~18px), white-filtered via
// CSS (see .role-icon) so they read as dim metadata regardless of the icons' own native color,
// same visual family as .place/.rank-tag. label is the short title tooltip text, matching the
// fixed ROLES order above one-to-one (never reordered independently of it).
const ROLE_ICON = {
  TOP: { url: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-top.png', label: 'TOP' },
  JUNGLE: { url: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-jungle.png', label: 'JUNGLE' },
  MIDDLE: { url: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-middle.png', label: 'MID' },
  BOTTOM: { url: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-bottom.png', label: 'ADC' },
  UTILITY: { url: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-utility.png', label: 'SUPPORT' },
};
const badgeHTML = p => p?.badge ? `<span class="badge-${p.badge.toLowerCase()}" title="${p.badge === 'MVP' ? 'Best performance of the winning team' : 'Best performance of the losing team'}">${p.badge}</span>` : '';

// v4.27: full-page background art — the searched player's most-played champion (across their
// currently-listed games) as a Data Dragon splash, at low opacity behind everything (see
// body::before in style.css). `function` declarations (not `const`), not arrow fns — restoreLastSearch
// below is an IIFE that runs synchronously at module load and calls renderRows (which calls
// updateBgSplash) immediately; a `const` here would still be in its temporal dead zone at that
// point (same lesson already documented elsewhere in this file re: winProbCompact).
function mostFrequentChamp(games) {
  const counts = {};
  for (const g of games || []) { if (g.champ && !g.remake) counts[g.champ] = (counts[g.champ] || 0) + 1; }
  let best = null, bestN = 0;
  for (const champ in counts) { if (counts[champ] > bestN) { best = champ; bestN = counts[champ]; } }
  return best;
}
// Splash URLs use the exact same internal championName id as everything else in this app (Data
// Dragon's own "MonkeyKing"/"Fiddlesticks"/"Kaisa" style ids — verified against ddragon directly:
// Wukong_0.jpg 404s, MonkeyKing_0.jpg is the real file; same id space lib/counters.mjs's header
// documents), so no extra name-mapping is needed beyond what pStats() already normalizes server-side.
// v4.29: FUNCTION declaration, not `const` — this exact mistake caused a real production TDZ
// crash ("Cannot access 'champSplashUrl' before initialization"). updateBgSplash (which calls
// this) is itself safely hoisted, but it's invoked SYNCHRONOUSLY at module-load time by
// restoreLastSearch's IIFE whenever a cached lastSearch exists — i.e. for any returning user —
// which runs well before a `const` declared this far down the file would have been evaluated by
// the normal top-to-bottom pass. A `function` declaration hoists its full body, not just the
// name, so it's safe to call from anywhere regardless of textual position — same lesson this
// file already documents for winProbCompact/mostFrequentChamp/updateBgSplash itself.
function champSplashUrl(champ) { return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${encodeURIComponent(champ)}_0.jpg`; }
// Preloads before committing to the CSS var, so a 404 (an unmapped/renamed champ id, or ddragon
// hiccup) never flashes a broken background — "if the image 404s, stay plain" — and the plain-bg
// default never blocks first render (this only ever runs after a search already has data).
function updateBgSplash(games) {
  const champ = mostFrequentChamp(games);
  if (!champ) { document.documentElement.style.setProperty('--splash-img', 'none'); document.body.classList.remove('has-splash'); return; }
  const url = champSplashUrl(champ);
  const img = new Image();
  img.onload = () => { document.documentElement.style.setProperty('--splash-img', `url("${url}")`); document.body.classList.add('has-splash'); };
  img.onerror = () => { document.documentElement.style.setProperty('--splash-img', 'none'); document.body.classList.remove('has-splash'); };
  img.src = url;
}
// v4.34: default landing splash — no known profile at all yet (restoreLastSearch's own early
// return, see below), so there's no real champ to derive one from. Picks uniformly at random from
// lib/champstats.mjs's own STATS keys (already imported; the exact same id space champSplashUrl
// expects) and reuses updateBgSplash's whole preload-then-commit contract via a synthetic
// single-game array — mostFrequentChamp trivially "wins" on a lone entry, so no separate code
// path is needed just for this. A resolved profile's real splash always overwrites this the
// moment one becomes known (any later updateBgSplash call just replaces the CSS var); a 404 on
// the random pick falls back to plain, same as any other splash attempt.
function showRandomSplash() {
  const champs = Object.keys(CHAMP_STATS);
  if (!champs.length) return;
  const champ = champs[Math.floor(Math.random() * champs.length)];
  updateBgSplash([{ champ }]);
}
// v4.27: delegated (capture — 'error' doesn't bubble), so every current AND future .champ-icon
// <img> (matchup champ-c cells) gets the same graceful text fallback on a 404 without needing to
// wire a per-element listener at each of matchupHTML's render call sites.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('champ-icon')) return;
  const span = document.createElement('span');
  span.className = 'champ' + (img.classList.contains('champ-meta') ? ' champ-meta' : '');
  span.textContent = img.alt || '';
  if (img.title) span.title = img.title;
  img.replaceWith(span);
}, true);

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

// Shared rank scale — module-level (not function-local) so both laneDifferentiators' existing
// rank-gap differentiator AND the v4.17 lane-rank-weighting below use the same tier order/labels.
const RANK_TIER = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Emerald', 'Diamond', 'Master', 'Grandmaster', 'Challenger'];
const RANK_DIV = { I: 3, II: 2, III: 1, IV: 0 };
const rankLabel = rk => rk ? rk.replace(/\s*\d+LP$/, '') : rk;
// Compact tag abbreviation for the matchup rows: "E4"/"P2"/"D3" for sub-apex tiers, "M"/"GM"/"C"
// (no division) for Master+ — Riot's apex tiers aren't meaningfully split into IV-I the way lower
// tiers are. parseRank is the shared base (tier/div/LP breakdown + the abbreviation + the full
// "Tier Div · NN LP" string) that both rankTag (matchup rows) and rankDetailLabel (details table)
// build on, so the two never disagree about what a given rank string means.
const RANK_TAG_LETTER = { Iron: 'I', Bronze: 'B', Silver: 'S', Gold: 'G', Platinum: 'P', Emerald: 'E', Diamond: 'D', Master: 'M', Grandmaster: 'GM', Challenger: 'C' };
function parseRank(rankStr) {
  const m = rankStr && /^(\S+)\s+(\S+)\s+(\d+)LP$/.exec(rankStr);
  if (!m) return null;
  const [, tierWord, div, lp] = m;
  const letter = RANK_TAG_LETTER[tierWord];
  if (!letter) return null;
  const isApex = tierWord === 'Master' || tierWord === 'Grandmaster' || tierWord === 'Challenger';
  const abbrev = isApex ? letter : `${letter}${{ IV: 4, III: 3, II: 2, I: 1 }[div] ?? ''}`;
  return { abbrev, full: `${tierWord} ${div} · ${lp} LP` };
}
// v4.18: tag extended from rank-only to rank·winrate ("P3 · 51%") — a rank number alone doesn't
// say whether that's a strong or weak account for the tier; season winrate does. wr/seasonGames
// come straight from the entry (gaScore already computes both; wr is null whenever seasonGames is
// 0, i.e. no ranked games yet this season — same condition already used elsewhere in this file).
// Full W-L is derived (seasonGames × wr/100, rounded) since only the aggregate win% is stored, not
// exact win/loss counts. Unranked -> no tag at all; ranked but missing wr -> rank only, no "· NN%".
function rankTag(rankStr, wr, seasonGames) {
  const p = parseRank(rankStr);
  if (!p) return null;
  let label = p.abbrev, title = p.full;
  if (wr != null) {
    label += ` · ${wr}%`;
    if (seasonGames) {
      const w = Math.round(seasonGames * wr / 100), l = seasonGames - w;
      title += ` · ${w}W-${l}L (${wr}%)`;
    } else {
      title += ` · ${wr}%`;
    }
  }
  return { label, title };
}
// Details table's rank column: the full, unabbreviated form ("Emerald I · 50 LP · 51%") — more
// room there than the compact matchup-row tag, so no need to abbreviate the tier name. Falls back
// to the raw rank string (e.g. "Unranked") when it doesn't parse as a normal ranked entry.
function rankDetailLabel(rankStr, wr) {
  const p = parseRank(rankStr);
  const base = p ? p.full : (rankStr || 'Unranked');
  return base + (wr != null ? ` · ${wr}%` : '');
}
// v4.17: mirrors lib/riot.mjs's rankDivisionIndex/rankGapAdj — direct head-to-head rank gap
// between two LANE OPPONENTS specifically (separate from and additional to the rank-vs-lobby-
// average signal already baked into each player's GA). Real case: a Platinum vs Emerald matchup
// between direct lane opponents was completely invisible in the lane table (just "BLUE +6", no
// rank shown anywhere). Division index: tier*4 + division-within-tier (IV=0..I=3) — apex tiers
// collapse to their tier base, same reasoning as rankTag above. 2 GA per division of gap, capped
// at ±8, added ONCE per lane (not once per side) so it can never contradict the engine's version.
const RANK_LANE_WEIGHT = 2, RANK_LANE_CAP = 8;
function rankDivisionIndex(rankStr) {
  if (!rankStr || rankStr === 'Unranked') return null;
  const [tierWord, div] = rankStr.split(' ');
  const tier = RANK_TIER.indexOf(tierWord);
  if (tier === -1) return null;
  return tier >= RANK_TIER.indexOf('Master') ? tier * 4 : tier * 4 + (RANK_DIV[div] ?? 0);
}
function rankGapAdj(aRank, bRank) {
  const a = rankDivisionIndex(aRank), b = rankDivisionIndex(bRank);
  if (a == null || b == null) return 0;
  return Math.max(-RANK_LANE_CAP, Math.min(RANK_LANE_CAP, (a - b) * RANK_LANE_WEIGHT));
}

// v4.18: champion meta hover — a per-patch snapshot (lib/champstats.mjs, same "static curated
// file, not a live call" philosophy as lib/counters.mjs), keyed by the exact match-v5 internal
// champion name every champ field in this app already uses, so no separate name-mapping is
// needed here. A champion missing from the snapshot (not yet in the fetched data, or a display
// mismatch) just gets no hover — never a fabricated number. Info-only: doesn't feed the fairness
// verdict, doesn't affect any GA math, purely a "what's this champ doing in the meta right now"
// tooltip.
function champMetaTitle(champ) {
  const s = champ && CHAMP_STATS[champ];
  if (!s) return null;
  return `${champ} — WR ${s.wr}% · pick ${s.pick}% · ban ${s.ban}% (patch ${CHAMP_STATS_PATCH})`;
}

// v4.20: mirrors lib/riot.mjs's botSynergyDelta/botSynergyOf — bot-lane (ADC+SUPPORT) duo
// synergy from lib/duosynergy.mjs's per-patch snapshot, net of each champ's own solo winrate
// (lib/champstats.mjs) so what's left is specifically "does this PAIRING work". Returns null
// (not 0) when the pair or either champ's solo WR is missing — a missing pair means no data, not
// confirmed-neutral synergy. allPlayers/team here use this app's 'blue'/'red' team labels, not
// the engine's 100/200.
function botSynergyDelta(adcChamp, suppChamp) {
  const pair = DUO_PAIRS[`${adcChamp}+${suppChamp}`];
  if (!pair) return null;
  const adcWr = CHAMP_STATS[adcChamp]?.wr, suppWr = CHAMP_STATS[suppChamp]?.wr;
  if (adcWr == null || suppWr == null) return null;
  return { delta: pair.wr - (adcWr + suppWr) / 2, wr: pair.wr, games: pair.games, adcChamp, suppChamp };
}
function botSynergyOf(allPlayers, team) {
  const adc = allPlayers?.find(p => p.team === team && p.pos === 'BOTTOM');
  const supp = allPlayers?.find(p => p.team === team && p.pos === 'UTILITY');
  if (!adc || !supp) return null;
  return botSynergyDelta(adc.champ, supp.champ);
}
const BOT_SYNERGY_LANE_CAP = 4;
const clampBotSynergy = delta => Math.max(-BOT_SYNERGY_LANE_CAP, Math.min(BOT_SYNERGY_LANE_CAP, delta));
// v4.22: shared "at most 1 decimal, no trailing .0" formatter — every display site that renders a
// computed (not stored-integer) delta funnels through this, so a float tail like
// "6.437000000000012" (real bug, rank-gap/bot-synergy fractional deltas leaking straight into the
// lane Favored column) can't happen anywhere. toFixed(1) rounds to one decimal as a string; the
// trailing "/\.0$/" strip is purely cosmetic (a real +4.0% reads better as +4%, still exact).
const fmt1 = v => v.toFixed(1).replace(/\.0$/, '');
// Chip for the BOTTOM/UTILITY rows: "duo +2.4%" — green when the pairing clears +1% over the
// champs' own solo winrates, red when it's -1% or worse, dim in the narrow band between (real,
// but not a strong enough signal to call out visually). Games count formatted compactly (12k) —
// this can be a small sample for off-meta ADCs (lib/duosynergy.mjs's header explains why), so the
// raw count is always in the tooltip for the reader to judge, never hidden.
function botSynergyChipHTML(synergy) {
  if (!synergy) return '';
  const cls = synergy.delta >= 1 ? 'synergy-pos' : synergy.delta <= -1 ? 'synergy-neg' : 'synergy-dim';
  const sign = synergy.delta >= 0 ? '+' : '';
  const gamesLabel = synergy.games >= 1000 ? `${fmt1(synergy.games / 1000)}k` : `${synergy.games}`;
  const title = `${synergy.adcChamp}+${synergy.suppChamp}: ${fmt1(synergy.wr)}% over ${gamesLabel} games — ${sign}${fmt1(synergy.delta)}% vs their solo winrates (patch ${DUO_SYNERGY_PATCH})`;
  return `<span class="chip ${cls}" title="${esc(title)}">duo ${sign}${fmt1(synergy.delta)}%</span>`;
}

// v4.2: mirrors lib/riot.mjs's duo-lane bonus — a duo'd player's lane reads a bit stronger than
// their solo GA alone, since they can coordinate with a teammate elsewhere on the map. v4.14: a
// jungle-inclusive duo's bonus is now ADAPTIVE (mirrors lib/riot.mjs's jungleDuoBonus/duoLaneInfo)
// rather than a flat +5 — real cases: Annie Tapis de Mosqué went 11/4/12 through a Δ34-ish deficit
// (raw GA 55 vs her mid opponent Quicker's 94) with jungle duo partner Qiyana camping mid
// relentlessly; Seraphine went 1/8/27 MVP — box-score numbers alone read as a stomp, but she was
// the actual playmaker because her jungler propped the lane up around her. Bucketed by the duo'd
// laner's raw GA deficit vs their direct lane opponent, computed from risk+counter-adjusted GA
// BEFORE any duo bonus (ownPreDuo/oppPreDuo, passed in by the caller — matchupHTML already
// computes these before calling this), deficit clamped at 0 so a duo'd laner who's actually ahead
// still gets the baseline, not a penalty: <10 -> +9, 10-19 -> +12, >=20 -> +15. Applies to BOTH
// members of a jungle-inclusive duo, each keyed off THEIR OWN lane's deficit, not their partner's.
const LANE_DUO_BONUS = 3;
const JUNGLE_DUO_TIERS = [{ under: 10, bonus: 9 }, { under: 20, bonus: 12 }, { under: Infinity, bonus: 15 }];
const jungleDuoBonus = deficit => JUNGLE_DUO_TIERS.find(t => deficit < t.under).bonus;
function duoAdjOf(p, allPlayers, ownPreDuo, oppPreDuo) {
  if (!p?.duo) return 0;
  const partner = p.duoWith && allPlayers ? allPlayers.find(x => x.n === p.duoWith) : null;
  const isJungleDuo = p.pos === 'JUNGLE' || partner?.pos === 'JUNGLE';
  if (!isJungleDuo) return LANE_DUO_BONUS;
  // No opponent on record for this lane (missing row) — no deficit signal to react to, fall back
  // to the baseline tier rather than guessing.
  if (ownPreDuo == null || oppPreDuo == null) return jungleDuoBonus(0);
  return jungleDuoBonus(Math.max(0, oppPreDuo - ownPreDuo));
}

// v4.1.1: lane tooltips must explain the GA GAP, not just list flags — a trait shared by BOTH
// laners (both OTP, both autofilled) explains nothing about why one side is ahead, so it's
// dropped entirely rather than shown as if it mattered. Only genuine differentiators — present
// on exactly one side, or a real comparative gap — are returned, dominant first. `side` ('b'/'r')
// records which player each differentiator's text is actually about (the "winner" for
// comparative factors, the flag-holder for one-sided ones), so laneEvenNote below can pick one
// differentiator favoring each side for an "X offset by Y" pairing.
function laneDifferentiators(b, r, allPlayers) {
  if (!b || !r) return [];
  const short = p => (p?.n || '').split('#')[0];
  const out = [];

  // Jungle-duo: the adaptive bonus above already prices this into the lane's GA, but the tooltip
  // should name WHY, same as every other flag-driven factor here does. One-sided only (same
  // cancels-out spirit as the flag block below) — if BOTH laners are jungle-duo'd, neither
  // explains the gap over the other.
  const isJungleDuo = p => {
    if (!p?.duo) return false;
    if (p.pos === 'JUNGLE') return true;
    const partner = p.duoWith && allPlayers ? allPlayers.find(x => x.n === p.duoWith) : null;
    return partner?.pos === 'JUNGLE';
  };
  const bJungleDuo = isJungleDuo(b), rJungleDuo = isJungleDuo(r);
  if (bJungleDuo !== rJungleDuo) {
    const p = bJungleDuo ? b : r;
    out.push({ text: `${short(p)} duo with their jungler — gank threat`, w: 10, side: bJungleDuo ? 'b' : 'r' });
  }

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
  // both collapse to the same "unit gap >= 2" check. Player name — rank is account-level. Uses the
  // module-level RANK_TIER/RANK_DIV/rankLabel above (this differentiator's rankValue keeps its own
  // apex handling — RANK_DIV['I']=3 — distinct from the v4.17 rankDivisionIndex used for lane-rank
  // weighting, which deliberately zeroes the apex division bonus; unrelated concerns that happen
  // to share a tier-order scale).
  const rankValue = p => {
    if (!p?.rank || p.rank === 'Unranked') return null;
    const [tierWord, div] = p.rank.split(' ');
    const tier = RANK_TIER.indexOf(tierWord);
    return tier === -1 ? null : tier * 4 + (RANK_DIV[div] ?? 0);
  };
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
function laneFactorTooltip(b, r, allPlayers) {
  const diffs = laneDifferentiators(b, r, allPlayers);
  return diffs.length ? diffs.slice(0, 2).map(d => d.text).join('; ') : null;
}

// EVEN lane tooltip: same shared-trait-cancels differentiator list, framed as an offset — one
// factor favoring each side if both exist ("X offset by Y"), else just the lone factor found (a
// small edge that existed but didn't swing the numeric outcome either way). Null when there's
// nothing to say beyond the plain "Even matchup" wording.
function laneEvenNote(b, r, allPlayers) {
  const diffs = laneDifferentiators(b, r, allPlayers);
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
  // v4.22: band thresholds (<=5, >18) stay against the RAW ad — rank gap and bot-synergy deltas
  // (both fractional) can shift ad by a fraction of a point, and rounding before the threshold
  // check could flip a lane's band right at the boundary. Only the DISPLAYED number is rounded
  // (adDisplay) — real bug: "BLUE +6.437000000000012" leaking a float tail straight into the UI.
  const adDisplay = Math.round(ad);
  // v4 (backtest-driven): EVEN band narrowed 8 -> 5 — a backtest of 17 cached analyses found
  // EVEN-band lanes were only right 27% of the time, the widest miss of any band. Favored is now
  // 6-18 (heavy stays >=19, unchanged).
  if (ad <= 5) {
    if (skipEvenSide) {
      const side = d !== 0 ? (d > 0 ? 'blue' : 'red') : skipEvenSide;
      const shown = d !== 0 ? adDisplay : 1; // exact wash: non-autofilled side still gets a nominal +1
      const sideLabel = side === 'blue' ? 'Blue' : 'Red';
      const title = favorTooltip || riskNote || `${sideLabel} side favored: one-sided autofill risk keeps this lane from reading even`;
      return `<span class="lv-${side}" title="${esc(title)}">${side.toUpperCase()} +${shown}</span>`;
    }
    const evenTitle = riskNote || `Even matchup — pre-game GA gap of only ${adDisplay} points`;
    return `<span class="lv-even" title="${esc(evenTitle)}">EVEN</span>`;
  }
  const heavy = ad > 18;
  const strength = heavy ? 'HEAVILY favored' : 'favored';
  const side = d > 0 ? 'blue' : 'red', sideLabel = side === 'blue' ? 'Blue' : 'Red';
  const title = favorTooltip || `${sideLabel} side ${strength}: +${adDisplay} GA advantage before the game started`;
  return `<span class="lv-${side}" title="${esc(title)}">${side.toUpperCase()} +${adDisplay}</span>`;
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
  // v4.20: one bot-lane synergy value per TEAM (its BOTTOM+UTILITY champion pair), computed once
  // and reused for both of that team's bot-lane rows (the chip shown on each, and the lane-level
  // GA adjustment below) and the TEAM footer's side-by-side comparison.
  const blueBotSynergy = botSynergyOf(g.players, 'blue');
  const redBotSynergy = botSynergyOf(g.players, 'red');
  // Two lines per player: line one is #place + name + this game's KDA + bold GA (+ rank tag);
  // line two is every chip (MVP/ACE leading, then flags/duo/streak/cs). v4.26: RED's line one now
  // mirrors BLUE's around the table's center Favored column for symmetric left-right reading
  // (user-specified exact order) — BLUE keeps place/name/kda/GA/rank left-to-right with the rank
  // tag pushed to the cell's own far edge; RED clusters rank/place/GA/kda toward the CENTER
  // (nearest the Favored column) and pushes the player NAME out to the table's outer edge instead
  // — same "edge" flex-push mechanism (.p-cell-edge, see CSS), mirrored which element gets pushed.
  // Lane-favor severity (favored/heavily favored) is NOT shown here — it's the Favored-column
  // value's own tooltip below (laneVerdict), so it isn't duplicated per player. extraChip (v4.20):
  // the bot synergy chip on BOTTOM/UTILITY rows, appended after the flag/duo/streak/cs chip group.
  const cellName = (p, oppChamp, extraChip, side) => {
    if (!p) return '<span class="dim">—</span>';
    const place = p.place ? `<span class="place">#${p.place}</span>` : '';
    const name = `<span class="pname">${nameLink(p.n)}</span>`;
    const kda = p.kda ? `<span class="dim">${esc(p.kda)}</span>` : '';
    const ga = `<b>GA ${p.ga ?? '–'}</b>`;
    // v4.17/v4.18: rank·winrate tag next to GA — compact ("E4 · 51%", "M" alone for Master+ with
    // no games yet), full rank+LP+W-L in the title. Unranked renders nothing rather than an empty
    // tag.
    const rt = rankTag(p.rank, p.wr, p.seasonGames);
    const rank = rt ? `<span class="rank-tag dim" title="${esc(rt.title)}">${esc(rt.label)}</span>` : '';
    // v4.25/v4.26: the non-pushed content stays bundled in one inline span (p-main-info) so
    // .p-main can be a flex row without collapsing the plain-space joins between its tokens —
    // flexbox only treats non-whitespace text runs as their own anonymous item, so a bare " "
    // joiner between two sibling spans would otherwise vanish once the parent becomes
    // display:flex. Whichever single element is meant to sit at the cell's far edge (rank tag on
    // blue, player name on red) is wrapped in .p-cell-edge, the flex row's other child, pushed
    // there via margin-left:auto.
    let main;
    if (side === 'red') {
      const cluster = [rank, place, ga, kda].filter(Boolean).join(' ');
      main = `<span class="p-main-info">${cluster}</span><span class="p-cell-edge">${name}</span>`;
    } else {
      const info = [place, name, kda, ga].filter(Boolean).join(' ');
      main = `<span class="p-main-info">${info}</span>` + (rank ? `<span class="p-cell-edge">${rank}</span>` : '');
    }
    const chips = badgeHTML(p) + chipsHTML(p, oppChamp) + (extraChip || '');
    return `<div class="p-main">${main}</div>` + (chips ? `<div class="p-chips">${chips}</div>` : '');
  };
  // v4.22: draft-pill component strings collected as they're derived — countered-lane notes here
  // (as each lane is walked, reusing the exact bCounter/rCounter values already computed per-lane
  // rather than a second netCounter pass), the bot-synergy comparison further below — to feed the
  // merged DRAFT pill's terse inline component list.
  const draftComponents = [];
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
    if (bCounter > 0) draftComponents.push(`${b.champ} countered by ${r.champ} −${bCounter}`);
    if (rCounter > 0) draftComponents.push(`${r.champ} countered by ${b.champ} −${rCounter}`);
    // v4.14: "pre-duo" GA (risk+counter-adjusted, no duo bonus yet) is what the adaptive
    // jungle-duo bonus's deficit is measured against — computed here, before duoAdjOf, and passed
    // into it (mirrors lib/riot.mjs's laneAdj: bPreDuo/rPreDuo before duoLaneBonusFor).
    const bPreDuo = bRiskAdj != null ? bRiskAdj - bCounter : null;
    const rPreDuo = rRiskAdj != null ? rRiskAdj - rCounter : null;
    // v4.17: direct head-to-head rank gap between these two lane opponents (rankGapAdj, mirrors
    // lib/riot.mjs) — added ONCE, on blue's side only, so bAdj-rAdj (wherever it's implicitly
    // diffed below) carries the term exactly once, same as the engine's delta computation.
    let bAdj = bPreDuo != null ? bPreDuo + duoAdjOf(b, g.players, bPreDuo, rPreDuo) + rankGapAdj(b.rank, r?.rank) : null;
    let rAdj = rPreDuo != null ? rPreDuo + duoAdjOf(r, g.players, rPreDuo, bPreDuo) : null;
    // v4.20: bot-lane duo synergy — each side's own (capped) value added to both its BOTTOM and
    // UTILITY lane adjustments, mirroring lib/riot.mjs's laneAdj exactly.
    if (role === 'BOTTOM' || role === 'UTILITY') {
      if (bAdj != null && blueBotSynergy) bAdj += clampBotSynergy(blueBotSynergy.delta);
      if (rAdj != null && redBotSynergy) rAdj += clampBotSynergy(redBotSynergy.delta);
    }
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
    const riskNote = !fav ? laneEvenNote(b, r, g.players) : null;
    const favorTooltip = fav ? laneFactorTooltip(b, r, g.players) : null;
    const rowCls = (base, p, side) => {
      const c = base ? [base] : [];
      if (fav) { if (fav.side === side) c.push(`fav-${side}`); }
      else c.push(`even-${side}`);
      if (p && p.n.replace('#', '-').toLowerCase() === meName) c.push('you');
      return c.length ? ` class="${c.join(' ')}"` : '';
    };
    // v4.27: champion square icon replaces the plain-text champ name (matchup columns only — see
    // the ROLE_ICON/champ-icon header comments; details tables and the live card deliberately keep
    // text names for now, out of this scope). Full champion name (plus the champ-meta WR/pick/ban
    // line when lib/champstats.mjs has it) moves entirely into the image's title tooltip — nothing
    // shown here is lost, just relocated. A 404 (unmapped id, ddragon hiccup) falls back to the
    // exact same plain-text `.champ` span this used to always render, via the delegated error
    // listener above — never a broken-image icon.
    const champCell = (p, side) => {
      if (!p) return '<span class="dim">—</span>';
      const meta = champMetaTitle(p.champ);
      const title = meta || p.champ;
      const cls = 'champ-icon team-' + side + (meta ? ' champ-meta' : '');
      const iconUrl = `https://ddragon.leagueoflegends.com/cdn/${CHAMP_STATS_PATCH}/img/champion/${encodeURIComponent(p.champ)}.png`;
      return `<img class="${cls}" src="${iconUrl}" alt="${esc(p.champ)}" title="${esc(title)}">`;
    };
    const isBotRow = role === 'BOTTOM' || role === 'UTILITY';
    const bSynergyChip = isBotRow ? botSynergyChipHTML(blueBotSynergy) : '';
    const rSynergyChip = isBotRow ? botSynergyChipHTML(redBotSynergy) : '';
    // v4.27: role icon (fixed TOP/JUNGLE/MID/ADC/SUPPORT order — ROLES/ROLE_ICON above) sits above
    // the lane's Favored verdict, in the same center column.
    const roleIcon = ROLE_ICON[role];
    const midCell = `<img class="role-icon" src="${roleIcon.url}" alt="${roleIcon.label}" title="${roleIcon.label}">${laneVerdict(bAdj, rAdj, riskNote, favorTooltip, skipEvenSide)}`;
    return `<tr><td${rowCls('champ-c', b, 'blue')}>${champCell(b, 'blue')}</td><td${rowCls('', b, 'blue')}>${cellName(b, r?.champ, bSynergyChip, 'blue')}</td><td class="mid-v">${midCell}</td><td${rowCls('rgt', r, 'red')}>${cellName(r, b?.champ, rSynergyChip, 'red')}</td><td${rowCls('champ-c rgt', r, 'red')}>${champCell(r, 'red')}</td></tr>`;
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
  // v4.22: side-by-side bot-synergy comparison folds into the merged DRAFT pill's inline
  // component list below (was its own standalone line — see draftPillHTML's doc comment) — only
  // added when BOTH teams have data, since a one-sided "+2.4% vs no data" reads as a false
  // equivalence.
  if (blueBotSynergy && redBotSynergy) {
    const fmt = v => `${v >= 0 ? '+' : ''}${fmt1(v)}%`;
    draftComponents.push(`bot synergy ${fmt(blueBotSynergy.delta)} vs ${fmt(redBotSynergy.delta)}`);
  }
  return `<table class="matchup">
    <tr><th class="champ-c"></th><th><span class="tm-blue">BLUE</span>${g.userTeam === 'blue' ? ' <span class="gold">YOU</span>' : ''}</th><th class="mid-v">Favored</th><th class="rgt"><span class="tm-red">RED</span>${g.userTeam === 'red' ? ' <span class="gold">YOU</span>' : ''}</th><th class="champ-c"></th></tr>
    ${rows}
    <tr class="teamrow"><td colspan="2"><b><span class="tm-blue">TEAM</span> · ${blueWon ? 'win' : 'loss'} · ${teamGaText(gB, g.duoBonus?.blue, g.autofillCounts?.blue)}</b></td><td class="mid-v"><span class="badge ${verdictCls(g.matchmaking, g.direction)}" title="${esc(verdictTitle(g.matchmaking, g.direction, g.verdictTooltip))}">${verdictLabel(g.matchmaking, g.direction)}</span>${winProbHTML(g.winProb)}${draftPillHTML(g.draft, draftComponents)}</td><td colspan="2" class="rgt"><b><span class="tm-red">TEAM</span> · ${blueWon ? 'loss' : 'win'} · ${teamGaText(gR, g.duoBonus?.red, g.autofillCounts?.red)}</b></td></tr>
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
        // v4.18: full unabbreviated form ("Emerald I · 50 LP · 51%") — rankDetailLabel above,
        // shared with (built on the same parseRank as) the matchup rows' compact tag. Season
        // winrate shows whenever it exists (wr is null only when seasonGames is 0) — no longer
        // gated behind a 20-game sample floor, matching the matchup-row tag's "missing wr -> rank
        // only" rule instead of silently hiding a real (if small-sample) number.
        const rankCell = esc(rankDetailLabel(p.rank, p.wr));
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
