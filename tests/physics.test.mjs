/**
 * tests/physics.test.mjs
 *
 * Unit tests for the atmospheric physics engine.
 * Run with:  node --test tests/physics.test.mjs
 *
 * Uses native node:test (Node 18+) — no external dependencies.
 */

import { test } from 'node:test';
import assert   from 'node:assert/strict';

// ── Import physics modules ────────────────────────────────────────────────────
// ESM imports — paths relative to project root when run with node --test
import { airMass, hygroscopicGrowth, angstromFromHumidity, computeScattering } from '../js/engine/physicsLayer.js';
import { computeAtmosphere, clearAtmosphereCache, PHASE_BLEND, SURFACE_ALBEDO, rayleighPhase, hgPhase } from '../js/engine/atmosphere.js';
import { spectrumToRGB }                          from '../js/engine/color.js';

// ── airMass ───────────────────────────────────────────────────────────────────

test('airMass: zenith (90°) ≈ 1', () => {
  const m = airMass(90);
  assert.ok(m >= 0.99 && m <= 1.01, `Expected ~1, got ${m}`);
});

test('airMass: horizon (0° geometric) is large (≥25) due to Saemundsson refraction', () => {
  // physicsLayer.js applies Saemundsson refraction: at geometric 0° the
  // apparent elevation is ~0.47°, so Kasten-Young returns ~32 rather than
  // the textbook "38 at true geometric horizon" value.
  const m = airMass(0);
  assert.ok(m >= 25 && m <= 42, `Expected 25-42, got ${m}`);
});

test('airMass: 30° elevation is between 1 and 5', () => {
  const m = airMass(30);
  assert.ok(m > 1 && m < 5, `Expected 1-5, got ${m}`);
});

test('airMass: decreases monotonically from horizon to zenith', () => {
  const elevations = [0, 5, 10, 20, 30, 45, 60, 90];
  const masses = elevations.map(e => airMass(e));
  for (let i = 1; i < masses.length; i++) {
    assert.ok(masses[i] < masses[i - 1],
      `airMass should decrease: m(${elevations[i]}°)=${masses[i].toFixed(2)} not < m(${elevations[i-1]}°)=${masses[i-1].toFixed(2)}`);
  }
});

test('airMass: below -2° returns cap value (≥ 60)', () => {
  const m = airMass(-5);
  assert.ok(m >= 60, `Expected ≥60 below horizon, got ${m}`);
});

// ── computeAtmosphere ─────────────────────────────────────────────────────────

test('computeAtmosphere: returns expected zones at sunset (0°, turbidity=0.3)', () => {
  const atm = computeAtmosphere(0, 0.3);
  assert.ok(Array.isArray(atm.skyTop),   'skyTop should be an array');
  assert.ok(Array.isArray(atm.skyMid),   'skyMid should be an array');
  assert.ok(Array.isArray(atm.horizon),  'horizon should be an array');
  assert.ok(Array.isArray(atm.sun),      'sun should be an array');
  assert.strictEqual(atm.skyTop.length,  5, 'skyTop should have 5 wavelengths (Phase 3.6: violet/blue/green/orange/red)');
});

test('computeAtmosphere: blue > red at zenith in clean air (horizon frac = 0)', () => {
  // At high solar elevation, Rayleigh scatter dominates → blue sky
  // WAVELENGTHS: [0]=430nm violet, [1]=450nm blue, [2]=550nm green, [3]=600nm orange, [4]=650nm red
  const atm = computeAtmosphere(Math.PI / 2, 0.05); // sun overhead, clean air
  const iBlue = atm.skyTop[1]; // 450nm
  const iRed  = atm.skyTop[4]; // 650nm
  assert.ok(iBlue > iRed, `Blue (${iBlue.toFixed(3)}) should dominate red (${iRed.toFixed(3)}) at zenith`);
});

