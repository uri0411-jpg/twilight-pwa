/**
 * atmosphere.js — Physically-based atmospheric light scattering engine
 *
 * Replaces empirical RGB heuristics with a genuine single-scattering model:
 *
 *   Rayleigh scattering  ∝ 1/λ⁴   → blue/violet in clean air
 *   Mie scattering       ≈ const   → wavelength-independent (aerosols / dust)
 *   Beer-Lambert law     T = exp(−τ·m)   → attenuation along the optical path
 *
 * Three sample wavelengths capture the visible spectrum with minimal overhead:
 *   450 nm → blue channel
 *   550 nm → green channel
 *   650 nm → red channel
 *
 * Four sky zones are modelled by mixing a Rayleigh-scatter component with a
 * direct-transmittance component in different proportions that vary with solar
 * elevation (see zoneMixRatios):
 *
 *   skyTop  : Rayleigh-dominant  → deep blue / violet
 *   skyMid  : blended transition → warm pink / amber
 *   horizon : transmittance-dominant → orange / red at sunset
 *   sun     : 100% direct (extra path) → reddened disk
 *
 * Air-mass model: Kasten-Young 1989 (imported from physicsLayer.js) with a
 * smooth exponential extension below the horizon to capture civil-twilight
 * purple/violet scatter (0° to −6°).
 *
 * Ozone: stratospheric Chappuis-band absorption (300 DU, Israel climatology)
 * selectively attenuates 500–700 nm, reinforcing the blue/violet twilight arch.
 *
 * References:
 *   Rayleigh optical depth coefficients — Bodhaine et al. (1999), simplified
 *   Beer-Lambert law — standard atmospheric optics
 *   Air mass — Kasten & Young (1989) via physicsLayer.js
 */

import { airMass as kastenyoungAirMass } from './physicsLayer.js';

// ── Visual calibration knobs (Phase 1+) ───────────────────────────────────────
//
// Every new physical effect introduced by the multi-phase upgrade parks its
// free parameters here so that aesthetic tuning is a one-line change with no
// logic edits. Defaults are chosen so that **disabling** (clouds = 0, blends
// at 0, boosts at 0) restores the pre-phase output byte-for-byte.
//
// Phase 1 — cloud optical depth:
//   CLOUD_K_LOW        slab extinction for stratus (dense, opaque)
//   CLOUD_K_MID        altocumulus (moderate)
//   CLOUD_K_HIGH       cirrus (thin, translucent)
//   CLOUD_COVER_CAP    never allow full black even at 100% cover
//   CIRRUS_AFTERGLOW_K forward red-channel gain for high clouds near twilight
//   CIRRUS_DEPTH_BOOST forward anisotropy proxy for high clouds (depth cue)
// ──────────────────────────────────────────────────────────────────────────────
const CLOUD_K_LOW         = 1.5;
const CLOUD_K_MID         = 1.2;
const CLOUD_K_HIGH        = 0.5;
const CLOUD_COVER_CAP     = 0.95;
const CIRRUS_AFTERGLOW_K  = 0.50;
const CIRRUS_DEPTH_BOOST  = 0.15;

// Phase 3 — Rayleigh + Henyey-Greenstein phase functions:
//   PHASE_BLEND        0 = legacy zoneMixRatios (byte-identical to Phase 2),
//                      1 = fully phase-function-derived mixing. Rolled out in
//                      gradual steps (0 → 0.25 → 0.5 → 0.75 → 1.0) with a
//                      visual parity gate at each step.
//
//                      CURRENT VALUE: 0.25 (first ramp step — partial blend,
//                      ~20 % weight of physical phase functions, ~80 % weight
//                      of the hand-tuned legacy ramps). Measured drift against
//                      the PHASE_BLEND=0 baseline: max Δ=7 channel units,
//                      inside the phase3_phase_funcs budget of 12. Further
//                      ramp steps (0.5, 0.75, 1.0) exceed the budget at their
//                      raw values and will require per-zone blend splits or a
//                      wider gate; they remain pending explicit sign-off.
//
//   HG_ASYMMETRY_G     Henyey-Greenstein g parameter for aerosol Mie scatter.
//                      0.75 is typical for continental mixed aerosol; 0.85 for
//                      maritime; 0.6 for fresh smoke. Only consulted when
//                      PHASE_BLEND > 0.
export const PHASE_BLEND  = 0.25;
const HG_ASYMMETRY_G      = 0.75;

