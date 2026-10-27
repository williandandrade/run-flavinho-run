// Canvas rendering: everything is drawn to a low-res offscreen canvas
// (16 logical px per tile) and scaled up without smoothing for crisp pixels.

import { FLOOR, WALL } from './map.js';
import { NES, TILE_PX as T, buildAllSprites, WALK_CYCLE } from './sprites.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.off = document.createElement('canvas');
    this.octx = this.off.getContext('2d');
    this.mapLayer = document.createElement('canvas');
    this.sprites = buildAllSprites();
    this.layout = null;
    this.map = null;
  }

  get offW() { return this.off.width; }
  get offH() { return this.off.height; }

  setLayout(layout, map, dpr) {
    this.layout = layout;
    this.dpr = dpr;
    const W = window.innerWidth, H = window.innerHeight;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    if (this.map !== map) {
      this.map = map;
      this.off.width = map.w * T;
      this.off.height = (map.h + 1) * T; // +1 row reserved for the HUD
      this.drawMapLayer(map);
    }
  }

  /** Pre-render walls: dark blue fill with light outlines facing corridors. */
  drawMapLayer(map) {
    const c = this.mapLayer;
    c.width = map.w * T;
    c.height = (map.h + 1) * T;
    const g = c.getContext('2d');
    g.fillStyle = NES.black;
    g.fillRect(0, 0, c.width, c.height);

    const solid = (x, y) => {
      if (y < 0 || y >= map.h) return true;
      if (x < 0 || x >= map.w) return !map.tunnelSet.has(y);
      return map.tiles[y * map.w + x] !== FLOOR;
    };

    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        if (map.tiles[y * map.w + x] !== WALL) continue;
        const px = x * T, py = (y + 1) * T;
        g.fillStyle = NES.darkBlue;
        g.fillRect(px, py, T, T);
        g.fillStyle = NES.lightBlue;
        if (!solid(x, y - 1)) g.fillRect(px, py, T, 2);
        if (!solid(x, y + 1)) g.fillRect(px, py + T - 2, T, 2);
        if (!solid(x - 1, y)) g.fillRect(px, py, 2, T);
        if (!solid(x + 1, y)) g.fillRect(px + T - 2, py, 2, T);
        // Inner corners
        if (solid(x - 1, y) && solid(x, y - 1) && !solid(x - 1, y - 1)) g.fillRect(px, py, 2, 2);
        if (solid(x + 1, y) && solid(x, y - 1) && !solid(x + 1, y - 1)) g.fillRect(px + T - 2, py, 2, 2);
        if (solid(x - 1, y) && solid(x, y + 1) && !solid(x - 1, y + 1)) g.fillRect(px, py + T - 2, 2, 2);
        if (solid(x + 1, y) && solid(x, y + 1) && !solid(x + 1, y + 1)) g.fillRect(px + T - 2, py + T - 2, 2, 2);
      }
    }

    // Central countdown block: black interior with a double pixel border.
    const b = map.block;
    const bx = b.x0 * T, by = (b.y0 + 1) * T;
    const bw = (b.x1 - b.x0 + 1) * T, bh = (b.y1 - b.y0 + 1) * T;
    g.fillStyle = NES.black;
    g.fillRect(bx, by, bw, bh);
    frame(g, bx + 2, by + 2, bw - 4, bh - 4, 2, NES.lightBlue);
    frame(g, bx + 6, by + 6, bw - 12, bh - 12, 1, NES.blue);
  }

  /**
   * Draw one frame.
   * scene: { game, time, showActors, flash, fireworks }
   */
  draw(scene) {
    const g = this.octx;
    const { game, time } = scene;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.mapLayer, 0, 0);

    if (game && scene.showActors) {
      const blink = Math.floor(time * 8) % 2;
      for (const t of game.telegraphs) {
        if (!blink) continue;
        const img = this.sprites.telegraph[Math.floor(time * 6) % 2];
        this.drawAt(img, t.tile % this.map.w, Math.floor(t.tile / this.map.w));
      }
      for (const c of game.cops) {
        const siren = Math.floor((time + c.phase) * 6) % 2;
        const leg = c.moving ? Math.floor(c.anim * 8) % 2 : 0;
        this.drawAt(this.sprites.cop[c.type][siren][leg], c.x, c.y);
      }
      const p = game.player;
      const frames = this.sprites.robber[p.facing.name];
      const frame = p.moving ? WALK_CYCLE[Math.floor(p.anim * 10) % WALK_CYCLE.length] : 0;
      this.drawAt(frames[frame], p.x, p.y);
    }

    if (scene.flash) {
      g.fillStyle = NES.white;
      g.fillRect(0, T, this.off.width, this.off.height - T);
    }

    if (scene.fireworks) scene.fireworks.draw(g);

    this.present();
  }

  /** Draw a sprite centered on a tile position, duplicating it across the tunnel wrap. */
  drawAt(img, x, y) {
    const g = this.octx;
    const py = Math.round((y + 1) * T);
    g.drawImage(img, Math.round(x * T), py);
    if (x < 0.5) g.drawImage(img, Math.round((x + this.map.w) * T), py);
    else if (x > this.map.w - 1.5) g.drawImage(img, Math.round((x - this.map.w) * T), py);
  }

  present() {
    const { ctx, layout: L, dpr } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = NES.black;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(
      this.off, 0, 0, this.off.width, this.off.height,
      Math.round(L.left * dpr), Math.round(L.top * dpr),
      Math.round(L.boardW * dpr), Math.round(L.boardH * dpr),
    );
  }
}

/** Hard-edged rectangular outline made of filled rects. */
function frame(g, x, y, w, h, t, color) {
  g.fillStyle = color;
  g.fillRect(x, y, w, t);
  g.fillRect(x, y + h - t, w, t);
  g.fillRect(x, y, t, h);
  g.fillRect(x + w - t, y, t, h);
}