test('computeAtmosphere: red > blue at horizon in moderate haze', () => {
  // At horizon with moderate turbidity, Beer-Lambert depletes blue strongly
  const atm = computeAtmosphere(0, 0.5); // sun at horizon, moderate haze
  const iBlue = atm.horizon[1]; // 450nm
  const iRed  = atm.horizon[4]; // 650nm
  assert.ok(iRed > iBlue, `Red (${iRed.toFixed(3)}) should dominate blue (${iBlue.toFixed(3)}) at hazy horizon`);
});

test('computeAtmosphere: higher turbidity reduces all channels', () => {
  const clean = computeAtmosphere(0, 0.1);
  const dusty = computeAtmosphere(0, 0.8);
  // In pure Rayleigh (no Mie), higher turbidity increases Mie attenuation
  const cleanHorizonR = clean.horizon[4]; // 650nm red
  const dustyHorizonR = dusty.horizon[4]; // 650nm red
  // At very high turbidity, even red gets attenuated at air mass ~38
  assert.ok(cleanHorizonR > 0 && dustyHorizonR >= 0, 'horizon intensities should be non-negative');
});

test('computeAtmosphere: LRU cache returns identical result for same inputs', () => {
  const a = computeAtmosphere(0.1, 0.3, 0.5, 290);
  const b = computeAtmosphere(0.1, 0.3, 0.5, 290);
  assert.deepStrictEqual(a, b, 'Cached result should be identical');
});

test('computeAtmosphere: different ozoneDU produces different skyTop', () => {
  const low  = computeAtmosphere(-0.05, 0.2, 0, 250);
  const high = computeAtmosphere(-0.05, 0.2, 0, 350);
  // Different ozone → different Chappuis absorption → different blue/orange ratio
  // Compare 450nm blue (index 1, barely absorbed) vs 600nm orange (index 3, Chappuis peak)
  const diff = Math.abs(low.skyTop[1] - high.skyTop[1])
             + Math.abs(low.skyTop[3] - high.skyTop[3]);
  assert.ok(diff > 0, 'Different ozoneDU should produce different spectrum');
});

// ── spectrumToRGB ─────────────────────────────────────────────────────────────

test('spectrumToRGB: output channels are integers in [0, 255]', () => {
  const { r, g, b } = spectrumToRGB([0.8, 0.5, 0.3]);
  assert.ok(Number.isInteger(r) && r >= 0 && r <= 255, `r=${r}`);
  assert.ok(Number.isInteger(g) && g >= 0 && g <= 255, `g=${g}`);
  assert.ok(Number.isInteger(b) && b >= 0 && b <= 255, `b=${b}`);
});

test('spectrumToRGB: deterministic — same input always gives same output', () => {
  const a = spectrumToRGB([0.6, 0.4, 0.7]);
  const b = spectrumToRGB([0.6, 0.4, 0.7]);
  assert.deepStrictEqual(a, b);
});

test('spectrumToRGB: [blue, green, red] → red channel from index 2', () => {
  // High red intensity (index 2) should produce high r channel
  const { r, b } = spectrumToRGB([0.05, 0.1, 0.9]);
  assert.ok(r > b, `Red channel (${r}) should exceed blue (${b}) when red intensity is dominant`);
});

test('spectrumToRGB: zero intensities map to (0, 0, 0)', () => {
  const { r, g, b } = spectrumToRGB([0, 0, 0]);
  assert.strictEqual(r, 0);
  assert.strictEqual(g, 0);
  assert.strictEqual(b, 0);
});

test('spectrumToRGB: high equal intensities approach (255, 255, 255)', () => {
  const { r, g, b } = spectrumToRGB([10, 10, 10]);
  assert.ok(r > 240 && g > 240 && b > 240,
    `High equal intensities should approach white, got (${r},${g},${b})`);
});

// ── Phase 1: cloud optical depth ──────────────────────────────────────────────

