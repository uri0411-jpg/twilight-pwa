/**
 * skyWorker.js — Off-thread physics sky gradient renderer
 *
 * Moves the computationally expensive sky gradient rendering off the main thread.
 * Receives render parameters via postMessage, computes the 8-stop physics gradient,
 * clips to the sky mask, and returns an ImageBitmap for the main thread to blit.
 *
 * Feature-gated: main-screen.js only instantiates this worker when
 * OffscreenCanvas is available (Safari < 16.4 falls back to inline rendering).
 *
 * @module workers/skyWorker
 */

import { computeAtmosphere }                    from '../engine/atmosphere.js';
import { spectrumToRGB, applyPerceptualTuning }  from '../engine/color.js';
import { LOCATION_CLIMATE }                      from '../config.js';

// ── Constants (mirrored from skyCanvas.js) ─────────────────────────────────
const STOP_POSITIONS   = [0.00, 0.12, 0.25, 0.40, 0.58, 0.70, 0.83, 1.00];
const STOP_OFFSETS_RAD = [0.35, 0.15, 0.06, 0.02, -0.01, -0.04, -0.09, -0.18];
const STOP_ZONES       = ['skyTop', 'skyTop', 'skyMid', 'skyMid', 'horizon', 'horizon', 'horizon', 'horizon'];
const STOP_ALPHAS      = [0.95, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00];
const NIGHT_INDIGO     = { r: 18, g: 10, b: 78 };

let _mask     = null; // ImageBitmap of the sky mask
let _maskW    = 0;    // original photo width
let _maskH    = 0;    // original photo height
let _prevAngle = null;

// ── Helpers (inlined from skyCanvas.js) ────────────────────────────────────

function rgba({ r, g, b }, a) {
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function boostSaturation({ r, g, b }, targetS) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const L = (max + min) / 2;
  if (max === min) return { r, g, b };

  const d = max - min;
  const S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
  let H;
  if (max === rn) H = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) H = (bn - rn) / d + 2;
  else H = (rn - gn) / d + 4;
  H /= 6;

  const newS = Math.max(S, targetS);
  const q = L < 0.5 ? L * (1 + newS) : L + newS - L * newS;
  const p = 2 * L - q;
  const hue2rgb = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(H + 1/3) * 255),
    g: Math.round(hue2rgb(H)       * 255),
    b: Math.round(hue2rgb(H - 1/3) * 255),
  };
}

function _computeBeltColor(sunAngle_rad, turbidity, ozoneDU) {
  const beltAngle = Math.abs(sunAngle_rad) + 0.052;
  const cleanTurb = Math.min(turbidity, 0.15);
  const atm = computeAtmosphere(beltAngle, cleanTurb, 0, ozoneDU * 2);
  const st = spectrumToRGB(atm.skyTop);
  const hz = spectrumToRGB(atm.horizon);
  return {
    r: Math.round(st.r * 0.70 + hz.r * 0.30),
    g: Math.round(st.g * 0.70 + hz.g * 0.30),
    b: Math.round(st.b * 0.70 + hz.b * 0.30),
  };
}

// ── Message handler ────────────────────────────────────────────────────────

self.onmessage = ({ data }) => {
  if (data.type === 'init-mask') {
    _mask  = data.mask;   // ImageBitmap
    _maskW = data.photoW;
    _maskH = data.photoH;
    return;
  }

  if (data.type === 'render') {
    const { sunAngle_rad, turbidity, angstromExp, beltOfVenus, clouds, mieGrowth, w, h } = data;
    if (!_mask || !w || !h) return;

    // Delta detection — skip if angle hasn't changed meaningfully
    if (_prevAngle !== null && Math.abs(_prevAngle - sunAngle_rad) < 0.001) return;
    _prevAngle = sunAngle_rad;

    try {
      const canvas = new OffscreenCanvas(w, h);
      const ctx    = canvas.getContext('2d');

      // ── Sample atmosphere at 8 elevation offsets ──
      const colors = STOP_OFFSETS_RAD.map((offset, i) => {
        const atm  = computeAtmosphere(sunAngle_rad + offset, turbidity, angstromExp || 0, LOCATION_CLIMATE.ozoneDU, clouds, mieGrowth || 1);
        const zone = STOP_ZONES[i];
        const rgb  = applyPerceptualTuning(spectrumToRGB(atm[zone]), { sunAngle_rad, zone });

        if (i === 5 && beltOfVenus > 0) {
          const belt = _computeBeltColor(sunAngle_rad, turbidity, LOCATION_CLIMATE.ozoneDU);
          return {
            r: Math.round(rgb.r * (1 - beltOfVenus) + belt.r * beltOfVenus),
            g: Math.round(rgb.g * (1 - beltOfVenus) + belt.g * beltOfVenus),
            b: Math.round(rgb.b * (1 - beltOfVenus) + belt.b * beltOfVenus),
          };
        }
        return rgb;
      });

      // ── Saturation boost + night anchor ──
      const elevDeg = sunAngle_rad * 180 / Math.PI;
      const boostT  = Math.max(0, Math.min(1, (12 - elevDeg) / 10));
      const targetS = 0.30 + 0.45 * boostT;
      const hCorr   = Math.max(0, Math.min(1, -elevDeg / 4));
      const effS    = targetS * (1 - hCorr * 0.35);

      const _nRaw = Math.max(0, Math.min(1, (-elevDeg - 1) / 20));
      const nightStr = _nRaw * _nRaw * (3 - 2 * _nRaw);
      const anchored = nightStr > 0
        ? colors.map(c => ({
            r: Math.round(c.r + (NIGHT_INDIGO.r - c.r) * nightStr),
            g: Math.round(c.g + (NIGHT_INDIGO.g - c.g) * nightStr),
            b: Math.round(c.b + (NIGHT_INDIGO.b - c.b) * nightStr),
          }))
        : colors;

      const saturated = anchored.map(c => boostSaturation(c, effS));

      // ── Build gradient ──
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      STOP_POSITIONS.forEach((pos, i) => {
        grad.addColorStop(pos, rgba(saturated[i], STOP_ALPHAS[i]));
      });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // ── Clip to sky mask (background-size: cover, top-aligned) ──
      ctx.globalCompositeOperation = 'destination-in';
      const scale = Math.max(w / _maskW, h / _maskH);
      const drawW = _maskW * scale;
      const drawH = _maskH * scale;
      const dx = (w - drawW) / 2;
      ctx.drawImage(_mask, dx, 0, drawW, drawH);
      ctx.globalCompositeOperation = 'source-over';

      // ── Transfer result ──
      const bitmap = canvas.transferToImageBitmap();
      self.postMessage({ type: 'frame', bitmap }, [bitmap]);
    } catch (err) {
      console.warn('[skyWorker] render error:', err?.message);
    }
  }
};
