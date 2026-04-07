/**
 * spectralEngine.js — Physically-based spectral sky color computation
 *
 * Pipeline:
 *   1. Rayleigh optical depth  τ_R(λ) ∝ λ⁻⁴
 *   2. Mie optical depth       τ_M(λ) ∝ λ⁻ᵅ  (Angstrom exponent α)
 *   3. Single-scattering radiance per zone (sky top / mid / horizon / sun)
 *   4. XYZ via CIE 1931 2° CMF (Wyman 2013 analytical approximation)
 *   5. XYZ → linear sRGB (D65) → Reinhard tone map → sRGB gamma
 *
 * CIE CMF source: Wyman, Sloan & Shirley (2013) "Simple Analytic Approximations
 * to the CIE XYZ Color Matching Functions", JCGT 2(2).
 * Avoids hardcoded table lookup errors by computing CMF values analytically.
 */

// ── Wavelength grid: 380–700 nm, 10 nm steps (33 samples) ──────────────────
const LAMBDA = [
  380,390,400,410,420,430,440,450,460,470,
  480,490,500,510,520,530,540,550,560,570,
  580,590,600,610,620,630,640,650,660,670,
  680,690,700,
];
const N_LAMBDA = LAMBDA.length; // 33
const D_LAMBDA = 10;            // nm step

// ── CIE 1931 2° CMF via Wyman 2013 analytical approximation ────────────────
// x̄(λ) = 1.065·G(λ,595.8,33.33) + 0.366·G(λ,446.8,19.44)
// ȳ(λ) = 1.014·LN(λ, ln 556.3, 0.075)
// z̄(λ) = 1.839·LN(λ, ln 449.8, 0.051)
// where G = Gaussian, LN = log-normal (natural log).

function _gauss(lam, mu, sigma) {
  const t = (lam - mu) / sigma;
  return Math.exp(-0.5 * t * t);
}
function _lognorm(lam, muLn, sigLn) {
  const t = (Math.log(lam) - muLn) / sigLn;
  return Math.exp(-0.5 * t * t);
}

const _LN_5563 = Math.log(556.3);
const _LN_4498 = Math.log(449.8);

function cmfX(lam) { return 1.065 * _gauss(lam, 595.8, 33.33) + 0.366 * _gauss(lam, 446.8, 19.44); }
function cmfY(lam) { return 1.014 * _lognorm(lam, _LN_5563, 0.075); }
function cmfZ(lam) { return 1.839 * _lognorm(lam, _LN_4498, 0.051); }

// Pre-compute at module load (33 evaluations, negligible cost)
const CIE_X = LAMBDA.map(cmfX);
const CIE_Y = LAMBDA.map(cmfY);
const CIE_Z = LAMBDA.map(cmfZ);

// ── Solar spectral irradiance (AM0, shape only — absolute scale cancels in tone map) ──
// Approximated from ASTM E490: rising from UV, relatively flat in visible, slight peak ~500nm
const SOLAR_E = [
  0.558,0.622,0.711,0.756,0.796,0.837,0.873,0.903,0.926,0.940,
  0.953,0.963,0.971,0.978,0.985,0.990,0.993,0.995,0.996,0.997,
  0.997,0.998,0.998,0.999,0.999,0.999,1.000,1.000,0.999,0.998,
  0.997,0.995,0.992,
];

// ── Physical constants ──────────────────────────────────────────────────────
const TAU_R0  = 0.0088;  // Rayleigh optical depth at 500 nm (sea level)
const TAU_M0  = 0.12;    // Mie optical depth at 500 nm per unit turbidity
const LAM_REF = 500;     // reference wavelength [nm]
const G_HG    = 0.76;    // Henyey-Greenstein asymmetry parameter for Mie

// ── Internal helpers ────────────────────────────────────────────────────────

function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

/** Kasten-Young air mass, clamped to [1, 38]. */
function airMassKY(elevDeg) {
  const el = Math.max(elevDeg, -2);
  const sinEl = Math.sin(el * Math.PI / 180);
  const m = 1 / (sinEl + 0.50572 * Math.pow(el + 6.07995, -1.6364));
  return Math.max(1, Math.min(38, m));
}

/** Rayleigh phase function (θ = angle from sun). */
function phaseRayleigh(cosTheta) {
  return 0.75 * (1 + cosTheta * cosTheta);
}

/** Henyey-Greenstein Mie phase function. */
function phaseMie(cosTheta) {
  const g  = G_HG, g2 = g * g;
  return (1 - g2) / Math.pow(1 + g2 - 2 * g * cosTheta, 1.5);
}