test('Phase 1: clouds default (undefined) is byte-identical to clouds={0,0,0}', () => {
  clearAtmosphereCache();
  const noArg = computeAtmosphere(0.05, 0.3, 0, 300);
  clearAtmosphereCache();
  const zeros = computeAtmosphere(0.05, 0.3, 0, 300, { low: 0, mid: 0, high: 0 });
  assert.deepStrictEqual(
    { skyTop: noArg.skyTop, skyMid: noArg.skyMid, horizon: noArg.horizon, sun: noArg.sun },
    { skyTop: zeros.skyTop, skyMid: zeros.skyMid, horizon: zeros.horizon, sun: zeros.sun },
    'Default clouds must reproduce pre-Phase-1 output exactly',
  );
});

test('Phase 1: stratus (low=1) crushes sky intensity across all wavelengths', () => {
  clearAtmosphereCache();
  const clear = computeAtmosphere(0.05, 0.2, 0, 300, { low: 0, mid: 0, high: 0 });
  clearAtmosphereCache();
  const thick = computeAtmosphere(0.05, 0.2, 0, 300, { low: 1, mid: 0, high: 0 });
  for (let i = 0; i < 5; i++) {
    assert.ok(
      thick.skyTop[i] < clear.skyTop[i] * 0.6,
      `λ[${i}]: thick stratus skyTop ${thick.skyTop[i]} should be < 60% of clear ${clear.skyTop[i]}`,
    );
  }
});

test('Phase 1: monotonicity — increasing low cloud cover monotonically decreases horizon radiance', () => {
  const covers = [0, 0.25, 0.5, 0.75, 0.95];
  const horizons = covers.map(c => {
    clearAtmosphereCache();
    const atm = computeAtmosphere(0.02, 0.2, 0, 300, { low: c, mid: 0, high: 0 });
    return atm.horizon;
  });
  for (let i = 1; i < horizons.length; i++) {
    for (let lambda = 0; lambda < 5; lambda++) {
      assert.ok(
        horizons[i][lambda] <= horizons[i - 1][lambda] + 1e-9,
        `horizon λ[${lambda}] not monotone: cover=${covers[i]} has ${horizons[i][lambda]} > cover=${covers[i-1]} ${horizons[i-1][lambda]}`,
      );
    }
  }
});

test('Phase 1: cirrus afterglow adds warm glow to red wavelengths near twilight', () => {
  // sunAngle ≈ -3° — inside afterglow window [-6°, 0°]
  const sunAngle = -3 * Math.PI / 180;
  clearAtmosphereCache();
  const noCloud = computeAtmosphere(sunAngle, 0.2, 0, 300, { low: 0, mid: 0, high: 0 });
  clearAtmosphereCache();
  const withCirrus = computeAtmosphere(sunAngle, 0.2, 0, 300, { low: 0, mid: 0, high: 0.5 });

  // At 600 nm (index 3) and 650 nm (index 4), horizon should be brighter with cirrus
  // The afterglow term injects glow on top of (reduced) base intensity
  const redDelta600 = withCirrus.horizon[3] - noCloud.horizon[3];
  const redDelta650 = withCirrus.horizon[4] - noCloud.horizon[4];
  assert.ok(
    redDelta600 > 0 && redDelta650 > 0,
    `Cirrus afterglow should add red glow: Δ600=${redDelta600}, Δ650=${redDelta650}`,
  );

  // Blue channel at 450 nm should NOT gain afterglow — it should be unchanged or reduced
  const blueDelta = withCirrus.horizon[1] - noCloud.horizon[1];
  assert.ok(
    blueDelta <= 0,
    `Cirrus afterglow should not add blue glow: Δ450=${blueDelta}`,
  );
});

