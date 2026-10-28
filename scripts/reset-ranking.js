#!/usr/bin/env node
// Resets the ranking: empties data/ranking.json and discards the submissions
// still queued in the Worker, so scores from before the reset don't come back
// on the next build.
//
//   node scripts/reset-ranking.js                 reset file (+ purge queue if configured)
//   node scripts/reset-ranking.js --keep-pending  reset file only
//   node scripts/reset-ranking.js --purge-only    purge the queue only (after the commit)
//
// Env: WORKER_URL, WORKER_TOKEN (optional; without them the queue is left alone).
// Writes `changed` to $GITHUB_OUTPUT when available.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ackKeys, fetchPending, setOutput, workerConfig } from './build-ranking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RANKING_FILE = path.join(ROOT, 'data', 'ranking.json');

function resetFile() {
  const current = fs.existsSync(RANKING_FILE) ? fs.readFileSync(RANKING_FILE, 'utf8') : '';
  let entries = -1;
  try { entries = JSON.parse(current).length; } catch { /* missing or corrupt: rewrite it */ }
  const changed = entries !== 0;
  if (changed) fs.writeFileSync(RANKING_FILE, '[]\n');
  console.log(changed ? `ranking reset (${Math.max(entries, 0)} entries removed)` : 'ranking already empty');
  return changed;
}

async function purgeQueue() {
  const { url, token } = workerConfig();
  if (!url || !token) {
    console.log('WORKER_URL/WORKER_TOKEN not set; pending queue left untouched.');
    return;
  }
  // /pending returns at most 1000 per call; loop until the queue is empty.
  let total = 0;
  for (let round = 0; round < 50; round++) {
    const items = await fetchPending();
    const keys = items.map((it) => it.key).filter(Boolean);
    if (!keys.length) break;
    await ackKeys(keys);
    total += keys.length;
  }
  console.log(`pending submissions discarded=${total}`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--purge-only')) return purgeQueue();
  const changed = resetFile();
  setOutput({ changed: String(changed) });
  if (!args.includes('--keep-pending')) await purgeQueue();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