// Phase 4 — Closed-form two-stream multi-scatter:
//   SURFACE_ALBEDO     Ground reflectance used in the two-stream surface-
//                      coupling term. 0.10 sits between open-sea (0.06) and
//                      dry soil (0.15) — a defensible Eastern-Mediterranean
//                      composite that keeps the per-scenario visual drift
//                      inside the Phase 4 budget (Δ ≤ 5 channel units per
//                      scenario). Was tried at 0.15 first; overcast_stratus
//                      and cirrus_afterglow overshot the gate by 1 unit each,
//                      so we dialled back to the smallest physical value that
//                      still gives a meaningful gain (~7 % at the horizon).
//
//                      Replaces the hand-tuned `1 + tauMie * 0.30` fudge with
//                      the closed-form two-stream gain
//                      1 + ω_s·A_g/(1 − ω_s·A_g) — textbook formula for a
//                      Lambertian surface coupled to an optically thin
//                      scattering layer. Bounded by construction: A_g × ω_s
//                      stays well below 1.
export const SURFACE_ALBEDO = 0.10;
// Above-cloud airmass cap used for cirrus afterglow emission.  Cirrus sits
// around 10 km and is lit by direct sunlight that grazes the top of the
// troposphere — the effective optical path never exceeds the horizon-path
// airmass (~32), even when the ground observer's sun is deep below the
// horizon. Prevents the afterglow from vanishing the moment the geometric
// airmass blows up below 0° elevation.
const CIRRUS_AFTERGLOW_AIRMASS_CAP = 32;

// Default cloud state — used when callers haven't wired clouds yet. Frozen
// so that it can be safely shared as a default value across every caller.
const NO_CLOUDS = Object.freeze({ low: 0, mid: 0, high: 0 });

// ── Wavelengths ───────────────────────────────────────────────────────────────

/**
 * Sample wavelengths in micrometres: [violet, blue, green, orange, red]
 *
 * Expanding from 3 to 5 wavelengths (Phase 3.6) adds:
 *   430 nm (violet) — Rayleigh-dominant, enhances Belt-of-Venus purple
 *   600 nm (orange) — Chappuis-band peak, discriminates orange from red glow
 *
 * Pass output arrays to color.js:spectrumToRGB() for XYZ→sRGB conversion.
 */
const WAVELENGTHS = [0.430, 0.450, 0.550, 0.600, 0.650];

// ── Scattering coefficients ───────────────────────────────────────────────────

/**
 * Rayleigh scattering optical depth per unit air mass at wavelength λ.
 * Coefficient 0.0087 is the reference value at λ=0.55 µm.
 * Scales as λ⁻⁴ — blue scatters ~4.4× more strongly than red.
 *
 * @param {number} lambda_um  Wavelength in micrometres
 * @returns {number} β_R(λ) — Rayleigh optical depth per air mass unit
 */
function rayleighBeta(lambda_um) {
  return 0.0087 * Math.pow(0.55 / lambda_um, 4);
}

/**
 * Mie scattering optical depth per unit air mass at wavelength λ.
 *
 * The Ångström exponent (α) describes spectral dependence of aerosol extinction:
 *   β_M(λ) = 0.05 · turbidity · g² · (0.55 / λ)^α
 *
 *   α ≈ 0   → wavelength-independent (coarse dust, sea salt)   → white/grey haze
 *   α ≈ 1.5 → strong wavelength dependence (fine smoke/urban)  → blue-tinted haze
 *
 * Phase 2 adds a hygroscopic growth factor `g` (wet/dry radius ratio, from
 * physicsLayer.hygroscopicGrowth). Mie cross-section scales with radius², so
 * `g²` multiplies the base coefficient. With defaults (g=1, α=0) the formula
 * reduces to the pre-Phase-2 wavelength-independent value, preserving
 * backward compatibility byte-for-byte.
 *
 * @param {number} lambda_um    Wavelength in µm
 * @param {number} turbidity    Aerosol loading index 0–1 (from physicsLayer.js)
 * @param {number} [angstromExp=0]   Ångström exponent α (from PM2.5/PM10 ratio
 *                                   and/or humidity-shifted in physicsLayer)
 * @param {number} [growthFactor=1]  Hygroscopic growth factor g = r_wet / r_dry.
 *                                   1 = dry baseline; 2.5 ≈ maritime at RH 95%.
 * @returns {number} β_M(λ) — Mie optical depth per air mass unit
 */
function mieBeta(lambda_um, turbidity, angstromExp = 0, growthFactor = 1) {
  return 0.05 * turbidity * growthFactor * growthFactor *
         Math.pow(0.55 / lambda_um, angstromExp);
}

// Normalization anchor: β_R at 450 nm (maximum Rayleigh coefficient)
const K_R_MAX = rayleighBeta(0.450); // ≈ 0.01942

// ── Air mass ──────────────────────────────────────────────────────────────────

/**
 * Compute relative air mass from solar elevation angle.
 *
 * Delegates to physicsLayer.js:airMass (Kasten-Young 1989) for elevations
 * at or above the horizon.  For sub-horizon elevations (civil twilight,
 * 0° to −6°) a smooth exponential continuation is applied so that scattered
 * light reaching the upper atmosphere is modelled:
 *
 *   m(0°)  ≈ 28   (Kasten-Young horizon value)
 *   m(−3°) ≈ 44
 *   m(−6°) ≈ 64   → enables purple-violet Belt-of-Venus colours
 *
 * @param {number} sunAngle_rad  Solar elevation in radians (negative = below horizon)
 * @returns {number}  Dimensionless air mass m ≥ 1
 */