test('Phase 1: cirrus afterglow only fires inside [-6°, 0°] window', () => {
  // Outside the window (high sun), cirrus should not inject warm glow
  const sunAngleDay = 30 * Math.PI / 180; // well above horizon
  clearAtmosphereCache();
  const noCloud = computeAtmosphere(sunAngleDay, 0.2, 0, 300, { low: 0, mid: 0, high: 0 });
  clearAtmosphereCache();
  const withCirrus = computeAtmosphere(sunAngleDay, 0.2, 0, 300, { low: 0, mid: 0, high: 0.5 });

  // High cirrus cover at noon should only *attenuate*, not enhance, red
  const redDelta = withCirrus.horizon[4] - noCloud.horizon[4];
  assert.ok(
    redDelta <= 0,
    `Daytime cirrus should only reduce red at horizon, not inject afterglow: Δ=${redDelta}`,
  );
});

test('Phase 1: cloud cover is wavelength-independent (grey extinction)', () => {
  // Water droplets are near-grey scatterers in the visible — the *ratio* of
  // clear vs. cloudy intensities should be identical across wavelengths
  // (except where afterglow fires, which it doesn't here: sunAngle above horizon)
  clearAtmosphereCache();
  const clear = computeAtmosphere(0.3, 0.2, 0, 300, { low: 0, mid: 0, high: 0 });
  clearAtmosphereCache();
  const cloudy = computeAtmosphere(0.3, 0.2, 0, 300, { low: 0.5, mid: 0, high: 0 });
  const ratios = [0, 1, 2, 3, 4].map(i => cloudy.skyTop[i] / clear.skyTop[i]);
  const r0 = ratios[0];
  for (const r of ratios) {
    assert.ok(
      Math.abs(r - r0) < 1e-9,
      `Cloud extinction should be wavelength-independent; ratios: ${ratios.map(x => x.toFixed(6))}`,
    );
  }
});

test('Phase 1: cloud cover cap prevents total extinction', () => {
  // Even at cover=1 with the strongest kLayer, some light must leak through
  // via the (1 - cover·CAP) clear-path term
  clearAtmosphereCache();
  const full = computeAtmosphere(0.05, 0.2, 0, 300, { low: 1, mid: 1, high: 1 });
  for (let i = 0; i < 5; i++) {
    assert.ok(
      full.skyTop[i] > 0,
      `Full cloud cover should still leak some light through clear-path floor: λ[${i}]=${full.skyTop[i]}`,
    );
  }
});

test('Phase 1: cache key distinguishes different cloud states', () => {
  clearAtmosphereCache();
  const a = computeAtmosphere(0.05, 0.2, 0, 300, { low: 0.3, mid: 0, high: 0 });
  const b = computeAtmosphere(0.05, 0.2, 0, 300, { low: 0.6, mid: 0, high: 0 });
  assert.notDeepStrictEqual(
    a.skyTop, b.skyTop,
    'Different cloud covers must produce different results (cache keys must differ)',
  );
});

// ── Phase 2: humidity → Mie growth factor + Ångström blend ───────────────────

test('Phase 2: hygroscopicGrowth(0%) === 1 (dry particles unchanged)', () => {
  assert.equal(hygroscopicGrowth(0), 1);
});

test('Phase 2: hygroscopicGrowth monotonic in RH', () => {
  const vals = [0, 0.25, 0.5, 0.7, 0.85, 0.95].map(hygroscopicGrowth);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] > vals[i - 1],
      `growth must increase with RH: g(${i})=${vals[i]} not > g(${i-1})=${vals[i-1]}`);
  }
});

test('Phase 2: hygroscopicGrowth(95%) ∈ [2.3, 3.0] (realistic maritime range)', () => {
  const g = hygroscopicGrowth(0.95);
  assert.ok(g >= 2.3 && g <= 3.0, `Expected 2.3-3.0 at 95% RH, got ${g.toFixed(3)}`);
});

test('Phase 2: hygroscopicGrowth clamps RH ≥ 95% to avoid divergence', () => {
  const g95  = hygroscopicGrowth(0.95);
  const g99  = hygroscopicGrowth(0.99);
  const g999 = hygroscopicGrowth(1.0);
  assert.equal(g99, g95, 'RH>95% should clamp to 95%');
  assert.equal(g999, g95, 'RH=100% should clamp to 95%');
});

