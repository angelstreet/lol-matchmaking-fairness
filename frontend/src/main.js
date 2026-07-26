import './style.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3131';

document.querySelector('#app').innerHTML = `
  <h1>LoL <span>Matchmaking Fairness</span></h1>
  <div class="sub">Ranked Solo/Duo only · pre-game form for all 10 players · duo detection · GA scores · powered by the official Riot API</div>
  <form id="f">
    <input id="riotId" placeholder="Game name #TAG — e.g. xDevilStreet#EUW" required>
    <select id="games"><option>3</option><option selected>5</option><option>10</option></select>
    <select id="region"><option selected>euw</option><option>eune</option><option>na</option><option>kr</option></select>
    <button id="go">Analyze</button>
    <input id="apiKey" placeholder="RGAPI key (only if server has none)" type="password">
    <div class="note">Key stays in your browser (localStorage) and is sent only to the fairness API. Deep analysis takes ~1–2 min per uncached game (Riot rate limits); cached games are instant.</div>
  </form>
  <div id="status"></div>
  <div id="out"></div>`;

const $ = s => document.querySelector(s);
$('#apiKey').value = localStorage.getItem('rgapi') || '';
$('#riotId').value = localStorage.getItem('riotId') || '';

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const riotId = $('#riotId').value.trim(), games = $('#games').value, region = $('#region').value, key = $('#apiKey').value.trim();
  localStorage.setItem('rgapi', key); localStorage.setItem('riotId', riotId);
  $('#go').disabled = true;
  $('#status').innerHTML = '<span class="spin">⏳</span> Analyzing ' + games + ' games for <b>' + esc(riotId) + '</b>… cached games return instantly, new ones take a while.';
  $('#out').innerHTML = '';
  try {
    const r = await fetch(API + '/api/scout?riotId=' + encodeURIComponent(riotId) + '&games=' + games + '&region=' + region, { headers: key ? { 'x-api-key': key } : {} });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || r.status);
    render(data, riotId);
    $('#status').textContent = data.length ? '' : 'No ranked solo games found.';
  } catch (err) { $('#status').innerHTML = '❌ ' + esc(err.message); }
  $('#go').disabled = false;
});

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(gamesArr, riotId) {
  const meName = riotId.replace('#', '-').toLowerCase();
  $('#out').innerHTML = gamesArr.map((g, i) => {
    const cls = g.matchmaking === 'OK' ? 'b-ok' : g.matchmaking === 'BORDERLINE' ? 'b-mid' : 'b-bad';
    const when = g.when ? new Date(g.when).toLocaleString() : '';
    const u = g.user || {};
    const teams = ['blue', 'red'].map(t => {
      const rows = (g.players || []).filter(p => p.team === t);
      if (!rows.length) return '';
      const won = (g.result === 'Victory') === (g.userTeam === t);
      return '<h4 style="margin:8px 0 2px">' + t.toUpperCase() + (g.userTeam === t ? ' (your team)' : '') + (won ? ' — won' : '') +
        (g.teamGA && g.teamGA[t] ? ' · avg GA ' + g.teamGA[t] : '') + '</h4>' +
        '<table><tr><th>Player</th><th>Rank</th><th>Pos</th><th>Champ</th><th>KDA</th><th>Dmg</th><th>CS</th><th>GA</th><th>Form (pre-game)</th></tr>' +
        rows.map(p => {
          const isMe = p.n.replace('#', '-').toLowerCase() === meName;
          const gaCls = p.ga == null ? '' : p.ga >= 70 ? 'ga-hi' : p.ga <= 45 ? 'ga-lo' : '';
          return '<tr class="t-' + t + (isMe ? ' you' : '') + '"><td>' + esc(p.n) + '</td><td>' + esc(p.rank) + '</td><td>' + esc(p.pos || '') +
            '</td><td>' + esc(p.champ) + '</td><td>' + esc(p.kda) + '</td><td>' + (p.dmg || 0).toLocaleString() + '</td><td>' + p.cs +
            '</td><td class="' + gaCls + '">' + (p.ga ?? '–') + '</td><td>' + esc(p.form || '–') +
            (p.flags && p.flags.length ? ' <span class="flag">⚠ ' + esc(p.flags.join(', ')) + '</span>' : '') + '</td></tr>';
        }).join('') + '</table>';
    }).join('');
    const duos = (g.duos || []).map(d => '<div class="duo">🔗 DUO (' + esc(d[3] || '') + '): ' + esc(d[0]) + ' + ' + esc(d[1]) + ' — ' + esc(d[2]) + '</div>').join('');
    return '<div class="card" id="c' + i + '">' +
      '<div class="head" data-i="' + i + '">' +
      '<span class="badge ' + cls + '">' + g.matchmaking + '</span>' +
      '<span class="res-' + g.result[0] + '">' + g.result + '</span>' +
      '<span>' + esc(u.champ || '') + ' ' + esc(u.kda || '') + '</span>' +
      '<span style="color:var(--dim)">' + esc(g.duration || '') + ' · ' + when + '</span>' +
      '<span style="margin-left:auto;color:var(--dim)">▾ details</span>' +
      '<span class="one">' + esc(g.oneLiner || '') + '</span></div>' +
      '<div class="details">' + teams + duos + '</div></div>';
  }).join('');
  document.querySelectorAll('.head').forEach(h =>
    h.addEventListener('click', () => document.getElementById('c' + h.dataset.i).classList.toggle('open')));
}
