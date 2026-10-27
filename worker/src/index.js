// Cloudflare Worker: write path for the ranking.
//
//   POST /submit   { name, score }  → queues a submission in KV (202)
//   GET  /pending  (Bearer token)   → lists queued submissions
//   POST /ack      (Bearer token)   { keys: [...] } → deletes processed ones
//
// Bindings: RANKING_KV (KV namespace), ALLOWED_ORIGIN (var, comma-separated),
// WORKER_TOKEN (secret).

const MAX_NAME = 50;
const MAX_SCORE = 100_000_000;
const MAX_BODY = 1024;           // bytes
const RATE_LIMIT = 3;            // submissions per window per IP
const RATE_WINDOW = 60;          // seconds (KV minimum TTL)
const MAX_LIST = 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/submit' && request.method === 'POST') return await submit(request, env, cors, origin);
      if (url.pathname === '/pending' && request.method === 'GET') return await pending(request, env);
      if (url.pathname === '/ack' && request.method === 'POST') return await ack(request, env);
      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'internal' }, 500, cors);
    }
  },
};

function allowedOrigins(env) {
  return (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
}

function corsHeaders(origin, env) {
  const headers = { Vary: 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function submit(request, env, cors, origin) {
  if (!origin || !allowedOrigins(env).includes(origin)) return json({ error: 'forbidden_origin' }, 403, cors);

  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'too_large' }, 413, cors);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'invalid_json' }, 400, cors); }

  const name = typeof body?.name === 'string'
    ? body.name.replace(/[\u0000-\u001F\u007F]/g, '').trim()
    : '';
  if (!name || name.length > MAX_NAME) return json({ error: 'invalid_name' }, 400, cors);
  const score = body?.score;
  if (!Number.isSafeInteger(score) || score <= 0 || score > MAX_SCORE) {
    return json({ error: 'invalid_score' }, 400, cors);
  }

  // Basic per-IP rate limit (KV is eventually consistent, so this is best-effort).
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const rlKey = `rl:${ip}`;
  const count = parseInt((await env.RANKING_KV.get(rlKey)) || '0', 10);
  if (count >= RATE_LIMIT) {
    return json({ error: 'rate_limited' }, 429, { ...cors, 'Retry-After': String(RATE_WINDOW) });
  }
  await env.RANKING_KV.put(rlKey, String(count + 1), { expirationTtl: RATE_WINDOW });

  // The submission lives in the key's metadata so /pending needs only list().
  const ts = Date.now();
  await env.RANKING_KV.put(`sub:${ts}:${crypto.randomUUID()}`, '1', { metadata: { name, score, ts } });
  return json({ ok: true }, 202, cors);
}

function authorized(request, env) {
  const expected = env.WORKER_TOKEN;
  const header = request.headers.get('Authorization') || '';
  if (!expected || !header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7), expected);
}

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function pending(request, env) {
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  const items = [];
  let cursor;
  do {
    const page = await env.RANKING_KV.list({ prefix: 'sub:', cursor, limit: MAX_LIST });
    for (const k of page.keys) {
      if (k.metadata) items.push({ key: k.name, ...k.metadata });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && items.length < MAX_LIST);
  return json({ items });
}

async function ack(request, env) {
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const keys = Array.isArray(body?.keys)
    ? body.keys.filter((k) => typeof k === 'string' && k.startsWith('sub:')).slice(0, MAX_LIST)
    : [];
  await Promise.all(keys.map((k) => env.RANKING_KV.delete(k)));
  return json({ deleted: keys.length });
}
