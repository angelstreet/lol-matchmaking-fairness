// lib/riot.mjs — Riot API client + fairness analysis engine (serverless-safe, no fs).
// Ranked Solo/Duo only (queue=420).

const REGIONS = { euw: ['euw1', 'europe'], eune: ['eun1', 'europe'], na: ['na1', 'americas'], kr: ['kr', 'asia'] };

export function makeClient(key, region = 'euw') {
  const [platform, routing] = REGIONS[region] || REGIONS.euw;
  let last = 0;
  async function api(host, path) {
    const wait = Math.max(0, last + 200 - Date.now()); // burst-friendly; 429 handler does the real pacing
    if (wait) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(`https://${host}.api.riotgames.com${path}`, { headers: { 'X-Riot-Token': key } });
    if (res.status === 429) {
      const retry = (parseInt(res.headers.get('retry-after') || '10', 10) + 1) * 1000;
      await new Promise(r => setTimeout(r, retry));
      return api(host, path);
    }
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 401) throw new Error('Riot API key invalid or expired — dev keys last 24h. Get a fresh one at developer.riotgames.com and paste it in the key field.');
    if (!res.ok) throw new Error(`Riot ${res.status} on ${path.split('?')[0]}`);
    return res.json();
  }
  return { api, platform, routing };
}

export const TIERS = { IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9 };
const DIV = { I: 0.75, II: 0.5, III: 0.25, IV: 0 };
export const tierNum = e => e ? TIERS[e.tier] + (DIV[e.rank] ?? 0) : null;
export const tierStr = e => e ? `${e.tier[0]}${e.tier.slice(1).toLowerCase()} ${e.rank} ${e.leaguePoints}LP` : 'Unranked';

export async function resolveAccount(c, name, tag) {
  return c.api(c.routing, `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(name)}/${encodeURIComponent(tag)}`);
}

export async function listMatchIds(c, puuid, count) {
  return (await c.api(c.routing, `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&count=${Math.min(20, count)}`)) || [];
}

export async function fetchMatch(c, db, id) {
  const cached = await db.getRaw(id);
  if (cached) return cached;
  const m = await c.api(c.routing, `/lol/match/v5/matches/${id}`);
  if (m) await db.putRaw(id, m);
  return m;
}

async function soloRank(c, puuid) {
  const entries = await c.api(c.platform, `/lol/league/v4/entries/by-puuid/${puuid}`);
  return (entries || []).find(e => e.queueType === 'RANKED_SOLO_5x5') || null;
}

// championId -> internal champion name (e.g. "MonkeyKing"), matching match-v5's championName
// field so live and post-game champ labels agree. Fetched from Data Dragon (not the Riot
// client — no key needed) and cached for the life of the process.
let ddragonChamps = null;
async function championNameMap() {
  if (ddragonChamps) return ddragonChamps;
  const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then(r => r.json());
  const ver = versions[0];
  const data = await fetch(`https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/champion.json`).then(r => r.json());
  ddragonChamps = {};
  for (const champ of Object.values(data.data)) ddragonChamps[champ.key] = champ.id;
  return ddragonChamps;
}

export function pStats(match, puuid) {
  const p = match.info.participants.find(x => x.puuid === puuid);
  if (!p) return null;
  return {
    champ: p.championName, champId: p.championId, k: p.kills, d: p.deaths, a: p.assists,
    dmg: p.totalDamageDealtToChampions, cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    win: p.win, pos: p.teamPosition, team: p.teamId,
    remake: match.info.gameDuration < 300,
  };
}

