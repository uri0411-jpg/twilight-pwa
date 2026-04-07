/**
 * skyCanvas.js — Physics-based canvas sky gradient renderer
 *
 * Replaces the CSS 5-stop gradient with a smooth canvas gradient computed
 * at 8 effective solar elevation samples, eliminating CSS gradient banding
 * and providing a physically motivated colour distribution across sky zones.
 *
 * Architecture:
 *   • Injects <canvas id="sky-canvas"> as first child of .home-content
 *   • z-index: -1 inside the stacking context — above CSS background, below
 *     flex content, sun disk, and SVG rays
 *   • Re-renders on each live gradient update (called from startLiveGradient)
 *
 * The 8 stops are obtained by sampling computeAtmosphere() at the current solar
 * elevation ± small offsets, approximating the effective solar angle seen from
 * each altitude band in the sky:
 *
 *   Stop 0 (zenith)  → sun angle + 0.35 rad  (higher effective elevation → bluer)
 *   Stop 1           → sun angle + 0.20 rad
 *   Stop 2           → sun angle + 0.10 rad
 *   Stop 3           → sun angle + 0.03 rad
 *   Stop 4           → sun angle − 0.02 rad  (horizon band)
 *   Stop 5 (belt)    → sun angle − 0.06 rad  (Belt of Venus zone)
 *   Stop 6 (earth)   → sun angle − 0.12 rad  (earth shadow)
 *   Stop 7 (base)    → sun angle − 0.18 rad  (deep dark base)
 *
 * @module render/skyCanvas
 */

import { computeAtmosphere } from '../engine/atmosphere.js';
import { spectrumToRGB }      from '../engine/color.js';

const CANVAS_ID = 'sky-canvas';

// Canvas-position fractions for each of the 8 gradient stops (top → bottom)
const STOP_POSITIONS = [0.00, 0.12, 0.25, 0.40, 0.58, 0.70, 0.83, 1.00];

// Angular offsets (radians) added to the current solar elevation for each stop
// Positive = looking higher than sun, negative = looking below sun (into earth shadow)
const STOP_OFFSETS_RAD = [0.35, 0.20, 0.10, 0.03, -0.02, -0.06, -0.12, -0.18];

// Which zone of atmosphere output each stop samples
const STOP_ZONES = ['skyTop', 'skyTop', 'skyMid', 'skyMid', 'horizon', 'horizon', 'horizon', 'horizon'];

// Alpha for each stop (top is lighter overlay, bottom is deep dark)
const STOP_ALPHAS = [0.70, 0.68, 0.62, 0.58, 0.55, 0.60, 0.70, 0.97];

// ── Belt of Venus tint ────────────────────────────────────────────────────────

function _lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

function _beltColor(horizonColor, beltOfVenus) {
  const bov = beltOfVenus;
  return {
    r: Math.round(_lerp(horizonColor.r, 180, bov)),
    g: Math.round(_lerp(horizonColor.g,  60, bov)),
    b: Math.round(_lerp(horizonColor.b, 160, bov)),
    a: bov * 0.55,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rgba({ r, g, b }, a) {
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Render (or update) the physics-based sky canvas inside a container.
 *
 * @param {Element} container       The .home-content element (position: relative)
 * @param {number}  sunAngle_rad    Current solar elevation in radians
 * @param {number}  turbidity       0–1 aerosol loading
 * @param {number}  [angstromExp=0] Ångström exponent from PM2.5/PM10
 * @param {number}  [beltOfVenus=0] 0–1 Belt-of-Venus visibility probability
 */
export function renderSkyCanvas(container, sunAngle_rad, turbidity, angstromExp = 0, beltOfVenus = 0) {
  if (!container) return;

  const w = container.offsetWidth  || window.innerWidth;
  const h = container.offsetHeight || window.innerHeight;

  // ── Find or create canvas ─────────────────────────────────────────────────
  let canvas = container.querySelector(`#${CANVAS_ID}`);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = CANVAS_ID;
    Object.assign(canvas.style, {
      position:      'absolute',
      inset:         '0',
      width:         '100%',
      height:        '100%',
      zIndex:        '-1',
      pointerEvents: 'none',
      display:       'block',
    });
    container.insertBefore(canvas, container.firstChild);
  }

  // Resize if needed
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width  = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  // ── Sample atmosphere at 8 elevation offsets ──────────────────────────────
  const colors = STOP_OFFSETS_RAD.map((offset, i) => {
    const sampleAngle = sunAngle_rad + offset;
    const atm = computeAtmosphere(sampleAngle, turbidity, angstromExp);
    const zone = STOP_ZONES[i];
    const rgb  = spectrumToRGB(atm[zone]);

    // Belt of Venus zone (stop 5): tint toward pink-purple
    if (i === 5 && beltOfVenus > 0) {
      const horizon = spectrumToRGB(atm.horizon);
      const belt    = _beltColor(horizon, beltOfVenus);
      return { r: belt.r, g: belt.g, b: belt.b };
    }
    return rgb;
  });

  // ── Build vertical gradient ───────────────────────────────────────────────
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  STOP_POSITIONS.forEach((pos, i) => {
    grad.addColorStop(pos, rgba(colors[i], STOP_ALPHAS[i]));
  });

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Remove the sky canvas element from the container.
 */
export function removeSkyCanvas(container) {
  container?.querySelector(`#${CANVAS_ID}`)?.remove();
}
