# Project: "Run! Flavinho, run!" — Countdown + Pixel-Art Chase Game

Build a single-page website, hosted on **GitHub Pages**, that combines a countdown
timer with a fullscreen 2D pixel-art "cops and robbers" chase game in the style of
Pac-Man. The countdown sits at the center of the screen, embedded in the game map.

All user-facing text must be in **Brazilian Portuguese**, except the page title,
which stays in English.

---

## 1. Tech stack & constraints

- **Vanilla JavaScript (ES modules) + HTML5 Canvas 2D**. No framework and no build
  step for the site itself, so it deploys as-is to GitHub Pages.
- Must run smoothly (60 fps target) on **desktop and mobile** browsers (Chrome,
  Safari iOS, Firefox, Edge).
- Use `requestAnimationFrame` with a **fixed-timestep** game loop
  (accumulator pattern) so speed is frame-rate independent.
- Render the game to a low-resolution offscreen canvas and scale it up with
  `imageSmoothingEnabled = false` to get crisp pixel art. Handle `devicePixelRatio`.
- Pause the game automatically when the tab is hidden (`visibilitychange`).
- No external assets are required. Draw sprites procedurally from pixel arrays
  in code, or use a single small PNG spritesheet included in the repo.
- Font: **"Press Start 2P"** from Google Fonts.
- Project structure:
  ```
  /index.html
  /css/style.css
  /js/main.js, game.js, map.js, ai.js, render.js, input.js, audio.js,
     countdown.js, ranking.js, fireworks.js
  /data/ranking.json
  /worker/            (Cloudflare Worker source)
  /.github/workflows/ (ranking build + Pages deploy)
  /scripts/build-ranking.js
  /README.md          (setup and deploy instructions)
  ```

---

## 2. Layout

- The game canvas occupies **100% of viewport width and height** (`100dvw` / `100dvh`),
  with no scrollbars. Recompute the tile size on resize and orientation change.
- **Top center**: the page title **"Run! Flavinho, run!"** in the pixel font. Also
  set it as the `<title>`.
- **Top right**: the live score, formatted like `PONTOS: 001230`, plus the current
  multiplier (e.g. `x1.5`).
- **Top left**: a mute/unmute button.
- **Center**: the countdown, rendered inside a rectangular block that is **part of
  the maze**. The block is a solid walled area that neither the player nor the cops
  can enter, much like the ghost house in Pac-Man. Inside it:
  - The countdown in the format `DD dias HH:MM:SS`.
  - Directly below, the text **"Para o fim do foro privilegiado!"**
- HUD elements must not overlap playable corridors. Reserve a top margin row for them.
- Mobile in **landscape orientation**:
  - Show a semi-transparent **virtual D-pad** (up/down/left/right) in the bottom-left
    corner, sized for thumbs (≥ 48 px per button), using touch/pointer events with
    `touch-action: none`.
  - In portrait orientation, show an overlay asking the user to rotate the device
    ("Gire o celular para jogar"). The countdown stays visible behind the overlay.

---

## 3. Countdown

- Target: **2027-01-01T00:00:00-03:00** (Brasília time), regardless of the visitor's
  timezone.
- Update it once per second, in sync with the wall clock. Compute it from
  `Date.now()`; do not decrement a counter.
- Support a debug query param `?now=<ISO date>` that overrides the current time,
  so the end state can be tested.
- **When the countdown reaches zero:**
  1. Stop and disable the game permanently. On later visits, show this end state
     directly.
  2. Play a **pixel-art fireworks** animation (particle bursts in the NES palette)
     over the whole screen.
  3. Replace the countdown with the large message **"Perdeu Playboy"**.
  4. Hide the D-pad and the ranking submission. The final ranking may still be
     shown read-only.

---

## 4. Map generation

- **Generate a new random maze on every page load.** Keep the same maze across
  replays within the session.
- The map is a tile grid sized to fill the viewport. Choose the tile size so the
  grid has about 28–40 columns on desktop and fewer on small screens.
- Pac-Man style:
  - Corridors are 1 tile wide.
  - The maze is **horizontally mirrored** (symmetric left/right).
  - It has loops, not just a perfect maze. Remove some dead ends and add extra
    connections so the player can escape.
  - The whole maze is bordered by walls.
- A **central walled block** sized to fit the countdown text, surrounded by a
  corridor ring.
- **Teleport tunnels**: one or more **paired openings on the left and right edges**
  at the same row. Exiting through the left one makes the character appear on the
  right one, and vice versa. This applies to the player and to cops.
- Validate that every walkable tile is reachable (flood fill). Regenerate if not.
- Visual style: NES-like walls, e.g. dark blue walls with lighter outlines on a black
  floor, drawn with pixel-perfect edges.

---

## 5. Movement & controls

- **Free, continuous movement** in pixels per second, not tile-by-tile hopping.
  Constrain it to corridors with:
  - **Input buffering**: remember the last requested direction and turn as soon as
    it becomes possible.
  - **Corner assist**: when a turn is requested near an intersection, snap the
    character to the corridor center so turns feel forgiving.
  - Collision detection against wall tiles using the character's hitbox.
- Desktop: arrow keys and WASD.
- Mobile: the virtual D-pad. Optionally also support swipe gestures.
- The player keeps moving in the current direction until blocked, as in Pac-Man.

---

## 6. Characters (pixel art, NES palette)

- **Robber (player)**: a **generic, fictional cartoon burglar**, with a striped shirt,
  black eye mask, beanie and money bag. It has a 2–4 frame walk animation and faces
  its movement direction. It must not resemble any real person.
- **Cops**: generic pixel police officers in blue uniforms with caps. Each cop has a
  small color accent (badge or cap band) to show its AI type. Animate a red/blue
  siren light that blinks above them.
