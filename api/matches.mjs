// GET /api/matches?riotId=Name%23TAG&games=5&region=euw
// Cheap funnel endpoint: resolves the account, lists last N ranked-solo games with
// per-game summary (W/L, champ, KDA) and whether a cached analysis already exists.

import { makeClient, resolveAccount, listMatchIds, fetchMatch, pStats } from '../lib/riot.mjs';
import * as store from '../lib/db.mjs';

export default async function handler(req, res) {
  try {
    await store.init();
    const riotId = String(req.query.riotId || '').trim().replace(/\s*#\s*/, '#');
    const games = Math.min(10, parseInt(req.query.games || '5', 10));
    const region = String(req.query.region || 'euw').replace(/[^a-z]/g, '');
    const key = req.headers['x-api-key'] || process.env.RIOT_API_KEY;
    if (!riotId.includes('#')) return res.status(400).json({ error: 'riotId must be Name#TAG' });
    if (!key) return res.status(400).json({ error: 'no API key available' });

    const [name, tag] = riotId.split('#');
    const c = makeClient(key, region);
    const acct = await resolveAccount(c, name, tag);
    if (!acct) return res.status(404).json({ error: 'account not found' });
    // Remakes (game ends in the first 5 min, no LP/analysis value) are excluded from the list
    // entirely rather than shown as a dead row — so request a few extra ids up front to backfill
    // whatever remakes eat into the requested count. If even that buffer isn't enough (rare —
    // would need 5 remakes in a row), we just return however many real games we found.
    const ids = await listMatchIds(c, acct.puuid, games + 4);
    const summoner = `${name}-${tag}`;

    const out = [];
    for (const id of ids) {
      if (out.length >= games) break;
      const cachedAnalysis = await store.getAnalysis(id, summoner);
      // A live-only cached entry (from mid-game) doesn't count as analyzed yet — fall through
      // to the normal uncached path so the row still gets an "Analyze" button for the final pass.
      // (analyze.mjs never caches a remake, so a cached entry here is never one.)
      if (cachedAnalysis && !cachedAnalysis.live) { out.push({ matchId: id, cached: true, ...pick(cachedAnalysis) }); continue; }
      const m = await fetchMatch(c, store, id); // 1 Riot call if raw not cached
      const me = m && pStats(m, acct.puuid);
      if (me?.remake) continue; // skip — doesn't count toward the requested total
      out.push({
        matchId: id, cached: false, wasLive: !!cachedAnalysis,
        result: me ? (me.win ? 'Victory' : 'Defeat') : '?',
        champ: me?.champ, kda: me ? `${me.k}/${me.d}/${me.a}` : '',
        when: m ? new Date(m.info.gameStartTimestamp).toISOString() : null,
        duration: m ? `${Math.floor(m.info.gameDuration / 60)}m ${String(m.info.gameDuration % 60).padStart(2, '0')}s` : '',
      });
    }
    res.status(200).json({ puuid: acct.puuid, summoner, games: out });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

const pick = a => ({ result: a.result, champ: a.user?.champ, kda: a.user?.kda, when: a.when, duration: a.duration, matchmaking: a.matchmaking, oneLiner: a.oneLiner });
