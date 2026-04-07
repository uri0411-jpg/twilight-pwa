/**
 * color.js — Spectrum-to-RGB conversion and colour blending utilities
 *
 * Converts the per-wavelength intensity arrays produced by atmosphere.js into
 * standard {r, g, b} objects suitable for CSS and canvas rendering.
 *
 * Wavelength order convention (matches atmosphere.js WAVELENGTHS array):
 *   intensities[0]  →  450 nm  →  blue  channel
 *   intensities[1]  →  550 nm  →  green channel
 *   intensities[2]  →  650 nm  →  red   channel
 */

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Pre-exposure scale applied before tone mapping.
 *
 * Raw intensities from atmosphere.js are dimensionless values typically in
 * [0.05, 0.95].  Multiplying by EXPOSURE maps them into the region where
 * Reinhard tone mapping (x / (1+x)) produces perceptually meaningful colour
 * differences.  Without this pre-scale the tonemapped values would cluster
 * near zero and the sky would appear very dark.
 *
 * EXPOSURE = 4.0 means that an intensity of 0.8 (bright horizon in clear air)
 * maps to 3.2 before tonemapping → 3.2/4.2 ≈ 0.76 → after gamma ≈ 0.88 → 224.
 * An intensity of 0.2 (dark upper sky) → 0.8 → 0.44 → gamma ≈ 0.67 → 170.
 * This keeps colour distinctions visible across the full sky range.
 */
const EXPOSURE = 4.0;

/**
 * Reinhard tone operator: compresses [0, ∞) → [0, 1).
 * Preserves hue ratios — channels are scaled equally at each intensity level.
 */
function tonemap(v) {
  return v / (1.0 + v);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Clamp v to integer in [0, 255]. */
function clamp8(v) {
  return Math.round(Math.max(0, Math.min(255, v)));
}

// ── Primary exports ───────────────────────────────────────────────────────────

/**
 * Convert a three-element intensity spectrum to an 8-bit sRGB colour object.
 *
 * Pipeline:
 *   1. Pre-scale by EXPOSURE   — brings dim physics values into usable range
 *   2. Reinhard tone mapping   — compresses highlights, prevents channel saturation
 *   3. sRGB gamma (x^1/2.2)   — linearises for display (browser assumes γ=2.2)
 *   4. Scale to [0, 255]       — final 8-bit output
 *
 * This replaces the previous linear `v × 255` mapping which caused the
 * horizon to saturate at 255 and dark sky zones to appear crushed.
 *
 * @param {number[]} intensities  [I_blue, I_green, I_red] from computeAtmosphere
 * @returns {{ r: number, g: number, b: number }}  Each channel 0–255
 */
export function spectrumToRGB(intensities) {
  const [iBlue, iGreen, iRed] = intensities;
  const gamma = v => Math.pow(Math.max(0, v), 1.0 / 2.2);
  return {
    r: clamp8(gamma(tonemap(iRed   * EXPOSURE)) * 255),
    g: clamp8(gamma(tonemap(iGreen * EXPOSURE)) * 255),
    b: clamp8(gamma(tonemap(iBlue  * EXPOSURE)) * 255),
  };
}

/**
 * Weighted linear blend of a physics-derived colour with a legacy colour.
 *
 * Used by skyColor.js for the hybrid pipeline:
 *   finalColor = physicsWeight × physicsColor + (1 − physicsWeight) × legacyColor
 *
 * @param {{ r, g, b }} physicsColor   Result from spectrumToRGB
 * @param {{ r, g, b }} legacyColor    Result from the heuristic RGB model
 * @param {number}      physicsWeight  0–1, default 0.7 (70% physics / 30% legacy)
 * @returns {{ r: number, g: number, b: number }}
 */
export function blendColors(physicsColor, legacyColor, physicsWeight = 0.7) {
  const w = Math.max(0, Math.min(1, physicsWeight));
  const lw = 1 - w;
  return {
    r: clamp8(physicsColor.r * w + legacyColor.r * lw),
    g: clamp8(physicsColor.g * w + legacyColor.g * lw),
    b: clamp8(physicsColor.b * w + legacyColor.b * lw),
  };
}