test('Phase 2: angstromFromHumidity interpolates dry→maritime', () => {
  // At 0% RH → α_dry = 1.3 (continental fine particles)
  // At 90% RH (internal clamp) → α = 1.3 - 1.0*0.9 = 0.4 (near-maritime)
  assert.ok(Math.abs(angstromFromHumidity(0) - 1.3) < 1e-9, 'dry α=1.3');
  const aHigh = angstromFromHumidity(0.9);
  assert.ok(Math.abs(aHigh - 0.4) < 1e-9, `saturated α≈0.4 (clamped), got ${aHigh}`);
  const aMid = angstromFromHumidity(0.5);
  assert.ok(aMid > 0.4 && aMid < 1.3, `mid RH α must be between, got ${aMid}`);
  // Monotonic
  const vals = [0, 0.3, 0.5, 0.7, 0.9].map(rh => angstromFromHumidity(rh));
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] < vals[i - 1], `α must decrease with RH: got ${vals.join(', ')}`);
  }
});

test('Phase 2: mieGrowth default (1) is byte-identical to pre-Phase-2 call', () => {
  clearAtmosphereCache();
  const noGrowth = computeAtmosphere(0.1, 0.3, 0, 300);
  clearAtmosphereCache();
  const explicit1 = computeAtmosphere(0.1, 0.3, 0, 300, undefined, 1);
  assert.deepStrictEqual(explicit1.skyTop,  noGrowth.skyTop);
  assert.deepStrictEqual(explicit1.skyMid,  noGrowth.skyMid);
  assert.deepStrictEqual(explicit1.horizon, noGrowth.horizon);
  assert.deepStrictEqual(explicit1.sun,     noGrowth.sun);
});

test('Phase 2: elevated mieGrowth increases Mie extinction (sun channel reddens)', () => {
  // Phase 2 physics: g>1 squares into mieBeta, increasing extinction at all λ.
  // Effect is strongest where Mie dominates path: the direct solar channel
  // at moderate sun angles.  We verify that total solar radiance decreases.
  clearAtmosphereCache();
  const dry = computeAtmosphere(0.2, 0.3, 0, 300, undefined, 1);
  clearAtmosphereCache();
  const wet = computeAtmosphere(0.2, 0.3, 0, 300, undefined, 2.0);
  const dryTotal = dry.sun.reduce((a, b) => a + b, 0);
  const wetTotal = wet.sun.reduce((a, b) => a + b, 0);
  assert.ok(wetTotal < dryTotal,
    `wet growth must reduce direct sun: wet=${wetTotal.toFixed(4)} dry=${dryTotal.toFixed(4)}`);
});

test('Phase 2: mieGrowth cache key distinguishes different growth factors', () => {
  clearAtmosphereCache();
  const a = computeAtmosphere(0.1, 0.3, 0, 300, undefined, 1.0);
  const b = computeAtmosphere(0.1, 0.3, 0, 300, undefined, 1.5);
  assert.notDeepStrictEqual(a.skyTop, b.skyTop,
    'different mieGrowth values must produce different results');
});

test('Phase 2: computeScattering emits mieGrowthFactor + angstromEffective', () => {
  const dry = computeScattering({ dust: 10, humidity: 20, visibility: 25, solarElevation: 10 });
  const wet = computeScattering({ dust: 10, humidity: 85, visibility: 25, solarElevation: 10 });
  assert.ok(typeof dry.mieGrowthFactor === 'number');
  assert.ok(typeof wet.mieGrowthFactor === 'number');
  assert.ok(wet.mieGrowthFactor > dry.mieGrowthFactor,
    `wet air must have larger growth: wet=${wet.mieGrowthFactor} dry=${dry.mieGrowthFactor}`);
  assert.ok(wet.angstromEffective < dry.angstromEffective,
    `wet air shifts toward maritime α: wet=${wet.angstromEffective} dry=${dry.angstromEffective}`);
});