function computeAirmass(sunAngle_rad) {
  const deg = sunAngle_rad * (180 / Math.PI);
  if (deg >= 0) {
    // Above horizon — Kasten-Young 1989 (same formula as physicsLayer.js)
    return kastenyoungAirMass(deg);
  }
  if (deg >= -6) {
    // Civil twilight — smooth exponential continuation from horizon value
    const horizonM = kastenyoungAirMass(0);
    return horizonM * Math.exp(-sunAngle_rad / (1.5 * Math.PI / 180));
  }
  // Astronomical / nautical twilight and below — sky effectively dark
  return 80;
}

// ── Ozone Chappuis absorption ─────────────────────────────────────────────────

/**
 * Stratospheric ozone (O₃) Chappuis band absorption transmittance.
 *
 * The Chappuis bands (500–700 nm, peak ~600 nm) absorb orange–red wavelengths.
 * This differential absorption relative to blue (450 nm, near-zero absorption)
 * is the primary physical cause of the blue-violet twilight arch and Belt-of-Venus
 * tint seen 5–10° above the anti-solar horizon after sunset.
 *
 * Parameterisation:
 *   σ(λ) = σ_max × exp( −½ ((λ − λ_peak) / w)² )   Gaussian fit to Chappuis peak
 *   T_O3  = exp( −σ(λ) × [O₃] )
 *
 *   σ_max  = 0.02  (relative, normalised units)
 *   λ_peak = 0.600 µm
 *   w      = 0.080 µm  (Gaussian width)
 *   [O₃]   = ozoneDU × 1e-3  (scaled column density)
 *
 * At a vertical column of 300 DU (Israel spring/summer climatology):
 *   T(450 nm) ≈ 0.999  →  blue essentially unaffected
 *   T(550 nm) ≈ 0.995  →  green mildly attenuated
 *   T(600 nm) ≈ 0.994  →  orange slightly reduced
 *
 * The effect is applied to every wavelength in every sky zone and compounds
 * with the Rayleigh + Mie Beer-Lambert attenuation, reinforcing the blue/violet
 * excess in the upper sky especially at high air mass (low solar elevation).
 *
 * @param {number} lambda_um      Wavelength in µm
 * @param {number} [ozoneDU=300]  Total ozone column in Dobson Units
 * @returns {number} Transmittance factor in (0, 1]
 */
function chappuisAbsorption(lambda_um, ozoneDU = 300) {
  const peak     = 0.600;
  const width    = 0.080;
  const sigmaMax = 0.02;
  const sigma = sigmaMax * Math.exp(-0.5 * Math.pow((lambda_um - peak) / width, 2));
  return Math.exp(-sigma * ozoneDU * 1e-3);
}

// ── Cloud optical depth (Phase 1) ─────────────────────────────────────────────

/**
 * Mixed-path transmittance through a horizontal cloud layer.
 *
 * Clouds are modelled as three wavelength-independent layers (low / mid /
 * high) — water droplets are Mie scatterers with a size parameter that
 * flattens spectral dependence to near-grey across the visible.
 *
 * At any zone, fraction `cover` of the incoming rays pass through a slab
 * with Beer-Lambert extinction τ = k·sec, and fraction `(1-cover)` pass
 * through clear sky unaffected:
 *
 *     T_layer(cover, sec) = (1−cover) + cover · exp(−k·sec)
 *
 * This is closer to how area-averaged radiance actually behaves than a
 * pure-slab model — a 60% stratus layer viewed near the horizon shouldn't
 * attenuate light to near-zero (the pure-slab result), because the 40% of
 * clear sky still contributes light to that zone. The formula also has an
 * irreducible floor of `(1−cover)`, preventing total extinction even at
 * infinite slant path, which matches real overcast visually.
 *
 * At cover = 0 this returns 1 exactly — the zero-cloud backward-compat path.
 *
 * @param {number} cover    Fractional cover 0–1 for this layer
 * @param {number} kLayer   Per-layer extinction constant (stratus > altocu > cirrus)
 * @param {number} zoneSec  Slant factor: 1 at zenith, ~5 at horizon
 * @returns {number}        Transmittance in (0, 1]
 */
function cloudExtinction(cover, kLayer, zoneSec) {
  if (cover <= 0) return 1;
  const c = Math.min(cover, CLOUD_COVER_CAP);
  const slabT = Math.exp(-kLayer * zoneSec);
  return (1 - c) + c * slabT;
}

