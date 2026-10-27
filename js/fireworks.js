// Pixel-art fireworks (NES palette), simulated in offscreen-canvas pixels.

import { NES } from './sprites.js';

const COLORS = [NES.red, NES.yellow, NES.white, NES.lightBlue, NES.pink,
  NES.lightGreen, NES.cyan, NES.orange, NES.lime, NES.lavender];
const GRAVITY = 90;          // px/s² for rockets
const SPARK_GRAVITY = 30;    // px/s² for sparks
const MAX_PARTICLES = 1500;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Fireworks {
  constructor(w, h, onBurst) {
    this.w = w;
    this.h = h;
    this.onBurst = onBurst;
    this.rockets = [];
    this.sparks = [];
    this.timer = 0;
    for (let i = 0; i < 3; i++) this.launch();
  }

  resize(w, h) { this.w = w; this.h = h; }

  launch() {
    const targetY = rand(this.h * 0.12, this.h * 0.5);
    this.rockets.push({
      x: rand(this.w * 0.1, this.w * 0.9),
      y: this.h,
      vx: rand(-10, 10),
      vy: -Math.sqrt(2 * GRAVITY * (this.h - targetY)),
      color: pick(COLORS),
    });
  }

  burst(x, y) {
    const colors = [pick(COLORS), pick(COLORS)];
    const n = Math.floor(rand(40, 70));
    for (let i = 0; i < n && this.sparks.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(20, 75);
      this.sparks.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(1.1, 1.8), color: colors[i % 2],
      });
    }
    this.onBurst?.();
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.launch();
      this.timer = rand(0.35, 0.9);
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.vy += GRAVITY * dt;
      if (r.vy >= 0) { this.rockets.splice(i, 1); this.burst(r.x, r.y); }
    }
    const drag = Math.max(0, 1 - 1.2 * dt);
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const p = this.sparks[i];
      p.vx *= drag;
      p.vy = p.vy * drag + SPARK_GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.sparks.splice(i, 1);
    }
  }

  draw(g) {
    for (const r of this.rockets) {
      g.fillStyle = r.color;
      g.fillRect(Math.round(r.x), Math.round(r.y), 1, 3);
    }
    for (const p of this.sparks) {
      // Flicker out instead of fading (no alpha blending).
      if (p.life < 0.35 && Math.floor(p.life * 20) % 2) continue;
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
    }
  }
}
