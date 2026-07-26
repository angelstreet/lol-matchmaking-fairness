// dev-server.mjs — local shim that hosts the Vercel /api functions on :3131.
// Vite dev proxies /api here (see vite.config.js). Not used in production.
// Env needed: RIOT_API_KEY (optional if BYOK), TURSO_DATABASE_URL, TURSO_AUTH_TOKEN.

import { createServer } from 'node:http';
import matches from './api/matches.mjs';
import analyze from './api/analyze.mjs';
import history from './api/history.mjs';
import bookmarks from './api/bookmarks.mjs';

const PORT = process.env.PORT || 3131;
const routes = { '/api/matches': matches, '/api/analyze': analyze, '/api/history': history, '/api/bookmarks': bookmarks };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // minimal Vercel-style req/res polyfill
  req.query = Object.fromEntries(url.searchParams);
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => { res.setHeader('content-type', 'application/json'); res.setHeader('access-control-allow-origin', '*'); res.end(JSON.stringify(obj)); };
  const fn = routes[url.pathname];
  if (!fn) return res.status(404).json({ error: 'not found' });
  try { await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); }
}).listen(PORT, () => console.log(`fairness dev API on http://localhost:${PORT}`));