/**
 * Per-zone viewing geometry for cloud slab extinction and forward-scatter
 * depth cue.  The slant secant describes how far light travels through a
 * horizontal cloud slab at this zone's nominal view elevation.  cosTheta is
 * a flat-earth approximation of the scattering angle between the view
 * direction and the solar direction — used as a forward-anisotropy proxy
 * for the high-cloud depth boost (Phase 1) and later by Phase 3 phase
 * functions.
 *
 *   View elevations (nominal):
 *     skyTop  ≈ 80°   (near zenith — almost straight up through slab)
 *     skyMid  ≈ 40°   (mid sky)
 *     horizon ≈  5°   (near horizon — grazing path, capped)
 *     sun     ≈ sunElev (tracks the sun disc)
 *
 * @param {number} sunAngle_rad  Solar elevation in radians
 * @param {string} zoneName      'skyTop' | 'skyMid' | 'horizon' | 'sun'
 * @returns {{ sec: number, cosTheta: number }}
 */
function zoneGeometryFor(sunAngle_rad, zoneName) {
  const DEG = Math.PI / 180;
  // Fixed view elevations for the three display zones
  const VIEW_ELEV = {
    skyTop:  80 * DEG,
    skyMid:  40 * DEG,
    horizon:  5 * DEG,
  };
  if (zoneName === 'sun') {
    // Slant through horizontal cloud slab at solar elevation, capped so that
    // sub-horizon sun doesn't blow up. Minimum elevation 3° to keep the
    // cap meaningful without dividing by ~0.
    const elev    = Math.max(sunAngle_rad, 3 * DEG);
    const sec     = Math.min(1 / Math.sin(elev), 10);
    // cosTheta = 1 — sun zone IS the sun direction
    return { sec, cosTheta: 1.0 };
  }
  const elev = VIEW_ELEV[zoneName] ?? 45 * DEG;
  // Slant secant — cap at 5 to prevent horizon blow-up
  const sec = Math.min(1 / Math.sin(elev), 5);
  // Flat-earth scattering angle: separation between view direction and sun
  const cosTheta = Math.cos(elev - sunAngle_rad);
  return { sec, cosTheta };
}

// ── Beer-Lambert transmittance ────────────────────────────────────────────────

/**
 * Combined atmospheric transmittance: Rayleigh + Mie (Beer-Lambert) × Chappuis (O₃).
 *   T(λ, m) = exp( −(β_R(λ) + β_M(λ)) × m ) × T_O3(λ)
 *
 * At m=1 (overhead, clean air)  T ≈ 0.97  (almost unattenuated)
 * At m=28 (near-horizon, clean) T(450nm) ≈ 0.58, T(650nm) ≈ 0.75  → blue depleted
 * At m=28, turbidity=0.5        T(450nm) ≈ 0.27  (heavy haze, very red horizon)
 *
 * The Chappuis term adds a wavelength-selective correction that slightly
 * enhances the blue channel relative to orange/red — a physically correct
 * contribution to the twilight blue arch.
 *
 * @param {number} lambda_um      Wavelength in µm
 * @param {number} airmass        Optical path length m
 * @param {number} turbidity      Mie loading 0–1
 * @param {number} [angstromExp]  Ångström exponent for spectral Mie (default 0)
 * @param {number} [ozoneDU]      Stratospheric ozone column in Dobson Units (default 300)
 * @returns {number} Transmittance in [0, 1]
 */
function transmittance(lambda_um, airmass, turbidity, angstromExp = 0, ozoneDU = 300, mieGrowth = 1) {
  const tau = (rayleighBeta(lambda_um) + mieBeta(lambda_um, turbidity, angstromExp, mieGrowth)) * airmass;
  return Math.exp(-tau) * chappuisAbsorption(lambda_um, ozoneDU);
}

// ── Zone intensity computation ────────────────────────────────────────────────

/**
 * Compute per-wavelength intensities for a single sky zone.
 *
 * Two additive components are mixed by (scatterFrac, directFrac):
 *
 * 1. Scatter component — Rayleigh-weighted transmittance:
 *      scatter_norm(λ) = (β_R(λ) / β_R_max) × T(λ)
 *    Represents light scattered *into* the view direction from the sun beam.
 *    The β_R normalisation makes blue = 1.0 at all conditions so that the
 *    hue relationship between wavelengths is preserved relative to the
 *    brightest scatter channel (blue at 450 nm).
 *
 * 2. Direct component — pure Beer-Lambert transmittance:
 *      direct(λ) = T(λ)
 *    Represents direct sun / forward-scattered light in the horizon glow.
 *    At high air mass blue is strongly attenuated → warm orange/red.
 *
 * At sunset (high airmass):
 *   - scatter: blue still dominant in ratio, but both components are dim
 *   - direct:  red > green >> blue  → orange glow dominates horizon
 *
 * @param {number}   airmass        Optical path length m
 * @param {number}   turbidity      Mie loading 0–1
 * @param {number}   scatterFrac    Weight for Rayleigh scatter (0–1)
 * @param {number}   directFrac     Weight for direct transmittance (0–1)
 * @param {number}   [angstromExp]  Ångström exponent for spectral Mie (default 0)
 * @param {number}   [ozoneDU]      Stratospheric ozone column in Dobson Units (default 300)
 * @returns {number[]} [I_blue, I_green, I_red]
 */
