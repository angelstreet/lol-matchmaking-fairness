// lib/riot.mjs — Riot API client + fairness analysis engine (serverless-safe, no fs).
// Ranked Solo/Duo only (queue=420).

import { counterPenalty } from './counters.mjs';

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
  // Defensive: callers should already skip this entirely for participants without a puuid
  // (spectator-v5 occasionally omits one), but guard here too since a 400 on
  // /by-puuid/null|undefined would otherwise take down the whole analysis either way.
  if (!puuid) return null;
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

// Fetches a player's top-10 champion masteries in ONE call and derives both the current champ's
// own points (feeds comfort/first-time/OTP's absolute threshold, same as the old by-champion
// lookup) and whether that champ DOMINATES their pool — their #1 mastery champ, or within 50% of
// the #1's points. That relative signal is what OTP's mastery branch now requires (v4.4): an
// absolute 150k threshold alone can't tell a genuine one-trick from a veteran who's simply logged
// enough games to clear 150k on several champs. If the current champ isn't even in the top 10, it
// obviously isn't dominant, and its points count as 0 — realistically nobody has 10+ OTHER champs
// each outmastering a genuinely significant pick, so this never costs real precision while keeping
// the call budget at one request per player (same as before, just a different endpoint).
async function topMasteryInfo(c, puuid, champId) {
  const top = (await c.api(c.platform, `/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=10`)) || [];
  const points = top.find(m => m.championId === champId)?.championPoints || 0;
  const topPoints = top[0]?.championPoints || 0;
  const dominant = topPoints > 0 && (top[0]?.championId === champId || points >= topPoints * 0.5);
  return { points, dominant };
}

export function pStats(match, puuid) {
  const p = match.info.participants.find(x => x.puuid === puuid);
  if (!p) return null;
  return {
    champ: p.championName, champId: p.championId, k: p.kills, d: p.deaths, a: p.assists,
    dmg: p.totalDamageDealtToChampions, cs: p.totalMinionsKilled + p.neutralMinionsKilled,
    win: p.win, pos: p.teamPosition, team: p.teamId,
    remake: match.info.gameDuration < 300,
    // For gaScore's tilt/rust/AFK-risk modifiers below.
    start: match.info.gameStartTimestamp, earlySurrender: !!p.gameEndedInEarlySurrender,
    summonerLevel: p.summonerLevel,
  };
}

