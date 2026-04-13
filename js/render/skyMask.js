// ═══════════════════════════════════════════
//  skyMask.js — Luminance-based sky mask for the background photo
//
//  Builds a one-shot alpha mask that marks which photo pixels are sky /
//  clouds (high luminance) vs. ground, vegetation and silhouettes (low
//  luminance). The mask is stored at full photo resolution and blitted
//  into the sky canvas each render via `destination-in`, cropping the
//  physics gradient to the sky region only.
//
//  Combined with `mix-blend-mode: hue` on the canvas, the result is
//  surgical: the photo's saturation and luminance are fully preserved
//  (so cloud texture, shadows, and vibrancy look untouched), while the
//  hue of the sky rotates to match the live physics forecast. Mountains,
//  olive trees, and dark silhouettes are luminance-masked out and never
//  receive any tint.
//
//  The mask is computed once per photo, cached in memory, then blitted
//  into the sky canvas each render. Cost: ~8ms at photo resolution, only
//  at first render; subsequent renders are a single drawImage.
// ═══════════════════════════════════════════

const PHOTO_URL = './images/background.jpg';

// Module-level cache so repeated renderSkyCanvas calls don't re-compute
let _maskCanvas    = null;   // offscreen canvas holding the mask (same dims as photo)
let _maskPromise   = null;   // in-flight load promise (prevents double-fetch)
let _photoW        = 0;
let _photoH        = 0;

/**
 * Smoothstep — cubic easing from edge0→edge1.
 */
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Build the sky mask from the background photo. Returns a promise that
 * resolves to an offscreen canvas whose alpha channel encodes "how much
 * this pixel should receive sky recoloring" (0 = protected, 255 = full).
 *
 * The mask formula per pixel is pure luminance, no vertical zoning:
 *
 *   lum       = ITU-R BT.709 relative luminance from sRGB bytes
 *                (0.2126·R + 0.7152·G + 0.0722·B, with R/G/B in 0..1)
 *   maskAlpha = smoothstep(0.35, 0.70, lum)
 *
 *   • Bright clouds and open sky (lum > 0.70)      → full recolor (255)
 *   • Dark olive-tree canopy (lum < 0.35)          → fully protected (0)
 *   • Mid-brightness mountain ridge/haze           → soft ramp
 *
 * Pure-luminance was chosen after testing y-zone masks: the app's CSS
 * `background-size: cover` crops the photo aggressively at narrow aspect
 * ratios, and any y-threshold baked into the mask risks misalignment
 * because the crop is device-dependent. Luminance is an intrinsic photo
 * property that survives any cover-crop unchanged.
 *
 * The photo (images/background.jpg) was chosen because its mountains and
 * olive trees are clearly darker than the sky and clouds — the luminance
 * separation is excellent (dark silhouettes ~0.15, lit clouds ~0.85),
 * giving the mask a crisp sky/ground boundary with no tuning needed.
 */
export function loadSkyMask() {
  if (_maskCanvas)   return Promise.resolve(_maskCanvas);
  if (_maskPromise)  return _maskPromise;

  _maskPromise = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      _photoW = W;
      _photoH = H;

      // Draw photo to a temp canvas to read pixels
      const src = document.createElement('canvas');
      src.width  = W;
      src.height = H;
      const sctx = src.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(img, 0, 0);

      let pixels;
      try {
        pixels = sctx.getImageData(0, 0, W, H);
      } catch (e) {
        // Tainted canvas (rare for same-origin local image, but guard anyway)
        reject(e);
        return;
      }

      // Build mask as a new ImageData: white RGB with mask-value alpha
      const mask = sctx.createImageData(W, H);
      const sp = pixels.data;
      const mp = mask.data;

      // Pure-luminance mask: alpha = smoothstep(0.35, 0.70, BT.709 lum).
      // No y-zoning — the photo is cropped aspect-dependently by
      // `background-size: cover`, so luminance is the only reliable
      // intrinsic signal for "is this pixel sky".
      const total = W * H * 4;
      for (let i = 0; i < total; i += 4) {
        const r = sp[i]     / 255;
        const g = sp[i + 1] / 255;
        const b = sp[i + 2] / 255;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const m   = smoothstep(0.35, 0.70, lum);
        mp[i]     = 255;                 // R — irrelevant for destination-in
        mp[i + 1] = 255;                 // G
        mp[i + 2] = 255;                 // B
        mp[i + 3] = Math.round(m * 255); // alpha = mask strength
      }

      // Write mask into final cached canvas
      const out = document.createElement('canvas');
      out.width  = W;
      out.height = H;
      out.getContext('2d').putImageData(mask, 0, 0);

      _maskCanvas = out;
      resolve(out);
    };
    img.onerror = reject;
    img.src = PHOTO_URL;
  });

  return _maskPromise;
}

/**
 * Draw the cached mask onto a target 2D context, matching the same
 * `background-size: cover; background-position: center top` cropping
 * that CSS applies to `.bg-sunset`.
 *
 * Caller must set `ctx.globalCompositeOperation = 'destination-in'`
 * before calling this; this function only handles the geometry.
 *
 * @param {CanvasRenderingContext2D} ctx  target canvas context
 * @param {number} w                      target width (css pixels)
 * @param {number} h                      target height (css pixels)
 */
export function drawSkyMask(ctx, w, h) {
  if (!_maskCanvas) return;  // not yet loaded — caller should fall back
  const W = _photoW;
  const H = _photoH;

  // Emulate background-size: cover — pick the larger scale so the photo
  // fills the viewport, cropping the excess on the smaller axis.
  const scale = Math.max(w / W, h / H);
  const drawW = W * scale;
  const drawH = H * scale;

  // background-position: center top — horizontally centred, top-aligned.
  const dx = (w - drawW) / 2;
  const dy = 0;

  ctx.drawImage(_maskCanvas, dx, dy, drawW, drawH);
}

/**
 * Synchronous accessor: returns the cached mask canvas if already loaded,
 * or null otherwise. Used by skyCanvas.js to decide whether to clip this
 * frame or draw unclipped (first render before mask loads).
 */
export function getSkyMaskSync() {
  return _maskCanvas;
}

/**
 * Returns the original photo dimensions of the mask source image.
 * Used by skyWorker.js to replicate background-size: cover geometry.
 */
export function getSkyMaskDimensions() {
  return { photoW: _photoW, photoH: _photoH };
}
