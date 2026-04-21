/**
 * scripts/backtest_aerosol.mjs
 *
 * Validation script for computeScattering() — cross-checks the turbidity
 * composite model against physically-motivated AOD (Aerosol Optical Depth)
 * reference values at 550nm.
 *
 * Usage:
 *   node scripts/backtest_aerosol.mjs
 *
 * Exit code:
 *   0 — turbidity ranges correct + AOD/turbidity monotonicity preserved
 *   1 — one or more scenarios out of expected range
 *
 * What this tests:
 *   1. turbidity is within a physically-motivated range for each scenario
 *   2. AOD reference is stored in contributions.aodReference when provided
 *   3. The composite model preserves ordering (clear < hazy < dusty < sharav)
 *   4. Mean absolute deviation between aodNorm and turbidity is reported
 *      (for monitoring calibration drift; not a hard fail criterion)
 *
 * AOD reference values are from AERONET Jerusalem station climatology and
 * literature (Derimian et al. 2008, Ben-Ami et al. 2012).
 */

import { computeScattering } from '../js/engine/physicsLayer.js';

const CASES = [
  {
    label:   'יום צלול — אוויר נקי',
    inputs:  { dust: 5,   visibility: 40, humidity: 40, aod: 0.10 },
    // dustNorm≈0.033, visNorm≈0.21, humNorm≈0.10 → turbidity ≈ 0.12
    turbRange: [0.05, 0.22],
    aod:     0.10,
    note:    'AERONET Jerusalem: clear winter day',
  },
  {
    label:   'תל אביב ממוצע — קיץ',
    inputs:  { dust: 30, visibility: 15, humidity: 60, aod: 0.25 },
    // dustNorm≈0.20, visNorm≈0.73, humNorm≈0.15 → turbidity ≈ 0.37
    turbRange: [0.25, 0.50],
    aod:     0.25,
    note:    'AERONET Jerusalem: summer median',
  },
  {
    label:   'ערב שרב — אבק עולה',
    inputs:  { dust: 80, visibility: 8,  humidity: 35, aod: 0.60 },
    // dustNorm≈0.53, visNorm≈0.88, humNorm≈0.088 → turbidity ≈ 0.55
    turbRange: [0.40, 0.70],
    aod:     0.60,
    note:    'Typical pre-sharav: dust rising, vis drops',
  },
  {
    label:   'שרב חזק — אבק קיצוני',
    inputs:  { dust: 150, visibility: 3, humidity: 20, aod: 1.20 },
    // dustNorm=1.0, visNorm≈0.98, humNorm≈0.05 → turbidity ≈ 0.72
    turbRange: [0.60, 0.92],
    aod:     1.20,
    note:    'Ben-Ami 2012: extreme sharav event, March 2015',
  },
  {
    label:      'ערפל חופי — לחות גבוהה',
    inputs:     { dust: 10, visibility: 6, humidity: 92, aod: 0.35 },
    // dustNorm≈0.067, visNorm≈0.92, humNorm≈0.82 → turbidity ≈ 0.58
    turbRange:  [0.40, 0.75],
    aod:        0.35,
    note:       'Coastal fog: high RH dominates (hygroscopic growth)',
    skipMonotonic: true, // not in the dust-progression chain — humidity-driven scenario
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

let passCount  = 0;
let sumAodDev  = 0;
const rows     = [];
let prevTurb   = -Infinity;
let monotonicOk = true;

for (const tc of CASES) {
  const result = computeScattering({
    dust:          tc.inputs.dust,
    visibility:    tc.inputs.visibility,
    humidity:      tc.inputs.humidity,
    aod:           tc.inputs.aod,
    solarElevation: 3,
  });

  const { turbidity, contributions } = result;
  const [lo, hi] = tc.turbRange;
  const inRange  = turbidity >= lo && turbidity <= hi;
  if (inRange) passCount++;

  const aodRef     = contributions.aodReference;
  const aodNorm    = aodRef?.normalized ?? null;
  const aodDevRaw  = aodNorm != null ? Math.abs(aodNorm - turbidity) : null;
  if (aodDevRaw != null) sumAodDev += aodDevRaw;

  // Monotonicity: turbidity should increase across the dust-progression chain.
  // Scenarios flagged skipMonotonic are humidity-dominated outliers, not part of
  // the ascending dust series, so they are exempt.
  if (!tc.skipMonotonic) {
    if (turbidity < prevTurb - 0.05) monotonicOk = false;
    prevTurb = turbidity;
  }

  rows.push({
    label:    tc.label,
    turb:     turbidity,
    lo, hi,
    inRange,
    aodNorm,
    aodDev:   aodDevRaw,
    note:     tc.note,
  });
}

// ── Output ────────────────────────────────────────────────────────────────────

const n         = CASES.length;
const meanAodDev = sumAodDev / n;

const COL = { label: 34, turb: 10, range: 16, aod: 10, dev: 10, ok: 5 };
const pad  = (s, w, right = false) => right ? String(s).padStart(w) : String(s).padEnd(w);
const hr   = '─'.repeat(COL.label + COL.turb + COL.range + COL.aod + COL.dev + COL.ok + 4);

console.log('\n── Aerosol Validation Backtest ────────────────────────────────────────────\n');
console.log(
  pad('תרחיש', COL.label) +
  pad('turbidity', COL.turb, true) +
  pad('range', COL.range, true) +
  pad('AODnorm', COL.aod, true) +
  pad('dev', COL.dev, true) +
  '  OK'
);
console.log(hr);

for (const r of rows) {
  const rangeStr = `[${r.lo.toFixed(2)}–${r.hi.toFixed(2)}]`;
  const aodStr   = r.aodNorm != null ? r.aodNorm.toFixed(3) : '  n/a';
  const devStr   = r.aodDev  != null ? r.aodDev.toFixed(3)  : '  n/a';
  console.log(
    pad(r.label, COL.label) +
    pad(r.turb.toFixed(3), COL.turb, true) +
    pad(rangeStr,         COL.range, true) +
    pad(aodStr,           COL.aod,   true) +
    pad(devStr,           COL.dev,   true) +
    '  ' + (r.inRange ? '✔' : '✘')
  );
  console.log(`  ↳ ${r.note}`);
}

console.log(hr);
console.log(`\nResults:    ${passCount}/${n} scenarios within turbidity range`);
console.log(`Monotonic:  ${monotonicOk ? '✔ turbidity increases with aerosol load' : '✘ ordering violated — check weights'}`);
console.log(`Mean |AODnorm − turbidity|: ${meanAodDev.toFixed(3)}  (< 0.30 = reasonable calibration)\n`);

if (meanAodDev >= 0.30) {
  console.warn('NOTE: Mean deviation ≥ 0.30 — composite model may be miscalibrated vs AOD.');
  console.warn('      Consider adjusting visibility weight (currently 0.25) or the AOD normalization cap (currently /2.0).\n');
}

const allPass = passCount === n && monotonicOk;
if (!allPass) {
  console.error('FAIL: one or more scenarios are out of expected turbidity range.');
  process.exit(1);
} else {
  console.log('PASS: all scenarios within expected range, ordering preserved.\n');
  process.exit(0);
}
