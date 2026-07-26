import './style.css';

// Same-origin API in production (Vercel functions); Vite proxies /api in dev.
const API = import.meta.env.VITE_API_URL || '';

document.querySelector('#app').innerHTML = `
  <h1>LoL <span>Matchmaking Fairness</span></h1>
  <div class="sub">Was your game winnable? Ranked Solo/Duo only · pre-game form for all 10 players · proven duo detection · GA scores · official Riot API</div>
  <form id="f">
    <input id="riotId" placeholder="Game name #TAG — e.g. xDevilStreet#EUW" required>
    <select id="games"><option>3</option><option selected>5</option><option>10</option></select>
    <select id="region"><option selected>euw</option><option>eune</option><option>na</option><option>kr</option></select>
    <button id="go">Find my games</button>
    <input id="apiKey" placeholder="Your Riot API key (optional)" type="password">
    <div class="note">
      No key? You get <b>3 free deep analyses per day</b> (shared analyzer, may queue). Already-analyzed games are always free and instant.
      <a href="#" id="howKey">How to get your own free key (2 min) ▾</a>
      <div id="keyHelp" style="display:none">
        1. Go to <a href="https://developer.riotgames.com" target="_blank" rel="noreferrer">developer.riotgames.com</a> and sign in with your Riot account.<br>
        2. Copy the <b>Development API Key</b> on the dashboard and paste it here.<br>
        3. It expires every 24h (Riot's rule) — just grab a new one. The key stays in your browser and is only used for your own requests.
      </div>
    </div>
  </form>
  <div id="status"></div>
  <div id="list"></div>
  <div id="out"></div>`;

const $ = s => document.querySelector(s);
$('#apiKey').value = localStorage.getItem('rgapi') || '';
$('#riotId').value = localStorage.getItem('riotId') || '';
$('#howKey').addEventListener('click', e => { e.preventDefault(); const k = $('#keyHelp'); k.style.display = k.style.display === 'none' ? 'block' : 'none'; });

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hdrs = () => { const k = $('#apiKey').value.trim(); return k ? { 'x-api-key': k } : {}; };
let CTX = { riotId: '', region: 'euw' };

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  CTX = { riotId: $('#riotId').value.trim(), region: $('#region').value };
  localStorage.setItem('rgapi', $('#apiKey').value.trim());
  localStorage.setItem('riotId', CTX.riotId);
  $('#go').disabled = true;
  $('#status').innerHTML = '<span class="spin">⏳</span> Fetching recent ranked games…';
  $('#list').innerHTML = ''; $('#out').innerHTML = '';
  try {
    const r = await fetch(`${API}/api/matches?riotId=${encodeURIComponent(CTX.riotId)}&games=${$('#games').value}&region=${CTX.region}`, { headers: hdrs() });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    renderList(data.games);
    $('#status').textContent = data.games.length ? 'Pick a game to analyze — ✓ games are already analyzed (free & instant).' : 'No ranked solo games found.';
  } catch (err) { $('#status').innerHTML = '❌ ' + esc(err.message); }
  $('#go').disabled = false;
});

function renderList(games) {
  $('#list').innerHTML = games.map((g, i) => {
    if (g.remake) return `<div class="row dim">Remake — skipped</div>`;
    const when = g.when ? new Date(g.when).toLocaleString() : '';
    const badge = g.cached && g.matchmaking ? `<span class="badge ${g.matchmaking === 'OK' ? 'b-ok' : g.matchmaking === 'BORDERLINE' ? 'b-mid' : 'b-bad'}">${g.matchmaking}</span>` : '';
    return `<div class="row">
      <span class="res-${(g.result || '?')[0]}">${esc(g.result)}</span>
      <span>${esc(g.champ)} ${esc(g.kda)}</span>
      <span class="dim">${esc(g.duration)} · ${when}</span>
      ${badge}
      <button class="mini" data-mid="${esc(g.matchId)}" data-i="${i}">${g.cached ? '✓ View' : 'Analyze'}</button>
    </div>`;
  }).join('');
  document.querySelectorAll('.mini').forEach(b => b.addEventListener('click', () => analyze(b.dataset.mid, b)));
}

