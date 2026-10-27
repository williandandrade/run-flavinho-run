// Maze generation: a horizontally mirrored Pac-Man-style tile maze with loops,
// a central walled block (the countdown "ghost house"), a corridor ring around
// it and teleport tunnels on the left/right edges.

export const FLOOR = 0;
export const WALL = 1;
export const BLOCK = 2;

export const DIRS = {
  up: { dx: 0, dy: -1, name: 'up' },
  down: { dx: 0, dy: 1, name: 'down' },
  left: { dx: -1, dy: 0, name: 'left' },
  right: { dx: 1, dy: 0, name: 'right' },
};
export const DIR_LIST = [DIRS.up, DIRS.left, DIRS.down, DIRS.right];

const MAZE = {
  MIN_COLS: 15,
  MAX_COLS: 39,
  MIN_ROWS: 13,        // playable rows (excluding the HUD row)
  LOOP_CHANCE: 0.08,   // probability of knocking out an extra wall
  DEAD_END_PASSES: 2,
  BLOCK_MARGIN: 0.1,   // block side margin as a fraction of the width
};

export function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

/** Small deterministic PRNG so a seed always yields the same maze. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick the grid size and tile size (CSS px) for a viewport.
 * Columns are kept ≡ 3 (mod 4) so the mirror axis is a cell column and the
 * maze halves join naturally. Row 0 of the board is reserved for the HUD.
 */
export function computeLayout(W, H) {
  const maxTileByHeight = Math.floor(H / (MAZE.MIN_ROWS + 1));
  const target = W >= 1200 ? 35 : W >= 800 ? 31 : 23;
  let tile = Math.max(8, Math.min(Math.floor(W / target), maxTileByHeight));
  let cols = Math.min(MAZE.MAX_COLS, Math.floor(W / tile));
  cols -= (((cols - 3) % 4) + 4) % 4;
  cols = Math.max(MAZE.MIN_COLS, cols);
  tile = Math.max(8, Math.min(Math.floor(W / cols), maxTileByHeight));
  let rows = Math.floor(H / tile) - 1;
  if (rows % 2 === 0) rows--;
  rows = Math.max(MAZE.MIN_ROWS, rows);
  const boardW = cols * tile;
  const boardH = (rows + 1) * tile;
  return {
    cols, rows, tile, boardW, boardH,
    left: Math.floor((W - boardW) / 2),
    top: Math.max(0, Math.floor((H - boardH) / 2)),
    tallBlock: tile < 22,
  };
}

export class GameMap {
  constructor(w, h, tiles, block, tunnels, playerStart, seed) {
    this.w = w;
    this.h = h;
    this.tiles = tiles;
    this.block = block;
    this.tunnels = tunnels;
    this.tunnelSet = new Set(tunnels);
    this.playerStart = playerStart;
    this.seed = seed;
    this.floorList = [];
    this.adj = new Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (tiles[i] !== FLOOR) continue;
        this.floorList.push(i);
        this.adj[i] = DIR_LIST.map((d) => this.step(x, y, d)).filter((j) => j >= 0);
      }
    }
  }

  idx(x, y) { return y * this.w + x; }

  /** Tile index of a (possibly fractional / wrapped) entity position. */
  idxOf(x, y) {
    const tx = ((Math.round(x) % this.w) + this.w) % this.w;
    return Math.round(y) * this.w + tx;
  }

  isFloor(x, y) {
    if (y < 0 || y >= this.h) return false;
    if (x < 0 || x >= this.w) {
      if (!this.tunnelSet.has(y)) return false;
      x = ((x % this.w) + this.w) % this.w;
    }
    return this.tiles[y * this.w + x] === FLOOR;
  }

  /** Index of the tile reached by moving one step from (x, y), or -1. Tunnel-aware. */
  step(x, y, d) {
    let nx = x + d.dx;
    const ny = y + d.dy;
    if (ny < 0 || ny >= this.h) return -1;
    if (nx < 0 || nx >= this.w) {
      if (!this.tunnelSet.has(ny)) return -1;
      nx = (nx + this.w) % this.w;
    }
    const i = ny * this.w + nx;
    return this.tiles[i] === FLOOR ? i : -1;
  }

  canMove(x, y, d) { return this.step(x, y, d) >= 0; }
}

/** Generate a validated maze; retries with derived seeds if validation fails. */
export function generateMap(w, h, seed, opts = {}) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const map = tryGenerate(w, h, (seed + attempt * 7919) >>> 0, opts);
    if (map) return map;
  }
  throw new Error('Maze generation failed');
}

