#!/usr/bin/env node
// Builds data/ranking.json from the submissions queued in the Worker.
//
//   node scripts/build-ranking.js         fetch pending → filter → merge → write
//   node scripts/build-ranking.js --ack   delete the processed submissions
//
// Env: WORKER_URL, WORKER_TOKEN. For local testing, PENDING_FILE=<json> can
// replace the Worker fetch (same shape as GET /pending: { items: [...] }).
// Writes `changed` and `count` to $GITHUB_OUTPUT when available.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RANKING_FILE = path.join(ROOT, 'data', 'ranking.json');
const BLOCKLIST_FILE = path.join(ROOT, 'data', 'blocklist.txt');
const ACK_FILE = path.join(ROOT, '.ranking-ack.json');
const TOP = 100;
const MAX_NAME = 50;
const MAX_SCORE = 100_000_000;

const LEET = { 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g',
  '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e' };

/** Lowercase, strip accents, undo leetspeak, keep letters only, collapse repeats. */
export function normalize(s) {
  return String(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9@$!|+€]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

/**
 * Blocklist format: one term per line, '#' comments. Terms are matched as
 * substrings of the normalized name; terms prefixed with '=' only match a
 * whole word (for short words that appear inside innocent ones).
 */
export function loadBlocklist(file = BLOCKLIST_FILE) {
  const substr = [];
  const words = new Set();
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('=')) words.add(normalize(line.slice(1)));
    else substr.push(normalize(line));
  }
  return { substr: substr.filter(Boolean), words };
}

export function isOffensive(name, blocklist) {
  const tokens = String(name).split(/[\s._\-,;:/\\]+/).map(normalize).filter(Boolean);
  if (tokens.some((t) => blocklist.words.has(t))) return true;
  const joined = normalize(name);
  return blocklist.substr.some((term) => joined.includes(term));
}

export function validEntry(e) {
  return e && typeof e.name === 'string' && e.name.trim().length > 0 && e.name.length <= MAX_NAME
    && Number.isSafeInteger(e.score) && e.score > 0 && e.score <= MAX_SCORE
    && Number.isFinite(e.ts);
}

/** Merge, sort by score desc then earliest timestamp, dedupe and keep the top N. */
export function mergeRanking(existing, incoming) {
  const seen = new Set();
  return existing.concat(incoming)
    .filter(validEntry)
    .map(({ name, score, ts }) => ({ name: name.trim(), score, ts }))
    .sort((a, b) => b.score - a.score || a.ts - b.ts)
    .filter((e) => {
      const k = `${e.name}|${e.score}|${e.ts}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, TOP);
}

function setOutput(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  console.log(lines);
}

function workerConfig() {
  const url = (process.env.WORKER_URL || '').replace(/\/+$/, '');
  const token = process.env.WORKER_TOKEN || '';
  return { url, token, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

async function fetchPending() {
  if (process.env.PENDING_FILE) return JSON.parse(fs.readFileSync(process.env.PENDING_FILE, 'utf8')).items || [];
  const { url, token, headers } = workerConfig();
  if (!url || !token) return null;
  const res = await fetch(`${url}/pending`, { headers });
  if (!res.ok) throw new Error(`GET /pending failed: HTTP ${res.status}`);
  return (await res.json()).items || [];
}

async function build() {
  const items = await fetchPending();
  if (items === null) {
    console.log('WORKER_URL/WORKER_TOKEN not set; nothing to do.');
    setOutput({ changed: 'false', count: 0 });
    return;
  }

  const blocklist = loadBlocklist();
  const existing = JSON.parse(fs.readFileSync(RANKING_FILE, 'utf8'));
  const accepted = [];
  let rejected = 0;
  for (const it of items) {
    const entry = { name: String(it.name ?? '').trim(), score: it.score, ts: it.ts };
    if (!validEntry(entry) || isOffensive(entry.name, blocklist)) { rejected++; continue; }
    accepted.push(entry);
  }

  const merged = mergeRanking(existing, accepted);
  const changed = JSON.stringify(merged) !== JSON.stringify(existing);
  if (changed) fs.writeFileSync(RANKING_FILE, `${JSON.stringify(merged, null, 2)}\n`);

  // Every fetched submission is processed (accepted, filtered or invalid).
  fs.writeFileSync(ACK_FILE, JSON.stringify(items.map((it) => it.key).filter(Boolean)));
  console.log(`pending=${items.length} accepted=${accepted.length} rejected=${rejected}`);
  setOutput({ changed: String(changed), count: items.length });
}

async function ackProcessed() {
  if (!fs.existsSync(ACK_FILE)) { console.log('No ack file; nothing to acknowledge.'); return; }
  const keys = JSON.parse(fs.readFileSync(ACK_FILE, 'utf8'));
  const { url, token, headers } = workerConfig();
  if (!url || !token) throw new Error('WORKER_URL and WORKER_TOKEN are required for --ack');
  for (let i = 0; i < keys.length; i += 500) {
    const res = await fetch(`${url}/ack`, {
      method: 'POST', headers, body: JSON.stringify({ keys: keys.slice(i, i + 500) }),
    });
    if (!res.ok) throw new Error(`POST /ack failed: HTTP ${res.status}`);
  }
  fs.unlinkSync(ACK_FILE);
  console.log(`acknowledged=${keys.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv.includes('--ack') ? ackProcessed() : build()).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
