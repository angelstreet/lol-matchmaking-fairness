# Roadmap

What's planned, and why. Each item follows the project's existing pattern: static per-patch
snapshot files (`lib/*.mjs`, community-editable, regenerated with `node scripts/refresh-snapshots.mjs`)
feeding a live analysis that only ever calls the Riot API at request time — never a third-party
site.

## Planned

### 1. Performance score, independent of fairness
Every player already gets an in-game performance rating (KDA, kill participation, damage
share, objective share, CS, vision — the formula behind MVP/ACE and the #1–#10 lobby
ranking). Surface it as a plain 0–10 "Performance score" next to each player, shown
regardless of the FAIR/NOT FAIR/FAVORED verdict — "the lobby was rigged, but you played a
7.8/10" should be visible at a glance. No new data source: this is entirely derived from
data already fetched per analysis.

### 2. Meta and pro build reference per matchup
- Recommended runes/items/skill order per champion+role, from a per-patch snapshot (same
  technique as `lib/champstats.mjs`) sourced from deeplol.gg's public build endpoint —
  win-rate-validated, with real sample sizes, refreshed per patch.
- A secondary "pro example" callout when a real pro-associated game exists for this exact
  matchup (opponent champion + build + result), sourced from lolvvv.com the same way.
  Sample sizes are thin for rarely-played champions — shown as an example, not a norm.

### 3. Full-team draft synergy
`lib/duosynergy.mjs` currently covers only ADC+Support. op.gg publishes the same kind of
synergy data for every role. Extend the snapshot to all role pairs, and sum every
same-team pair (10 per game) into one team-level draft-synergy number feeding the
existing `DRAFT` verdict (`GOOD` / `BAD` / `EVEN`) — never the matchmaking-fairness verdict,
which stays about what Riot handed you, not what the team picked.

## Under consideration (not started)

- **A trained comp-vs-comp win-probability model** from a large self-crawled Riot match
  dataset. A 1,000-game proof of concept confirmed the pipeline works (~650 bytes/game,
  ~65k games/day on a single dev key) but also confirmed that pairwise synergy needs
  10–20k+ games per pair to mean anything — the snapshot approach above gets most of the
  value without a crawler or a training pipeline. Revisit if the project ever needs
  live-collected, elo-specific data at real scale.
