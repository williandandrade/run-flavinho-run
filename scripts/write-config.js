#!/usr/bin/env node
// Writes js/config.js (client feature flags) from environment variables.
// Used by deploy.yml, since the site itself has no build step.
//
//   node scripts/write-config.js [out]   default out: js/config.js
//
// Env: RANKING_ENABLED (false/0/off/no disables the ranking; anything else,
// including unset, keeps it on).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFF = new Set(['false', '0', 'off', 'no']);

export const isEnabled = (value) => !OFF.has(String(value ?? '').trim().toLowerCase());

const out = path.resolve(process.argv[2] || path.join(ROOT, 'js', 'config.js'));
const rankingEnabled = isEnabled(process.env.RANKING_ENABLED);

fs.writeFileSync(out, `// Feature flags. Overwritten at deploy time by scripts/write-config.js
// (from the RANKING_ENABLED env var); this committed copy is the local default.
export const RANKING_ENABLED = ${rankingEnabled};
`);
console.log(`RANKING_ENABLED=${rankingEnabled} → ${path.relative(process.cwd(), out)}`);