function tryGenerate(w, h, seed, opts) {
  const rng = mulberry32(seed);
  const tiles = new Uint8Array(w * h).fill(WALL);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  const idx = (x, y) => y * w + x;
  // Every write is mirrored, which keeps the maze symmetric by construction.
  const setFloor = (x, y) => {
    tiles[idx(x, y)] = FLOOR;
    tiles[idx(w - 1 - x, y)] = FLOOR;
  };

  // Central block bounds: even coordinates so the ring falls on cell lines.
  const bx0 = Math.max(2, 2 * Math.round(w * MAZE.BLOCK_MARGIN));
  const bx1 = w - 1 - bx0;
  let k = cy % 2 === 1 ? 1 : 2;
  if (opts.tallBlock && h >= 19) k += 2;
  const by0 = cy - k;
  const by1 = cy + k;

  const inBlock = (x, y) => x > bx0 && x < bx1 && y > by0 && y < by1;
  const isCell = (x, y) =>
    x >= 1 && x <= w - 2 && y >= 1 && y <= h - 2 && x % 2 === 1 && y % 2 === 1 && !inBlock(x, y);

  // 1) Perfect maze (iterative recursive backtracker) on the left half.
  const visited = new Uint8Array(w * h);
  const STEPS = [[0, -2], [2, 0], [0, 2], [-2, 0]];
  const stack = [[1, 1]];
  visited[idx(1, 1)] = 1;
  setFloor(1, 1);
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const options = [];
    for (const [dx, dy] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (nx <= cx && isCell(nx, ny) && !visited[idx(nx, ny)]) options.push([nx, ny]);
    }
    if (!options.length) { stack.pop(); continue; }
    const [nx, ny] = options[Math.floor(rng() * options.length)];
    setFloor((x + nx) / 2, (y + ny) / 2);
    setFloor(nx, ny);
    visited[idx(nx, ny)] = 1;
    stack.push([nx, ny]);
  }

  // 2) Extra connections so the maze has loops.
  for (let y = 1; y <= h - 2; y++) {
    for (let x = 1; x <= cx; x++) {
      if ((x + y) % 2 !== 1 || tiles[idx(x, y)] !== WALL) continue;
      const horizontal = x % 2 === 0;
      const ok = horizontal
        ? isCell(x - 1, y) && isCell(x + 1, y)
        : isCell(x, y - 1) && isCell(x, y + 1);
      if (ok && rng() < MAZE.LOOP_CHANCE) setFloor(x, y);
    }
  }

  // 3) Remove dead ends by opening another wall around them.
  for (let pass = 0; pass < MAZE.DEAD_END_PASSES; pass++) {
    for (let y = 1; y <= h - 2; y += 2) {
      for (let x = 1; x <= cx; x += 2) {
        if (!isCell(x, y)) continue;
        let open = 0;
        const closed = [];
        for (const [dx, dy] of STEPS) {
          const wx = x + dx / 2, wy = y + dy / 2;
          if (tiles[idx(wx, wy)] === FLOOR) open++;
          else if (isCell(x + dx, y + dy)) closed.push([wx, wy]);
        }
        if (open <= 1 && closed.length) {
          const [wx, wy] = closed[Math.floor(rng() * closed.length)];
          setFloor(wx, wy);
        }
      }
    }
  }

  // 4) Corridor ring around the block, then the block itself.
  for (let x = bx0 - 1; x <= bx1 + 1; x++) {
    setFloor(x, by0 - 1);
    setFloor(x, by1 + 1);
  }
  for (let y = by0 - 1; y <= by1 + 1; y++) setFloor(bx0 - 1, y);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) tiles[idx(x, y)] = BLOCK;
  }

  // 5) Teleport tunnels: paired openings on the left/right borders.
  const candidates = [];
  for (let y = 3; y <= h - 4; y += 2) candidates.push(y);
  const tunnelCount = h >= 21 ? 2 : 1;
  const tunnels = [];
  while (tunnels.length < tunnelCount && candidates.length) {
    const y = candidates.splice(Math.floor(rng() * candidates.length), 1)[0];
    if (tunnels.every((t) => Math.abs(t - y) >= 4)) tunnels.push(y);
  }
  for (const y of tunnels) setFloor(0, y);

  const playerStart = { x: cx, y: by1 + 1 };
  const map = new GameMap(w, h, tiles, { x0: bx0, y0: by0, x1: bx1, y1: by1 }, tunnels, playerStart, seed);

  // 6) Validate: every floor tile must be reachable (flood fill, tunnel-aware).
  const seen = new Uint8Array(w * h);
  const queue = [map.idx(playerStart.x, playerStart.y)];
  seen[queue[0]] = 1;
  let reached = 0;
  while (queue.length) {
    const i = queue.pop();
    reached++;
    for (const j of map.adj[i]) if (!seen[j]) { seen[j] = 1; queue.push(j); }
  }
  return reached === map.floorList.length ? map : null;
}
