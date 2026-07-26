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
      const riotId = String(body.riotId || '');
      const region = String(body.region || 'euw').replace(/[^a-z]/g, '');
      if (!riotId.includes('#')) return res.status(400).json({ error: 'riotId must be Name#TAG' });
      if (body.op === 'remove') await store.removeBookmark(uid, riotId);
      else await store.addBookmark(uid, riotId, region);
    }
    res.status(200).json({ bookmarks: await store.listBookmarks(uid) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function readBody(req) {
  if (req.body) return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