function gaScore(prior, current, entry, lobbyAvgTier, mastery, masteryDominant) {
  const ranked = prior.filter(g => !g.remake);
  const wins = ranked.filter(g => g.win).length;
  let streak = 0;
  for (const g of ranked) { if (g.win === ranked[0]?.win) streak++; else break; }
  let form = Math.round((wins / Math.max(1, ranked.length)) * 22);
  // v4 (backtest-driven): streak was ±5, but a backtest of 17 cached analyses found 3 misses
  // where a player on a 4-5 game LOSING streak went MVP the very next game — the modifier was
  // reading momentum where there wasn't any. Softened to ±2, still directionally meaningful but
  // no longer capable of swinging the score on its own.
  if (streak >= 3) form += ranked[0].win ? 2 : -2;
  const ratios = ranked.map(g => Math.min(10, (g.k + g.a) / Math.max(1, g.d)));
  const avgKda = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0;
  const perf = Math.min(25, Math.round(avgKda * 5));
  const champCount = ranked.filter(g => g.champId === current.champId).length;
  // OTP denied their champion: champCount above only measures comfort on THIS game's champ —
  // it says nothing about whether they're actually playing their signature pick. A player who's
  // played one champion in 4+ of their last 5 ranked games but got a different one this game is
  // a real one-trick pushed off their champion, which is a bigger disadvantage than the ordinary
  // low-comfort score already captures (unfamiliar champ, but ALSO a proven strong one denied).
  // Moved ahead of the comfort calculation below (v4.4) so comfort itself can be OTP-aware.
  const champTally = {};
  ranked.forEach(g => { if (g.champId != null) champTally[g.champId] = (champTally[g.champId] || 0) + 1; });
  const topChamp = Object.entries(champTally).sort((a, b) => b[1] - a[1])[0];
  const otpDenied = !!topChamp && topChamp[1] >= 4 && Number(topChamp[0]) !== current.champId;
  const deniedChamp = otpDenied ? (ranked.find(g => g.champId === Number(topChamp[0]))?.champ ?? null) : null;
  // otp and otpDenied must be mutually exclusive by definition (OTP = one-tricking THIS champ,
  // otpDenied = one-tricking a DIFFERENT champ and forced off it). They can't both describe the
  // same game. champCount alone can't trip both — with only 5 ranked games, two different champs
  // can't each reach the ≥4 threshold, so if the current champ is the recent-5 mode, topChamp IS
  // the current champ and otpDenied is false already. The real collision was the mastery branch:
  // a player who heavily plays two champs can have ≥150k mastery on the CURRENT champ while a
  // DIFFERENT champ dominates their last 5 games, tripping otp (via mastery) and otpDenied (via
  // recent games) at once. Recent-games evidence wins that conflict — it's what's actually true
  // *this game* — so otpDenied forces otp off regardless of the mastery signal.
  // v4.4: the mastery branch is now RELATIVE, not absolute — 150k+ on the current champ only
  // counts as a one-trick if that champ actually DOMINATES the player's pool (their #1 mastery
  // champ, or within 50% of the #1's points — see topMasteryInfo below, one top-10 call per
  // player). A 1360-games/season veteran can clear 150k on five different champs; an absolute
  // threshold alone can't distinguish a genuine one-trick from "experienced player who knows a
  // lot of champs" (real case: vaporizer89's 318k Illaoi, dwarfed by his 1.13M Ahri).
  const otp = !otpDenied && (champCount >= 4 || (mastery >= 150000 && masteryDominant));
  let masteryBonus = mastery >= 100000 ? 8 : mastery >= 25000 ? 5 : mastery >= 5000 ? 2 : 0;
  // v4.4: full mastery credit is reserved for genuine one-tricks (otp true). A player with
  // OTP-tier mastery (150k+) who ISN'T currently dominant in their pool (the "Nk mastery" chip
  // case below) still has real, demonstrated skill on the champ — just not what they're actively
  // playing right now — so it's credited at a reduced 60% rather than scored identically to an
  // actual current specialist with the same raw points.
  if (!otp && mastery >= 150000) masteryBonus = Math.round(masteryBonus * 0.6);
  let comfort = champCount * 4 + masteryBonus;
  comfort = Math.min(20, Math.max(mastery < 5000 && champCount === 0 ? 2 : 3, comfort));
  if (otpDenied) comfort = Math.max(0, comfort - 5);
  const posCounts = {};
  ranked.forEach(g => { if (g.pos) posCounts[g.pos] = (posCounts[g.pos] || 0) + 1; });
  const mainPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  // Role security scales with how much of the recent 5 games were actually spent in this game's
  // role — "role heat" — rather than a coarse main-role/off-role/fill bucket split. 5/5 in role
  // = 15, 0/5 = 3 (still off-role but not zero, since a single game proves little either way);
  // no positional data at all (e.g. a very early-season sample) falls back to a neutral 8.
  const inRole = posCounts[current.pos] || 0;
  const considered = ranked.filter(g => g.pos).length;
  const role = considered ? Math.round(3 + 12 * (inRole / considered)) : 8;
  const t = tierNum(entry);
  let rankPts = t == null ? 5 : t >= lobbyAvgTier + 0.75 ? 10 : t >= lobbyAvgTier - 0.5 ? 7 : t >= lobbyAvgTier - 1.5 ? 5 : 3;
  // Season winrate (5 pts): the league-v4 entry's career wins/losses this season — a much
  // bigger sample than the last-5-games form component above. Small samples (<20 games) aren't
  // meaningful yet, so those score a flat neutral 3 rather than rewarding/punishing noise.
  const seasonGames = (entry?.wins || 0) + (entry?.losses || 0);
  const wr = seasonGames > 0 ? entry.wins / seasonGames : null;
  const seasonPts = seasonGames < 20 ? 3 : wr >= 0.58 ? 5 : wr >= 0.54 ? 4 : wr >= 0.50 ? 3 : wr >= 0.46 ? 2 : 1;

  // Session tilt: 3+ of the prior games happened within ~3h before this one AND at least 2 of
  // those were losses. v4 (backtest-driven): this used to cost -3 form, but the backtest found
  // tilt-flagged players actually placed BETTER than baseline (4.43 vs 5.60 average place, n=14)
  // — the theory ("a fatigued/tilted session underperforms") didn't hold up against real data.
  // Dropped the score penalty entirely; still computed and returned for the informational
  // "tilt?" chip, just no longer treated as evidence of anything.
  const THREE_H = 3 * 60 * 60 * 1000;
  const sameSession = current.start != null ? ranked.filter(g => g.start != null && current.start - g.start >= 0 && current.start - g.start <= THREE_H) : [];
  const tilt = sameSession.length >= 3 && sameSession.filter(g => !g.win).length >= 2;

  // Rust (-2 form): the most recent prior game (ranked is newest-first) is more than 14 days
  // old — recent "form" isn't very predictive if there isn't much recent play to measure.
  const FOURTEEN_D = 14 * 24 * 60 * 60 * 1000;
  const rusty = current.start != null && ranked[0]?.start != null && current.start - ranked[0].start > FOURTEEN_D;
  if (rusty) form -= 2;

  // AFK risk (-2 form): any prior game ended in an early surrender for this player — a loose
  // proxy for AFK/DC-prone recent games (Riot doesn't expose AFK flags directly).
  const afkRisk = ranked.some(g => g.earlySurrender);
  if (afkRisk) form -= 2;

  form = Math.max(0, Math.min(27, form));

  // Smurf detection: a low account level paired with either a real season winrate sample well
  // above average, or strong recent KDA, outclasses what tier-relative rankPts alone would
  // credit them. v4 (backtest-driven): all 4 smurf-flagged players in the backtest actually
  // placed 5th-8th — the old avgKda≥4 branch was catching plenty of merely-decent games, not
  // just real smurfs, and forcing rankPts straight to the max overcorrected for it. Tightened
  // the KDA trigger to ≥5 and softened the effect to a capped +3 bump instead of a hard override.
  const smurf = (current.summonerLevel ?? 999) < 60 && ((seasonGames >= 10 && wr >= 0.58) || avgKda >= 5);
  if (smurf) rankPts = Math.min(10, rankPts + 3);

  // v4.3: the +3 rankPts bump above only handles BORDERLINE smurfs — a flagrant one (real case:
  // GA 30 despite going 7/2/5 at 9.6 cs/min on a first-game champ) still craters on paper because
  // everything else about a fresh account reads as weak: low tier-relative rankPts, near-zero
  // champ/role history for comfort and role heat, first-time/autofill flags that are meaningless
  // signals on a smurf specifically (the account is new, the PLAYER isn't). A detected smurf is
  // never actually a weak player, so once the trigger fires, floor the final GA at 65 regardless
  // of what the account-history components computed — the v4 backtest that flagged smurfs as
  // *over*-scored was measuring the old +3-only/no-floor version at borderline cases, not this.
  let ga = Math.max(0, Math.min(100, form + perf + comfort + role + rankPts + seasonPts));
  if (smurf) ga = Math.max(ga, 65);

  return {
    ga, wins, n: ranked.length,
    streak: `${streak}${ranked[0]?.win ? 'W' : 'L'}`, avgKda: +avgKda.toFixed(2), mainPos,
    firstTime: champCount === 0 && mastery < 5000,
    autofill: !!mainPos && current.pos !== mainPos && inRole < 2,
    otp, otpDenied, deniedChamp,
    masteryPts: mastery,
    wr: wr != null ? Math.round(wr * 100) : null, seasonGames,
    tilt, rusty, afkRisk, smurf,
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

// Map each player name to their duo pair's joint W-L record ("3W-2L") in the shared prior games
// where they were actually teammates, for the frontend's duo chip tooltip.
function duoRecordMap(duos) {
  const m = {};
  for (const d of duos) {
    const rec = `${d.jointWins}W-${d.jointLosses}L`;
    if (!(d.a in m)) m[d.a] = rec;
    if (!(d.b in m)) m[d.b] = rec;
  }
  return m;
}

// A duo pair's joint record specifically in the shared games where they were teammates (not
// just both present — matchmaking coincidence could put duo-queue partners on opposite teams
// in an unrelated shared game). Every shared match id was already fetched (and cached) while
// building each player's own prior-games list, so this never costs an extra Riot API call.
async function duoRecord(c, db, sharedIds, puuidA, puuidB) {
  let w = 0, l = 0;
  for (const id of sharedIds) {
    const pm = await fetchMatch(c, db, id);
    if (!pm) continue;
    const sa = pStats(pm, puuidA), sb = pStats(pm, puuidB);
    if (!sa || !sb || sa.team !== sb.team) continue;
    if (sa.win) w++; else l++;
  }
  return { w, l };
}

// Off-role (autofill) and unfamiliar-champion (first-time) picks are risk, not skill — a player
// carrying either is more likely to underperform their GA than the number itself suggests. Used
// both to flag an asymmetric team-level risk load below and (client-side, mirrored in main.js)
// to keep individual lane verdicts from reading EVEN when one side is carrying risk the other
// isn't. v4 (backtest-driven): first-time was -5, but first-timers in the backtest averaged
// place 8.8/10 — clearly underweighted. Bumped to -7 (autofill stays -5, it wasn't flagged).
// v4.2: bumped again to -10 — a first-time pick reading as merely "risky" still wasn't heavy
// enough (a fresh first-time Malphite got run over in a real game that prompted this).
// v4.3: a detected smurf is exempt from BOTH penalties — autofill/first-time are proxies for "this
// player probably doesn't know what they're doing here," which is exactly backwards for a smurf:
// their fresh account's thin role/champ history is meaningless, the mechanics behind it are not.
// Counter penalties (applied separately via counterPenalty, not riskOf) still apply — a real
// champion matchup disadvantage doesn't go away just because the player piloting it is good.
const riskOf = r => r.ga?.smurf ? 0 : (r.ga?.autofill ? 5 : 0) + (r.ga?.firstTime ? 10 : 0);

// v4.2: a duo'd player can communicate/coordinate with their lane... well, usually their bot
// lane partner specifically, but duo pairs aren't always both in this exact lane pairing, so this
// applies the bonus to whichever lane each half of a duo happens to be playing — coordination
// with a teammate elsewhere on the map (calls, dives, timers) still makes THIS lane play looser
// than a solo queuer's GA alone would suggest. Additive on top of (not instead of) the team-level
// duo bonus in fairness() below, which rewards the pair's proven synergy at the team-GA level;
// this is the same signal applied one level down, at the individual lane a duo'd player is in.
const LANE_DUO_BONUS = 3;

// Short lane names for reason text ("Δ37 jungle for you"), matching the lowercase/casual style
// players actually use, not the ROLE constants themselves.
const LANE_NAME = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'bot', UTILITY: 'supp' };

// Win probability: a logistic curve over the SAME effective team-score gap (top-weighted 0.65/0.35
// team GA + duo bonus) used by the team-GA-gap fairness check below — P(blue wins) =
// 1 / (1 + e^(-K * gap)). A backtest agent fit K against our current ~34-game sample, but that's
// far too small to trust a steep/aggressive curve, so this ships the backtest's own recommended
// CONSERVATIVE default rather than its raw best-fit value. gap 10 -> 55%, gap 20 -> 60%, gap 40 ->
// 69% — deliberately gentle. Refit once the analysis DB reaches ~150+ games.
const WIN_PROB_K = 0.02;

// v4.1: one short sentence built from whichever fired reason is both (a) the highest-weight
// (biggest GA-equivalent contributor) and (b) actually pointing the same way as the overall
// verdict direction — using a reason that points the OPPOSITE way as the "why" would read as
// nonsensical ("first-time picks tipped it in your favor"). `effB`/`effR` are only needed for the
// gaGap template's exact numbers.
function oneLinerFor(r, dir, effB, effR) {
  const favor = dir === 'favor';
  const tail = favor ? 'in your favor' : 'against you';
  switch (r.type) {
    case 'gaGap': return `Team strength gap (GA ${Math.round(effB)} vs ${Math.round(effR)}) ${tail}.`;
    case 'duoEdge': return `Enemy duo synergy tipped it ${tail}.`;
    case 'firstTimers': return `First-time picks on your team tipped it ${tail}.`;
    case 'risk': return `Off-role/first-time risk tipped it ${tail}.`;
    case 'tierSpread': return `A lopsided tier spread worked ${tail}.`;
    case 'lane': return `Your ${r.note} tipped it ${tail}.`;
    default: return favor ? 'The numbers leaned in your favor overall.' : 'The numbers were stacked against you overall.';
  }
}
function genericOneLiner(dir) {
  return dir === 'favor' ? 'The numbers leaned in your favor overall.' : 'The numbers were stacked against you overall.';
}

function fairness(rows, duos, userTeam) {
  const spread = team => {
    const v = rows.filter(r => r.team === team && r.tierN != null).map(r => r.tierN);
    return v.length ? Math.max(...v) - Math.min(...v) : 0;
  };
  const sB = spread(100), sR = spread(200), maxSpread = Math.max(sB, sR);
  // v4 (backtest-driven): a flat 5-player average dilutes a hard carry — the backtest found an
  // 83-GA lane hard-carrying a team that still read as "weak" on paper (happened twice) because
  // four average-ish teammates pulled the mean down. Weighting the top-2 GAs more heavily
  // reflects that a team's ceiling matters, not just its average. Feeds both the team-GA-gap
  // fairness check below and the TEAM footer display (teamGA in the returned object) — the same
  // number now drives what's judged and what's shown, instead of the display lagging the logic.
  const weightedGA = team => {
    const v = rows.filter(r => r.team === team && r.ga).map(r => r.ga.ga);
    if (!v.length) return null;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const top2 = [...v].sort((a, b) => b - a).slice(0, 2);
    const topMean = top2.reduce((a, b) => a + b, 0) / top2.length;
    return 0.65 * mean + 0.35 * topMean;
  };
  const gaB = weightedGA(100), gaR = weightedGA(200);
  // A proven duo coordinates better than two solo queuers — give each team a GA bonus scaled by
  // how well each pair actually performs TOGETHER (their joint win record in shared prior
  // games), not just by pair count: a duo with a winning record earns the full bonus, a mixed
  // record earns less, a losing record less still. Summed per team, then (v4.2) amplified when a
  // team has 2+ duos — two coordinating pairs compound each other's advantage, not just add —
  // and capped so one team can't run away with it. Used for the EFFECTIVE (bonus-adjusted) GAs in
  // the fairness check below instead of the raw averages.
  const pairBonus = d => {
    const total = d.jointWins + d.jointLosses;
    if (total === 0) return 0; // no same-team shared game to judge coordination by
    if (d.jointWins > d.jointLosses) return 8; // winning record together -> full bonus
    if (d.jointWins === d.jointLosses) return 6; // mixed record -> partial
    return 4; // losing record together -> smallest bonus, still a real pair
  };
  const STACK_AMP = 1.25; // v4.2: 2+ duos on one team amplify their summed bonus by 25%
  const teamBonus = team => {
    const teamDuos = duos.filter(d => d.team === team);
    const raw = teamDuos.reduce((s, d) => s + pairBonus(d), 0);
    return Math.min(20, Math.round(teamDuos.length >= 2 ? raw * STACK_AMP : raw));
  };
  const bonusB = teamBonus(100), bonusR = teamBonus(200);
  const effB = gaB != null ? gaB + bonusB : null, effR = gaR != null ? gaR + bonusR : null;
  const gaGap = effB != null && effR != null ? Math.abs(effB - effR) : null;
  const userEffGa = userTeam === 100 ? effB : effR;
  // v4.1: each fired reason is an object, not a plain string, so it can drive three different
  // outputs from one source of truth: the badge tooltip (every fired reason, terse, joined with
  // ' · '), the one-liner (the single dominant — highest-weight, direction-aligned — reason, via
  // oneLinerFor above), and the FAIR/NOT-FAIR/direction decision itself via `net` below. `weight`
  // is a rough GA-equivalent used only to rank reasons against each other, not a precise
  // conversion. `favorsUser` is true/false/null (a tier spread can be exactly equal both sides).
  const reasons = [];

  if (maxSpread >= 2.5) {
    const userSpread = userTeam === 100 ? sB : sR, enemySpread = userTeam === 100 ? sR : sB;
    const favorsUser = userSpread === enemySpread ? null : enemySpread > userSpread;
    reasons.push({ type: 'tierSpread', terse: `${maxSpread.toFixed(1)}-tier spread on a team`, weight: maxSpread * 8, favorsUser, note: `${maxSpread.toFixed(1)}-tier spread` });
  }
  if (gaGap != null && gaGap >= 12) {
    const favorsUser = userEffGa !== Math.min(effB, effR);
    reasons.push({ type: 'gaGap', terse: `GA gap ${Math.round(effB)} vs ${Math.round(effR)}`, weight: gaGap, favorsUser, note: `GA gap ${Math.round(effB)}-${Math.round(effR)}` });
  }
  const allyBonus = userTeam === 100 ? bonusB : bonusR, enemyBonus = userTeam === 100 ? bonusR : bonusB;
  const duoEdge = enemyBonus - allyBonus;
  if (duoEdge > 0) reasons.push({ type: 'duoEdge', terse: `enemy duo synergy +${duoEdge}`, weight: duoEdge, favorsUser: false, note: `enemy duo +${duoEdge} GA` });
  const firstTimers = rows.filter(r => r.team === userTeam && r.ga?.firstTime).length;
  if (firstTimers >= 2) reasons.push({ type: 'firstTimers', terse: `${firstTimers} first-timers on your team`, weight: firstTimers * 7, favorsUser: false, note: `${firstTimers} first-timers` });
  // Asymmetric risk load: one team carrying meaningfully more autofill/first-time risk than the
  // other is itself unfair, independent of the GA-gap check above (which uses raw GA and can
  // still read "close" even when the underlying picks are lopsided). Only fires against the
  // user, matching the binary verdict's framing of "was this fair to you".
  const teamRisk = team => rows.filter(r => r.team === team).reduce((s, r) => s + riskOf(r), 0);
  const riskB = teamRisk(100), riskR = teamRisk(200);
  const userRisk = userTeam === 100 ? riskB : riskR, enemyRisk = userTeam === 100 ? riskR : riskB;
  if (Math.abs(riskB - riskR) >= 8 && userRisk > enemyRisk) reasons.push({ type: 'risk', terse: 'autofill/first-time risk against you', weight: Math.abs(riskB - riskR), favorsUser: false, note: 'risk imbalance' });

  // Lane-level: pair each role across teams (risk+counter-adjusted GA, same riskOf as above) and
  // name individually heavy lanes (|delta|>=19) by role, a single blowout lane (>=30 — only
  // reported separately when it wasn't already named among the heavy lanes above, to avoid
  // double-reporting the same lane), and the net summed lane advantage across all 5. Same trigger
  // thresholds as before v4.1; the difference is these are now named per-lane in the tooltip
  // ("jungle Δ37 for you") instead of reported as an aggregate count/figure.
  // A known lane counter (lib/counters.mjs) is itself a form of lane risk, same spirit as
  // riskOf's autofill/first-time penalty above — subtracted from the countered side before
  // comparing, so e.g. a Garen into a Vayne lane doesn't read as even just because the raw GAs
  // are close. v4.2: a duo'd player also gets LANE_DUO_BONUS added — the team-level duo bonus
  // above rewards the pair's synergy at the team-GA level, this applies the same signal one level
  // down, to whichever individual lane each half of the duo is actually playing.
  const duoedNames = new Set(duos.flatMap(d => [d.a, d.b]));
  const laneAdj = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map(pos => {
    const b = rows.find(r => r.team === 100 && r.pos === pos && r.ga);
    const r = rows.find(r => r.team === 200 && r.pos === pos && r.ga);
    if (!b || !r) return null;
    const bGa = b.ga.ga - riskOf(b) - counterPenalty(b.champ, r.champ) + (duoedNames.has(b.name) ? LANE_DUO_BONUS : 0);
    const rGa = r.ga.ga - riskOf(r) - counterPenalty(r.champ, b.champ) + (duoedNames.has(r.name) ? LANE_DUO_BONUS : 0);
    return { pos, delta: bGa - rGa }; // positive delta = blue favored
  }).filter(v => v != null);

  const heavyBlue = laneAdj.filter(l => l.delta >= 19);
  const heavyRed = laneAdj.filter(l => l.delta <= -19);
  const userHeavy = userTeam === 100 ? heavyBlue : heavyRed;
  const enemyHeavy = userTeam === 100 ? heavyRed : heavyBlue;
  const heavyDiff = Math.abs(userHeavy.length - enemyHeavy.length);
  const namedHeavy = new Set();
  if (heavyDiff >= 2) {
    for (const l of [...userHeavy, ...enemyHeavy]) {
      const favorsUser = userHeavy.includes(l);
      const mag = Math.abs(Math.round(l.delta));
      reasons.push({ type: 'lane', terse: `${LANE_NAME[l.pos]} Δ${mag} ${favorsUser ? 'for you' : 'for enemy'}`, weight: mag, favorsUser, note: `Δ${mag} ${LANE_NAME[l.pos]} lane` });
      namedHeavy.add(l.pos);
    }
  }

  const blowoutLane = laneAdj.find(l => Math.abs(l.delta) >= 30);
  if (blowoutLane && !namedHeavy.has(blowoutLane.pos)) {
    const favorsUser = userTeam === 100 ? blowoutLane.delta > 0 : blowoutLane.delta < 0;
    const mag = Math.abs(Math.round(blowoutLane.delta));
    reasons.push({ type: 'lane', terse: `${LANE_NAME[blowoutLane.pos]} blown out (Δ${mag})`, weight: mag, favorsUser, note: `Δ${mag} ${LANE_NAME[blowoutLane.pos]} lane` });
  }

  const netLaneSum = laneAdj.reduce((s, l) => s + l.delta, 0);
  const netLaneUser = userTeam === 100 ? netLaneSum : -netLaneSum;
  if (Math.abs(netLaneSum) >= 35) {
    const favorsUser = netLaneUser > 0;
    const mag = Math.abs(Math.round(netLaneSum));
    reasons.push({ type: 'lane', terse: `net lanes Δ${mag} ${favorsUser ? 'for you' : 'for enemy'}`, weight: mag, favorsUser, note: `Δ${mag} net across lanes` });
  }

  // v4.1: net direction replaces the old 'mixed' branch entirely — every verdict is now either
  // FAIR or NOT FAIR clearly favoring one side, never an ambiguous "both". `net` sums the two
  // purely quantitative, user-perspective signals: the summed risk/counter-adjusted lane deltas
  // and the effective (duo-bonus-included) team GA gap. Whenever any reason fired at all:
  //   - |net| >= NET_THRESHOLD -> a real, one-sided swing -> NOT FAIR, direction = net's side.
  //   - |net| < NET_THRESHOLD -> the fired reasons substantially offset each other -> back to
  //     FAIR, with the offsetting factors explained in the tooltip/one-liner instead of being
  //     silently dropped (e.g. a strong lane for you, canceled out by autofills against you).
  // NET_THRESHOLD = 10 GA: smaller than the smallest single trigger that fires on its own (team
  // GA gap needs 12, the smallest heavy-lane trigger needs 19), so nothing below it could have
  // single-handedly justified NOT FAIR either.
  const NET_THRESHOLD = 10;
  const gaGapUser = (effB != null && effR != null) ? (userTeam === 100 ? effB - effR : effR - effB) : 0;
  const net = netLaneUser + gaGapUser;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  let verdict, verdictDirection, oneLiner, verdictTooltip;
  if (reasons.length === 0) {
    verdict = 'FAIR'; verdictDirection = null;
    oneLiner = 'Fair lobby — result came down to play.';
    verdictTooltip = '';
  } else if (Math.abs(net) >= NET_THRESHOLD) {
    verdict = 'NOT FAIR';
    verdictDirection = net > 0 ? 'favor' : 'against';
    // Dominant = highest-weight reason that actually points the same way as the verdict — a
    // reason pointing the opposite way (rare, but possible when several smaller against-you
    // reasons are outweighed by one big for-you lane) would read as nonsensical in the template
    // ("first-time picks tipped it in your favor"), so it's excluded from consideration here.
    const aligned = reasons.filter(r => r.favorsUser === (verdictDirection === 'favor'));
    const dominant = aligned.length ? [...aligned].sort((a, b) => b.weight - a.weight)[0] : null;
    oneLiner = dominant ? oneLinerFor(dominant, verdictDirection, effB, effR) : genericOneLiner(verdictDirection);
    verdictTooltip = reasons.map(r => r.terse).join(' · ');
  } else {
    verdict = 'FAIR'; verdictDirection = null;
    const forUser = [...reasons].filter(r => r.favorsUser === true).sort((a, b) => b.weight - a.weight)[0];
    const againstUser = [...reasons].filter(r => r.favorsUser === false).sort((a, b) => b.weight - a.weight)[0];
    if (forUser && againstUser) {
      oneLiner = `${cap(forUser.note)} offset by ${againstUser.note} — fair overall.`;
      verdictTooltip = `EVEN overall — ${againstUser.terse} offset by ${forUser.terse}`;
    } else if (forUser || againstUser) {
      const only = forUser || againstUser;
      oneLiner = `${cap(only.note)} — not enough to tip it either way.`;
      verdictTooltip = `EVEN overall — ${only.terse}, not decisive`;
    } else {
      oneLiner = 'Fair lobby — result came down to play.';
      verdictTooltip = '';
    }
  }

  // Win probability, poker-style ("BLUE 55% / RED 45%") — a logistic on the same effB/effR gap
  // the team-GA-gap fairness check above already uses, so it agrees with everything else on the
  // page instead of introducing a second notion of "team strength". Null (not a fake 50/50) when
  // either side's effective GA isn't available, same convention as teamGA above.
  let winProb = null;
  if (effB != null && effR != null) {
    const pBlue = 1 / (1 + Math.exp(-WIN_PROB_K * (effB - effR)));
    const blue = Math.round(pBlue * 100);
    winProb = { blue, red: 100 - blue };
  }

  return {
    verdict, oneLiner, direction: verdictDirection, verdictTooltip,
    teamGA: { blue: gaB && Math.round(gaB), red: gaR && Math.round(gaR) },
    duoBonus: { blue: bonusB, red: bonusR }, spreads: { blue: +sB.toFixed(2), red: +sR.toFixed(2) },
    winProb,
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
    // match-v5 puuids are reliable (unlike spectator-v5's, see analyzeLive below), but the guard
    // costs nothing and keeps this symmetric with the live path.
    const pIds = p.puuid ? (await c.api(c.routing, `/lol/match/v5/matches/by-puuid/${p.puuid}/ids?queue=420&count=5&endTime=${endSec}`)) || [] : [];
    priorIdsByPuuid[p.puuid] = pIds;
    const prior = [];
    for (const mid of pIds) { const pm = await fetchMatch(c, db, mid); const s = pm && pStats(pm, p.puuid); if (s) prior.push(s); }
    const { points: mastery, dominant: masteryDominant } = await topMasteryInfo(c, p.puuid, cur.champId);
    const ga = gaScore(prior, cur, p._entry, lobbyAvg, mastery, masteryDominant);
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
    if (shared.length >= 2) {
      const rec = await duoRecord(c, db, shared, parts[i].puuid, parts[j].puuid);
      duos.push({ a: rows[i].name, b: rows[j].name, shared: shared.length, team: parts[i].teamId, jointWins: rec.w, jointLosses: rec.l });
    }
  }

  const fair = fairness(rows, duos, me.team);
  const duoNames = new Set(duos.flatMap(d => [d.a, d.b]));
  const duoWith = duoWithMap(duos);
  const duoShared = duoSharedMap(duos);
  const duoRec = duoRecordMap(duos);
  return {
    matchId, analyzedAt: new Date().toISOString(), summoner: `${name}-${tag}`,
    result: me.win ? 'Victory' : 'Defeat', queue: 'Ranked Solo/Duo', depth: 'deep', source: 'riot-api',
    when: new Date(match.info.gameStartTimestamp).toISOString(), duration: dur,
    user: { champ: me.champ, kda: `${me.k}/${me.d}/${me.a}`, dmg: me.dmg, cs: me.cs, pos: me.pos },
    userTeam: me.team === 100 ? 'blue' : 'red',
    matchmaking: fair.verdict, direction: fair.direction, oneLiner: fair.oneLiner, verdictTooltip: fair.verdictTooltip, teamGA: fair.teamGA, duoBonus: fair.duoBonus, spreads: fair.spreads, winProb: fair.winProb,
    duos: duos.map(d => [d.a, d.b, `${d.shared}/5 pre-game games together`, d.team === me.team ? 'ally' : 'enemy']),
    players: rows.map(r => ({ n: r.name, team: r.team === 100 ? 'blue' : 'red', rank: r.rank, pos: r.pos, champ: r.champ, kda: r.kda, dmg: r.dmg, cs: r.cs, cspm: +(r.cs / mins).toFixed(1), ga: r.ga.ga, form: `${r.ga.wins}W-${r.ga.n - r.ga.wins}L`, streak: r.ga.streak, wr: r.ga.wr, seasonGames: r.ga.seasonGames, duo: duoNames.has(r.name), duoWith: duoWith[r.name] || null, duoShared: duoShared[r.name] ?? null, duoRecord: duoRec[r.name] || null, deniedChamp: r.ga.deniedChamp || null, masteryPts: r.ga.masteryPts || 0, flags: [!r.ga.smurf && r.ga.autofill && 'autofill', !r.ga.smurf && r.ga.firstTime && 'first-time', r.ga.otp && 'otp', !r.ga.otp && r.ga.masteryPts >= 150000 && 'mastery', r.ga.otpDenied && 'otp-denied', !r.ga.smurf && r.ga.tilt && 'tilt', r.ga.rusty && 'rusty', r.ga.smurf && 'smurf', r.ga.afkRisk && 'afk-risk'].filter(Boolean), place: r.place || null, badge: r.badge || null })),
  };
}

// Picks the most-favored lane (TOP/MID/BOT, from the user's team perspective) to recommend
// as a "play for X" call, live-only. BOT is the average of BOTTOM + UTILITY per side (it's the
// 2v2 lane). Excludes the user's own lane — a jungler picks among all three, a top laner only
// considers MID/BOT, etc. Returns null if there isn't enough data to compare any lane.
// v4.2: gaOf applies the same LANE_DUO_BONUS as fairness()'s laneAdj — a duo'd player's lane
// reads a bit stronger here too, keeping the live recommendation consistent with the same-game
// analysis math instead of drifting out of sync.
function laneRecommendation(rows, userTeam, enemyTeam, userPos, duos = []) {
  const duoedNames = new Set(duos.flatMap(d => [d.a, d.b]));
  const gaOf = (team, pos) => {
    const row = rows.find(r => r.team === team && r.pos === pos);
    if (!row?.ga) return null;
    return row.ga.ga + (duoedNames.has(row.name) ? LANE_DUO_BONUS : 0);
  };
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

  // soloRank() itself also guards against a missing puuid (belt-and-suspenders), but skip the
  // call outright here too — no sense making a request we know is pointless.
  for (const p of parts) p._entry = p.puuid ? await soloRank(c, p.puuid) : null;
  const nums = parts.map(p => tierNum(p._entry)).filter(t => t != null);
  const lobbyAvg = nums.reduce((a, b) => a + b, 0) / Math.max(1, nums.length);

  const rows = [];
  const priorIdsByPuuid = {};
  for (const p of parts) {
    // Spectator-v5 occasionally hands back a participant with a null/undefined/empty puuid
    // (unexplained by Riot, seen in the wild) — every per-player Riot call below needs one, so
    // skip them all for this participant rather than 400ing and killing the whole live analysis.
    // The row still shows up (champ + name from the spectator payload) just with no rank/GA and
    // no duo participation (priorIdsByPuuid is left unset for them, which the duo-detection loop
    // below already treats as an empty prior-games list via its `|| []` fallback).
    if (!p.puuid) {
      rows.push({ name: p.riotId || 'Unknown', team: p.teamId, pos: '', champ: champs[String(p.championId)] || 'Unknown', rank: 'Unranked', tierN: null, ga: null });
      continue;
    }
    const pIds = (await c.api(c.routing, `/lol/match/v5/matches/by-puuid/${p.puuid}/ids?queue=420&count=5&endTime=${nowSec}`)) || [];
    priorIdsByPuuid[p.puuid] = pIds;
    const prior = [];
    for (const mid of pIds) { const pm = await fetchMatch(c, db, mid); const s = pm && pStats(pm, p.puuid); if (s) prior.push(s); }
    const posCounts = {};
    prior.filter(g => !g.remake).forEach(g => { if (g.pos) posCounts[g.pos] = (posCounts[g.pos] || 0) + 1; });
    const mainPos = Object.entries(posCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const { points: mastery, dominant: masteryDominant } = await topMasteryInfo(c, p.puuid, p.championId);
    // Spectator-v5 participants don't expose summonerLevel, so smurf detection just never
    // triggers live (safe no-op) — it only ever fires from a completed match's real data.
    const ga = gaScore(prior, { champId: p.championId, pos: mainPos, start: game.gameStartTime, summonerLevel: p.summonerLevel }, p._entry, lobbyAvg, mastery, masteryDominant);
    rows.push({ name: p.riotId, team: p.teamId, pos: mainPos, champ: champs[String(p.championId)] || 'Unknown', rank: tierStr(p._entry), tierN: tierNum(p._entry), ga });
  }

  const duos = [];
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    if (parts[i].teamId !== parts[j].teamId) continue;
    const shared = (priorIdsByPuuid[parts[i].puuid] || []).filter(x => (priorIdsByPuuid[parts[j].puuid] || []).includes(x));
    if (shared.length >= 2) {
      const rec = await duoRecord(c, db, shared, parts[i].puuid, parts[j].puuid);
      duos.push({ a: rows[i].name, b: rows[j].name, shared: shared.length, team: parts[i].teamId, jointWins: rec.w, jointLosses: rec.l });
    }
  }

  const meIdx = parts.findIndex(p => p.puuid === puuid);
  const me = parts[meIdx], meRow = rows[meIdx];
  const enemyTeam = me.teamId === 100 ? 200 : 100;
  const fair = fairness(rows, duos, me.teamId);
  const duoNames = new Set(duos.flatMap(d => [d.a, d.b]));
  const duoWith = duoWithMap(duos);
  const duoShared = duoSharedMap(duos);
  const duoRec = duoRecordMap(duos);
  const entry = {
    live: true, matchId, result: 'Live', queue: 'Ranked Solo/Duo',
    when: new Date(game.gameStartTime).toISOString(), duration: Math.max(0, Math.floor(game.gameLength / 60)) + 'm (in progress)',
    user: { champ: meRow.champ, pos: meRow.pos },
    userTeam: me.teamId === 100 ? 'blue' : 'red',
    matchmaking: fair.verdict, direction: fair.direction, oneLiner: fair.oneLiner, verdictTooltip: fair.verdictTooltip, teamGA: fair.teamGA, duoBonus: fair.duoBonus, spreads: fair.spreads, winProb: fair.winProb,
    recommendation: laneRecommendation(rows, me.teamId, enemyTeam, meRow.pos, duos),
    duos: duos.map(d => [d.a, d.b, `${d.shared}/5 pre-game games together`, d.team === me.teamId ? 'ally' : 'enemy']),
    // r.ga is null for a spectator participant with no puuid (see the puuid guard above) — every
    // field sourced from it needs the same null guard here, not just the top-level `ga` value.
    players: rows.map(r => ({ n: r.name, team: r.team === 100 ? 'blue' : 'red', rank: r.rank, pos: r.pos, champ: r.champ, ga: r.ga ? r.ga.ga : null, form: r.ga ? `${r.ga.wins}W-${r.ga.n - r.ga.wins}L` : null, streak: r.ga ? r.ga.streak : null, wr: r.ga ? r.ga.wr : null, seasonGames: r.ga ? r.ga.seasonGames : null, duo: duoNames.has(r.name), duoWith: duoWith[r.name] || null, duoShared: duoShared[r.name] ?? null, duoRecord: duoRec[r.name] || null, deniedChamp: r.ga ? (r.ga.deniedChamp || null) : null, masteryPts: r.ga ? (r.ga.masteryPts || 0) : 0, flags: r.ga ? [!r.ga.smurf && r.ga.autofill && 'autofill', !r.ga.smurf && r.ga.firstTime && 'first-time', r.ga.otp && 'otp', !r.ga.otp && r.ga.masteryPts >= 150000 && 'mastery', r.ga.otpDenied && 'otp-denied', !r.ga.smurf && r.ga.tilt && 'tilt', r.ga.rusty && 'rusty', r.ga.smurf && 'smurf', r.ga.afkRisk && 'afk-risk'].filter(Boolean) : [], place: null, badge: null, posInferred: true })),
  };
  await db.putAnalysis(matchId, summoner, entry);
  return entry;
}
