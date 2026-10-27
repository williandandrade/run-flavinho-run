// Input: keyboard (arrows + WASD), on-screen D-pad and swipe gestures.
// Every input writes a buffered direction; any input also counts as "start".

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const SWIPE_MIN = 24; // CSS px

const isTyping = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

/**
 * @param {{ onDir(name: string): void, onAny(e: Event): void, isBlocked(): boolean }} handlers
 *   isBlocked() returns true while a modal owns the input.
 */
export function initInput({ onDir, onAny, isBlocked }) {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || isBlocked()) return;
    const dir = KEYMAP[e.code];
    if (dir || e.code === 'Space') e.preventDefault();
    if (dir) onDir(dir);
    if (!e.repeat) onAny(e);
  });

  // D-pad: one pointer-captured surface; the direction comes from the angle
  // to its center, so the thumb can slide between buttons.
  const pad = document.getElementById('dpad');
  const buttons = pad.querySelectorAll('[data-dir]');
  const highlight = (dir) => buttons.forEach((b) => b.classList.toggle('active', b.dataset.dir === dir));
  const padDir = (e) => {
    const r = pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.12) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    highlight(dir);
    onDir(dir);
  };
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isBlocked()) return;
    pad.setPointerCapture(e.pointerId);
    padDir(e);
    onAny(e);
  });
  pad.addEventListener('pointermove', (e) => {
    if (pad.hasPointerCapture(e.pointerId)) padDir(e);
  });
  const release = () => highlight(null);
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  // Taps and swipes anywhere else on the play surface.
  let swipe = null;
  window.addEventListener('pointerdown', (e) => {
    if (isBlocked() || e.target.closest('#dpad, button, input, #modal')) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
    onAny(e);
  });
  window.addEventListener('pointermove', (e) => {
    if (!swipe || swipe.id !== e.pointerId || e.pointerType === 'mouse') return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (Math.hypot(dx, dy) < SWIPE_MIN) return;
    onDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    swipe.x = e.clientX; // allow chained swipes without lifting the finger
    swipe.y = e.clientY;
  });
  const endSwipe = (e) => { if (swipe && swipe.id === e.pointerId) swipe = null; };
  window.addEventListener('pointerup', endSwipe);
  window.addEventListener('pointercancel', endSwipe);
}
