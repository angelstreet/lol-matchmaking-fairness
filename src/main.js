import './style.css';

// Same-origin API in production (Vercel functions); Vite proxies /api in dev.
const API = import.meta.env.VITE_API_URL || '';

document.querySelector('#app').innerHTML = `
  <h1>LoL <span>Matchmaking Fairness</span> <span id="clerkBtn"></span></h1>
  <div class="sub">Was your game winnable? Ranked Solo/Duo only · pre-game form for all 10 players · proven duo detection · GA scores · official Riot API</div>
  <form id="f" autocomplete="off">
    <div class="combo">
      <input id="riotId" name="riot-search" placeholder="Game name #TAG — e.g. xDevilStreet#EUW" required autocomplete="off">
      <button type="button" id="bmStar" title="Bookmark this profile">☆</button>
      <div id="bmDrop"></div>
    </div>
    <select id="games"><option>3</option><option selected>5</option><option>10</option></select>
    <select id="region"><option selected>euw</option><option>eune</option><option>na</option><option>kr</option></select>
    <button id="go">Find my games</button>
    <button type="button" id="liveBtn" class="live">🔴 Live game</button>
    <div class="keyrow">
      <input id="apiKey" name="riot-api-key" placeholder="Your Riot API key (optional)" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" data-bwignore>
      <div class="note">
        <a href="#" id="howKey">How to get your own free key (2 min) ▾</a>
        <div id="keyHelp" style="display:none">
          1. Go to <a href="https://developer.riotgames.com" target="_blank" rel="noreferrer">developer.riotgames.com</a> and sign in with your Riot account.<br>
          2. Copy the <b>Development API Key</b> on the dashboard and paste it here.<br>
          3. It expires every 24h (Riot's rule) — just grab a new one. The key stays in your browser and is only used for your own requests.
        </div>
        <div>No key? <b>3 free analyses/day</b> (may queue). Analyzed games are always free & instant.</div>
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

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Riot IDs are typed inconsistently ("Name #TAG" vs "Name#TAG") — normalize whitespace around
// the '#' everywhere before it's used as a cache/history key, so both forms resolve the same entry.
const normRiotId = s => String(s || '').trim().replace(/\s*#\s*/, '#');
const hdrs = () => { const k = $('#apiKey').value.trim(); return k ? { 'x-api-key': k } : {}; };
// Verdict is binary (FAIR / NOT FAIR — echoing the app name). Legacy cached entries may still
// carry the old 'OK' / 'NOT OK' / 'BORDERLINE' values — map those to the same two states.
const isFairVerdict = v => v === 'OK' || v === 'FAIR';
const verdictCls = v => isFairVerdict(v) ? 'b-ok' : 'b-bad';
const verdictLabel = v => isFairVerdict(v) ? 'FAIR' : 'NOT FAIR';
let CTX = { riotId: '', region: 'euw' };

// ---- bookmarks: localStorage always; synced to the Clerk account when signed in ----
let clerk = null;
const getBM = () => { try { return JSON.parse(localStorage.getItem('bookmarks') || '[]'); } catch { return []; } };
const isBM = id => getBM().some(b => b.riotId.toLowerCase() === id.toLowerCase());
const setBM = l => { localStorage.setItem('bookmarks', JSON.stringify(l)); renderBM(); };
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
  setBM(on ? getBM().filter(b => b.riotId.toLowerCase() !== riotId.toLowerCase()) : [...getBM(), { riotId, region }]);
  const synced = await serverBM(on ? 'remove' : 'add', riotId, region);
  if (synced) setBM(synced);
});
$('#bmDrop').addEventListener('click', e => {
  const item = e.target.closest('.bmItem'); if (!item) return;
  $('#riotId').value = item.dataset.riotid;
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
        for (const b of getBM()) if (!merged.some(m => m.riotId.toLowerCase() === b.riotId.toLowerCase())) { merged.push(b); await serverBM('add', b.riotId, b.region); }
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
  CTX = { riotId: normRiotId($('#riotId').value), region: $('#region').value };
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  localStorage.setItem('riotId', CTX.riotId);
  const goLabel = $('#go').textContent;
  beginBusy();
  $('#go').innerHTML = '<span class="spinner"></span>';
  $('#status').textContent = '';
  $('#list').innerHTML = '';
  try {
    const r = await fetch(`${API}/api/matches?riotId=${encodeURIComponent(CTX.riotId)}&games=${$('#games').value}&region=${CTX.region}`, { headers: hdrs() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    renderRows(data.games, $('#list'), 'm');
    $('#status').textContent = data.games.length ? 'Pick a game to analyze — ✓ games are already analyzed (free & instant).' : 'No ranked solo games found.';
    loadHistory(0);
  } catch (err) { $('#status').innerHTML = '❌ ' + esc(err.message); }
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
  try {
    const r = await fetch(`${API}/api/live?riotId=${encodeURIComponent(riotId)}&region=${region}`, { headers: hdrs() });
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
      renderLive(data.entry);
      $('#status').textContent = '';
    }
  } catch (err) {
    $('#status').innerHTML = '❌ ' + esc(err.message);
  }
}

function renderLive(g) {
  document.getElementById('liveCard')?.remove();
  const mins = Math.max(0, Math.round((Date.now() - new Date(g.when).getTime()) / 60000));
  const card = document.createElement('div');
  card.className = 'gcard open';
  card.id = 'liveCard';
  card.innerHTML = `
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
    renderRows(d.games, $('#hist'), 'h' + offset + '_');
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

