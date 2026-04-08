/**
 * skyColor.js — Physics-based sky colour pipeline
 *
 *   computeSkyColor() → atmosphere.js (Rayleigh / Mie / Chappuis, wavelength-based)
 *                     → color.js (CIE 1931 spectrum → sRGB)
 *
 * Backward-compatible interface:
 *   computeSkyColor({ solarElevation, airMass, turbidity,
 *                     mieIntensity, rayleighSpread, humidity,
 *                     angstromExp, ozoneDU, clouds, mieGrowth })
 *   → { skyTop, skyMid, horizon, sun }
 *
 * Physics references:
 *   Rayleigh scattering ∝ 1/λ⁴                 → see atmosphere.js
 *   Mie scattering with Ångström exponent       → see atmosphere.js
 *   Chappuis-band ozone absorption              → see atmosphere.js
 *   Beer-Lambert attenuation                    → see atmosphere.js
 */

import { computeAtmosphere }                  from './atmosphere.js';
import { spectrumToRGB, applyPerceptualTuning } from './color.js';

// ── Shared internal helpers ───────────────────────────────────────────────────

function clamp(v, min = 0, max = 255) {
  return Math.max(min, Math.min(max, v));
}

// Constants retained for the sun-appearance helpers below
const AIR_MASS_MAX = 38;   // Kasten-Young air mass at horizon (h=0°)
const K_RAYLEIGH   = 0.05; // molecular extinction optical depth baseline
const K_MIE        = 0.45; // aerosol scaling — matches physicsLayer.js tauExt formula

/**
 * Warmth factor: ∝ 1/sin(elevation), normalised 0→1 as sun approaches horizon.
 * Capped at 1 so that sub-horizon elevations stay at maximum warmth.
 * Used by computeSunAppearance for disk size modulation.
 */
function _warmthNorm(solarElevation) {
  const sinEl = Math.max(Math.sin(solarElevation * Math.PI / 180), 0.01);
  return Math.min(1 / sinEl / AIR_MASS_MAX, 1);
}

/**
 * Beer-Lambert transmittance: fraction of direct solar radiation surviving the path.
 * Uses same tauExt formula as physicsLayer.js for consistency.
 * Used by computeSunAppearance for direct-disk intensity.
 */
function _beerLambert(airMass, turbidity) {
  const tauExt = K_RAYLEIGH + K_MIE * turbidity;
  return Math.exp(-tauExt * airMass);
}

// ── Physics colour path ───────────────────────────────────────────────────────

/**
 * Convert atmosphere.js output to a four-zone {r,g,b} colour set.
 * @param {number} sunAngle_rad    Solar elevation in radians
 * @param {number} turbidity       0–1 from physicsLayer
 * @param {number} [angstromExp]   Ångström exponent from PM2.5/PM10
 * @param {number} [ozoneDU]       Stratospheric ozone column in Dobson Units
 * @param {{low:number,mid:number,high:number}} [clouds]
 *                                 Fractional cloud cover per layer 0–1 (Phase 1).
 *                                 Defaults to all-zero (pre-Phase-1 behaviour).
 * @param {number} [mieGrowth=1]   κ-Köhler growth factor (Phase 2).
 * @returns {{ skyTop, skyMid, horizon, sun }}
 */
