// Bootstrap: layout, state machine, fixed-timestep loop and DOM HUD.
// States: READY → PLAYING → GAME_OVER (modal) → PLAYING … → EXPIRED

import { CONFIG, Game } from './game.js';
import { DIRS, computeLayout, generateMap, randomSeed } from './map.js';
import { Renderer } from './render.js';
import { initInput } from './input.js';
import * as audio from './audio.js';
import * as countdown from './countdown.js';
import { initRankingModal } from './ranking.js';
import { Fireworks } from './fireworks.js';

const STEP = 1 / 60;
const MAX_STEPS = 5;
const READY_TEXT = 'Pressione qualquer tecla ou toque para começar';
const PAUSED_TEXT = 'PAUSADO - pressione qualquer tecla ou toque para continuar';
const CRT_KEY = 'rfr_crt';

const $ = (id) => document.getElementById(id);
const els = {
  board: $('board'),
  score: $('score'),
  mult: $('mult'),
  box: $('countdown-box'),
  countdown: $('countdown'),
  sub: $('countdown-sub'),
  message: $('message'),
  messageText: $('message-text'),
  mute: $('btn-mute'),
  crt: $('btn-crt'),
  rankingBtn: $('btn-ranking'),
};
const portraitMQ = matchMedia('(pointer: coarse) and (orientation: portrait)');

const seed = randomSeed(); // one maze per page load, reused for replays
const renderer = new Renderer($('screen'));
let layout = null;
let map = null;
let game = null;
let fireworks = null;
let state = 'READY';
let paused = false;
let caughtTimer = 0;
let modalShown = false;
let lastHud = '';

const modal = initRankingModal({ onReplay: replay, onClose: () => {} });

// --- Game lifecycle ----------------------------------------------------------

function newGame() {
  game = new Game(map, {
    onTelegraph: () => audio.siren(),
    onCaught,
  });
  lastHud = '';
}

function setMessage(text) {
  els.message.hidden = !text;
  if (text) els.messageText.textContent = text;
}

function startPlaying() {
  state = 'PLAYING';
  paused = false;
  setMessage(null);
  audio.resume();
  audio.startMusic();
}

function pause() {
  if (state !== 'PLAYING' || paused) return;
  paused = true;
  setMessage(PAUSED_TEXT);
  audio.stopMusic();
  audio.suspend();
}

function onCaught() {
  state = 'GAME_OVER';
  caughtTimer = CONFIG.CAUGHT_FREEZE;
  modalShown = false;
  audio.stopMusic();
  audio.caught();
}

function replay() {
  if (state === 'EXPIRED') return;
  newGame();
  startPlaying();
}

function enterExpired() {
  if (state === 'EXPIRED') return;
  state = 'EXPIRED';
  paused = false;
  document.body.classList.add('expired');
  audio.stopMusic();
  setMessage(null);
  modal.lockReadOnly();
  els.countdown.textContent = 'Perdeu Playboy';
  els.box.classList.add('final');
  els.rankingBtn.hidden = false;
  fireworks = new Fireworks(renderer.offW, renderer.offH, () => audio.crackle());
  fitCountdown();
}

// --- Input -------------------------------------------------------------------

function onDir(name) {
  if (game && (state === 'READY' || state === 'PLAYING')) game.player.next = DIRS[name];
}

function onAny() {
  audio.unlock();
  if (state === 'EXPIRED' || modal.isOpen() || portraitMQ.matches) return;
  if (state === 'READY') startPlaying();
  else if (state === 'PLAYING' && paused) {
    paused = false;
    setMessage(null);
    audio.resume();
    audio.startMusic();
  }
}

initInput({ onDir, onAny, isBlocked: () => modal.isOpen() });
audio.installUnlock();
preventZoom();

/** Block pinch and double-tap zoom (iOS ignores user-scalable=no). */
function preventZoom() {
  const block = (e) => e.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, block, { passive: false });
  }
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = e.timeStamp;
    // Leave buttons/inputs alone so their clicks still fire.
    if (now - lastTap < 300 && !e.target.closest('button, input')) e.preventDefault();
    lastTap = now;
  }, { passive: false });
}

els.mute.addEventListener('click', () => {
  audio.unlock();
  audio.setMuted(!audio.isMuted());
  updateMuteButton();
});
function updateMuteButton() {
  const m = audio.isMuted();
  els.mute.textContent = m ? 'MUDO' : 'SOM';
  els.mute.setAttribute('aria-pressed', String(m));
  els.mute.setAttribute('aria-label', m ? 'Ativar som' : 'Desativar som');
}
updateMuteButton();