- Sprites are around 16×16 logical pixels, scaled to the tile size.

---

## 7. Cops: spawning, AI and difficulty

- Cops spawn at random walkable tiles **at least N tiles away from the player**
  (e.g. ≥ 10 by path distance), never directly in view at close range.
- Show a brief spawn telegraph (a blinking siren marker for 1 second) before the cop
  becomes active.
- **Spawn schedule uses exponential backoff.** The interval between spawns grows
  with each spawn:
  `interval_n = BASE_INTERVAL * BACKOFF_FACTOR^n`
  (e.g. BASE = 3 s, FACTOR = 1.4). Make these configurable constants.
- **Maximum of 10 cops** on screen.
- **Difficulty level** increases over time. Each level slightly increases cop speed,
  capped below the player's speed at the start and reaching parity or slightly above
  at high levels. Make all tuning values configurable constants at the top of
  `game.js`.
- Cops path-find on the tile grid with BFS or A*, and are aware of the teleport
  tunnels. Recompute paths periodically, not every frame.
- Cops have **distinct behaviors**, assigned in rotation as they spawn:
  1. **Chaser**: targets the player's current tile.
  2. **Ambusher**: targets a tile 4 tiles ahead of the player's direction.
  3. **Flanker**: targets a point mirrored from another cop through the player,
     to pincer the player.
  4. **Patroller/Wanderer**: roams randomly and switches to chasing when within a
     certain distance or line of sight.
- Add slight randomness to decision timing so cops don't move in perfect lockstep.
- **Collision**: if any cop's hitbox overlaps the robber's hitbox (use a slightly
  forgiving hitbox), the game is over.

---

## 8. Scoring

- **10 points per second survived**, multiplied by the current difficulty multiplier.
- Example: `multiplier = 1 + 0.1 * activeCops + 0.25 * difficultyLevel`. Make it
  configurable.
- Accumulate the score continuously and display it as an integer in the top-right
  HUD.

---

## 9. Game over & ranking

### Game over flow
1. Freeze the game, play a short "caught" sound and a flashing effect.
2. Open a **pixel-styled modal** that shows:
   - "PEGO!" and the final score
   - A name input: **max 50 characters**, trimmed, not empty, with a counter
   - A "Enviar pontuação" button
   - The **TOP 100 ranking** (position, name, score) in a scrollable list. Highlight
     the player's own entry.
   - A **"Jogar novamente"** button that restarts on the same maze
3. Submitting the score is optional. The player can just replay.

### Ranking architecture (static site + scheduled build)
- **Read path**: the site fetches `/data/ranking.json` from GitHub Pages. Add a
  cache-busting query param.
- **Write path**: a minimal **Cloudflare Worker** (free tier):
  - `POST /submit` with `{ name, score }`:
    - Validates the input: name ≤ 50 characters after trim, score is a positive
      integer.
    - Applies a basic rate limit per IP.
    - Stores the submission in a **Cloudflare KV** queue with a timestamp.
    - Returns 202.
  - `GET /pending` (protected by a secret bearer token): returns the queued
    submissions.
  - `POST /ack` (protected): deletes the processed submissions.
  - Configure CORS to allow only the GitHub Pages origin.
- **Build**: a **GitHub Actions workflow on a cron schedule (every 15 minutes)**,
  plus `workflow_dispatch`:
  1. Run `scripts/build-ranking.js` (Node).
  2. The script fetches the pending submissions from the Worker.
  3. It filters offensive names using a Portuguese + English profanity word list
     stored in the repo (`data/blocklist.txt`). It normalizes accents and leetspeak
     before matching, and drops matching entries.
  4. It merges the remaining entries with the existing `ranking.json`, sorts by score
     (descending), breaks ties by the earliest timestamp, and keeps the **TOP 100**.
  5. It commits the updated `ranking.json` only if it changed, acks the processed
     submissions, and lets the Pages deploy run.
  - Secrets: `WORKER_URL`, `WORKER_TOKEN`.
- **Client UX for the delay**:
  - After submitting, store the entry in `localStorage` and merge it into the
    displayed ranking, marked as "pendente".
  - Show the note "O ranking é atualizado a cada ~15 minutos."
  - Remove pending local entries once they appear in the fetched `ranking.json`.
- Escape all names when rendering (no `innerHTML` with user data).

---

## 10. Audio

- Use **Web Audio API** synthesized chiptune (square/triangle/noise oscillators).
  No audio files.
  - A short looping 8-bit background tune.
  - A siren blip when a cop spawns.
  - A "caught" jingle on game over.
  - A fireworks crackle at the end of the countdown.
- Start audio only after the first user interaction, as browsers require.
- Provide a mute toggle and persist its state in `localStorage`.

---

## 11. Game states

`READY` → `PLAYING` → `GAME_OVER` (modal) → `PLAYING` (replay) … → `EXPIRED`
(countdown finished, game disabled).

`READY` shows "Pressione qualquer tecla ou toque para começar" over the maze.

---

## 12. Visual style

- Strictly use the **NES color palette**.
- Use pixel font for all text.
- Use hard pixel edges everywhere: no anti-aliasing, gradients or blur.
- Optionally add a subtle CRT scanline overlay, toggleable and off by default on
  mobile for performance.

---

## 13. Deliverables

- The complete, working source code organized as above.
- `README.md` with:
  - How to run locally (any static server).
  - How to deploy to GitHub Pages.
  - How to deploy the Cloudflare Worker (`wrangler`) and configure KV and secrets.
  - How to configure the GitHub Actions secrets.
  - Where the tuning constants are.
- Clean, commented code. Keep gameplay constants grouped in a single config object.