function computeSkyColorPhysics(sunAngle_rad, turbidity, angstromExp = 0, ozoneDU = 300, clouds, mieGrowth = 1) {
  const atm = computeAtmosphere(sunAngle_rad, turbidity, angstromExp, ozoneDU, clouds, mieGrowth);

  // Phase 7: run the perceptual tuning pass per zone. At PERCEPTUAL_BOOST=0
  // (shipping default) this is a byte-identical no-op — each call short-circuits
  // on the first line. Zone label drives per-band asymmetry (horizon > skyTop).
  return {
    skyTop:  applyPerceptualTuning(spectrumToRGB(atm.skyTop),  { sunAngle_rad, zone: 'skyTop'  }),
    skyMid:  applyPerceptualTuning(spectrumToRGB(atm.skyMid),  { sunAngle_rad, zone: 'skyMid'  }),
    horizon: applyPerceptualTuning(spectrumToRGB(atm.horizon), { sunAngle_rad, zone: 'horizon' }),
    sun:     applyPerceptualTuning(spectrumToRGB(atm.sun),     { sunAngle_rad, zone: 'sun'     }),
  };
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Compute physics-based sky colours for four vertical zones.
 *
 * Pure physics path: Rayleigh + Mie + Chappuis ozone on 5 wavelengths,
 * integrated to sRGB via CIE 1931. Interface is backward-compatible with
 * the previous implementation — callers in score.js do not need to change.
 *
 * @param {Object} params
 * @param {number} params.solarElevation   Solar elevation in degrees (negative = below horizon)
 * @param {number} params.airMass          Kasten-Young air mass (unused by physics path, kept for API parity)
 * @param {number} params.turbidity        0–1 composite aerosol index
 * @param {number} params.mieIntensity     0–1 Mie forward-scatter strength (unused here, kept for API parity)
 * @param {number} params.rayleighSpread   0–1 clean-air gradient quality (unused here, kept for API parity)
 * @param {number} params.humidity         0–100 relative humidity (unused here, kept for API parity)
 * @param {number} [params.angstromExp=0]  Ångström exponent
 * @param {number} [params.ozoneDU=300]    Stratospheric ozone column (Dobson Units).
 *                                         Pass LOCATION_CLIMATE.ozoneDU for location accuracy.
 * @param {{low:number,mid:number,high:number}} [params.clouds]
 *                                         Fractional cloud cover per layer 0–1 (Phase 1).
 *                                         When omitted, falls back to clear-sky physics.
 * @param {number} [params.mieGrowth=1]    κ-Köhler growth factor (Phase 2).
 *
 * @returns {{
 *   skyTop:  {r:number, g:number, b:number},
 *   skyMid:  {r:number, g:number, b:number},
 *   horizon: {r:number, g:number, b:number},
 *   sun:     {r:number, g:number, b:number}
 * }}
 */
export function computeSkyColor({ solarElevation, turbidity, angstromExp = 0, ozoneDU = 300, clouds, mieGrowth = 1 }) {
  const sunAngle_rad = solarElevation * (Math.PI / 180);
  return computeSkyColorPhysics(sunAngle_rad, turbidity, angstromExp, ozoneDU, clouds, mieGrowth);
}

// ── Sun appearance model ──────────────────────────────────────────────────────

/**
 * Compute physical appearance parameters for the sun disk.
 * Useful for canvas rendering or CSS glow (future phase).
 *
 * @param {Object} params
 * @param {number} params.solarElevation  degrees
 * @param {number} params.turbidity       0–1
 * @param {number} params.mieIntensity    0–1
 * @param {number} params.humidity        0–100
 * @param {number} params.airMass         Kasten-Young air mass
 *
 * @returns {{ color:{r,g,b}, size:number, blur:number, intensity:number }}
 */
export function computeSunAppearance({ solarElevation, turbidity, mieIntensity, humidity, airMass }) {
  const warmthN   = _warmthNorm(solarElevation);
  const intensity = _beerLambert(airMass, turbidity);
  const { sun }   = computeSkyColor({
    solarElevation, airMass, turbidity, mieIntensity,
    rayleighSpread: clamp(1 - turbidity, 0, 1),
    humidity,
  });

  // Atmospheric refraction enlarges the apparent sun near the horizon
  const size = 1 + 0.6 * warmthN * (1 - turbidity * 0.3);

  // Mie halo blurs the disk
  const blur = 4 + mieIntensity * 24 + humidity * 0.05;

  return {
    color: sun,
    size:      clamp(size, 0, 2),
    blur:      clamp(blur, 0, 30),
    intensity: Math.max(intensity, 0.05), // always slightly visible
  };
}