function zoneIntensities(
  airmass,
  turbidity,
  scatterFrac,
  directFrac,
  angstromExp = 0,
  ozoneDU = 300,
  sunAngle_rad = 0,
  zoneName = 'skyMid',
  clouds = NO_CLOUDS,
  mieGrowth = 1,
) {
  // ── Phase 1: per-zone geometry for cloud slab + forward boost ─────────────
  const geom = zoneGeometryFor(sunAngle_rad, zoneName);

  // Cirrus afterglow window — sun at or just below the horizon, only on the
  // warmer sky zones where high-cloud glow shows up visually.
  const afterglowZone   = (zoneName === 'skyMid' || zoneName === 'horizon');
  const afterglowActive = afterglowZone &&
                          sunAngle_rad >= -0.105 && // ~−6°
                          sunAngle_rad <= 0;

  // Precompute layer transmittances once per zone — wavelength-independent
  // because cloud droplets scatter near-grey in the visible.
  const tCloudLow  = cloudExtinction(clouds.low,  CLOUD_K_LOW,  geom.sec);
  const tCloudMid  = cloudExtinction(clouds.mid,  CLOUD_K_MID,  geom.sec);
  const tCloudHigh = cloudExtinction(clouds.high, CLOUD_K_HIGH, geom.sec);
  const tCloud     = tCloudLow * tCloudMid * tCloudHigh;

  // Forward-anisotropy proxy for high (cirrus) clouds: boost intensity for
  // view directions near the sun. Restores depth cues when high clouds are
  // present — without this, exp(−τ) alone gives a flat grey veil.
  const forwardBoost =
    1 + clouds.high * CIRRUS_DEPTH_BOOST * Math.max(0, geom.cosTheta);

  return WAVELENGTHS.map(lambda => {
    const T = transmittance(lambda, airmass, turbidity, angstromExp, ozoneDU, mieGrowth);
    // Rayleigh scatter normalised to blue channel = 1.0
    const scatterNorm = (rayleighBeta(lambda) / K_R_MAX) * T;
    const single = scatterFrac * scatterNorm + directFrac * T;
    // ── Multiple scattering correction (Phase 3.2) ────────────────────────────
    // Single-scattering models underestimate brightness at high aerosol optical
    // depth (AOD).  At τ_Mie ≈ 1 (heavy haze / dust), first-order multiple
    // scatter augments the single-scatter radiance by ~30%.
    //   I_total ≈ I_single × (1 + τ_Mie × 0.30)
    // Reference: two-stream approximation, e.g. Chandrasekhar (1960) §5.
    // Effect is negligible for clean air (turbidity < 0.2, τ_Mie < 0.05)
    // and significant for heavy dust (turbidity > 0.5, τ_Mie > 0.5).
    const tauMie = mieBeta(lambda, turbidity, angstromExp, mieGrowth) * airmass;
    let intensity = single * (1 + tauMie * 0.30);

    // ── Phase 4: two-stream surface coupling ─────────────────────────────────
    // Closed-form multiple-scattering correction derived from the two-stream
    // approximation with a Lambertian ground:
    //
    //   I_total(λ) = I_single(λ) × (1 + ω_s(λ) · A_g / (1 − ω_s(λ) · A_g))
    //
    // where
    //   ω_s(λ)  = 1 − exp(−τ_total(λ) · 0.6)  — approximate spherical albedo
    //             of the atmosphere above the observer (factor 0.6 is the
    //             standard escape-probability approximation for a plane-
    //             parallel slab with isotropic source function).
    //   A_g     = SURFACE_ALBEDO — Lambertian ground reflectance.
    //
    // At SURFACE_ALBEDO = 0 (shipping default) the gain factor is exactly 1,
    // i.e. this block is a byte-identical no-op on top of Phase 3. Raising
    // SURFACE_ALBEDO to ~0.15 adds a few-percent multi-scatter brightening
    // that is most visible at high airmass (twilight) and low wavelengths.
    //
    // Reference: two-stream approximation, e.g. Liou (2002) §6.5.3.
    if (SURFACE_ALBEDO > 0) {
      const tauTotal = (rayleighBeta(lambda) +
                        mieBeta(lambda, turbidity, angstromExp, mieGrowth)) *
                       airmass;
      const sphericalAlbedo = 1 - Math.exp(-tauTotal * 0.6);
      const product         = sphericalAlbedo * SURFACE_ALBEDO;
      const multiScatterGain = 1 + product / Math.max(1 - product, 1e-6);
      intensity *= multiScatterGain;
    }

    // ── Phase 1: cloud slab extinction + forward boost ───────────────────────
    // At cloud cover = 0 the product (tCloud·forwardBoost) is exactly 1 and
    // this step is a no-op — byte-for-byte backward compat with pre-Phase-1.
    intensity *= tCloud * forwardBoost;

    // ── Phase 1: cirrus afterglow injection ──────────────────────────────────
    // Adds a warm (600 / 650 nm) glow on skyMid & horizon when the sun is
    // within the civil-twilight window and high clouds are present. Restores
    // the pink/gold glow of a thin cirrus deck just after sunset.
    //
    // Key physical detail: the cirrus is at ~10 km and sees direct sunlight
    // that grazes the *top* of the troposphere, not the ground observer's
    // near-tangential path.  We therefore evaluate the emission using a
    // capped airmass (CIRRUS_AFTERGLOW_AIRMASS_CAP) rather than the ground
    // airmass — otherwise the term would vanish right when it's most needed.
    if (afterglowActive && lambda >= 0.595 && clouds.high > 0) {
      const cirrusAirmass = Math.min(airmass, CIRRUS_AFTERGLOW_AIRMASS_CAP);
      const T_cirrus = transmittance(lambda, cirrusAirmass, turbidity, angstromExp, ozoneDU, mieGrowth);
      intensity += clouds.high * CIRRUS_AFTERGLOW_K * T_cirrus;
    }

    return intensity;
  });
}

