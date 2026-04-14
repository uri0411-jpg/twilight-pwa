/**
 * lint_raw_css.mjs — Design freeze checkpoint for css/app.css
 *
 * Prevents CSS drift back into hardcoded values we've already tokenized.
 * Run via: node scripts/lint_raw_css.mjs
 * or:      npm run lint:css
 *
 * Rules:
 *   HARD  — fail immediately if count exceeds budget
 *   INFO  — print count, no failure (future migration targets)
 *
 * To update a budget: adjust the budget number below AND add a comment
 * explaining why the allowance exists. Never raise a budget silently.
 */

import { readFileSync } from 'node:fs';

const CSS_FILE = 'css/app.css';
const source = readFileSync(CSS_FILE, 'utf8');

// Strip block comments so we don't penalise commented-out code
const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');

let errors = 0;

function check(label, pattern, budget, mode = 'hard') {
  const matches = stripped.match(new RegExp(pattern, 'g')) ?? [];
  const count = matches.length;

  if (mode === 'hard') {
    if (count > budget) {
      console.error(`\n❌  ${label}`);
      console.error(`    found: ${count}  |  budget: ${budget}`);
      // Show up to 5 sample matches for quick diagnosis
      const uniq = [...new Set(matches)].slice(0, 5);
      uniq.forEach(m => console.error(`    · ${m.slice(0, 100)}`));
      errors++;
    } else {
      console.log(`✔   ${label}: ${count} / ${budget}`);
    }
  } else {
    // Informational — future migration target, no failure
    console.log(`ℹ   ${label}: ${count} remaining (future migration target)`);
  }
}

// ── HARD RULES ───────────────────────────────────────────────────────────────

// cubic-bezier() — fully migrated to --twl-motion-ease-* tokens in Phase 4c.
// Budget: 0. Any addition is a regression.
check(
  'raw cubic-bezier() (fully migrated to tokens)',
  'cubic-bezier\\(',
  0,
);

// Global z-index (≥ 100) outside of var() — should use layer tokens.
// Budget: 6 — current allowance covers:
//   · Leaflet map pane overrides (z-index: 190, 500, 999)
//   · Modal/sheet overlay (z-index: 1001, 9999)
//   · Deep overlay (z-index: 10000 — eruda debug panel)
// Reduce this budget as each is tokenized.
check(
  'raw z-index ≥ 100 (should use --twl-layer-* tokens)',
  'z-index:\\s*[1-9]\\d{2,}',
  6,
);

// ── INFORMATIONAL ─────────────────────────────────────────────────────────────
// These are noted as future migration targets but do NOT block CI.

// rgba() / rgb() — 300+ occurrences, gradual migration via --twl-color-* tokens.
check('raw rgba() / rgb() color literals', 'rgba?\\(', Infinity, 'info');

// Hard px font-sizes — gradual migration via --twl-font-size-* tokens.
check('raw font-size px literals', 'font-size:\\s*[0-9]', Infinity, 'info');

// ── RESULT ────────────────────────────────────────────────────────────────────
if (errors > 0) {
  console.error(`\nlint_raw_css: ${errors} error(s) — fix before committing.\n`);
  process.exit(1);
}
console.log('\nlint_raw_css: OK\n');
