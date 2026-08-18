# LoL Matchmaking Fairness

**Was your League of Legends game actually winnable?**

Enter a Riot ID, pick a game (or your **current live game**), and get a fairness verdict — **OK / BORDERLINE / NOT OK** — with a one-line reason and a lane-by-lane matchup table for all 10 players, computed from **pre-game data only** (what everyone looked like *before* the match started, not after).

> Free & open source (MIT). Fork it, self-host it in ~10 minutes on free tiers.

## Features

- 🎯 **Ranked Solo/Duo only** (queue 420) — ARAM and flex never pollute the data
- ⏪ **Pre-game form** for every player: W-L of their 5 ranked games *before* the analyzed match — current form lies, pre-game form doesn't
- ⚖️ **Lane-by-lane matchup table**: champion · player · GA per side, `EVEN` / `BLUE +n` / `RED +n` verdicts, favored-side tinting, and a TEAM footer with the overall call
- 🏷️ **At-a-glance chips** per player: `⚠️ autofill`, `OTP`, `🔗 duo` (proven by shared pre-game match IDs), `🔥/❄️` streaks, color-coded CS/min
- 👑 **MVP / ACE + 1st–10th** in-game performance ranking (KDA, kill participation, damage dealt share, **objective damage**, **damage taken** with an over-death guard, CS, vision — support- and tank-friendly)
- 🔴 **Live game analysis** (spectator-v5): analyze your *current* lobby during loading screen — know by minute 2 which lanes are favored and where to play (roles inferred from each player's history)
- ⭐ **Bookmarked profiles** in the search field's dropdown; with **sign-in (Clerk)** they sync across devices
- 📜 **Analyzed history** per player with pagination beyond the last 10 games
- 🤝 **Shared community cache** (Turso): any game analyzed once is instant and free for everyone, forever
- 🔑 **Bring-your-own-key**: paste your free Riot API key for unlimited analyses; keyless visitors get 3 free deep analyses/day (5 when signed in) on the shared key with a fair-use lock

## How it works

```
Vercel (free tier)
├── Vite static frontend
└── /api serverless functions (Node; only deps: @libsql/client, jose)
    ├── /api/matches    — recent ranked games + cached flags                  (~2s)
    ├── /api/analyze    — deep analysis of ONE game (~80 Riot calls)          (~20–60s, cached forever)
    ├── /api/live       — spectator-v5 lobby of the current game              (~20–60s, cached per game)
    ├── /api/history    — paged archive of analyzed games                     (instant)
    └── /api/bookmarks  — per-account bookmarks (Clerk JWT verified via JWKS)
Turso (free tier, SQLite over HTTP)
├── matches_raw   raw Riot match JSON (shared across all users)
├── analyses      verdicts + full player breakdowns
├── rate_lock     serializes shared-key usage across serverless instances
├── quota         per-IP / per-user daily limits
└── bookmarks     starred profiles per signed-in user
```

All data comes from the official [Riot Games API](https://developer.riotgames.com) — no scraping.

## Self-host / fork

1. **Fork this repo**, then import it on [vercel.com/new](https://vercel.com/new) — leave Root Directory empty; `vercel.json` pins the Vite build and function timeouts.
2. Create a free SQLite database at [turso.tech](https://turso.tech) and copy its URL + auth token.
3. Get a Riot API key at [developer.riotgames.com](https://developer.riotgames.com) (dev keys are free, expire every 24h; a personal key is permanent).
4. Optional accounts: create a free [Clerk](https://clerk.com) app and note its publishable key + frontend API URL.
5. In Vercel → Project → Settings → Environment Variables:

   | Variable | Value |
   |---|---|
   | `RIOT_API_KEY` | shared key for keyless visitors (optional — without it the app is BYOK-only) |
   | `TURSO_DATABASE_URL` | `libsql://your-db.turso.io` |
   | `TURSO_AUTH_TOKEN` | Turso token |
   | `VITE_CLERK_PUBLISHABLE_KEY` | optional — Clerk publishable key (`pk_...`) |
   | `CLERK_ISSUER` | optional — e.g. `https://your-instance.clerk.accounts.dev` |

6. Deploy. Done.

### Local development

```bash
npm install
# terminal 1 — API shim on :3131 (hosts the same serverless functions locally)
RIOT_API_KEY=RGAPI-xxx TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... CLERK_ISSUER=... npm run dev:api
# terminal 2 — Vite on :5173 (proxies /api to :3131)
VITE_CLERK_PUBLISHABLE_KEY=pk_... npx vite
```

## Notes & limits

- Riot dev keys allow ~100 requests / 2 min. One uncached deep analysis ≈ 80 calls; back-to-back analyses on one key pause between games (the UI retries automatically).
- Spectator data has no assigned roles — live-game positions are inferred from each player's recent history and labeled as such.
- The GA score and verdicts are **heuristics**: a "NOT OK" lobby can still be won; the point is knowing when the queue — not you — decided the game.
- Tighten CORS / quotas before heavy public use, and mind [Riot's API policies](https://developer.riotgames.com/policies/general) beyond personal use.
- Champion-meta and bot-lane-synergy data (`lib/champstats.mjs`, `lib/duosynergy.mjs`) are static op.gg snapshots — refresh them once per patch with `node scripts/refresh-snapshots.mjs`.

## License

[MIT](LICENSE) — do whatever you want, attribution appreciated.

*LoL Matchmaking Fairness isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.*