function renderRows(games, container, prefix) {
  container.innerHTML = games.map((g, i) => {
    if (g.remake) return `<div class="row dim">Remake — skipped</div>`;
    const key = prefix + i;
    const when = g.when ? new Date(g.when).toLocaleString() : '';
    const badge = g.cached && g.matchmaking ? `<span class="badge ${verdictCls(g.matchmaking)}" id="b${key}">${verdictLabel(g.matchmaking)}</span>` : `<span id="b${key}"></span>`;
    const oneLiner = g.cached ? esc(g.oneLiner || '') : '';
    const isLive = g.live || g.result === 'Live';
    const resultEl = isLive ? '<span class="badge b-live">LIVE</span>' : `<span class="res-${(g.result || '?')[0]}">${esc(g.result)}</span>`;
    return `<div class="gcard" id="g${key}">
      <div class="row">
        ${resultEl}
        <span>${esc(g.champ)} ${esc(g.kda)}</span>
        <span class="dim">${esc(g.duration)} · ${when}</span>
        ${badge}
        <span class="one-h" id="o${key}" title="${oneLiner}">${oneLiner}</span>
        <button class="mini" data-mid="${esc(g.matchId)}" data-key="${key}">${g.cached ? '✓ View' : 'Analyze'}</button>
      </div>
      <div class="details" id="d${key}"></div>
    </div>`;
  }).join('');
  container.querySelectorAll('.mini').forEach(b => b.addEventListener('click', () => analyze(b.dataset.mid, b, b.dataset.key)));
}

async function analyze(matchId, btn, i, attempt = 0) {
  const card = document.getElementById('g' + i);
  if (btn.dataset.loaded) { card.classList.toggle('open'); btn.textContent = card.classList.contains('open') ? '▴ Hide' : '✓ View'; return; }
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  beginBusy();
  try {
    const r = await fetch(`${API}/api/analyze?riotId=${encodeURIComponent(CTX.riotId)}&matchId=${encodeURIComponent(matchId)}&region=${CTX.region}`, { headers: hdrs() });
    const data = await r.json();
    if (r.status === 409 && attempt < 15) { // shared analyzer busy — auto retry, shown on the button
      btn.innerHTML = `<span class="spinner"></span> #${attempt + 1}`;
      await new Promise(res => setTimeout(res, 20000));
      return await analyze(matchId, btn, i, attempt + 1);
    }
    if (!r.ok) throw new Error(data.error || r.status);
    const g = data.entry;
    document.getElementById('d' + i).innerHTML = detailsHTML(g, i);
    const badgeEl = document.getElementById('b' + i);
    if (badgeEl) { badgeEl.className = 'badge ' + verdictCls(g.matchmaking); badgeEl.textContent = verdictLabel(g.matchmaking); }
    const oneEl = document.getElementById('o' + i);
    if (oneEl) { oneEl.textContent = g.oneLiner || ''; oneEl.title = g.oneLiner || ''; }
    btn.dataset.loaded = '1'; btn.textContent = '▴ Hide'; btn.disabled = false;
    card.classList.add('open');
    $('#status').textContent = '';
  } catch (err) {
    $('#status').innerHTML = '❌ ' + esc(err.message);
    btn.textContent = 'Analyze'; btn.disabled = false;
  } finally {
    endBusy();
  }
}

const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const ord = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
const badgeHTML = p => p?.badge ? `<span class="badge-${p.badge.toLowerCase()}" title="${p.badge === 'MVP' ? 'Best performance of the winning team' : 'Best performance of the losing team'}">${p.badge}</span>` : '';
const placeHTML = p => p?.place ? `<span class="dim" title="In-game performance rank out of all 10 players (KDA, kill participation, damage share, CS, vision)">${ord(p.place)}</span>` : '';