// CRT scanlines: off by default on touch devices for performance.
function initCrt() {
  let on;
  try { on = localStorage.getItem(CRT_KEY); } catch { on = null; }
  setCrt(on === null ? !matchMedia('(pointer: coarse)').matches : on === '1');
  els.crt.addEventListener('click', () => {
    const next = !document.body.classList.contains('crt');
    setCrt(next);
    try { localStorage.setItem(CRT_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  });
}
function setCrt(on) {
  document.body.classList.toggle('crt', on);
  els.crt.setAttribute('aria-pressed', String(on));
}
initCrt();

els.rankingBtn.addEventListener('click', () => modal.open({ readOnly: true }));

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
portraitMQ.addEventListener('change', () => { if (portraitMQ.matches) pause(); });

// --- Layout ------------------------------------------------------------------

function relayout() {
  const W = window.innerWidth, H = window.innerHeight;
  let L = computeLayout(W, H);
  const changed = !map || map.w !== L.cols || map.h !== L.rows || layout.tallBlock !== L.tallBlock;
  if (changed && state === 'READY') {
    // Only rebuild the grid before a run starts (same seed → same maze for a size).
    map = generateMap(L.cols, L.rows, seed, { tallBlock: L.tallBlock });
    newGame();
  } else if (changed) {
    // Mid-session (e.g. mobile URL bar): keep the maze, just rescale it.
    L = fitLayout(W, H, map, layout.tallBlock);
  }
  layout = L;
  renderer.setLayout(L, map, window.devicePixelRatio || 1);
  if (fireworks) fireworks.resize(renderer.offW, renderer.offH);

  const s = els.board.style;
  s.left = `${L.left}px`;
  s.top = `${L.top}px`;
  s.width = `${L.boardW}px`;
  s.height = `${L.boardH}px`;
  s.setProperty('--tile', `${L.tile}px`);
  s.setProperty('--hud-font', `${Math.max(7, Math.min(20, Math.floor(Math.min(L.tile * 0.42, L.boardW / 62))))}px`);

  const b = map.block;
  const box = els.box.style;
  box.left = `${b.x0 * L.tile}px`;
  box.top = `${(b.y0 + 1) * L.tile}px`;
  box.width = `${(b.x1 - b.x0 + 1) * L.tile}px`;
  box.height = `${(b.y1 - b.y0 + 1) * L.tile}px`;
  fitCountdown();
}

/** Layout that fits an existing map's grid into the viewport. */
function fitLayout(W, H, m, tallBlock) {
  const tile = Math.max(4, Math.min(Math.floor(W / m.w), Math.floor(H / (m.h + 1))));
  const boardW = m.w * tile, boardH = (m.h + 1) * tile;
  return {
    cols: m.w, rows: m.h, tile, boardW, boardH, tallBlock,
    left: Math.floor((W - boardW) / 2),
    top: Math.max(0, Math.floor((H - boardH) / 2)),
  };
}

/** Size the countdown text (monospace pixel font: 1 glyph ≈ 1em wide). */
function fitCountdown() {
  if (!layout) return;
  const b = map.block;
  const w = (b.x1 - b.x0 + 1) * layout.tile - layout.tile;
  const h = (b.y1 - b.y0 + 1) * layout.tile - layout.tile * 0.6;
  if (state === 'EXPIRED') {
    els.countdown.style.fontSize = `${Math.max(8, Math.floor(Math.min(w / 15, h * 0.6)))}px`;
    return;
  }
  const sub = Math.max(6, Math.floor(w / 33));
  const main = Math.max(8, Math.floor(Math.min(w / 17, (h - sub * 1.6) / 1.3)));
  els.sub.style.fontSize = `${sub}px`;
  els.countdown.style.fontSize = `${main}px`;
}

let resizeTimer = 0;
const onResize = () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(relayout, 100);
};
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', onResize);

// --- HUD ---------------------------------------------------------------------

function formatMult(m) {
  const r = Math.round(m * 100) / 100;
  return `x${Number.isInteger(r) ? r.toFixed(1) : r}`;
}

function updateHud() {
  if (!game) return;
  const score = `PONTOS: ${String(Math.floor(game.score)).padStart(6, '0')}`;
  const mult = formatMult(game.multiplier());
  const key = score + mult;
  if (key === lastHud) return;
  lastHud = key;
  els.score.textContent = score;
  els.mult.textContent = mult;
}

// --- Main loop -----------------------------------------------------------------

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  if (state === 'PLAYING' && !paused) {
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS && state === 'PLAYING') {
      game.update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps >= MAX_STEPS) acc = 0; // drop backlog after a long stall
  } else {
    acc = 0;
  }

  if (state === 'GAME_OVER' && !modalShown) {
    caughtTimer -= dt;
    if (caughtTimer <= 0) {
      modalShown = true;
      modal.open({ score: game.score });
    }
  }

  if (state === 'EXPIRED' && fireworks) fireworks.update(dt);

  updateHud();
  renderer.draw({
    game,
    time,
    showActors: state !== 'EXPIRED',
    flash: state === 'GAME_OVER' && caughtTimer > 0 && Math.floor(caughtTimer * 10) % 2 === 0,
    fireworks: state === 'EXPIRED' ? fireworks : null,
  });
}

// --- Boot --------------------------------------------------------------------

relayout();
setMessage(READY_TEXT);
countdown.start(
  (text) => { if (state !== 'EXPIRED') els.countdown.textContent = text; },
  enterExpired,
);
if (document.fonts) document.fonts.ready.then(fitCountdown);
requestAnimationFrame(frame);
