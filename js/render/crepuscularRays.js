/**
 * crepuscularRays.js — SVG crepuscular-ray (volumetric light beam) overlay
 *
 * Renders fan-shaped SVG rays radiating from the sun's horizon position over
 * the .home-content element when scoreEngine indicates a high probability.
 *
 * Visibility threshold: probability > 0.30 → rays become visible.
 * At probability = 1.0 → full opacity (capped at 0.55 to stay subtle).
 *
 * Ray geometry:
 *   • 7 rays spreading ±55° around the sun azimuth
 *   • Each ray is a thin radial gradient polygon narrowing toward the sun
 *   • Random-ish width and opacity variation for organic look
 *   • No animation (static beams avoid continuous repaint)
 *
 * @module render/crepuscularRays
 */

const SVG_ID   = 'crepuscular-rays';
const MIN_PROB = 0.30;   // probability threshold for rays to appear
const MAX_ALPHA = 0.55;  // maximum overlay opacity (keeps them subtle)
const RAY_COUNT = 7;
const SPREAD_DEG = 55;   // half-spread angle around sun azimuth

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Convert azimuth (degrees clockwise from N) to CSS left% on screen.
 * Mirrors the logic in sunDisk.js: 270° (West) → 50%.
 */
function azimuthToX(azimuthDeg) {
  const offset  = ((azimuthDeg - 270 + 180) % 360) - 180;
  return clamp(50 + (offset / 90) * 40, 5, 95);
}

/**
 * Deterministic pseudo-random in [0,1] — avoids re-randomising on every update.
 */
function seedRng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── Primary export ────────────────────────────────────────────────────────────

/**
 * Create or update the #crepuscular-rays SVG inside the given container.
 * Removes the SVG when probability is below MIN_PROB.
 *
 * @param {Element} container       The .home-content element
 * @param {number}  probability     0–1 from scoreEngine.crepuscularRays
 * @param {number}  [solarAzimuth=270]  Degrees (0=N, 90=E, 180=S, 270=W)
 * @param {number}  [sunY=65]       Vertical anchor % (matches sunDisk elevationToY)
 */
export function renderCrepuscularRays(container, probability, solarAzimuth = 270, sunY = 65) {
  if (!container) return;

  // Below threshold — remove and stop
  if (probability < MIN_PROB) {
    removeCrepuscularRays(container);
    return;
  }

  const alpha  = clamp((probability - MIN_PROB) / (1 - MIN_PROB), 0, 1) * MAX_ALPHA;
  const sunX   = azimuthToX(solarAzimuth);
  const rng    = seedRng(Math.round(solarAzimuth * 100)); // stable per azimuth

  // Build SVG rays as polygon paths radiating from (sunX%, sunY%)
  const W = 100; // viewBox width units
  const H = 100; // viewBox height units
  const ox = sunX;
  const oy = sunY;

  const rays = [];
  for (let i = 0; i < RAY_COUNT; i++) {
    // Spread rays evenly around sun azimuth ± SPREAD_DEG
    const angleFrac  = (i / (RAY_COUNT - 1)) - 0.5;          // −0.5 to +0.5
    const angleBase  = angleFrac * SPREAD_DEG * 2;            // degrees
    const jitter     = (rng() - 0.5) * 8;                     // ±4° jitter
    const angleDeg   = angleBase + jitter;
    const angleRad   = (angleDeg - 90) * (Math.PI / 180);     // 0° = up

    // Ray extends to the top/edge of the viewport
    const len        = 130;  // length in viewBox units (overshoots edges)
    const tipX       = ox + Math.cos(angleRad) * len;
    const tipY       = oy + Math.sin(angleRad) * len;

    // Half-width of the ray at its far end
    const hw         = 1.5 + rng() * 2.5;
    const perpX      = -Math.sin(angleRad) * hw;
    const perpY      =  Math.cos(angleRad) * hw;

    // Individual ray opacity variation (some rays brighter than others)
    const rayAlpha   = (alpha * (0.55 + rng() * 0.45)).toFixed(3);

    rays.push(`
      <polygon
        points="${ox},${oy} ${(tipX - perpX).toFixed(1)},${(tipY - perpY).toFixed(1)} ${(tipX + perpX).toFixed(1)},${(tipY + perpY).toFixed(1)}"
        fill="rgba(255,200,100,${rayAlpha})"
      />`);
  }

  const svgMarkup = `<svg id="${SVG_ID}"
    viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
    style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:hidden"
    xmlns="http://www.w3.org/2000/svg">
    ${rays.join('')}
  </svg>`;

  // Find or create SVG
  let svg = container.querySelector(`#${SVG_ID}`);
  if (!svg) {
    const wrap = document.createElement('div');
    wrap.innerHTML = svgMarkup;
    svg = wrap.firstElementChild;
    // Insert after #sun-disk (z-index 1) but before content (z-index 10)
    const sunDisk = container.querySelector('#sun-disk');
    if (sunDisk) {
      sunDisk.insertAdjacentElement('afterend', svg);
    } else {
      container.insertBefore(svg, container.firstChild);
    }
  } else {
    svg.innerHTML = rays.join('');
  }
}

/**
 * Remove the crepuscular rays SVG from the container.
 */
export function removeCrepuscularRays(container) {
  container?.querySelector(`#${SVG_ID}`)?.remove();
}
