# CLAUDE.md

Guidance for working in this repo. `README.md` has the full setup/deploy runbook; `.claude/commands/create.md` is the original product spec (`/create`).

## What this is

**Run! Flavinho, run!** — a single-page site that shows a countdown to **2027-01-01 00:00 Brasília (UTC−3)** embedded in a fullscreen, Pac-Man-style pixel-art chase game (the player runs from cops). The countdown lives inside a walled block at the center of the maze. When it hits zero the game ends for good ("Perdeu Playboy" + fireworks).

There are three independent parts:

1. **Static site** (`index.html`, `css/`, `js/`, `assets/`) — vanilla JS ES modules + Canvas 2D, **no build step, no dependencies**, hosted on GitHub Pages.
2. **Cloudflare Worker** (`worker/`) — the ranking *write* path: `POST /submit` queues scores in KV; `GET /pending` and `POST /ack` (Bearer token) drain the queue.
3. **Node scripts + GitHub Actions** (`scripts/`, `.github/workflows/`) — the ranking *read* path: every 15 min an Action pulls pending submissions, filters them, merges into `data/ranking.json` (TOP 100), commits and redeploys Pages. A daily job at 00:00 Brasília resets the ranking.

## Conventions

- **All user-facing text is Brazilian Portuguese** (the `<title>` stays in English). Code, comments and docs are in English.
- No frameworks, bundlers or npm runtime deps. Node ≥ 20 is only for `scripts/`.
- Each JS file opens with a short header comment describing its role; keep that style.
- `localStorage` keys use the `rfr_` prefix (`rfr_muted`, `rfr_crt`, `rfr_pending`, `rfr_mine`) and every access is wrapped in `try/catch`.
- Target 60 fps on desktop and mobile (incl. iOS Safari); mobile is landscape-only (portrait shows a rotate overlay and pauses).

## Running

```bash
npm start                       # npx serve on :8080 (or: python3 -m http.server 8080)
```

ES modules don't load from `file://`. Useful URL overrides: `?now=2026-12-31T23:59:50-03:00` (watch it hit zero) or a date after the target (already expired).

There is no test suite or linter. Verify changes by running the page. The ranking builder can be tested offline:

```bash
echo '{"items":[{"key":"sub:1:a","name":"Maria","score":500,"ts":1}]}' > /tmp/p.json
PENDING_FILE=/tmp/p.json node scripts/build-ranking.js
```

## Client architecture (`js/`)

`main.js` is the entry point and owns the state machine: `READY` (splash / start button) → `PLAYING` → `GAME_OVER` (modal) → `PLAYING` … → `EXPIRED`. It runs a fixed-timestep loop (`STEP = 1/60`, accumulator, `MAX_STEPS = 5`), handles layout/resize, pause on `visibilitychange`, the DOM HUD, mute and CRT toggles.

| File | Role |
|------|------|
| `game.js` | `CONFIG` (**all gameplay tuning**) and the `Game` simulation: movement, cop spawning with backoff, difficulty levels, collision, scoring/multiplier |
| `map.js` | Seeded (`mulberry32`) mirrored maze generator, tunnels, `computeLayout`; tile types `FLOOR`/`WALL`/`BLOCK`; `MAZE` shape constants |
| `ai.js` | BFS flow fields, line of sight, the four cop behaviors (`chaser`, `ambusher`, `flanker`, `wanderer`), spawn tile selection |
| `render.js` | Draws to a low-res offscreen canvas, upscaled with smoothing off |
| `sprites.js` | Procedural pixel-art sprites from arrays, `NES` palette, `TILE_PX = 16` |
| `input.js` | Keyboard (arrows/WASD), on-screen D-pad, swipes |
| `audio.js` | Web Audio chiptune music + SFX (siren, caught, fireworks crackle) |
| `countdown.js` | `TARGET` date, `?now=` offset, `DD dias HH:MM:SS` formatting |
| `ranking.js` | `WORKER_URL`, fetch `data/ranking.json`, submit score, game-over modal; pending submissions shown locally as "pendente" |
| `share.js` | Share score (social links, Web Share API, copy) |
| `fireworks.js` | End-of-countdown fireworks |
| `config.js` | Feature flags — **generated at deploy time**, see below |

Positions in the simulation are in tile units; integer coordinates are tile centers. One maze seed is generated per page load and reused for replays and resizes.

## Feature flag: `RANKING_ENABLED`

`js/config.js` is overwritten in CI by `scripts/write-config.js` from the GitHub repo variable `RANKING_ENABLED` (`false`/`0`/`off`/`no` → off; anything else, including unset, → on). The committed copy is only the local default — don't commit a regenerated version by accident. When off: no name form, no TOP 100 fetch, no "Ver ranking" button, and `ranking.yml` / `reset-ranking.yml` skip.

## Ranking pipeline

- `worker/src/index.js`: validates `{ name, score }` (name ≤ 50, score ≤ 1e8, body ≤ 1 KB), CORS-checks `ALLOWED_ORIGIN`, rate-limits 3/min/IP, stores in `RANKING_KV`. Config in `worker/wrangler.toml`; `WORKER_TOKEN` is a secret.
- `scripts/build-ranking.js`: fetch `/pending` → validate → drop offensive names (`data/blocklist.txt`, matched after normalizing accents/leetspeak/repeats; `=term` lines match whole words only) → merge, sort by score desc then earliest `ts`, dedupe, keep 100 → write `data/ranking.json`. `--ack` deletes processed keys (stored in `.ranking-ack.json`) *after* the commit is pushed.
- `scripts/reset-ranking.js`: empties `ranking.json` and purges the Worker queue (`--keep-pending`, `--purge-only` split the two steps).
- Validation limits are duplicated in the Worker and the builder — keep them in sync.
- Scores are computed client-side; the server only enforces sanity limits.

## Deploy

- `deploy.yml`: on push to `main` (or called by the ranking workflows, since `GITHUB_TOKEN` pushes don't trigger workflows) assembles `_site/` from `index.html`, `css/`, `js/`, `assets/`, generated `js/config.js` and `data/ranking.json`. **New top-level files/dirs the site needs must be added there.**
- `ranking.yml` (`*/15 * * * *`) and `reset-ranking.yml` (`0 3 * * *` UTC) share the `ranking` concurrency group. Both need secrets `WORKER_URL`, `WORKER_TOKEN`.
- Worker deploys separately with `npx wrangler deploy` from `worker/`.