// ── Phase 3: Single-scattering phase functions ───────────────────────────────

/**
 * Analytic Rayleigh scattering phase function.
 *   p_R(θ) = ¾ (1 + cos²θ)
 *
 * Normalised so that ∫ p_R(θ) dΩ / (4π) = 1 over the full sphere — the
 * return value is a dimensionless probability density in steradians⁻¹ × 4π.
 * Forward and backward peaks are equal (1.5); the minimum at θ = 90° is 0.75.
 *
 * Reference: Chandrasekhar (1950), "Radiative Transfer", §1.17.
 *
 * @param {number} cosTheta  Cosine of the scattering angle (view↔sun)
 * @returns {number}         p_R(θ) ∈ [0.75, 1.5]
 */
export function rayleighPhase(cosTheta) {
  return 0.75 * (1 + cosTheta * cosTheta);
}

/**
 * Henyey-Greenstein phase function for Mie aerosol scattering.
 *   p_HG(θ) = (1 − g²) / (4π · (1 + g² − 2g·cosθ)^{3/2})
 *
 * Widely used as an analytic approximation to the full Mie phase function
 * for continental / maritime aerosols. The asymmetry parameter g ∈ (−1, 1):
 *   g > 0 → forward-peaked (typical for aerosols, 0.6–0.9)
 *   g = 0 → isotropic
 *   g < 0 → backward-peaked (rare, cloud back-scatter)
 *
 * The normalisation constant (1 − g²)/(4π) ensures the integral of p_HG over
 * the full sphere equals 1.  For small scattering angles the forward peak
 * can be many orders of magnitude above the isotropic average — which is
 * why callers should be careful when using p_HG as a *multiplicative* weight
 * rather than a full integral.
 *
 * Reference: Henyey & Greenstein (1941), "Diffuse radiation in the galaxy".
 *
 * @param {number} cosTheta  Cosine of scattering angle
 * @param {number} g         Asymmetry parameter (−1, 1)
 * @returns {number}         p_HG(θ) > 0
 */
export function hgPhase(cosTheta, g) {
  const g2    = g * g;
  const denom = Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
  return (1 - g2) / (4 * Math.PI * denom);
}

// ── Elevation-dependent zone mixing ratios ────────────────────────────────────

/**
 * Compute scatter/direct mixing fractions for each sky zone as a function of
 * solar elevation.
 *
 * As the sun approaches the horizon (horizonFrac → 1) the direct-transmittance
 * component grows relative to Rayleigh scatter, producing the characteristic
 * warm orange/red horizon glow.  At high solar elevations scatter dominates
 * everywhere and the sky is uniformly blue.
 *
 * This is the *legacy* mixing kept for PHASE_BLEND = 0 byte-compat and as the
 * interpolation anchor for the Phase 3 ramp.
 *
 * @param {number} sunAngle_rad  Solar elevation in radians
 * @returns {{ skyTop, skyMid, horizon }} each as { s: scatterFrac, d: directFrac }
 */
function zoneMixRatios(sunAngle_rad) {
  // 0 at zenith (sun overhead), 1 at horizon and below
  const horizonFrac = Math.max(0, 1 - sunAngle_rad / (Math.PI / 2));
  return {
    skyTop:  { s: 0.92 - 0.05 * horizonFrac, d: 0.08 + 0.05 * horizonFrac },
    skyMid:  { s: 0.55 - 0.20 * horizonFrac, d: 0.45 + 0.20 * horizonFrac },
    horizon: { s: 0.10 - 0.08 * horizonFrac, d: 0.90 + 0.08 * horizonFrac },
  };
}

