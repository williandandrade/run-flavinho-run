// Cop AI: BFS distance fields on the tile graph (tunnel-aware via map.adj),
// per-type targeting and spawn tile selection.

import { DIRS, DIR_LIST } from './map.js';
import { CONFIG } from './game.js';

/** Breadth-first distances from `start` to every tile (-1 = unreachable). */
export function bfs(map, start, out) {
  const n = map.w * map.h;
  const dist = out && out.length === n ? out : new Int16Array(n);
  dist.fill(-1);
  if (start < 0 || !map.adj[start]) return dist;
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++];
    const d = dist[i] + 1;
    for (const j of map.adj[i]) {
      if (dist[j] < 0) { dist[j] = d; queue[tail++] = j; }
    }
  }
  return dist;
}

/** Closest floor tile (Manhattan) to an arbitrary, possibly out-of-grid, point. */
export function nearestFloor(map, x, y) {
  x = Math.max(0, Math.min(map.w - 1, x));
  y = Math.max(0, Math.min(map.h - 1, y));
  let best = map.floorList[0], bestD = Infinity;
  for (const i of map.floorList) {
    const d = Math.abs((i % map.w) - x) + Math.abs(Math.floor(i / map.w) - y);
    if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
  }
  return best;
}

/** Straight, unobstructed row/column visibility between two tiles. */
export function lineOfSight(map, ax, ay, bx, by, maxDist) {
  if (ax === bx) {
    if (Math.abs(ay - by) > maxDist) return false;
    const s = Math.sign(by - ay);
    for (let y = ay; y !== by; y += s) if (!map.isFloor(ax, y)) return false;
    return true;
  }
  if (ay === by) {
    if (Math.abs(ax - bx) > maxDist) return false;
    const s = Math.sign(bx - ax);
    for (let x = ax; x !== bx; x += s) if (!map.isFloor(x, ay)) return false;
    return true;
  }
  return false;
}

const tileXY = (map, i) => [i % map.w, Math.floor(i / map.w)];

/** Target tile index for a cop, according to its behavior type. */
export function computeTarget(game, cop) {
  const { map, player } = game;
  const pi = map.idxOf(player.x, player.y);
  const [px, py] = tileXY(map, pi);

  switch (cop.type) {
    case 'ambusher': {
      // A few tiles ahead of where the robber is heading.
      const d = player.facing || DIRS.up;
      return nearestFloor(map, px + d.dx * CONFIG.AMBUSH_AHEAD, py + d.dy * CONFIG.AMBUSH_AHEAD);
    }
    case 'flanker': {
      // Mirror another cop through the player to close a pincer.
      const ref = game.cops.find((c) => c !== cop && c.type === 'chaser')
        || game.cops.find((c) => c !== cop);
      if (!ref) return pi;
      const [rx, ry] = tileXY(map, map.idxOf(ref.x, ref.y));
      return nearestFloor(map, 2 * px - rx, 2 * py - ry);
    }
    case 'wanderer': {
      const ci = map.idxOf(cop.x, cop.y);
      const [cx, cy] = tileXY(map, ci);
      const d = game.playerField[ci];
      const spotted = (d >= 0 && d <= CONFIG.WANDER_AGGRO_DIST)
        || lineOfSight(map, cx, cy, px, py, CONFIG.WANDER_LOS_DIST);
      if (spotted) cop.chaseUntil = game.elapsed + CONFIG.WANDER_CHASE_TIME;
      if (game.elapsed < cop.chaseUntil) return pi;
      if (cop.wanderTarget == null || ci === cop.wanderTarget || game.elapsed > cop.wanderUntil) {
        cop.wanderTarget = map.floorList[Math.floor(Math.random() * map.floorList.length)];
        cop.wanderUntil = game.elapsed + CONFIG.WANDER_RETARGET;
      }
      return cop.wanderTarget;
    }
    default: // chaser
      return pi;
  }
}

/**
 * Pick the direction at a tile center that descends the cop's distance field.
 * Reversing is avoided (like Pac-Man ghosts) unless it's the only way out or
 * going forward is much worse.
 */
export function chooseDirection(map, cop, tx, ty, field) {
  const options = DIR_LIST.filter((d) => map.canMove(tx, ty, d));
  if (!options.length) return null;
  const score = (d) => {
    const v = field ? field[map.step(tx, ty, d)] : -1;
    return (v < 0 ? 9999 : v) + Math.random() * 0.5; // random tie-break
  };
  const rev = cop.dir && options.find((d) => d.dx === -cop.dir.dx && d.dy === -cop.dir.dy);
  const forward = rev && options.length > 1 ? options.filter((d) => d !== rev) : options;

  let best = forward[0], bestV = Infinity;
  for (const d of forward) {
    const v = score(d);
    if (v < bestV) { bestV = v; best = d; }
  }
  if (rev && best !== rev && score(rev) + CONFIG.REVERSE_MARGIN < bestV) return rev;
  return best;
}

/** Random floor tile far from the player (by path distance), preferring out of sight. */
export function pickSpawnTile(game) {
  const { map, player } = game;
  const field = game.playerField;
  const [px, py] = tileXY(map, map.idxOf(player.x, player.y));
  const occupied = new Set(game.cops.map((c) => map.idxOf(c.x, c.y)));
  for (const t of game.telegraphs) occupied.add(t.tile);

  const far = map.floorList.filter((i) => field[i] >= CONFIG.MIN_SPAWN_DIST && !occupied.has(i));
  const hidden = far.filter((i) => {
    const [x, y] = tileXY(map, i);
    return !lineOfSight(map, x, y, px, py, Infinity);
  });
  const pool = hidden.length ? hidden : far;
  if (pool.length) return pool[Math.floor(Math.random() * pool.length)];

  // Tiny maps: fall back to the farthest free tile.
  let best = -1, bestD = -1;
  for (const i of map.floorList) {
    if (!occupied.has(i) && field[i] > bestD) { bestD = field[i]; best = i; }
  }
  return best;
}
