// GET /api/analyze?riotId=Name%23TAG&matchId=EUW1_xxx&region=euw
// Order of service: Turso cache (free, instant) → user's own key (immediate)
// → shared server key (per-IP daily quota + global lock; 409 = queued, retry).

import { randomUUID } from 'node:crypto';
import { makeClient, resolveAccount, analyzeMatch } from '../lib/riot.mjs';
import { userFromReq } from '../lib/clerk.mjs';
import * as store from '../lib/db.mjs';

export default async function handler(req, res) {
  // Hoisted above the try so the catch below can report which key was actually in play — a
  // caught Riot error (e.g. the 401/403 "key invalid or expired" from lib/riot.mjs) is otherwise
  // ambiguous about whether it was the user's own pasted key or the shared server key that failed.
  let userKey;
  try {
    await store.init();
    const riotId = String(req.query.riotId || '').trim().replace(/\s*#\s*/, '#');
    const matchId = String(req.query.matchId || '');
    const region = String(req.query.region || 'euw').replace(/[^a-z]/g, '');
    if (!riotId.includes('#') || !matchId) return res.status(400).json({ error: 'riotId (Name#TAG) and matchId required' });
    const [name, tag] = riotId.split('#');
    const summoner = `${name}-${tag}`;

    // 1. shared cache — free for everyone, no key needed, served as-is by default. force=1
    // bypasses the cache for ANY entry (live or already-final) and runs a fresh analysis that
    // putAnalysis overwrites the row with — used both by the list's live→final upgrade path and
    // by the history "re-analyze" button to re-judge an old cached game with the current scoring
    // engine. Without force, a plain "View" click always serves whatever's cached, keylessly.
    const force = req.query.force === '1';
    const cached = await store.getAnalysis(matchId, summoner);
    if (cached && !force) return res.status(200).json({ cached: true, entry: cached });

    userKey = req.headers['x-api-key'];
    const sharedKey = process.env.RIOT_API_KEY;
    const ip = (req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();

    let key = userKey;
    let usingShared = false;
    let lockHolder = null;
    let quotaKey = ip;

    if (!key) {
      if (!sharedKey) return res.status(400).json({ error: 'No API key: paste your own Riot key (developer.riotgames.com)' });
      // signed-in users get a per-account quota (and a bit more of it) instead of per-IP
      const uid = await userFromReq(req);
      quotaKey = uid || ip;
      const q = await store.checkQuota(quotaKey, uid ? 5 : 3);
      if (!q.allowed) return res.status(429).json({ error: `Free limit reached (${q.limit}/day). Paste your own free Riot API key for unlimited analyses.`, quota: q });
      lockHolder = randomUUID();
      if (!(await store.acquireLock(lockHolder))) {
        return res.status(409).json({ queued: true, error: 'The free analyzer is busy — retrying automatically…' });
      }
      key = sharedKey;
      usingShared = true;
    }

    try {
      const c = makeClient(key, region);
      const acct = await resolveAccount(c, name, tag);
      if (!acct) return res.status(404).json({ error: 'account not found' });
      const entry = await analyzeMatch(c, store, { name, tag, puuid: acct.puuid, matchId });
      if (!entry.remake) await store.putAnalysis(matchId, summoner, entry);
      if (usingShared) await store.incQuota(quotaKey);
      res.status(200).json({ cached: false, entry });
    } finally {
      if (lockHolder) await store.releaseLock(lockHolder);
    }
  } catch (e) {
    res.status(500).json({ error: e.message + (userKey ? ' (your pasted key)' : ' (the shared server key)') });
  }
}