function gaScore(prior, current, entry, lobbyAvgTier, mastery) {
  const ranked = prior.filter(g => !g.remake);
  const wins = ranked.filter(g => g.win).length;
  let streak = 0;
  for (const g of ranked) { if (g.win === ranked[0]?.win) streak++; else break; }
  let form = Math.round((wins / Math.max(1, ranked.length)) * 22);
  if (streak >= 3) form += ranked[0].win ? 5 : -5;
  form = Math.max(0, Math.min(27, form));
  const ratios = ranked.map(g => Math.min(10, (g.k + g.a) / Math.max(1, g.d)));
  const avgKda = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const perf = Math.min(25, Math.round(avgKda * 5));
  const champCount = ranked.filter(g => g.champId === current.champId).length;
  let comfort = champCount * 4 + (mastery >= 100000 ? 8 : mastery >= 25000 ? 5 : mastery >= 5000 ? 2 : 0);
  comfort = Math.min(20, Math.max(mastery < 5000 && champCount === 0 ? 2 : 3, comfort));
  const posCounts = {};
  ranked.forEach(g => { if (g.pos) posCounts[g.pos] = (posCounts[g.pos] || 0) + 1; });
  const mainPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const role = !mainPos ? 8 : current.pos === mainPos ? 15 : (posCounts[current.pos] || 0) >= 2 ? 8 : 3;
  const t = tierNum(entry);
  const rankPts = t == null ? 5 : t >= lobbyAvgTier + 0.75 ? 10 : t >= lobbyAvgTier - 0.5 ? 7 : t >= lobbyAvgTier - 1.5 ? 5 : 3;
  // Season winrate (5 pts): the league-v4 entry's career wins/losses this season — a much
  // bigger sample than the last-5-games form component above. Small samples (<20 games) aren't
  // meaningful yet, so those score a flat neutral 3 rather than rewarding/punishing noise.
  const seasonGames = (entry?.wins || 0) + (entry?.losses || 0);
  const wr = seasonGames > 0 ? entry.wins / seasonGames : null;
  const seasonPts = seasonGames < 20 ? 3 : wr >= 0.58 ? 5 : wr >= 0.54 ? 4 : wr >= 0.50 ? 3 : wr >= 0.46 ? 2 : 1;
  return {
    ga: form + perf + comfort + role + rankPts + seasonPts, wins, n: ranked.length,
    streak: `${streak}${ranked[0]?.win ? 'W' : 'L'}`, avgKda: +avgKda.toFixed(2), mainPos,
    firstTime: champCount === 0 && mastery < 5000,
    autofill: !!mainPos && current.pos !== mainPos && (posCounts[current.pos] || 0) < 2,
    otp: champCount >= 4 || mastery >= 150000,
    wr: wr != null ? Math.round(wr * 100) : null, seasonGames,
  };
}

// Map each player name to their duo partner name(s) — joined with ' & ' if a player is in
// more than one detected pair — so the frontend can name WHO a duo chip refers to.
function duoWithMap(duos) {
  const m = {};
  for (const d of duos) {
    m[d.a] = m[d.a] ? `${m[d.a]} & ${d.b}` : d.b;
    m[d.b] = m[d.b] ? `${m[d.b]} & ${d.a}` : d.a;
  }
  return m;
}

// Map each player name to their duo pair's shared-prior-games count (out of the last 5), for
// the frontend's duo chip tooltip ("N/5 previous games together"). First pair found wins for
// a player in multiple pairs, matching duoWithMap's convention.
function duoSharedMap(duos) {
  const m = {};
  for (const d of duos) {
    if (!(d.a in m)) m[d.a] = d.shared;
    if (!(d.b in m)) m[d.b] = d.shared;
  }
  return m;
}

