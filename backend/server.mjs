#!/usr/bin/env node
// LoL Matchmaking Fairness — API server (run under pm2, consumed by the Vite frontend).
// GET /api/scout?riotId=Name%23TAG&games=5   → JSON array of analyzed games
// GET /api/health                            → { ok: true }
// Auth: RIOT_API_KEY env var on the server, or per-request 'x-api-key' header.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(DIR, 'scout.mjs');
const PORT = process.env.PORT || 3131;
const CORS = {
  'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
  'Access-Control-Allow-Headers': 'x-api-key, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

let busy = false; // the scout writes data/games.json — one run at a time

createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  const json = (code, obj) => { res.writeHead(code, { ...CORS, 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

  if (url.pathname === '/api/health') return json(200, { ok: true, busy });

  if (url.pathname === '/api/scout') {
    const riotId = url.searchParams.get('riotId') || '';
    const games = Math.min(10, parseInt(url.searchParams.get('games') || '5', 10));
    const region = (url.searchParams.get('region') || 'euw').replace(/[^a-z]/g, '');
    const key = process.env.RIOT_API_KEY || req.headers['x-api-key'];
    if (!riotId.includes('#')) return json(400, { error: 'riotId must be Name#TAG' });
    if (!key) return json(400, { error: 'No API key: set RIOT_API_KEY on the server or fill the key field' });
    if (busy) return json(409, { error: 'A scout is already running, try again in a minute' });
    busy = true;
    const child = spawn(process.execPath, [SCRIPT, riotId, '--games', String(games), '--region', region, '--mode', 'deep', '--json'], {
      env: { ...process.env, RIOT_API_KEY: key },
    });
    let out = '', errLog = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => { errLog += d; process.stderr.write(d); });
    child.on('close', code => {
      busy = false;
      if (code === 0) { res.writeHead(200, { ...CORS, 'content-type': 'application/json' }); res.end(out); }
      else json(500, { error: errLog.slice(-500) || 'scout failed' });
    });
    return;
  }
  json(404, { error: 'not found' });
}).listen(PORT, () => console.log(`LoL Matchmaking Fairness API on http://localhost:${PORT}`));