// Maps each player name to which duo pair they belong to (0-based index into g.duos, in the
// order the backend found them), so a game with multiple duos can label them 🔗 D1 / 🔗 D2
// instead of an ambiguous plain "duo" chip on every pair.
function duoPairIndex(duos) {
  const m = {};
  (duos || []).forEach(([a, b], idx) => { if (!(a in m)) m[a] = idx; if (!(b in m)) m[b] = idx; });
  return m;
}

// Shared compact chip group for a player's flags/duo/streak/cspm — used identically in the
// summary matchup table and the per-team details tables so both views render the same way.
// duoCtx = { count, idx } — how many duo pairs exist in this game, and which one this player
// is in — computed once per game by the caller via duoPairIndex().
function chipsHTML(p, duoCtx) {
  if (!p) return '';
  const c = [];
  if (p.flags?.includes('autofill')) c.push(['⚠️ autofill', 'Playing outside their usual role']);
  if (p.flags?.includes('first-time')) c.push(['first-time', 'No recent games and low mastery on this champion']);
  if (p.flags?.includes('otp')) c.push(['OTP', 'One-trick: played this champion in 4+ of their last 5 games or 150k+ mastery']);
  if (p.duo) {
    const label = duoCtx && duoCtx.count > 1 && duoCtx.idx != null ? `🔗 D${duoCtx.idx + 1}` : '🔗 duo';
    const tip = p.duoWith ? `Duo with ${p.duoWith} — proven by shared pre-game matches` : 'Queued with a teammate — proven by shared pre-game matches';
    c.push([label, tip]);
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
  return c.map(([l, t, cls]) => `<span class="chip${cls ? ' ' + cls : ''}" title="${esc(t)}">${l}</span>`).join('');
}

function laneVerdict(a, b) {
  if (a == null || b == null) return '<span class="dim">·</span>';
  const d = a - b, ad = Math.abs(d);
  if (ad <= 8) return `<span class="lv-even" title="Even matchup — pre-game GA gap of only ${ad} points">EVEN</span>`;
  const heavy = ad > 18;
  const strength = heavy ? 'HEAVILY favored' : 'favored';
  const side = d > 0 ? 'blue' : 'red', sideLabel = side === 'blue' ? 'Blue' : 'Red';
  return `<span class="lv-${side}" title="${sideLabel} side ${strength}: +${ad} GA advantage before the game started">${side.toUpperCase()} +${ad}</span>`;
}

// Which side (if any) a lane is favored toward, for tinting that side's cells and for the
// severity chip in that side's name group — kept separate from laneVerdict's HTML/text so the
// middle "Favored" column only ever shows the centered EVEN/BLUE +n/RED +n text.
function laneFavor(a, b) {
  if (a == null || b == null) return null;
  const d = a - b, ad = Math.abs(d);
  if (ad <= 8) return null;
  return { side: d > 0 ? 'blue' : 'red', icon: ad > 18 ? '🔥' : '⚠️' };
}

function matchupHTML(g) {
  const meName = CTX.riotId.replace('#', '-').toLowerCase();
  const by = (t, role) => (g.players || []).find(p => p.team === t && p.pos === role);
  const duoCtxBase = { count: (g.duos || []).length, idxMap: duoPairIndex(g.duos) };
  const cellName = (p, side, fav) => {
    if (!p) return '<span class="dim">—</span>';
    const badge = badgeHTML(p);
    const pname = `<span class="pname">${esc(p.n)} <b>GA ${p.ga ?? '–'}</b></span>`;
    const chips = chipsHTML(p, { count: duoCtxBase.count, idx: duoCtxBase.idxMap[p.n] });
    // The lane-favor icon rides along with the badge/chips group, same side rule as the rest —
    // only the favored side gets it, and it's a chip, not text next to the champion.
    const favChip = fav && fav.side === side
      ? `<span class="chip" title="${side === 'blue' ? 'Blue' : 'Red'} side ${fav.icon === '🔥' ? 'HEAVILY favored (>18 GA gap)' : 'favored (9–18 GA gap)'} in this lane — based on pre-game data only">${fav.icon}</span>`
      : '';
    // Badges and chips sit toward the table's center on each side, not before the outer name,
    // so the outer name edges (row start on blue, row end on red) stay aligned down the column.
    const items = side === 'red' ? [chips, favChip, badge, pname] : [pname, badge, favChip, chips];
    return `<span class="pcell">${items.filter(Boolean).join('')}</span>`;
  };
  const rows = ROLES.map(role => {
    const b = by('blue', role), r = by('red', role);
    if (!b && !r) return '';
    const fav = laneFavor(b?.ga, r?.ga);
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
    return `<tr><td${rowCls('champ-c', b, 'blue')}>${champCell(b)}</td><td${rowCls('', b, 'blue')}>${cellName(b, 'blue', fav)}</td><td class="mid-v">${laneVerdict(b?.ga, r?.ga)}</td><td${rowCls('rgt', r, 'red')}>${cellName(r, 'red', fav)}</td><td${rowCls('champ-c rgt', r, 'red')}>${champCell(r)}</td></tr>`;
  }).join('');
  const gB = g.teamGA?.blue, gR = g.teamGA?.red;
  const blueWon = (g.result === 'Victory') === (g.userTeam === 'blue');
  const duoLines = (g.duos || []).map(d => {
    const sideEl = d[3] === 'ally' ? `<span class="gold">${esc(d[3])}</span>` : `<span class="duo-enemy">${esc(d[3])}</span>`;
    return `<div class="duo">🔗 DUO (${sideEl}): ${esc(d[0])} + ${esc(d[1])} — ${esc(d[2])}</div>`;
  }).join('');
  return `<table class="matchup">
    <tr><th class="champ-c"></th><th><span class="tm-blue">BLUE</span>${g.userTeam === 'blue' ? ' <span class="gold">YOU</span>' : ''}</th><th class="mid-v">Favored</th><th class="rgt"><span class="tm-red">RED</span>${g.userTeam === 'red' ? ' <span class="gold">YOU</span>' : ''}</th><th class="champ-c"></th></tr>
    ${rows}
    <tr class="teamrow"><td colspan="2"><b><span class="tm-blue">TEAM</span> · ${blueWon ? 'win' : 'loss'} · avg GA ${gB ?? '–'}</b></td><td class="mid-v">${laneVerdict(gB, gR)} <span class="badge ${verdictCls(g.matchmaking)}">${verdictLabel(g.matchmaking)}</span></td><td colspan="2" class="rgt"><b><span class="tm-red">TEAM</span> · ${blueWon ? 'loss' : 'win'} · avg GA ${gR ?? '–'}</b></td></tr>
  </table>${duoLines}`;
}

function detailsHTML(g, key = 'x') {
  const meName = CTX.riotId.replace('#', '-').toLowerCase();
  const duoCtxBase = { count: (g.duos || []).length, idxMap: duoPairIndex(g.duos) };
  const teams = ['blue', 'red'].map(t => {
    const rows = (g.players || []).filter(p => p.team === t);
    if (!rows.length) return '';
    const won = (g.result === 'Victory') === (g.userTeam === t);
    return '<h4><span class="tm-' + t + '">' + t.toUpperCase() + '</span>' + (g.userTeam === t ? ' <span class="gold">YOU</span>' : '') + ' · ' + (won ? 'win' : 'loss') +
      (g.teamGA && g.teamGA[t] ? ' · avg GA ' + g.teamGA[t] : '') + '</h4>' +
      '<table><tr><th>Player</th><th>Rank</th><th>Pos</th><th>Champ</th><th>KDA</th><th>Dmg</th><th>CS</th><th>Perf</th><th>GA</th><th title="Wins-losses in their last 5 ranked games before this one">Form (last 5 before game)</th></tr>' +
      rows.map(p => {
        const isMe = p.n.replace('#', '-').toLowerCase() === meName;
        const gaCls = p.ga == null ? '' : p.ga >= 70 ? 'ga-hi' : p.ga <= 45 ? 'ga-lo' : '';
        const chips = chipsHTML(p, { count: duoCtxBase.count, idx: duoCtxBase.idxMap[p.n] });
        return '<tr class="t-' + t + (isMe ? ' you' : '') + '"><td>' + esc(p.n) + '</td><td>' + esc(p.rank) + '</td><td>' + esc(p.pos) +
          '</td><td>' + esc(p.champ) + '</td><td>' + esc(p.kda) + '</td><td>' + (p.dmg || 0).toLocaleString() + '</td><td>' + p.cs +
          '</td><td>' + badgeHTML(p) + (p.badge ? ' ' : '') + placeHTML(p) + '</td><td class="' + gaCls + '">' + (p.ga ?? '–') + '</td><td>' + esc(p.form || '–') +
          (chips ? ' <span class="pcell">' + chips + '</span>' : '') + '</td></tr>';
      }).join('') + '</table>';
  }).join('');
  const mId = 'sm' + key, dId = 'sd' + key;
  // Matchup summary is the primary view (expanded, and now includes the duo lines directly
  // below the table — no need to open Details just to see who's queued together); full team
  // tables are on-demand (collapsed). Sections are toggled by the delegated .sec-h handler below.
  return `<div class="sec-h first" data-target="${mId}">▾ Matchup</div>` +
    `<div class="sec-b" id="${mId}">${matchupHTML(g)}</div>` +
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