function fairness(rows, duos, userTeam) {
  const spread = team => {
    const v = rows.filter(r => r.team === team && r.tierN != null).map(r => r.tierN);
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
  };
  const sB = spread(100), sR = spread(200), maxSpread = Math.max(sB, sR);
  const avg = team => { const v = rows.filter(r => r.team === team && r.ga); return v.length ? v.reduce((s, r) => s + r.ga.ga, 0) / v.length : null; };
  const gaB = avg(100), gaR = avg(200);
  // A proven duo coordinates better than two solo queuers — give each team a small GA bonus
  // scaled by its number of duo pairs (capped so one team can't run away with it), and use the
  // EFFECTIVE (bonus-adjusted) GAs for the fairness check instead of the raw averages.
  const duoCount = team => duos.filter(d => d.team === team).length;
  const bonusB = Math.min(8, 4 * duoCount(100)), bonusR = Math.min(8, 4 * duoCount(200));
  const effB = gaB != null ? gaB + bonusB : null, effR = gaR != null ? gaR + bonusR : null;
  const gaGap = effB != null && effR != null ? Math.abs(effB - effR) : null;
  const userEffGa = userTeam === 100 ? effB : effR;
  const reasons = [];
  if (maxSpread >= 2.5) reasons.push(`huge tier spread inside a team (${maxSpread.toFixed(1)} tiers)`);
  if (gaGap != null && gaGap >= 12) reasons.push(`team strength gap (GA ${Math.round(effB)} vs ${Math.round(effR)})${(userEffGa === Math.min(effB, effR)) ? ' against you' : ' in your favor'}`);
  const allyBonus = userTeam === 100 ? bonusB : bonusR, enemyBonus = userTeam === 100 ? bonusR : bonusB;
  const duoEdge = enemyBonus - allyBonus;
  if (duoEdge > 0) reasons.push(`enemy duo synergy (+${duoEdge} GA) tips the balance`);
  const firstTimers = rows.filter(r => r.team === userTeam && r.ga?.firstTime).length;
  if (firstTimers >= 2) reasons.push(`${firstTimers} first-time champions on your team`);
  const verdict = reasons.length === 0 ? 'FAIR' : 'NOT FAIR';
  const oneLiner = verdict === 'FAIR' ? 'Fair lobby — result came down to play.' : reasons.join('; ') + '.';
  return {
    verdict, oneLiner, teamGA: { blue: gaB && Math.round(gaB), red: gaR && Math.round(gaR) },
    duoBonus: { blue: bonusB, red: bonusR }, spreads: { blue: +sB.toFixed(2), red: +sR.toFixed(2) },
  };
}

