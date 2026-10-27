// Game simulation: movement, cop spawning, difficulty, collision and scoring.
// Positions are in tile units; integer coordinates are tile centers.

import { DIRS } from './map.js';
import { bfs, computeTarget, chooseDirection, pickSpawnTile } from './ai.js';

// ---------------------------------------------------------------------------
// All gameplay tuning lives here.
export const CONFIG = {
  // Movement (tiles per second)
  PLAYER_SPEED: 6,
  CORNER_ASSIST: 0.35,        // max distance (tiles) from a center to accept a turn

  // Cop speed as a fraction of PLAYER_SPEED: START + PER_LEVEL * level, capped at MAX
  COP_SPEED_START: 0.75,
  COP_SPEED_PER_LEVEL: 0.03,
  COP_SPEED_MAX: 1.05,
  COP_SPEED_JITTER: 0.03,     // ± per-cop variation so they don't move in lockstep

  // Difficulty
  LEVEL_DURATION: 20,         // seconds per difficulty level

  // Spawning: interval_n = BASE_INTERVAL * BACKOFF_FACTOR^n
  BASE_INTERVAL: 3,
  BACKOFF_FACTOR: 1.4,
  MAX_COPS: 10,
  MIN_SPAWN_DIST: 10,         // path distance (tiles) from the player
  SPAWN_TELEGRAPH: 1,         // seconds of blinking siren before activation

  // AI
  REPATH_INTERVAL: 0.3,       // seconds between path recomputations
  REPATH_JITTER: 0.12,        // ± random variation of the above
  REVERSE_MARGIN: 4,          // reverse only if it's this many tiles better
  AMBUSH_AHEAD: 4,
  WANDER_AGGRO_DIST: 6,
  WANDER_LOS_DIST: 8,
  WANDER_CHASE_TIME: 3,
  WANDER_RETARGET: 6,

  // Collision: overlap when centers are closer than this on both axes (tiles).
  // < 1 makes the hitbox slightly forgiving.
  HITBOX: 0.6,

  // Scoring: POINTS_PER_SECOND * (1 + MULT_PER_COP * cops + MULT_PER_LEVEL * level)
  POINTS_PER_SECOND: 10,
  MULT_PER_COP: 0.1,
  MULT_PER_LEVEL: 0.25,

  // Game over flash duration before the modal opens (seconds)
  CAUGHT_FREEZE: 0.9,
};

export const COP_TYPES = ['chaser', 'ambusher', 'flanker', 'wanderer'];
const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Movement

function makeEntity(x, y) {
  return { x, y, dir: null, next: null, facing: DIRS.down, moving: false, anim: 0, assist: 0 };
}

/** Apply the buffered direction if possible (reverse anytime, turns near centers). */
function tryTurn(map, e, tx, ty) {
  const n = e.next;
  if (!n || n === e.dir) return;
  if (e.dir && n.dx === -e.dir.dx && n.dy === -e.dir.dy) { e.dir = n; return; }
  const off = Math.abs(e.x - tx) + Math.abs(e.y - ty);
  if (off <= e.assist + EPS && map.canMove(tx, ty, n)) {
    // Corner assist: snap onto the corridor center and take the turn.
    e.x = tx;
    e.y = ty;
    e.dir = n;
  }
}

/**
 * Continuous movement constrained to corridors. Movement is split at tile
 * centers so turns and AI decisions happen exactly there.
 */
export function moveEntity(map, e, dist, onCenter) {
  e.moving = false;
  for (let guard = 0; dist > EPS && guard < 16; guard++) {
    const tx = Math.round(e.x), ty = Math.round(e.y);
    if (Math.abs(e.x - tx) < EPS && Math.abs(e.y - ty) < EPS) {
      e.x = tx;
      e.y = ty;
      if (onCenter) onCenter(e, tx, ty);
    }
    tryTurn(map, e, tx, ty);
    if (!e.dir) break;
    const { dx, dy } = e.dir;
    e.facing = e.dir;

    if (!map.canMove(tx, ty, e.dir)) {
      // Blocked ahead: slide up to the center of the current tile and stop.
      const rem = (tx - e.x) * dx + (ty - e.y) * dy;
      if (rem <= EPS) { e.x = tx; e.y = ty; break; }
      const s = Math.min(dist, rem);
      e.x += dx * s;
      e.y += dy * s;
      dist -= s;
      e.moving = true;
      continue;
    }

    // Advance toward the next tile center along the current direction.
    const sgn = dx || dy;
    const p = dx ? e.x : e.y;
    let nxt = sgn > 0 ? Math.ceil(p - EPS) : Math.floor(p + EPS);
    if ((nxt - p) * sgn <= EPS) nxt += sgn;
    const toNext = (nxt - p) * sgn;
    const s = Math.min(dist, toNext);
    const np = s === toNext ? nxt : p + sgn * s;
    if (dx) e.x = np; else e.y = np;
    dist -= s;
    e.moving = true;

    // Teleport tunnels: wrap horizontally.
    if (e.x < -0.5) e.x += map.w;
    else if (e.x >= map.w - 0.5) e.x -= map.w;
  }
}

