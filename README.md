# Run! Flavinho! Run!

A countdown to **2027-01-01 00:00 (Brasília)** embedded in a fullscreen,
Pac-Man-style pixel-art chase game. Vanilla JS (ES modules) + Canvas 2D, with
no build step, hosted on GitHub Pages. The global TOP 100 ranking uses a
Cloudflare Worker (write path) and a scheduled GitHub Action that rebuilds
`data/ranking.json` (read path).

```
index.html, css/style.css
js/main.js        bootstrap, state machine, fixed-timestep loop, HUD
js/game.js        CONFIG (all tuning) + simulation: movement, spawns, scoring
js/map.js         seeded mirrored maze generator, tunnels, layout
js/ai.js          BFS pathing, cop behaviors, spawn selection
js/render.js      low-res offscreen canvas renderer
js/sprites.js     pixel-art sprites + NES palette
js/input.js       keyboard, D-pad, swipes
js/audio.js       Web Audio chiptune + SFX
js/countdown.js   countdown (supports ?now=)
js/ranking.js     ranking fetch/submit + game-over modal
js/share.js       share score (social links, native share, copy)
js/config.js      feature flags (generated on deploy, see below)
js/fireworks.js   end-of-countdown fireworks
data/ranking.json published ranking (TOP 100)
data/blocklist.txt offensive-name filter list
worker/           Cloudflare Worker (submit / pending / ack)
scripts/build-ranking.js  ranking builder used by the Action
scripts/reset-ranking.js  empties the ranking (daily reset)
scripts/write-config.js   writes js/config.js from env vars (deploy)
.github/workflows/        deploy.yml (Pages), ranking.yml (every 15 min), reset-ranking.yml (daily)
```

## Run locally

Any static server works. ES modules don't load from `file://`.

```bash
python3 -m http.server 8080      # or: npm start  (npx serve)
# open http://localhost:8080
```

Debug the end state with the `?now=` override (time keeps flowing from it):

- `http://localhost:8080/?now=2026-12-31T23:59:50-03:00`: watch it reach zero
- `http://localhost:8080/?now=2027-02-01T00:00:00-03:00`: already expired

Controls: arrow keys / WASD; on touch devices in landscape, the D-pad or swipes.

## Tuning

All gameplay constants are in the `CONFIG` object at the top of
[`js/game.js`](js/game.js):

- Player and cop speeds, and the per-level speed increase and cap
- Spawn backoff (`BASE_INTERVAL`, `BACKOFF_FACTOR`), `MAX_COPS`, `MIN_SPAWN_DIST`
- AI repath timing, the wanderer's aggro range, the hitbox and score multipliers

Maze shape constants (loop chance, column limits) are in `MAZE` in
[`js/map.js`](js/map.js).

## Deploy to GitHub Pages

1. Push this repo to GitHub (branch `main`).
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. `deploy.yml` runs on every push to `main`, and can also be run manually. It
   publishes `index.html`, `css/`, `js/` and `data/ranking.json`.

## Ranking feature flag

The ranking can be turned off without touching the game code. Set the
repository variable **Settings → Secrets and variables → Actions → Variables →
`RANKING_ENABLED`** to `false` (`0`, `off` and `no` also work). Then run
**Deploy to GitHub Pages** manually so the new value is published. If the
variable is unset or set to anything else, the ranking stays on.

`deploy.yml` runs `scripts/write-config.js`, which turns the variable into
`js/config.js`. With the ranking off:

- the game-over modal only shows the score and "Jogar novamente": no name form,
  no TOP 100, and no request to `data/ranking.json`;
- the "Ver ranking" button does not appear when the countdown ends;
- `ranking.yml` and `reset-ranking.yml` skip their jobs.

The Worker is left as is. The client simply stops calling it. Locally, edit
`js/config.js`, or run `RANKING_ENABLED=false npm run config` (don't commit the
result).