// Full deep analysis of one match from the perspective of `puuid`.
export async function analyzeMatch(c, db, { name, tag, puuid, matchId }) {
  const match = await fetchMatch(c, db, matchId);
  if (!match) throw new Error('match not found');
  const me = pStats(match, puuid);
  if (me.remake) return { matchId, remake: true };
  const dur = `${Math.floor(match.info.gameDuration / 60)}m ${String(match.info.gameDuration % 60).padStart(2, '0')}s`;
  const parts = match.info.participants;
  const endSec = Math.floor(match.info.gameStartTimestamp / 1000) - 1;

  for (const p of parts) p._entry = await soloRank(c, p.puuid);
  const nums = parts.map(p => tierNum(p._entry)).filter(t => t != null);
  const lobbyAvg = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);

  const rows = [];
  const priorIdsByPuuid = {};
  for (const p of parts) {
    const cur = pStats(match, p.puuid);
    const pIds = (await c.api(c.routing, `/lol/match/v5/matches/by-puuid/${p.puuid}/ids?queue=420&count=5&endTime=${endSec}`)) || [];
    priorIdsByPuuid[p.puuid] = pIds;
    const prior = [];
    for (const mid of pIds) { const pm = await fetchMatch(c, db, mid); const s = pm && pStats(pm, p.puuid); if (s) prior.push(s); }
    const mastery = (await c.api(c.platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${p.puuid}/by-champion/${cur.champId}`))?.championPoints || 0;
    const ga = gaScore(prior, cur, p._entry, lobbyAvg, mastery);
    rows.push({ name: `${p.riotIdGameName}#${p.riotIdTagline}`, team: cur.team, pos: cur.pos, champ: cur.champ, kda: `${cur.k}/${cur.d}/${cur.a}`, dmg: cur.dmg, cs: cur.cs, rank: tierStr(p._entry), tierN: tierNum(p._entry), ga });
  }

  // In-game performance rating (op.gg-style): rank 1st-10th + MVP (best winner) / ACE (best loser).
  // Riot doesn't expose OP scores, so we compute our own from KDA, kill participation,
  // damage share, CS/min and vision/min — support-friendly weights.
  const teamKills = { 100: 0, 200: 0 }, teamDmg = { 100: 0, 200: 0 }, teamTaken = { 100: 0, 200: 0 }, teamObj = { 100: 0, 200: 0 };
  for (const p of parts) {
    teamKills[p.teamId] += p.kills; teamDmg[p.teamId] += p.totalDamageDealtToChampions;
    teamTaken[p.teamId] += p.totalDamageTaken; teamObj[p.teamId] += p.damageDealtToObjectives;
  }
  const mins = match.info.gameDuration / 60;
  const scored = parts.map((p, idx) => {
    const kp = teamKills[p.teamId] ? (p.kills + p.assists) / teamKills[p.teamId] : 0;
    const dmgShare = teamDmg[p.teamId] ? p.totalDamageDealtToChampions / teamDmg[p.teamId] : 0;
    const takenShare = teamTaken[p.teamId] ? p.totalDamageTaken / teamTaken[p.teamId] : 0;
    const objShare = teamObj[p.teamId] ? p.damageDealtToObjectives / teamObj[p.teamId] : 0;
    const kdaR = Math.min(10, (p.kills + p.assists) / Math.max(1, p.deaths));
    const cspm = (p.totalMinionsKilled + p.neutralMinionsKilled) / mins;
    const vspm = (p.visionScore || 0) / mins;
    // Dying a lot inflates damage taken (more respawns soaking damage again), so halve its
    // credit once a player passes 6 deaths in the game rather than reward feeding tankiness.
    const takenGuard = p.deaths <= 6 ? 1 : 0.5;
    return { idx, s: kdaR * 1.5 + kp * 10 + dmgShare * 10 + objShare * 5 + takenShare * 5 * takenGuard + cspm * 0.6 + vspm * 2 };
  }).sort((a, b) => b.s - a.s);
  scored.forEach((x, i) => { rows[x.idx].place = i + 1; });
  const winTeam = parts.find(p => p.win)?.teamId;
  const bestWin = scored.find(x => parts[x.idx].teamId === winTeam);
  const bestLose = scored.find(x => parts[x.idx].teamId !== winTeam);
  if (bestWin) rows[bestWin.idx].badge = 'MVP';
  if (bestLose) rows[bestLose.idx].badge = 'ACE';

  const duos = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (parts[i].teamId !== parts[j].teamId) continue;
    const shared = (priorIdsByPuuid[parts[i].puuid] || []).filter(x => (priorIdsByPuuid[parts[j].puuid] || []).includes(x));
    if (shared.length >= 2) duos.push({ a: rows[i].name, b: rows[j].name, shared: shared.length, team: parts[i].teamId });
  }

  const fair = fairness(rows, duos, me.team);
  const duoNames = new Set(duos.flatMap(d => [d.a, d.b]));
  const duoWith = duoWithMap(duos);
  const duoShared = duoSharedMap(duos);
  return {
    matchId, analyzedAt: new Date().toISOString(), summoner: `${name}-${tag}`,
    result: me.win ? 'Victory' : 'Defeat', queue: 'Ranked Solo/Duo', depth: 'deep', source: 'riot-api',
    when: new Date(match.info.gameStartTimestamp).toISOString(), duration: dur,
    user: { champ: me.champ, kda: `${me.k}/${me.d}/${me.a}`, dmg: me.dmg, cs: me.cs, pos: me.pos },
    userTeam: me.team === 100 ? 'blue' : 'red',
    matchmaking: fair.verdict, oneLiner: fair.oneLiner, teamGA: fair.teamGA, duoBonus: fair.duoBonus, spreads: fair.spreads,
    duos: duos.map(d => [d.a, d.b, `${d.shared}/5 pre-game games together`, d.team === me.team ? 'ally' : 'enemy']),
    players: rows.map(r => ({ n: r.name, team: r.team === 100 ? 'blue' : 'red', rank: r.rank, pos: r.pos, champ: r.champ, kda: r.kda, dmg: r.dmg, cs: r.cs, cspm: +(r.cs / mins).toFixed(1), ga: r.ga.ga, form: `${r.ga.wins}W-${r.ga.n - r.ga.wins}L`, streak: r.ga.streak, wr: r.ga.wr, seasonGames: r.ga.seasonGames, duo: duoNames.has(r.name), duoWith: duoWith[r.name] || null, duoShared: duoShared[r.name] ?? null, flags: [r.ga.autofill && 'autofill', r.ga.firstTime && 'first-time', r.ga.otp && 'otp'].filter(Boolean), place: r.place || null, badge: r.badge || null })),
  };
}

