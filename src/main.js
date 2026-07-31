import './style.css';
import { counterPenalty } from '../lib/counters.mjs';

// Same-origin API in production (Vercel functions); Vite proxies /api in dev.
const API = import.meta.env.VITE_API_URL || '';

document.querySelector('#app').innerHTML = `
  <h1>LoL <span>Matchmaking Fairness</span> <span id="clerkBtn"></span></h1>
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
        <input id="apiKey" name="riot-api-key" placeholder="Your Riot API key (optional)" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore>
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
  <footer class="foot"><a href="https://github.com/angelstreet/lol-matchmaking-fairness" target="_blank" rel="noreferrer">⭐ Open source — star it on GitHub</a><span class="dim"> · MIT · not endorsed by Riot Games</span></footer>`;

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
$('#apiKey').addEventListener('input', () => {
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  flashKeyField();
});
$('#clearKey').addEventListener('click', () => {
  $('#apiKey').value = '';
  localStorage.removeItem('rgapi');
  $('#apiKey').focus();
});

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Game-row date/duration is squeezed into a fixed column (see .col-date), so it needs to be as
// short as possible: duration drops the seconds ("38m 24s" -> "38m", "12m (in progress)"
// unaffected since it has no seconds token to strip), and the date drops the year and seconds
// ("29/07 18:06" instead of a full locale string) — full precision isn't needed for a list of
// recent games, and the row already carries a full title tooltip on the one-liner if more detail
// is ever wanted elsewhere.
const shortDuration = d => {
  if (!d) return '';
  const m = /^(\d+)m/.exec(d);
  if (!m) return d;
  const rest = d.slice(m[0].length).trim().replace(/^\d+s\s*/, '');
  return rest ? `${m[1]}m ${rest}` : `${m[1]}m`;
};
const shortDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const two = n => String(n).padStart(2, '0');
  return `${two(d.getDate())}/${two(d.getMonth() + 1)} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
// Riot IDs are typed inconsistently ("Name #TAG" vs "Name#TAG") — normalize whitespace around
// the '#' everywhere before it's used as a cache/history key, so both forms resolve the same entry.
const normRiotId = s => String(s || '').trim().replace(/\s*#\s*/, '#');
const hdrs = () => { const k = $('#apiKey').value.trim(); return k ? { 'x-api-key': k } : {}; };
// A request that SENT the user's stored key can fail because that key expired/was revoked
// (lib/riot.mjs's friendly 401/403 message contains 'key invalid or expired') — when that
// happens, auto-clear the dead key instead of leaving the user stuck retrying with it. Returns
// true if it handled the error (caller should skip its normal ❌ error display), false otherwise.
function handleKeyError(err, sentKey) {
  if (!sentKey || !String(err?.message || '').includes('key invalid or expired')) return false;
  $('#apiKey').value = '';
  localStorage.removeItem('rgapi');
  $('#status').textContent = 'Your saved Riot API key was expired and has been removed — paste a fresh one from developer.riotgames.com, or continue keyless (3/day).';
  return true;
}
// Verdict is binary (FAIR / NOT FAIR — echoing the app name). Legacy cached entries may still
// carry the old 'OK' / 'NOT OK' / 'BORDERLINE' values — map those to the same two states.
const isFairVerdict = v => v === 'OK' || v === 'FAIR';
const verdictCls = v => isFairVerdict(v) ? 'b-ok' : 'b-bad';
const verdictLabel = v => isFairVerdict(v) ? 'FAIR' : 'NOT FAIR';
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
  cached.games[idx] = { ...cached.games[idx], cached: true, matchmaking: entry.matchmaking, oneLiner: entry.oneLiner };
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
  fetch(`${API}/api/matches?riotId=${encodeURIComponent(cached.riotId)}&games=${$('#games').value}&region=${cached.region}`, { headers: hdrs() })
    .then(r => (r.ok ? r.json() : Promise.reject()))
    .then(data => {
      renderRows(data.games, $('#list'), 'm', cached.riotId);
      localStorage.setItem('lastSearch', JSON.stringify({ riotId: cached.riotId, region: cached.region, games: data.games, ts: Date.now() }));
    })
    .catch(() => {}); // silent — keep the cached view as-is
})();

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
    const h = hdrs(); sentKey = !!h['x-api-key'];
    const r = await fetch(`${API}/api/matches?riotId=${encodeURIComponent(attempt.riotId)}&games=${$('#games').value}&region=${attempt.region}`, { headers: h });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    CTX = attempt;
    localStorage.setItem('riotId', CTX.riotId);
    $('#list').innerHTML = ''; // only clear the previous list once the new one is ready to replace it
    renderRows(data.games, $('#list'), 'm', CTX.riotId);
    $('#status').textContent = data.games.length ? 'Pick a game to analyze — ✓ games are already analyzed (free & instant).' : 'No ranked solo games found.';
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
    const h = hdrs(); sentKey = !!h['x-api-key'];
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
    }
  } catch (err) {
    if (!handleKeyError(err, sentKey)) $('#status').innerHTML = '❌ ' + esc(err.message);
  }
}

function renderLive(g) {
  document.getElementById('liveCard')?.remove();
  const mins = Math.max(0, Math.round((Date.now() - new Date(g.when).getTime()) / 60000));
  const card = document.createElement('div');
  card.className = 'gcard open';
  card.id = 'liveCard';
  const reco = g.recommendation;
  const [recoHead, recoDetail] = reco ? reco.text.split(' — ') : [];
  const recoHTML = reco
    ? `<div class="reco"${reco.delta <= 0 ? ' style="color:var(--mid)"' : ''}>🎯 ${esc(recoHead)}${recoDetail ? ` <span class="dim">— ${esc(recoDetail)}</span>` : ''}</div>`
    : '';
  card.innerHTML = `
    ${recoHTML}
    <div class="row">
      <span class="badge b-live">LIVE</span>
      <span>LIVE — ${esc(g.user?.champ || '')} · started ${mins} min ago</span>
      <span class="one-h" title="${esc(g.oneLiner || '')}">${esc(g.oneLiner || '')}</span>
    </div>
    <div class="details">
      ${detailsHTML(g, 'live')}
    </div>`;
  $('#list').insertBefore(card, $('#list').firstChild);
}

async function loadHistory(offset) {
  try {
    const r = await fetch(`${API}/api/history?riotId=${encodeURIComponent(CTX.riotId)}&offset=${offset}&limit=10`);
    const d = await r.json();
    if (!r.ok || !d.total) { $('#histWrap').style.display = 'none'; return; }
    $('#histWrap').style.display = 'block';
    renderRows(d.games, $('#hist'), 'h' + offset + '_', CTX.riotId);
    if (d.total <= 10) { $('#histNav').innerHTML = ''; return; }
    const from = offset + 1, to = offset + d.games.length;
    $('#histNav').innerHTML =
      (offset > 0 ? `<button class="mini" id="hNewer">◀ 10 newer</button>` : '') +
      `<span>${from}–${to} of ${d.total} analyzed games</span>` +
      (to < d.total ? `<button class="mini" id="hOlder">10 older ▶</button>` : '');
    const newer = $('#hNewer'), older = $('#hOlder');
    if (newer) newer.addEventListener('click', () => loadHistory(Math.max(0, offset - 10)));
    if (older) older.addEventListener('click', () => loadHistory(offset + 10));
  } catch { $('#histWrap').style.display = 'none'; }
}

function renderRows(games, container, prefix, rid) {
  container.innerHTML = games.map((g, i) => {
    if (g.remake) return ''; // server no longer sends remakes; guard is only for legacy lastSearch cache
    const key = prefix + i;
    const badge = g.cached && g.matchmaking ? `<span class="badge ${verdictCls(g.matchmaking)}" id="b${key}">${verdictLabel(g.matchmaking)}</span>` : `<span id="b${key}"></span>`;
    const oneLiner = g.cached ? esc(g.oneLiner || '') : '';
    const isLive = g.live || g.result === 'Live';
    const resultEl = isLive ? '<span class="badge b-live">LIVE</span>' : `<span class="res-${(g.result || '?')[0]}">${esc(g.result)}</span>`;
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
    // -analyzed game can be re-judged with whatever the scoring engine looks like today. It
    // carries its own data-force="1" (independent of data-wasLive), and shares the row's key so
    // analyze() can look up the View button (id v${key}) and keep the two in sync.
    const reanalyzeBtn = g.cached
      ? `<button class="mini icon-btn" data-mid="${esc(g.matchId)}" data-key="${key}" data-rid="${esc(rid)}" data-force="1" title="Re-analyze with the latest scoring (needs a key or a free slot)">↻</button>`
      : '';
    return `<div class="gcard" id="g${key}">
      <div class="row">
        <span class="col-res">${resultEl}</span>
        <span class="col-champ" title="${esc(g.champ)}">${esc(g.champ)}</span>
        <span class="col-kda">${esc(g.kda)}</span>
        <span class="col-badge">${badge}</span>
        <span class="col-date dim">${esc(shortDuration(g.duration))} · ${esc(shortDate(g.when))}</span>
        <span class="one-h" id="o${key}" title="${oneLiner}">${oneLiner}</span>
        <button class="mini" id="v${key}" data-mid="${esc(g.matchId)}" data-key="${key}" data-rid="${esc(rid)}"${g.wasLive ? ' data-force="1"' : ''}>${g.cached ? '✓ View' : 'Analyze'}</button>
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
    const h = hdrs(); sentKey = !!h['x-api-key'];
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
    if (badgeEl) { badgeEl.className = 'badge ' + verdictCls(g.matchmaking); badgeEl.textContent = verdictLabel(g.matchmaking); }
    const oneEl = document.getElementById('o' + i);
    if (oneEl) { oneEl.textContent = g.oneLiner || ''; oneEl.title = g.oneLiner || ''; }
    if (viewBtn) { viewBtn.dataset.loaded = '1'; viewBtn.textContent = '▴ Hide'; viewBtn.disabled = false; }
    card.classList.add('open');
    $('#status').textContent = '';
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
  if (p.flags?.includes('autofill')) c.push(['autofill', 'Playing outside their usual role']);
  if (p.flags?.includes('first-time')) c.push(['first-time', 'No recent games and low mastery on this champion']);
  if (p.flags?.includes('otp')) c.push(['OTP', 'One-trick: played this champion in 4+ of their last 5 games or 150k+ mastery']);
  if (p.flags?.includes('otp-denied')) c.push(['OTP denied', `One-trick on ${p.deniedChamp} but not playing it this game`, 'flag-otp-denied']);
  if (oppChamp && counterPenalty(p.champ, oppChamp) > 0) c.push(['countered', `${p.champ} is countered by ${oppChamp}`, 'flag-countered']);
  // Session-history warning flags — computed from the player's prior games / league entry,
  // shown compactly; each is rare enough that a plain chip (no icon) reads fine.
  if (p.flags?.includes('tilt')) c.push(['tilt?', '3+ games in the last ~3h with at least 2 losses — possible session tilt', 'flag-tilt']);
  if (p.flags?.includes('rusty')) c.push(['rusty', "Hasn't played this queue in 14+ days — recent form may be less predictive", '']);
  if (p.flags?.includes('smurf')) c.push(['SMURF?', 'Low account level with a strong season winrate or recent KDA — likely outclasses their displayed rank', 'flag-smurf']);
  if (p.flags?.includes('afk-risk')) c.push(['AFK risk', 'A recent game ended in an early surrender for this player — possible AFK/DC pattern', 'flag-afk']);
  if (p.duo) {
    const tip = p.duoWith
      ? `Duo with ${p.duoWith} — ${p.duoRecord ? p.duoRecord + ' together in their last 5 shared games' : (p.duoShared != null ? p.duoShared + '/5 previous games together' : 'proven by shared pre-game matches')}`
      : 'Queued with a teammate — proven by shared pre-game matches';
    c.push(['DUO', tip]);
  }
  if (p.streak) {
    const n = parseInt(p.streak), w = p.streak.endsWith('W');
    if (n >= 3) c.push([w ? `🔥 ${n}W` : `❄️ ${n}L`, (w ? 'Win' : 'Loss') + ' streak entering this game']);
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

// Off-role (autofill) and unfamiliar-champion (first-time) picks are risk, not skill — mirrors
// riskOf in lib/riot.mjs so a lane with an autofilled/first-timing player never reads EVEN
// against a clean opponent just because the raw GAs happened to land close together.
const riskOf = p => (p?.flags?.includes('autofill') ? 5 : 0) + (p?.flags?.includes('first-time') ? 5 : 0);

// a and b are risk-adjusted GAs (see riskOf above) — callers no longer pass raw p.ga
// directly, so a lane where one side is autofilled/first-timing never reads EVEN just because
// the raw GAs happened to be close. riskNote, when given, is appended to the tooltip so the
// adjustment is explained rather than silently changing the number.
function laneVerdict(a, b, riskNote) {
  if (a == null || b == null) return '<span class="dim">·</span>';
  const d = a - b, ad = Math.abs(d);
  const note = riskNote ? ` (${riskNote})` : '';
  if (ad <= 8) return `<span class="lv-even" title="Even matchup — pre-game GA gap of only ${ad} points${note}">EVEN</span>`;
  const heavy = ad > 18;
  const strength = heavy ? 'HEAVILY favored' : 'favored';
  const side = d > 0 ? 'blue' : 'red', sideLabel = side === 'blue' ? 'Blue' : 'Red';
  return `<span class="lv-${side}" title="${sideLabel} side ${strength}: +${ad} GA advantage before the game started${note}">${side.toUpperCase()} +${ad}</span>`;
}

// Which side (if any) a lane is favored toward, for tinting that side's cells — kept separate
// from laneVerdict's HTML/text so the middle "Favored" column only ever shows the centered
// EVEN/BLUE +n/RED +n text. The favored/heavily-favored severity itself is no longer shown as
// a chip on the player — it's explained by the Favored-column value's own tooltip instead.
// Takes the same risk-adjusted values as laneVerdict so the tinting always agrees with the text.
function laneFavor(a, b) {
  if (a == null || b == null) return null;
  const d = a - b, ad = Math.abs(d);
  if (ad <= 8) return null;
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
    const name = `<span class="pname">${esc(p.n)}</span>`;
    const kda = p.kda ? `<span class="dim">${esc(p.kda)}</span>` : '';
    const ga = `<b>GA ${p.ga ?? '–'}</b>`;
    const main = [place, name, kda, ga].filter(Boolean).join(' ');
    const chips = badgeHTML(p) + chipsHTML(p, oppChamp);
    return `<div class="p-main">${main}</div>` + (chips ? `<div class="p-chips">${chips}</div>` : '');
  };
  // Verdict "category" (EVEN / BLUE-favored / RED-favored) for a pair of GA values, using the
  // same EVEN threshold as laneVerdict — used below to detect when risk-adjustment flips or
  // changes a lane's read compared to the raw (un-adjusted) GAs, so the tooltip can call it out.
  const verdictCat = (a, b) => {
    if (a == null || b == null) return null;
    const d = a - b;
    return Math.abs(d) <= 8 ? 'EVEN' : (d > 0 ? 'BLUE' : 'RED');
  };
  const rows = ROLES.map(role => {
    const b = by('blue', role), r = by('red', role);
    if (!b && !r) return '';
    const bRisk = riskOf(b), rRisk = riskOf(r);
    const bRiskAdj = b?.ga != null ? b.ga - bRisk : null;
    const rRiskAdj = r?.ga != null ? r.ga - rRisk : null;
    // Known lane counters (lib/counters.mjs, shared with the engine's fairness() lane rules) are
    // subtracted the same way as autofill/first-time risk — a countered lane never reads EVEN
    // just because the raw GAs happened to be close.
    const bCounter = (b && r) ? counterPenalty(b.champ, r.champ) : 0;
    const rCounter = (b && r) ? counterPenalty(r.champ, b.champ) : 0;
    const bAdj = bRiskAdj != null ? bRiskAdj - bCounter : null;
    const rAdj = rRiskAdj != null ? rRiskAdj - rCounter : null;
    // Note the adjustment in the tooltip only when it actually changed how the lane reads (raw
    // vs adjusted verdict category differ) — otherwise a flagged player with a lane that was
    // never close is left alone rather than adding noise to every row. Risk and counter notes
    // are checked (and worded) independently since they're different phenomena.
    const notes = [];
    if ((bRisk > 0 || rRisk > 0) && verdictCat(b?.ga, r?.ga) !== verdictCat(bRiskAdj, rRiskAdj)) {
      const who = [bRisk > 0 && 'blue', rRisk > 0 && 'red'].filter(Boolean).join(' & ');
      notes.push(`includes autofill/first-time risk on the ${who} player${who.includes('&') ? 's' : ''}`);
    }
    if ((bCounter > 0 || rCounter > 0) && verdictCat(bRiskAdj, rRiskAdj) !== verdictCat(bAdj, rAdj)) {
      if (bCounter > 0) notes.push(`${b.champ} is countered by ${r.champ}`);
      if (rCounter > 0) notes.push(`${r.champ} is countered by ${b.champ}`);
    }
    const riskNote = notes.length ? notes.join('; ') : null;
    const fav = laneFavor(bAdj, rAdj);
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
    return `<tr><td${rowCls('champ-c', b, 'blue')}>${champCell(b)}</td><td${rowCls('', b, 'blue')}>${cellName(b, r?.champ)}</td><td class="mid-v">${laneVerdict(bAdj, rAdj, riskNote)}</td><td${rowCls('rgt', r, 'red')}>${cellName(r, b?.champ)}</td><td${rowCls('champ-c rgt', r, 'red')}>${champCell(r)}</td></tr>`;
  }).join('');
  const gB = g.teamGA?.blue, gR = g.teamGA?.red;
  const blueWon = (g.result === 'Victory') === (g.userTeam === 'blue');
  // Legacy entries analyzed before duo synergy scoring don't have g.duoBonus — the (+N duo)
  // tag is simply omitted for them rather than showing a bogus +0.
  const teamGaText = (avgGa, bonus) => `avg GA ${avgGa ?? '–'}` + (bonus > 0 ? ` <span title="GA bonus for proven duo synergy">(+${bonus} duo)</span>` : '');
  return `<table class="matchup">
    <tr><th class="champ-c"></th><th><span class="tm-blue">BLUE</span>${g.userTeam === 'blue' ? ' <span class="gold">YOU</span>' : ''}</th><th class="mid-v">Favored</th><th class="rgt"><span class="tm-red">RED</span>${g.userTeam === 'red' ? ' <span class="gold">YOU</span>' : ''}</th><th class="champ-c"></th></tr>
    ${rows}
    <tr class="teamrow"><td colspan="2"><b><span class="tm-blue">TEAM</span> · ${blueWon ? 'win' : 'loss'} · ${teamGaText(gB, g.duoBonus?.blue)}</b></td><td class="mid-v"><span class="badge ${verdictCls(g.matchmaking)}">${verdictLabel(g.matchmaking)}</span></td><td colspan="2" class="rgt"><b><span class="tm-red">TEAM</span> · ${blueWon ? 'loss' : 'win'} · ${teamGaText(gR, g.duoBonus?.red)}</b></td></tr>
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
      (g.teamGA && g.teamGA[t] ? ' · avg GA ' + g.teamGA[t] : '') + '</h4>' +
      '<table class="details-table">' + detailsColgroup + '<tr><th>Player</th><th>Rank</th><th>Pos</th><th>Champ</th><th>KDA</th><th>Dmg</th><th>CS</th><th>GA</th><th title="Wins-losses in their last 5 ranked games before this one">Form (last 5 before game)</th></tr>' +
      rows.map(p => {
        const isMe = p.n.replace('#', '-').toLowerCase() === meName;
        const gaCls = p.ga == null ? '' : p.ga >= 70 ? 'ga-hi' : p.ga <= 45 ? 'ga-lo' : '';
        const badge = badgeHTML(p);
        const chips = chipsHTML(p);
        // MVP/ACE and the flag/duo/streak/cspm chips all live in the Player cell's chip group —
        // keeping the other columns plain text is what makes the fixed-width alignment hold up.
        const nameCell = `<span class="pcell"><span class="pname">${esc(p.n)}</span>${badge}${chips}</span>`;
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
