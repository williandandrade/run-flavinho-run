// Countdown to the target instant, always computed from the wall clock.
// Debug: ?now=<ISO date> shifts "now" (time keeps flowing from there).

export const TARGET = Date.parse('2027-01-01T00:00:00-03:00'); // Brasília time

let offset = 0;
{
  const raw = new URLSearchParams(location.search).get('now');
  if (raw) {
    // A literal "+" in a query string decodes to a space; restore it.
    const t = Date.parse(raw.replace(' ', '+'));
    if (!Number.isNaN(t)) offset = t - Date.now();
  }
}

export const now = () => Date.now() + offset;
export const remaining = () => Math.max(0, TARGET - now());
export const isExpired = () => remaining() <= 0;

const pad2 = (n) => String(n).padStart(2, '0');

/** "DD dias HH:MM:SS" (seconds rounded up so 00:00:00 only shows at zero). */
export function format(ms) {
  const total = Math.ceil(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad2(d)} dias ${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** Tick once per second, aligned with second boundaries of the remaining time. */
export function start(onTick, onExpire) {
  const tick = () => {
    const r = remaining();
    onTick(format(r));
    if (r <= 0) { onExpire(); return; }
    setTimeout(tick, (r % 1000 || 1000) + 2);
  };
  tick();
}