## Deploy the Cloudflare Worker

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create RANKING_KV
#   → copy the printed id into wrangler.toml ([[kv_namespaces]] id = "...")
```

Edit `wrangler.toml` and set `ALLOWED_ORIGIN` to your Pages origin. Use only
the scheme and host, with no path. It is currently
`https://custom-domain.com,https://your-user.github.io`. Add
`,http://localhost:8080` if you want to test submissions locally.

```bash
# Generate a long random token and keep it: the Action needs the same value.
openssl rand -hex 32
npx wrangler secret put WORKER_TOKEN
npx wrangler deploy
#   → https://run-flavinho-ranking.<subdomain>.workers.dev
```

Then put that URL in `WORKER_URL` at the top of
[`js/ranking.js`](js/ranking.js) and push.

Endpoints:

| Method | Path       | Auth          | Purpose                                                    |
|--------|------------|---------------|------------------------------------------------------------|
| POST   | `/submit`  | allowed Origin | `{ name, score }` → validates, rate-limits (3/min/IP), queues, `202` |
| GET    | `/pending` | Bearer token  | queued submissions `{ items: [{ key, name, score, ts }] }`  |
| POST   | `/ack`     | Bearer token  | `{ keys: [...] }` → deletes processed submissions          |

Quick test:

```bash
curl -i -X POST "$WORKER_URL/submit" -H 'Origin: https://custom-domain.com' \
  -H 'Content-Type: application/json' -d '{"name":"Teste","score":123}'
curl -s "$WORKER_URL/pending" -H "Authorization: Bearer $WORKER_TOKEN"
```

The free tier allows 1,000 KV writes/day. Each submission uses 2 writes (the
queue entry plus the rate-limit counter), and each ack uses 1 delete per entry.

## GitHub Actions secrets

In **Settings → Secrets and variables → Actions**, add:

- `WORKER_URL`: the Worker base URL (no trailing slash)
- `WORKER_TOKEN`: the same token you set with `wrangler secret put`

`ranking.yml` runs every 15 minutes (GitHub may delay scheduled runs), and can
also be run manually from the Actions tab:

1. `scripts/build-ranking.js` fetches `/pending` and drops invalid or offensive
   names. Matching runs after normalizing accents, leetspeak and repeated
   letters, using `data/blocklist.txt`. It then merges with
   `data/ranking.json`, sorts by score (ties go to the earliest timestamp) and
   keeps the TOP 100.
2. If the file changed, the workflow commits it and redeploys Pages by calling
   `deploy.yml`. This is needed because pushes made with `GITHUB_TOKEN` don't
   trigger other workflows.
3. Once the push succeeds, it acks the processed submissions.

Test the builder locally without a Worker:

```bash
echo '{"items":[{"key":"sub:1:a","name":"Maria","score":500,"ts":1}]}' > /tmp/p.json
PENDING_FILE=/tmp/p.json node scripts/build-ranking.js
```

## Daily ranking reset

`reset-ranking.yml` empties the ranking every day at **00:00 Brasília time**
(cron `0 3 * * *` in UTC), and can also be run manually from the Actions tab.
It uses the same secrets as `ranking.yml` and the same concurrency group, so a
build never overlaps a reset. It:

1. Writes `[]` to `data/ranking.json` and commits it (only if it wasn't
   already empty).
2. Discards all submissions still queued in the Worker, so scores from the
   previous day don't reappear on the next build.
3. Redeploys Pages.

Run it by hand:

```bash
npm run reset:ranking                                    # empty the file (+ purge the queue if WORKER_* are set)
node scripts/reset-ranking.js --keep-pending             # empty the file only
WORKER_URL=... WORKER_TOKEN=... node scripts/reset-ranking.js --purge-only   # purge the queue only
```

To change the schedule, edit the `cron` line in
`.github/workflows/reset-ranking.yml` (UTC; Brasília = UTC−3).

## Notes

- A new random maze is generated on each page load. It stays the same for
  replays and when the window is resized mid-session.
- Submitted scores show locally as "pendente" until they appear in the
  published `ranking.json`.
- Scores are computed client-side, so a determined player can forge one. The
  Worker only enforces sanity limits and rate limiting.