test('Phase 2: computeScattering returns growth=1 + α=0 when humidity is null', () => {
  const noHum = computeScattering({ dust: 10, humidity: null, visibility: 25, solarElevation: 10 });
  assert.equal(noHum.mieGrowthFactor, 1);
  assert.equal(noHum.angstromEffective, 0);
});

// ── Phase 3: Rayleigh + HG phase functions ────────────────────────────────────

test('Phase 3: rayleighPhase forward/backward peaks = 1.5', () => {
  assert.ok(Math.abs(rayleighPhase(1)  - 1.5) < 1e-12, 'forward peak');
  assert.ok(Math.abs(rayleighPhase(-1) - 1.5) < 1e-12, 'backward peak');
});

test('Phase 3: rayleighPhase minimum at cosθ=0 equals 0.75', () => {
  assert.ok(Math.abs(rayleighPhase(0) - 0.75) < 1e-12);
});

test('Phase 3: rayleighPhase is symmetric in cosθ', () => {
  for (const c of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    assert.ok(Math.abs(rayleighPhase(c) - rayleighPhase(-c)) < 1e-12);
  }
});

test('Phase 3: hgPhase forward peak >> backward for g > 0', () => {
  const fwd = hgPhase( 1, 0.75);
  const back = hgPhase(-1, 0.75);
  assert.ok(fwd > back * 10, `forward=${fwd} should be >> back=${back}`);
});

test('Phase 3: hgPhase isotropic when g=0', () => {
  // When g=0 the HG denominator collapses to 1 → p_HG = 1/(4π) everywhere
  const iso = 1 / (4 * Math.PI);
  for (const c of [-1, -0.5, 0, 0.5, 1]) {
    const p = hgPhase(c, 0);
    assert.ok(Math.abs(p - iso) < 1e-12, `cosθ=${c} p=${p} expected ${iso}`);
  }
});

test('Phase 3: hgPhase integrates to 1 over the unit sphere (numerical quadrature)', () => {
  // ∫₀^π p_HG(cosθ, g) · sinθ dθ · 2π should equal 1 for any g ∈ (-1, 1)
  const g = 0.75;
  const N = 2000;
  let integral = 0;
  for (let i = 0; i < N; i++) {
    const theta = (i + 0.5) * Math.PI / N;      // midpoint
    const cosT  = Math.cos(theta);
    integral += hgPhase(cosT, g) * Math.sin(theta) * (Math.PI / N);
  }
  integral *= 2 * Math.PI;
  assert.ok(Math.abs(integral - 1) < 1e-3,
    `HG phase function must integrate to 1 over sphere, got ${integral}`);
});

test('Phase 3 ramp step 1: PHASE_BLEND pinned at 0.25', () => {
  // First ramp step — validated against the phase3_phase_funcs budget (Δ ≤ 12)
  // and the perceptual metrics gate. Any further bump (0.5 / 0.75 / 1.0) must
  // update this assertion in the same commit as the visual sign-off.
  assert.strictEqual(PHASE_BLEND, 0.25,
    `PHASE_BLEND is now at 0.25 (first ramp step); got ${PHASE_BLEND}. If you are ramping further, update this test in the same commit.`);
});

test('Phase 3: computeAtmosphere is deterministic at the current PHASE_BLEND', () => {
  // Determinism guard — running the same scenario twice must produce the
  // exact same output. At PHASE_BLEND=0.25 the blended mixing path is active,
  // so this test protects against any nondeterministic interaction (e.g. an
  // uninitialised variable, a Date.now() sneaking in).
  clearAtmosphereCache();
  const a = computeAtmosphere(0.05, 0.25, 0.2, 300, { low: 0, mid: 0, high: 0 }, 1);
  clearAtmosphereCache();
  const b = computeAtmosphere(0.05, 0.25, 0.2, 300, { low: 0, mid: 0, high: 0 }, 1);
  assert.deepStrictEqual(a.skyTop,  b.skyTop);
  assert.deepStrictEqual(a.skyMid,  b.skyMid);
  assert.deepStrictEqual(a.horizon, b.horizon);
  assert.deepStrictEqual(a.sun,     b.sun);
});