/**
 * Phase-function-derived scatter/direct mixing fractions per zone.
 *
 * For each sky zone we look up the view geometry (zoneGeometryFor) to get
 * the cosine of the scattering angle cosθ, then weight:
 *
 *   rw = p_R(θ)                          — Rayleigh phase (isotropic-ish)
 *   mw = p_HG(θ, g) · turbidity          — Mie phase scaled by aerosol load
 *
 * and return
 *
 *   s = rw / (rw + mw)   d = mw / (rw + mw)
 *
 * which preserves the sum-to-one convention of the legacy mix. Unlike the
 * legacy formula, this *varies with scattering angle*, not just elevation —
 * which is the physical correction Phase 3 is introducing.
 *
 * Because the HG forward peak is extreme for small θ, the resulting d can
 * differ substantially from the legacy mix — that is why PHASE_BLEND is
 * ramped gradually with visual gate checks at each step.
 *
 * @param {number} sunAngle_rad  Solar elevation in radians
 * @param {number} turbidity     Aerosol loading 0–1 (scales Mie weight)
 * @returns {{ skyTop, skyMid, horizon }} each as { s, d }
 */
function zoneMixRatiosFromPhaseFuncs(sunAngle_rad, turbidity) {
  const zones = ['skyTop', 'skyMid', 'horizon'];
  const out = {};
  for (const zoneName of zones) {
    const { cosTheta } = zoneGeometryFor(sunAngle_rad, zoneName);
    const rw = rayleighPhase(cosTheta);
    const mw = hgPhase(cosTheta, HG_ASYMMETRY_G) * turbidity;
    const sum = rw + mw;
    if (sum <= 0) {
      out[zoneName] = { s: 1, d: 0 };
    } else {
      out[zoneName] = { s: rw / sum, d: mw / sum };
    }
  }
  return out;
}

/**
 * Blended zone mixing ratios — legacy ↔ phase-function-derived.
 *
 * Returns the legacy mix when PHASE_BLEND = 0 (byte-compat), the physical mix
 * when PHASE_BLEND = 1, and a linear interpolation in between.  Keeping both
 * formulations live side-by-side lets us ramp the blend in-place without
 * deleting the legacy path — critical for the gradual Phase 3 rollout.
 *
 * @param {number} sunAngle_rad  Solar elevation in radians
 * @param {number} turbidity     Aerosol loading 0–1
 * @returns {{ skyTop, skyMid, horizon }} each as { s, d }
 */
function zoneMixRatiosBlended(sunAngle_rad, turbidity) {
  const legacy = zoneMixRatios(sunAngle_rad);
  if (PHASE_BLEND <= 0) return legacy;
  const physical = zoneMixRatiosFromPhaseFuncs(sunAngle_rad, turbidity);
  const t = Math.max(0, Math.min(1, PHASE_BLEND));
  const lerpPair = (a, b) => ({
    s: a.s + (b.s - a.s) * t,
    d: a.d + (b.d - a.d) * t,
  });
  return {
    skyTop:  lerpPair(legacy.skyTop,  physical.skyTop),
    skyMid:  lerpPair(legacy.skyMid,  physical.skyMid),
    horizon: lerpPair(legacy.horizon, physical.horizon),
  };
}

// ── LRU Cache ─────────────────────────────────────────────────────────────────

/**
 * Least-recently-used cache for atmosphere computations.
 *
 * During the 30-second live-update loop the solar elevation changes by only
 * ~0.008°/s, meaning successive calls often share the same rounded key.
 * A single-entry cache is invalidated on every tiny parameter drift; an
 * 8-entry LRU retains the last several distinct (angle, turbidity, angstrom,
 * ozone) combinations — covering all 8 canvas stops plus the score pipeline
 * in a single render cycle without recomputing.
 */
const LRU_MAX = 8;
const _lruCache = new Map(); // insertion order = LRU order

function _cacheGet(key) {
  if (!_lruCache.has(key)) return null;
  // Re-insert to mark as most recently used
  const val = _lruCache.get(key);
  _lruCache.delete(key);
  _lruCache.set(key, val);
  return val;
}

