// GET /api/live?riotId=Name%23TAG&region=euw
// Live lobby analysis via spectator-v5, for a game the player is currently in.
// Same key/quota/lock policy as /api/analyze — live analyses count against the same quota.
// Unlike /api/analyze there's no free pre-key cache short-circuit: the game id (and
// therefore the analysis cache key) isn't known until after the spectator call, which
// needs a key anyway.

import { randomUUID } from 'node:crypto';
import { makeClient, resolveAccount, analyzeLive } from '../lib/riot.mjs';
import { userFromReq } from '../lib/clerk.mjs';
import * as store from '../lib/db.mjs';

export default async function handler(req, res) {
  try {
    await store.init();
    const riotId = String(req.query.riotId || '').trim().replace(/\s*#\s*/, '#');
    const region = String(req.query.region || 'euw').replace(/[^a-z]/g, '');
    if (!riotId.includes('#')) return res.status(400).json({ error: 'riotId (Name#TAG) required' });
    const [name, tag] = riotId.split('#');

    const userKey = req.headers['x-api-key'];
    const sharedKey = process.env.RIOT_API_KEY;
    const ip = (req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();

    let key = userKey;
    let usingShared = false;
    let lockHolder = null;
    let quotaKey = ip;

    if (!key) {
      if (!sharedKey) return res.status(400).json({ error: 'No API key: paste your own Riot key (developer.riotgames.com)' });
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
      const entry = await analyzeLive(c, store, { name, tag, puuid: acct.puuid });
      if (usingShared) await store.incQuota(quotaKey);
      if (entry.inGame === false) return res.status(200).json({ inGame: false });
      if (entry.unsupported) return res.status(200).json({ inGame: true, unsupported: true, queue: entry.queue });
      res.status(200).json({ entry });
    } finally {
      if (lockHolder) await store.releaseLock(lockHolder);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
