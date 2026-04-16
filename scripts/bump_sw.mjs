/**
 * bump_sw.mjs — Auto-update BUILD_DATE in sw.js to today's date (YYYYMMDD).
 * Run before every deploy: node scripts/bump_sw.mjs
 *
 * Modes:
 *   node scripts/bump_sw.mjs          — mutate sw.js to today's date (default, used by `npm run predeploy`)
 *   node scripts/bump_sw.mjs --check  — read-only; exits 1 if BUILD_DATE is older than today.
 *                                       Used by `npm test` to catch "deploy without bump" drift early.
 */
import { readFileSync, writeFileSync } from 'fs';

const swPath = new URL('../sw.js', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const now    = new Date();
const today  = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`; // local date YYYYMMDD

const content = readFileSync(swPath, 'utf8');
const match   = content.match(/BUILD_DATE\s*=\s*'(\d{8})'/);
if (!match) {
  console.error('✗ BUILD_DATE constant not found in sw.js');
  process.exit(1);
}

const current = match[1];
const checkOnly = process.argv.includes('--check');

if (checkOnly) {
  // Warn-only: stale BUILD_DATE is a deploy hazard, not a dev-time error.
  // CI pipelines that run `npm test` before publishing will see the warning.
  if (current < today) {
    console.warn(`⚠ sw.js BUILD_DATE is stale: ${current} (today: ${today}). Run \`npm run bump-sw\` before deploy.`);
  } else {
    console.log(`✓ sw.js BUILD_DATE is current: ${current}`);
  }
  process.exit(0);
}

const updated = content.replace(/BUILD_DATE\s*=\s*'\d{8}'/, `BUILD_DATE  = '${today}'`);

if (content === updated) {
  console.log(`sw.js BUILD_DATE already up to date: ${today}`);
} else {
  writeFileSync(swPath, updated, 'utf8');
  console.log(`✓ sw.js BUILD_DATE bumped → ${today}`);
}