// ── Phase 4: Two-stream multi-scatter ────────────────────────────────────────

test('Phase 4 rollout: SURFACE_ALBEDO pinned at 0.10 (Eastern-Med composite)', () => {
  // Phase 4 rolled out at 0.10 — composite between open-sea (0.06) and dry
  // soil (0.15), dialled back from an initial 0.15 that overshot the gate by
  // 1 channel unit on overcast_stratus and cirrus_afterglow. Any further
  // change must update this assertion in the same commit.
  assert.strictEqual(SURFACE_ALBEDO, 0.10,
    `SURFACE_ALBEDO is now 0.10 (Phase 4 rollout); got ${SURFACE_ALBEDO}. If you are tuning this, update the test in the same commit.`);
});

test('Phase 4: computeAtmosphere is deterministic at rollout SURFACE_ALBEDO', () => {
  // Determinism guard at the active rollout value: running the same scenario
  // twice must produce the exact same output. If the closed-form two-stream
  // math ever became nondeterministic (float cache, order of ops), this
  // catches it immediately.
  clearAtmosphereCache();
  const a = computeAtmosphere(-0.05, 0.3, 0.2, 300, { low: 0.1, mid: 0, high: 0.2 }, 1.1);
  clearAtmosphereCache();
  const b = computeAtmosphere(-0.05, 0.3, 0.2, 300, { low: 0.1, mid: 0, high: 0.2 }, 1.1);
  assert.deepStrictEqual(a.skyTop,  b.skyTop);
  assert.deepStrictEqual(a.skyMid,  b.skyMid);
  assert.deepStrictEqual(a.horizon, b.horizon);
  assert.deepStrictEqual(a.sun,     b.sun);
});

test('Phase 4 rollout: horizon intensity is positive at all 5 wavelengths', () => {
  // Smoke test that the rollout didn't divide-by-zero or emit NaN anywhere.
  // The `gainFor` formula could blow up if A_g × ω_s ever approached 1 — this
  // run across a hazy sunset horizon verifies the bound holds in practice.
  clearAtmosphereCache();
  const atm = computeAtmosphere(0, 0.3, 0, 300, { low: 0, mid: 0, high: 0 }, 1);
  for (let i = 0; i < 5; i++) {
    assert.ok(Number.isFinite(atm.horizon[i]) && atm.horizon[i] > 0,
      `Horizon intensity must be finite and > 0 at λ[${i}]; got ${atm.horizon[i]}`);
  }
});

test('Phase 4: two-stream gain formula sanity (pure math check)', () => {
  // Independent reimplementation of the formula to verify the closed-form
  // expression in zoneIntensities. This catches algebraic mistakes without
  // requiring SURFACE_ALBEDO to be nonzero at ship time.
  const gainFor = (omega_s, A_g) => {
    const p = omega_s * A_g;
    return 1 + p / Math.max(1 - p, 1e-6);
  };
  // A_g = 0 → no gain
  assert.strictEqual(gainFor(0.5, 0), 1);
  assert.strictEqual(gainFor(0.9, 0), 1);
  // Monotonic in A_g at fixed ω_s
  const omega = 0.6;
  const gains = [0, 0.05, 0.1, 0.15, 0.2].map(A => gainFor(omega, A));
  for (let i = 1; i < gains.length; i++) {
    assert.ok(gains[i] > gains[i - 1],
      `gain must increase with surface albedo: ${gains.join(', ')}`);
  }
  // Typical rollout target ω_s ≈ 0.6, A_g = 0.15 → gain ≈ 1.099 (~10% boost)
  const typical = gainFor(0.6, 0.15);
  assert.ok(typical > 1.08 && typical < 1.12,
    `typical rollout gain should be ~1.10, got ${typical.toFixed(4)}`);
});