/** Shortest horizontal distance, accounting for the tunnel wrap. */
function wrapDx(map, a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, map.w - d);
}

// ---------------------------------------------------------------------------

export class Game {
  constructor(map, events = {}) {
    this.map = map;
    this.events = events;
    const s = map.playerStart;
    this.player = makeEntity(s.x, s.y);
    this.player.assist = CONFIG.CORNER_ASSIST;
    this.cops = [];
    this.telegraphs = [];
    this.elapsed = 0;
    this.score = 0;
    this.level = 0;
    this.spawnCount = 0;
    this.nextSpawnAt = CONFIG.BASE_INTERVAL;
    this.over = false;
    this.playerField = bfs(map, this.playerIndex());
    this.fieldTimer = 0;
  }

  playerIndex() { return this.map.idxOf(this.player.x, this.player.y); }

  multiplier() {
    return 1 + CONFIG.MULT_PER_COP * this.cops.length + CONFIG.MULT_PER_LEVEL * this.level;
  }

  copSpeed() {
    const frac = Math.min(
      CONFIG.COP_SPEED_START + CONFIG.COP_SPEED_PER_LEVEL * this.level,
      CONFIG.COP_SPEED_MAX,
    );
    return CONFIG.PLAYER_SPEED * frac;
  }

  update(dt) {
    if (this.over) return;
    this.elapsed += dt;
    this.level = Math.floor(this.elapsed / CONFIG.LEVEL_DURATION);

    // Player
    const p = this.player;
    moveEntity(this.map, p, CONFIG.PLAYER_SPEED * dt);
    if (p.moving) p.anim += dt;

    // Shared distance field from the player (spawn checks, wanderer aggro).
    this.fieldTimer -= dt;
    if (this.fieldTimer <= 0) {
      this.playerField = bfs(this.map, this.playerIndex(), this.playerField);
      this.fieldTimer = 0.2;
    }

    this.updateSpawning(dt);

    for (const cop of this.cops) this.updateCop(cop, dt);

    if (this.checkCollision()) {
      this.over = true;
      this.events.onCaught?.();
      return;
    }

    this.score += CONFIG.POINTS_PER_SECOND * dt * this.multiplier();
  }

  updateSpawning(dt) {
    const total = this.cops.length + this.telegraphs.length;
    if (total < CONFIG.MAX_COPS && this.elapsed >= this.nextSpawnAt) {
      this.playerField = bfs(this.map, this.playerIndex(), this.playerField);
      const tile = pickSpawnTile(this);
      if (tile >= 0) {
        const type = COP_TYPES[this.spawnCount % COP_TYPES.length];
        this.telegraphs.push({ tile, type, timer: CONFIG.SPAWN_TELEGRAPH });
        this.events.onTelegraph?.();
      }
      this.spawnCount++;
      this.nextSpawnAt = this.elapsed + CONFIG.BASE_INTERVAL * CONFIG.BACKOFF_FACTOR ** this.spawnCount;
    }

    for (let i = this.telegraphs.length - 1; i >= 0; i--) {
      const t = this.telegraphs[i];
      t.timer -= dt;
      if (t.timer > 0) continue;
      // If the robber wandered close during the telegraph, relocate it.
      if (this.playerField[t.tile] < CONFIG.MIN_SPAWN_DIST / 2) {
        const tile = pickSpawnTile(this);
        if (tile >= 0) { t.tile = tile; t.timer = CONFIG.SPAWN_TELEGRAPH; continue; }
      }
      this.telegraphs.splice(i, 1);
      this.activateCop(t);
    }
  }

  activateCop(t) {
    const w = this.map.w;
    const cop = makeEntity(t.tile % w, Math.floor(t.tile / w));
    Object.assign(cop, {
      type: t.type,
      field: null,
      repath: 0,
      lastDecision: -1,
      speedMul: 1 + (Math.random() * 2 - 1) * CONFIG.COP_SPEED_JITTER,
      phase: Math.random(),
      wanderTarget: null,
      wanderUntil: 0,
      chaseUntil: 0,
    });
    this.cops.push(cop);
  }

  updateCop(cop, dt) {
    cop.repath -= dt;
    if (cop.repath <= 0 || !cop.field) {
      cop.repath = CONFIG.REPATH_INTERVAL + (Math.random() * 2 - 1) * CONFIG.REPATH_JITTER;
      cop.field = bfs(this.map, computeTarget(this, cop), cop.field);
    }
    moveEntity(this.map, cop, this.copSpeed() * cop.speedMul * dt, (e, tx, ty) => {
      const i = this.map.idx(tx, ty);
      if (i === e.lastDecision) return;
      e.lastDecision = i;
      const d = chooseDirection(this.map, e, tx, ty, e.field);
      if (d) e.next = d;
    });
    if (cop.moving) cop.anim += dt;
    else cop.lastDecision = -1; // never get stuck on a stale decision
  }

  checkCollision() {
    const p = this.player;
    return this.cops.some((c) =>
      wrapDx(this.map, c.x, p.x) < CONFIG.HITBOX && Math.abs(c.y - p.y) < CONFIG.HITBOX);
  }
}
