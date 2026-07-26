# LoL Matchmaking Fairness

Was your last League of Legends game winnable? Enter a Riot ID and get a **fairness verdict per game** (OK / BORDERLINE / NOT OK) with a one-line reason, plus an expandable op.gg-style breakdown of all 10 players — computed from **pre-game data only**.

- **Ranked Solo/Duo only** (queue 420) — ARAM and flex are never mixed in
- **Pre-game form** for every player: their 5 ranked games *before* the analyzed match (W/L, KDA, streak) — not their form now
- **Proven duo detection**: two teammates sharing ≥2 of their 5 pre-game match IDs
- **GA score (0–100)** per player: form (30) + performance (25) + champion comfort via mastery & recent games (20) + role security / autofill detection (15) + rank vs lobby (10)
- **Fairness verdict** per game from tier spreads, team GA gap, duo asymmetry, and first-time-champion count
- Local JSON cache — a game is analyzed once, ever; repeat queries are instant

Data source: the official [Riot Games API](https://developer.riotgames.com) (no scraping).

## Structure

```
backend/    Node (zero-dependency) API server + analysis engine — run with pm2
frontend/   Vite app (static) — deploy to Vercel
```

## Backend (pm2)

```bash
cd backend
# set your Riot API key in the environment (dev keys expire every 24h — never commit them)
export RIOT_API_KEY=RGAPI-xxxx        # PowerShell: $env:RIOT_API_KEY='RGAPI-xxxx'
pm2 start ecosystem.config.cjs
```

API: `GET /api/scout?riotId=Name%23TAG&games=5&region=euw` → JSON, `GET /api/health`.
CLI without the server: `node scout.mjs "Name#TAG" --games 5 --json`.

Note: Riot dev keys allow ~100 requests/2 min; a deep analysis of one uncached game is ~80 calls, so expect 1–2 minutes per new game. Set `CORS_ORIGIN` in `ecosystem.config.cjs` to your Vercel domain in production.

## Frontend (Vite → Vercel)

```bash
cd frontend
npm install
npm run dev            # local, expects backend on http://localhost:3131
```

Deploy on Vercel: import the repo, set **Root Directory = `frontend`**, and add env var `VITE_API_URL=https://your-backend-host:3131` (the pm2 machine, reachable from the internet).

## Disclaimer

Not endorsed by Riot Games. GA scores and verdicts are heuristics — a "NOT OK" lobby can still be won, it just wasn't fair.