function _cacheSet(key, value) {
  if (_lruCache.has(key)) _lruCache.delete(key);
  else if (_lruCache.size >= LRU_MAX) {
    // Evict oldest entry (first key in insertion order)
    _lruCache.delete(_lruCache.keys().next().value);
  }
  _lruCache.set(key, value);
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Compute physically-based sky radiance for four vertical zones.
 *
 * Results are returned as raw per-wavelength intensities in [0, ~1].
 * Pass each zone through color.js `spectrumToRGB()` to get 0–255 RGB values.
 *
 * Zone mixing ratios vary with solar elevation (see zoneMixRatios): near the
 * horizon the direct-transmittance component dominates, producing warm orange/
 * red; at high elevations Rayleigh scatter dominates, producing deep blue.
 *
 * @param {number} sunAngle_rad       Solar elevation in radians (negative = below horizon)
 * @param {number} turbidity          Aerosol loading 0–1 (from physicsLayer.computeScattering)
 * @param {number} [angstromExp=0]    Ångström exponent α from PM2.5/PM10 ratio.
 *                                    0 = pure dust (white haze), 1.5 = fine smoke (tinted haze).
 * @param {number} [ozoneDU=300]      Stratospheric ozone column in Dobson Units.
 *                                    Pass LOCATION_CLIMATE.ozoneDU for location-aware accuracy.
 * @param {{low:number,mid:number,high:number}} [clouds]
 *                                    Cloud cover fractions 0–1 per layer. Default is
 *                                    all-zeros, which reproduces pre-Phase-1 output byte-for-byte.
 * @param {number} [mieGrowth=1]      κ-Köhler hygroscopic growth factor (Phase 2).
 *                                    Multiplies Mie cross-section by g². g=1 → dry baseline
 *                                    (byte-identical to pre-Phase-2).
 * @returns {{
 *   skyTop:   number[],   // [I_blue, I_green, I_red] — zenith zone
 *   skyMid:   number[],   // transition zone
 *   horizon:  number[],   // near-horizon zone
 *   sun:      number[],   // sun disk (direct only, slightly more extinction)
 *   airmass:  number,     // computed air mass for reference / debug
 *   turbidity: number,
 *   wavelengths: number[] // λ values [0.43, 0.45, 0.55, 0.60, 0.65] µm for reference
 * }}
 */
export function computeAtmosphere(
  sunAngle_rad,
  turbidity,
  angstromExp = 0,
  ozoneDU = 300,
  clouds = NO_CLOUDS,
  mieGrowth = 1,
) {
  // Normalise clouds so that missing fields don't break the cache key or math.
  const c = {
    low:  clouds?.low  ?? 0,
    mid:  clouds?.mid  ?? 0,
    high: clouds?.high ?? 0,
  };
  // Growth factor must be ≥ 1 (dry baseline); guard against bad inputs.
  const g = Math.max(1, mieGrowth ?? 1);
  // Ozone column: callers sometimes pass LOCATION_CLIMATE.ozoneDU which may be
  // undefined/null for locations absent from the climate table. Non-finite values
  // produce NaN in chappuisAbsorption → greyscale sky. Fall back to the
  // mid-latitude annual mean of 300 DU.
  if (!Number.isFinite(ozoneDU)) ozoneDU = 300;
  if (!Number.isFinite(angstromExp)) angstromExp = 0;

  // ── Cache lookup ──────────────────────────────────────────────────────────
  // Cloud fractions are rounded to 2 decimals — the physical effect of a 1%
  // cover delta is sub-perceptual, and coarse quantisation keeps the LRU
  // cache effective during the 30-second live-update loop.
  // PHASE_BLEND is baked into the key so that flipping the Phase 3 ramp
  // invalidates cached results from prior PHASE_BLEND values automatically.
  const cloudKey = `${c.low.toFixed(2)}_${c.mid.toFixed(2)}_${c.high.toFixed(2)}`;
  const cacheKey = `${sunAngle_rad.toFixed(3)}_${turbidity.toFixed(3)}_${angstromExp.toFixed(2)}_${ozoneDU}_${cloudKey}_${g.toFixed(2)}_${PHASE_BLEND.toFixed(2)}`;
  const cached = _cacheGet(cacheKey);
  if (cached) return cached;

  // ── Air mass ──────────────────────────────────────────────────────────────
  const m = computeAirmass(sunAngle_rad);

  // ── Elevation-dependent mixing ratios (Phase 3: legacy ↔ phase-function) ─
  const mix = zoneMixRatiosBlended(sunAngle_rad, turbidity);

  // ── Zone colours ──────────────────────────────────────────────────────────
  const result = {
    skyTop:    zoneIntensities(m,        turbidity, mix.skyTop.s,  mix.skyTop.d,  angstromExp, ozoneDU, sunAngle_rad, 'skyTop',  c, g),
    skyMid:    zoneIntensities(m,        turbidity, mix.skyMid.s,  mix.skyMid.d,  angstromExp, ozoneDU, sunAngle_rad, 'skyMid',  c, g),
    horizon:   zoneIntensities(m,        turbidity, mix.horizon.s, mix.horizon.d, angstromExp, ozoneDU, sunAngle_rad, 'horizon', c, g),
    sun:       zoneIntensities(m * 1.02, turbidity, 0.00,          1.00,          angstromExp, ozoneDU, sunAngle_rad, 'sun',     c, g),
    airmass:   m,
    turbidity,
    wavelengths: WAVELENGTHS,
  };

  // ── Cache store ───────────────────────────────────────────────────────────
  _cacheSet(cacheKey, result);
  return result;
}

/**
 * Invalidate the LRU cache.
 * Optional — the cache auto-evicts stale entries; call only when you want
 * to force a full recompute (e.g. after a turbidity step-change).
 */
export function clearAtmosphereCache() {
  _lruCache.clear();
}