/**
 * Compute spectral radiance for one sky zone.
 * @param {number} m_path   Viewing path air mass (varies by zone)
 * @param {number} m_sun    Solar beam air mass (from elevation)
 * @param {number} turbidity 0–1
 * @param {number} alpha    Angstrom exponent
 * @param {number} pR       Rayleigh phase value
 * @param {number} pM       Mie phase value
 * @param {boolean} directOnly  true = direct solar transmission only (sun zone)
 * @returns {number[]} 33-element spectral radiance array
 */
function spectralRadiance(m_path, m_sun, turbidity, alpha, pR, pM, directOnly) {
  const L = new Array(N_LAMBDA);
  for (let i = 0; i < N_LAMBDA; i++) {
    const lam  = LAMBDA[i] / LAM_REF;
    const tauR = TAU_R0 * Math.pow(lam, -4);
    const tauM = turbidity * TAU_M0 * Math.pow(lam, -alpha);
    const tauT = tauR + tauM;

    const T_sun = Math.exp(-tauT * m_sun);
    if (directOnly) {
      L[i] = SOLAR_E[i] * T_sun;
      continue;
    }
    // Single-scatter: solar beam is already reddened by T_sun before reaching
    // the scatter point — this is the key source of sunset warm colours.
    const T_view  = Math.exp(-tauT * m_path);
    const scatR   = tauR * pR * T_view;
    const scatM   = tauM * pM * T_view;
    L[i] = SOLAR_E[i] * T_sun * (scatR + scatM);
  }
  return L;
}

/**
 * Integrate spectral radiance → linear sRGB via CIE XYZ (D65 matrix).
 * @param {number[]} L  33-element radiance
 * @returns {{ r, g, b }} linear, unbounded
 */
function spectrumToLinearRGB(L) {
  let X = 0, Y = 0, Z = 0;
  for (let i = 0; i < N_LAMBDA; i++) {
    X += L[i] * CIE_X[i];
    Y += L[i] * CIE_Y[i];
    Z += L[i] * CIE_Z[i];
  }
  X *= D_LAMBDA; Y *= D_LAMBDA; Z *= D_LAMBDA;

  // sRGB D65 matrix (IEC 61966-2-1)
  return {
    r: Math.max(0,  3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    g: Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    b: Math.max(0,  0.0557 * X - 0.2040 * Y + 1.0570 * Z),
  };
}

/**
 * Reinhard luminance tone map + sRGB gamma encode + saturation boost.
 * The saturation boost compensates for Mie-scattering's achromatic dilution
 * (Mie adds a near-white component that desaturates physically correct hues).
 * @param {{ r,g,b }} rgb  linear, any range
 * @param {number} exposure  scale before tone map
 * @param {number} satBoost  saturation multiplier applied after gamma (default 1.8)
 * @returns {{ r,g,b }} gamma bytes [0,255]
 */
function toneMapAndGamma({ r, g, b }, exposure = 1, satBoost = 1.8) {
  r *= exposure; g *= exposure; b *= exposure;

  // Reinhard on luminance (preserves hue)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 0) {
    const scale = (lum / (1 + lum)) / lum;
    r *= scale; g *= scale; b *= scale;
  }

  // sRGB gamma
  const gc = (v) => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  let rg = gc(r), gg = gc(g), bg = gc(b);

  // Saturation boost in gamma space (perceptual)
  if (satBoost !== 1) {
    const lumG = 0.2126 * rg + 0.7152 * gg + 0.0722 * bg;
    rg = lumG + satBoost * (rg - lumG);
    gg = lumG + satBoost * (gg - lumG);
    bg = lumG + satBoost * (bg - lumG);
  }

  return {
    r: clampByte(rg * 255),
    g: clampByte(gg * 255),
    b: clampByte(bg * 255),
  };
}

// ── Primary export ──────────────────────────────────────────────────────────

/**
 * Compute physically-based sky colors for four vertical zones.
 * Drop-in replacement for computeSkyColor() in skyColor.js.
 *
 * @param {number} solarElevation  degrees (negative = below horizon)
 * @param {Object} p
 * @param {number} p.turbidity      0–1
 * @param {number} p.mieIntensity   0–1 → maps to Angstrom α [0.5, 2.0]
 * @param {number} p.humidity       0–100
 * @param {number} [p.airMass]      optional; computed from elevation if absent
 * @returns {{ skyTop, skyMid, horizon, sun }}
 */
