// Chiptune audio synthesized with the Web Audio API (no audio files).
// The context is created on the first user gesture, as browsers require.

const STORAGE_KEY = 'rfr_muted';
const STEP_TIME = 0.2;      // one 8th note at 150 BPM
const LOOKAHEAD = 0.12;     // seconds scheduled ahead

// Original 32-step loop (MIDI note numbers, 0 = rest).
const LEAD = [69, 0, 72, 69, 76, 0, 74, 72, 71, 0, 74, 71, 67, 0, 71, 74,
  69, 0, 72, 69, 76, 0, 79, 76, 74, 72, 71, 74, 72, 0, 69, 0];
const BASS = [45, 0, 45, 57, 45, 0, 45, 57, 43, 0, 43, 55, 43, 0, 43, 55,
  41, 0, 41, 53, 41, 0, 41, 53, 40, 0, 40, 52, 40, 0, 44, 0];

let ctx = null;
let master, musicBus, sfxBus, noiseBuffer;
let muted = loadMuted();
let musicTimer = null;
let step = 0;
let nextTime = 0;

function loadMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
}

const freq = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Create/resume the audio context. Call from a user gesture handler. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.5;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.8;
    sfxBus.connect(master);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    // iOS unlock: play a silent buffer inside the gesture.
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, 22050);
    src.connect(ctx.destination);
    src.start(0);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = value;
  try { localStorage.setItem(STORAGE_KEY, value ? '1' : '0'); } catch { /* storage unavailable */ }
  if (master) master.gain.setValueAtTime(value ? 0 : 1, ctx.currentTime);
}

export function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
export function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

function tone(type, f, t, dur, vol, bus, slideTo) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(bus);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(t, dur, vol, bus, highpass = 1000) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = highpass;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter).connect(gain).connect(bus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

// --- Music ----------------------------------------------------------------

function schedule() {
  while (nextTime < ctx.currentTime + LOOKAHEAD) {
    const i = step % LEAD.length;
    if (LEAD[i]) tone('square', freq(LEAD[i]), nextTime, STEP_TIME * 0.9, 0.06, musicBus);
    if (BASS[i]) tone('triangle', freq(BASS[i]), nextTime, STEP_TIME * 0.95, 0.18, musicBus);
    if (i % 2 === 0) noise(nextTime, 0.04, 0.03, musicBus, 6000);
    nextTime += STEP_TIME;
    step++;
  }
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  step = 0;
  nextTime = ctx.currentTime + 0.05;
  schedule();
  musicTimer = setInterval(schedule, 25);
}

export function stopMusic() {
  clearInterval(musicTimer);
  musicTimer = null;
}

// --- Sound effects ----------------------------------------------------------

/** Two-tone police siren blip (cop spawn). */
export function siren() {
  if (!ctx) return;
  const t = ctx.currentTime;
  for (let i = 0; i < 4; i++) tone('square', i % 2 ? 660 : 880, t + i * 0.09, 0.08, 0.05, sfxBus);
}

/** Descending "caught" jingle. */
export function caught() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [784, 659, 523, 392, 330].forEach((f, i) => tone('square', f, t + i * 0.11, 0.1, 0.08, sfxBus));
  tone('triangle', 165, t + 0.55, 0.5, 0.2, sfxBus, 82);
  noise(t, 0.15, 0.08, sfxBus, 800);
}

/** Fireworks pop + crackle. */
export function crackle() {
  if (!ctx) return;
  const t = ctx.currentTime;
  noise(t, 0.12, 0.12, sfxBus, 400);
  for (let i = 0; i < 8; i++) noise(t + 0.1 + Math.random() * 0.5, 0.02, 0.06, sfxBus, 3000);
}
