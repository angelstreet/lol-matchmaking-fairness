// GET /api/history?riotId=Name%23TAG&offset=0&limit=10
// Paged list of this summoner's already-analyzed games from the Turso cache
// (no Riot calls, no key needed — history is always free).

import * as store from '../lib/db.mjs';

export default async function handler(req, res) {
  try {
    await store.init();
    const riotId = String(req.query.riotId || '').trim().replace(/\s*#\s*/, '#');
    const offset = Math.max(0, parseInt(req.query.offset || '0', 10));
    const limit = Math.min(10, Math.max(1, parseInt(req.query.limit || '10', 10)));
    if (!riotId.includes('#')) return res.status(400).json({ error: 'riotId must be Name#TAG' });
    const summoner = riotId.replace('#', '-');

    const [total, entries] = await Promise.all([
      store.countAnalyses(summoner),
      store.listAnalyses(summoner, limit, offset),
    ]);
    res.status(200).json({
      total, offset, limit,
      games: entries.map(a => ({
        matchId: a.matchId, cached: true, live: !!a.live,
        result: a.result, champ: a.user?.champ, kda: a.user?.kda,
        when: a.when, duration: a.duration,
        matchmaking: a.matchmaking, direction: a.direction, verdictTooltip: a.verdictTooltip, oneLiner: a.oneLiner,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
