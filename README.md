# LoL Matchmaking Fairness

**Was your League of Legends game actually winnable?**

Enter a Riot ID, pick a game, and get a fairness verdict — **OK / BORDERLINE / NOT OK** — with a one-line reason and an expandable breakdown of all 10 players, computed from **pre-game data only** (what everyone looked like *before* the match started, not after).

> Free & open source (MIT). Fork it, self-host it in ~10 minutes on free tiers.

## Features

- 🎯 **Ranked Solo/Duo only** (queue 420) — ARAM and flex never pollute the data
- ⏪ **Pre-game form** for every player: their 5 ranked games *before* the analyzed match (W/L, KDA, streaks) — current form lies, pre-game form doesn't
- 🔗 **Proven duo detection**: two teammates sharing ≥2 of their 5 pre-game match IDs — evidence, not guessing
- 📊 **GA score (0–100)** per player: form (30) + performance (25) + champion comfort via mastery + recent games (20) + role security with **autofill & first-time-champion flags** (15) + rank vs lobby (10)
- ⚖️ **Role-by-role matchup table**: blue vs red lane by lane, with per-lane fairness and a team-level verdict
- 📜 **Analyzed history** per player with pagination — every game ever analyzed stays available
- 🤝 **Shared community cache** (Turso): any game analyzed once is instant and free for everyone, forever
- 🔑 **Bring-your-own-key model**: users can paste their own free Riot API key for unlimited analyses; keyless visitors get a daily quota on the shared key with a fair-use lock

## How it works

```
Vercel (free tier)
├── Vite frontend (static)
└── /api serverless functions (Node, zero runtime deps except @libsql/client)
    ├── /api/matches   — list recent ranked games + cached flags        (~2s)
    ├── /api/analyze   — deep analysis of ONE game (~80 Riot API calls) (~20–60s, cached forever)
    └── /api/history   — paged archive of analyzed games               (instant)
Turso (free tier, SQLite over HTTP)
├── matches_raw   raw Riot match JSON (shared across all users)
├── analyses      fairness verdicts + full player breakdowns
├── rate_lock     serializes shared-key usage across serverless instances
└── quota         per-IP daily limit for keyless users
```

All data comes from the official [Riot Games API](https://developer.riotgames.com) — no scraping.

## Self-host / fork

1. **Fork this repo**, then import it on [vercel.com/new](https://vercel.com/new) (framework auto-detects as Vite; `vercel.json` pins the build).
2. Create a free SQLite database at [turso.tech](https://turso.tech) and copy its URL + auth token.
3. Get a Riot API key at [developer.riotgames.com](https://developer.riotgames.com) (dev keys are free and expire every 24h; apply for a personal key for a permanent one).
4. In Vercel → Project → Settings → Environment Variables:

   | Variable | Value |
   |---|---|
   | `RIOT_API_KEY` | your shared key for keyless visitors (optional — without it the app is BYOK-only) |
   | `TURSO_DATABASE_URL` | `libsql://your-db.turso.io` |
   | `TURSO_AUTH_TOKEN` | Turso token |

5. Deploy. Done.

### Local development

```bash
npm install
# terminal 1 — API shim on :3131 (hosts the same serverless functions locally)
RIOT_API_KEY=RGAPI-xxx TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run dev:api
# terminal 2 — Vite on :5173 (proxies /api to :3131)
npx vite
```

## Notes & limits

- Riot dev keys allow ~100 requests / 2 min. One uncached deep analysis ≈ 80 calls, so back-to-back analyses on one key will pause between games — the UI shows progress and retries automatically.
- The GA score and verdicts are **heuristics**: a "NOT OK" lobby can still be won; the point is knowing when the queue — not you — decided the game.
- Tighten CORS / add your domain before heavy public use, and mind [Riot's API policies](https://developer.riotgames.com/policies/general) if you grow beyond personal use.

## License

[MIT](LICENSE) — do whatever you want, attribution appreciated.

*LoL Matchmaking Fairness isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.*