export function computeSpectralSky(solarElevation, { turbidity = 0.3, mieIntensity = 0.3, humidity = 50, airMass } = {}) {
  const m_sun = airMass != null ? Math.max(1, Math.min(38, airMass)) : airMassKY(solarElevation);

  // Angstrom exponent: fine pollution aerosols → high α (wavelength-selective),
  // coarse dust → low α (gray-white)
  const alpha = 0.5 + mieIntensity * 1.5;

  // Humidity → reduced Angstrom (hygroscopic growth shifts distribution coarser)
  const alphaEff = alpha * (1 - (humidity / 100) * 0.35);

  // Twilight: sun below horizon — use effective elevation = 0 (lit upper atmosphere)
  // with exponential exposure decay
  const isTwilight  = solarElevation < 0;
  const m_eff       = isTwilight ? airMassKY(0) : m_sun;
  const twilightExp = isTwilight ? Math.exp(solarElevation / 4) : 1;  // 1 at 0°, ~0.22 at -6°

  // ── Phase functions per viewing zone ────────────────────────────────────
  // cosTheta: angle between viewing direction and sun direction
  const cos_at = (deg) => Math.cos(deg * Math.PI / 180);
  const pR_sun   = phaseRayleigh(cos_at(0));   // looking directly at sun
  const pR_horiz = phaseRayleigh(cos_at(25));  // horizon warm glow (25° avoids extreme Mie peak)
  const pR_mid   = phaseRayleigh(cos_at(70));  // sky mid
  const pR_top   = phaseRayleigh(cos_at(150)); // sky top (looking away and up)

  const pM_sun   = phaseMie(cos_at(0));
  const pM_horiz = phaseMie(cos_at(25));
  const pM_mid   = phaseMie(cos_at(70));
  const pM_top   = phaseMie(cos_at(150));

  // ── Viewing path air masses per zone ─────────────────────────────────────
  const m_horiz = m_eff;
  const m_mid   = Math.max(1, m_eff * 0.45);
  const m_top   = 1.0;  // overhead

  // ── Spectral radiance ────────────────────────────────────────────────────
  const L_sun   = spectralRadiance(m_eff,   m_eff, turbidity, alphaEff, pR_sun,   pM_sun,   true);
  const L_horiz = spectralRadiance(m_horiz, m_eff, turbidity, alphaEff, pR_horiz, pM_horiz, false);
  const L_mid   = spectralRadiance(m_mid,   m_eff, turbidity, alphaEff, pR_mid,   pM_mid,   false);
  const L_top   = spectralRadiance(m_top,   m_eff, turbidity, alphaEff, pR_top,   pM_top,   false);

  // ── Tone map to bytes ────────────────────────────────────────────────────
  // Exposure calibrated so clear sunset horizon ≈ warm amber.
  // Sky top uses lower exposure (appears darker / deeper blue than horizon).
  const EXP_SKY = 1;
  const EXP_SUN = 1;

  const sun    = toneMapAndGamma(spectrumToLinearRGB(L_sun),   EXP_SUN * twilightExp);
  const horizon = toneMapAndGamma(spectrumToLinearRGB(L_horiz), EXP_SKY * twilightExp);
  const skyMidRaw = toneMapAndGamma(spectrumToLinearRGB(L_mid), EXP_SKY * twilightExp);
  const skyTopRaw = toneMapAndGamma(spectrumToLinearRGB(L_top), EXP_SKY * 0.65 * twilightExp);

  // ── Twilight purple tint (Belt of Venus) on upper sky ────────────────────
  // Post-sunset: upper atmosphere still lit by solar UV/violet → purple-magenta shift
  const tDepth = Math.max(0, -solarElevation / 6);  // 0 at horizon, 1 at -6°
  const pBlend = tDepth * 0.55;

  const skyTop = {
    r: clampByte(skyTopRaw.r * (1 - pBlend) + 40  * pBlend),
    g: clampByte(skyTopRaw.g * (1 - pBlend) + 8   * pBlend),
    b: clampByte(skyTopRaw.b * (1 - pBlend) + 90  * pBlend),
  };
  const skyMid = {
    r: clampByte(skyMidRaw.r * (1 - pBlend * 0.4) + 55 * pBlend * 0.4),
    g: clampByte(skyMidRaw.g * (1 - pBlend * 0.4) + 12 * pBlend * 0.4),
    b: clampByte(skyMidRaw.b * (1 - pBlend * 0.4) + 75 * pBlend * 0.4),
  };

  return { skyTop, skyMid, horizon, sun };
}
