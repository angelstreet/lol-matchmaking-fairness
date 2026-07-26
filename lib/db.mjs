// lib/db.mjs — Turso (libSQL) storage: shared analysis cache, raw match cache,
// shared-key rate lock, and per-IP daily quota for keyless users.

import { createClient } from '@libsql/client';

let client = null;
let ready = null;

function db() {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL not set');
    client = createClient({ url, authToken });
  }
  return client;
}

export function init() {
  if (!ready) ready = (async () => {
    await db().batch([
      `CREATE TABLE IF NOT EXISTS matches_raw (match_id TEXT PRIMARY KEY, json TEXT NOT NULL, fetched_at TEXT DEFAULT (datetime('now')))`,
      `CREATE TABLE IF NOT EXISTS analyses (match_id TEXT NOT NULL, summoner TEXT NOT NULL, json TEXT NOT NULL, analyzed_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (match_id, summoner))`,
      `CREATE TABLE IF NOT EXISTS rate_lock (id INTEGER PRIMARY KEY CHECK (id = 1), holder TEXT, expires_at INTEGER)`,
      `CREATE TABLE IF NOT EXISTS quota (ip TEXT NOT NULL, day TEXT NOT NULL, used INTEGER DEFAULT 0, PRIMARY KEY (ip, day))`,
      `CREATE TABLE IF NOT EXISTS bookmarks (user_id TEXT NOT NULL, riot_id TEXT NOT NULL, region TEXT DEFAULT 'euw', created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (user_id, riot_id))`,
    ], 'write');
    await db().execute({ sql: `INSERT OR IGNORE INTO rate_lock (id, holder, expires_at) VALUES (1, NULL, 0)`, args: [] });
  })();
  return ready;
}

export async function getRaw(matchId) {
  const r = await db().execute({ sql: `SELECT json FROM matches_raw WHERE match_id = ?`, args: [matchId] });
  return r.rows.length ? JSON.parse(r.rows[0].json) : null;
}
export async function putRaw(matchId, obj) {
  await db().execute({ sql: `INSERT OR REPLACE INTO matches_raw (match_id, json) VALUES (?, ?)`, args: [matchId, JSON.stringify(obj)] });
}

export async function getAnalysis(matchId, summoner) {
  const r = await db().execute({ sql: `SELECT json FROM analyses WHERE match_id = ? AND summoner = ?`, args: [matchId, summoner] });
  return r.rows.length ? JSON.parse(r.rows[0].json) : null;
}
export async function anyAnalysis(matchId) {
  const r = await db().execute({ sql: `SELECT summoner FROM analyses WHERE match_id = ? LIMIT 1`, args: [matchId] });
  return r.rows.length ? r.rows[0].summoner : null;
}
export async function putAnalysis(matchId, summoner, obj) {
  await db().execute({ sql: `INSERT OR REPLACE INTO analyses (match_id, summoner, json) VALUES (?, ?, ?)`, args: [matchId, summoner, JSON.stringify(obj)] });
}

// Paged history of analyzed games for one summoner, newest first. Live analyses are stored
// under their real match id and DO show up here (upgraded to a final analysis in place once
// re-analyzed). The 'LIVE_%' filter only hides legacy rows from before that change.
export async function listAnalyses(summoner, limit = 10, offset = 0) {
  const r = await db().execute({
    sql: `SELECT json FROM analyses WHERE summoner = ? AND match_id NOT LIKE 'LIVE_%' ORDER BY json_extract(json, '$.when') DESC LIMIT ? OFFSET ?`,
    args: [summoner, limit, offset],
  });
  return r.rows.map(row => JSON.parse(row.json));
}
export async function countAnalyses(summoner) {
  const r = await db().execute({ sql: `SELECT COUNT(*) AS c FROM analyses WHERE summoner = ? AND match_id NOT LIKE 'LIVE_%'`, args: [summoner] });
  return Number(r.rows[0]?.c ?? 0);
}

// Atomic lock for the shared API key: succeeds only if free or expired. TTL guards against crashed holders.
export async function acquireLock(holder, ttlMs = 240000) {
  const now = Date.now();
  const r = await db().execute({
    sql: `UPDATE rate_lock SET holder = ?, expires_at = ? WHERE id = 1 AND (expires_at < ? OR holder = ?)`,
    args: [holder, now + ttlMs, now, holder],
  });
  return r.rowsAffected > 0;
}
export async function releaseLock(holder) {
  await db().execute({ sql: `UPDATE rate_lock SET holder = NULL, expires_at = 0 WHERE id = 1 AND holder = ?`, args: [holder] });
}

// Per-IP daily quota for keyless users. Returns { allowed, used, limit }.
export async function checkQuota(ip, limit = 3) {
  const day = new Date().toISOString().slice(0, 10);
  await db().execute({ sql: `INSERT OR IGNORE INTO quota (ip, day, used) VALUES (?, ?, 0)`, args: [ip, day] });
  const r = await db().execute({ sql: `SELECT used FROM quota WHERE ip = ? AND day = ?`, args: [ip, day] });
  const used = r.rows[0]?.used ?? 0;
  return { allowed: used < limit, used, limit };
}
export async function incQuota(ip) {
  const day = new Date().toISOString().slice(0, 10);
  await db().execute({ sql: `UPDATE quota SET used = used + 1 WHERE ip = ? AND day = ?`, args: [ip, day] });
}

// Bookmarked profiles per authenticated (Clerk) user.
export async function listBookmarks(userId) {
  const r = await db().execute({ sql: `SELECT riot_id, region FROM bookmarks WHERE user_id = ? ORDER BY created_at`, args: [userId] });
  return r.rows.map(x => ({ riotId: x.riot_id, region: x.region }));
}
export async function addBookmark(userId, riotId, region) {
  await db().execute({ sql: `INSERT OR REPLACE INTO bookmarks (user_id, riot_id, region) VALUES (?, ?, ?)`, args: [userId, riotId, region] });
}
export async function removeBookmark(userId, riotId) {
  await db().execute({ sql: `DELETE FROM bookmarks WHERE user_id = ? AND riot_id = ?`, args: [userId, riotId] });
}
