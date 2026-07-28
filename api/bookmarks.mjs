// GET  /api/bookmarks                     → { bookmarks: [{riotId, region}] }
// POST /api/bookmarks {op, riotId, region} op = 'add' | 'remove'
// Requires a Clerk session token (Authorization: Bearer ...). 401 otherwise.

import { userFromReq } from '../lib/clerk.mjs';
import * as store from '../lib/db.mjs';

export default async function handler(req, res) {
  try {
    await store.init();
    const uid = await userFromReq(req);
    if (!uid) return res.status(401).json({ error: 'sign in to sync bookmarks' });

    if (req.method === 'POST') {
      const body = await readBody(req);
      const riotId = String(body.riotId || '').trim().replace(/\s*#\s*/, '#');
      const region = String(body.region || 'euw').replace(/[^a-z]/g, '');
      if (!riotId.includes('#')) return res.status(400).json({ error: 'riotId must be Name#TAG' });
      if (body.op === 'remove') await store.removeBookmark(uid, riotId);
      else await store.addBookmark(uid, riotId, region);
    }
    res.status(200).json({ bookmarks: await cleanedBookmarks(uid) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// Normalizes + dedupes a user's stored bookmarks (case-insensitively, keeping the earliest row
// per Riot ID) and self-cleans Turso: rows saved with a raw, non-normalized riot_id (e.g.
// "Name #TAG" from before normalization was applied everywhere) get migrated to the normalized
// id — added if that row doesn't already exist, then the stale raw row deleted — so this only
// has to run once per stray row.
async function cleanedBookmarks(uid) {
  const raw = await store.listBookmarks(uid);
  const seen = new Map();
  const stale = [];
  for (const b of raw) {
    const norm = String(b.riotId || '').trim().replace(/\s*#\s*/, '#');
    if (b.riotId !== norm) stale.push(b.riotId);
    const key = norm.toLowerCase();
    if (!seen.has(key)) seen.set(key, { riotId: norm, region: b.region });
  }
  const cleaned = [...seen.values()];
  if (stale.length) {
    for (const b of cleaned) await store.addBookmark(uid, b.riotId, b.region); // ensure normalized rows exist first
    for (const rawId of stale) await store.removeBookmark(uid, rawId);
  }
  return cleaned;
}

function readBody(req) {
  if (req.body) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