async function analyze(matchId, btn, attempt = 0) {
  btn.disabled = true; btn.textContent = '…';
  $('#status').innerHTML = `<span class="spin">⏳</span> Analyzing ${esc(matchId)} — up to ~1 min for a new game…`;
  try {
    const r = await fetch(`${API}/api/analyze?riotId=${encodeURIComponent(CTX.riotId)}&matchId=${encodeURIComponent(matchId)}&region=${CTX.region}`, { headers: hdrs() });
    const data = await r.json();
    if (r.status === 409 && attempt < 15) { // shared analyzer busy — auto retry
      $('#status').innerHTML = `<span class="spin">⏳</span> Free analyzer busy — retrying (${attempt + 1})…`;
      await new Promise(res => setTimeout(res, 20000));
      return analyze(matchId, btn, attempt + 1);
    }
    if (!r.ok) throw new Error(data.error || r.status);
    renderCard(data.entry);
    btn.textContent = '✓ View'; btn.disabled = false;
    $('#status').textContent = data.cached ? 'Loaded from shared cache (instant).' : 'Analysis complete — cached for everyone from now on.';
  } catch (err) {
    $('#status').innerHTML = '❌ ' + esc(err.message);
    btn.textContent = 'Analyze'; btn.disabled = false;
  }
}

function renderCard(g) {
  const meName = CTX.riotId.replace('#', '-').toLowerCase();
  const cls = g.matchmaking === 'OK' ? 'b-ok' : g.matchmaking === 'BORDERLINE' ? 'b-mid' : 'b-bad';
  const when = g.when ? new Date(g.when).toLocaleString() : '';
  const teams = ['blue', 'red'].map(t => {
    const rows = (g.players || []).filter(p => p.team === t);
    if (!rows.length) return '';
    const won = (g.result === 'Victory') === (g.userTeam === t);
    return '<h4>' + t.toUpperCase() + (g.userTeam === t ? ' (your team)' : '') + (won ? ' — won' : '') +
      (g.teamGA && g.teamGA[t] ? ' · avg GA ' + g.teamGA[t] : '') + '</h4>' +
      '<table><tr><th>Player</th><th>Rank</th><th>Pos</th><th>Champ</th><th>KDA</th><th>Dmg</th><th>CS</th><th>GA</th><th>Form (pre-game)</th></tr>' +
      rows.map(p => {
        const isMe = p.n.replace('#', '-').toLowerCase() === meName;
        const gaCls = p.ga == null ? '' : p.ga >= 70 ? 'ga-hi' : p.ga <= 45 ? 'ga-lo' : '';
        return '<tr class="t-' + t + (isMe ? ' you' : '') + '"><td>' + esc(p.n) + '</td><td>' + esc(p.rank) + '</td><td>' + esc(p.pos) +
          '</td><td>' + esc(p.champ) + '</td><td>' + esc(p.kda) + '</td><td>' + (p.dmg || 0).toLocaleString() + '</td><td>' + p.cs +
          '</td><td class="' + gaCls + '">' + (p.ga ?? '–') + '</td><td>' + esc(p.form || '–') +
          (p.flags && p.flags.length ? ' <span class="flag">⚠ ' + esc(p.flags.join(', ')) + '</span>' : '') + '</td></tr>';
      }).join('') + '</table>';
  }).join('');
  const duos = (g.duos || []).map(d => '<div class="duo">🔗 DUO (' + esc(d[3]) + '): ' + esc(d[0]) + ' + ' + esc(d[1]) + ' — ' + esc(d[2]) + '</div>').join('');
  $('#out').innerHTML = '<div class="card open">' +
    '<div class="head">' +
    '<span class="badge ' + cls + '">' + g.matchmaking + '</span>' +
    '<span class="res-' + g.result[0] + '">' + g.result + '</span>' +
    '<span>' + esc(g.user?.champ) + ' ' + esc(g.user?.kda) + '</span>' +
    '<span class="dim">' + esc(g.duration) + ' · ' + when + '</span>' +
    '<span class="one">' + esc(g.oneLiner) + '</span></div>' +
    '<div class="details">' + teams + duos + '</div></div>';
  $('#out').scrollIntoView({ behavior: 'smooth' });
}