// Picks the most-favored lane (TOP/MID/BOT, from the user's team perspective) to recommend
// as a "play for X" call, live-only. BOT is the average of BOTTOM + UTILITY per side (it's the
// 2v2 lane). Excludes the user's own lane — a jungler picks among all three, a top laner only
// considers MID/BOT, etc. Returns null if there isn't enough data to compare any lane.
function laneRecommendation(rows, userTeam, enemyTeam, userPos) {
  const gaOf = (team, pos) => rows.find(r => r.team === team && r.pos === pos)?.ga?.ga;
  const botAvg = team => {
    const vals = [gaOf(team, 'BOTTOM'), gaOf(team, 'UTILITY')].filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const deltas = {};
  const top = [gaOf(userTeam, 'TOP'), gaOf(enemyTeam, 'TOP')];
  if (top[0] != null && top[1] != null) deltas.TOP = top[0] - top[1];
  const mid = [gaOf(userTeam, 'MIDDLE'), gaOf(enemyTeam, 'MIDDLE')];
  if (mid[0] != null && mid[1] != null) deltas.MID = mid[0] - mid[1];
  const bot = [botAvg(userTeam), botAvg(enemyTeam)];
  if (bot[0] != null && bot[1] != null) deltas.BOT = bot[0] - bot[1];

  const excludeLane = userPos === 'TOP' ? 'TOP' : userPos === 'MIDDLE' ? 'MID' : (userPos === 'BOTTOM' || userPos === 'UTILITY') ? 'BOT' : null;
  const candidates = Object.entries(deltas).filter(([lane]) => lane !== excludeLane);
  if (!candidates.length) return null;

  const [lane, deltaRaw] = candidates.reduce((best, cur) => (cur[1] > best[1] ? cur : best));
  const delta = Math.round(deltaRaw);
  const laneLabel = { TOP: 'top lane', MID: 'mid lane', BOT: 'bot lane' }[lane];
  const text = delta > 0
    ? `PLAY FOR ${lane} — your ${laneLabel} is +${delta} GA ahead`
    : `No favored lane — play safe; best odds are ${lane} (${delta} GA)`;
  return { lane, delta, text };
}

// Live lobby analysis via spectator-v5, for a game the player is currently in (loading
// screen / early game). Reuses the same rank/prior-games/mastery/GA/duo/fairness pipeline
// as analyzeMatch, but positions aren't assigned in spectator data, so each player's role
// is inferred from their own recent ranked games (their most common position).
export async function analyzeLive(c, db, { name, tag, puuid }) {
  const game = await c.api(c.platform, `/lol/spectator/v5/active-games/by-summoner/${puuid}`);
  if (!game) return { inGame: false };
  if (game.gameQueueConfigId !== 420) return { inGame: true, unsupported: true, queue: game.gameQueueConfigId };

  const summoner = `${name}-${tag}`;
  // Store under the REAL match id the finished game will have (spectator's platformId + gameId
  // is exactly match-v5's match id format, e.g. EUW1_7929963703) instead of a synthetic LIVE_
  // prefix, so this same cache row is what api/analyze.mjs later overwrites with the final
  // deep analysis — the history entry upgrades from live to final in place, no duplicates.
  const matchId = `${(game.platformId || c.platform).toUpperCase()}_${game.gameId}`;
  const cached = await db.getAnalysis(matchId, summoner);
  if (cached) return cached;

  const champs = await championNameMap();
  const parts = game.participants;
  const nowSec = Math.floor(Date.now() / 1000);

  for (const p of parts) p._entry = await soloRank(c, p.puuid);
  const nums = parts.map(p => tierNum(p._entry)).filter(t => t != null);
  const lobbyAvg = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);

  const rows = [];
  const priorIdsByPuuid = {};
  for (const p of parts) {
    const pIds = (await c.api(c.routing, `/lol/match/v5/matches/by-puuid/${p.puuid}/ids?queue=420&count=5&endTime=${nowSec}`)) || [];
    priorIdsByPuuid[p.puuid] = pIds;
    const prior = [];
    for (const mid of pIds) { const pm = await fetchMatch(c, db, mid); const s = pm && pStats(pm, p.puuid); if (s) prior.push(s); }
    const posCounts = {};
    prior.filter(g => !g.remake).forEach(g => { if (g.pos) posCounts[g.pos] = (posCounts[g.pos] || 0) + 1; });
    const mainPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const mastery = (await c.api(c.platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${p.puuid}/by-champion/${p.championId}`))?.championPoints || 0;
    const ga = gaScore(prior, { champId: p.championId, pos: mainPos }, p._entry, lobbyAvg, mastery);
    rows.push({ name: p.riotId, team: p.teamId, pos: mainPos, champ: champs[String(p.championId)] || 'Unknown', rank: tierStr(p._entry), tierN: tierNum(p._entry), ga });
  }

  const duos = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (parts[i].teamId !== parts[j].teamId) continue;
    const shared = (priorIdsByPuuid[parts[i].puuid] || []).filter(x => (priorIdsByPuuid[parts[j].puuid] || []).includes(x));
    if (shared.length >= 2) duos.push({ a: rows[i].name, b: rows[j].name, shared: shared.length, team: parts[i].teamId });
  }

  const meIdx = parts.findIndex(p => p.puuid === puuid);
  const me = parts[meIdx], meRow = rows[meIdx];
  const enemyTeam = me.teamId === 100 ? 200 : 100;
  const fair = fairness(rows, duos, me.teamId);
  const duoNames = new Set(duos.flatMap(d => [d.a, d.b]));
  const duoWith = duoWithMap(duos);
  const duoShared = duoSharedMap(duos);
  const entry = {
    live: true, matchId, result: 'Live', queue: 'Ranked Solo/Duo',
    when: new Date(game.gameStartTime).toISOString(), duration: Math.max(0, Math.floor(game.gameLength / 60)) + 'm (in progress)',
    user: { champ: meRow.champ, pos: meRow.pos },
    userTeam: me.teamId === 100 ? 'blue' : 'red',
    matchmaking: fair.verdict, oneLiner: fair.oneLiner, teamGA: fair.teamGA, duoBonus: fair.duoBonus, spreads: fair.spreads,
    recommendation: laneRecommendation(rows, me.teamId, enemyTeam, meRow.pos),
    duos: duos.map(d => [d.a, d.b, `${d.shared}/5 pre-game games together`, d.team === me.teamId ? 'ally' : 'enemy']),
    players: rows.map(r => ({ n: r.name, team: r.team === 100 ? 'blue' : 'red', rank: r.rank, pos: r.pos, champ: r.champ, ga: r.ga.ga, form: `${r.ga.wins}W-${r.ga.n - r.ga.wins}L`, streak: r.ga.streak, wr: r.ga.wr, seasonGames: r.ga.seasonGames, duo: duoNames.has(r.name), duoWith: duoWith[r.name] || null, duoShared: duoShared[r.name] ?? null, flags: [r.ga.autofill && 'autofill', r.ga.firstTime && 'first-time'].filter(Boolean), place: null, badge: null, posInferred: true })),
  };
  await db.putAnalysis(matchId, summoner, entry);
  return entry;
}
