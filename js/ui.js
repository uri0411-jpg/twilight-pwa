// ═══════════════════════════════════════════
//  TWILIGHT — ui.js
//  Toast notifications and loading overlay
// ═══════════════════════════════════════════

let toastTimer = null;

/**
 * Show a toast notification
 * @param {string} msg - message text
 * @param {'success'|'error'|'info'} type
 */
export function showToast(msg, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) return;

  el.textContent = msg;
  el.className = `toast toast-${type}`;
  el.style.display = 'flex';

  // Clear previous timer
  if (toastTimer) clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => {
      el.style.display = 'none';
      el.style.opacity = '';
    }, 300);
  }, 2500);
}

/**
 * Show or hide the loading overlay
 * @param {boolean} show
 */
export function showLoading(show) {
  const el = document.getElementById('loading');
  if (!el) return;
  if (show) {
    el.classList.remove('hidden');
    el.style.display = 'flex';
  } else {
    el.classList.add('hidden');
    el.style.display = 'none';
  }
}

/**
 * Create an image element with the twilight logo set
 * @param {'sunrise'|'sunset'|'twilight'} type
 * @param {number} size - px
 */
export function logoImg(type, size = 24) {
  const srcMap = {
    sunrise:  'images/sunrise.png',
    sunset:   'images/sunset.png',
    twilight: 'images/twilight.png'
  };
  return `<img src="${srcMap[type] || srcMap.twilight}" width="${size}" height="${size}" style="object-fit:contain;flex-shrink:0" alt="${type}">`;
}

/**
 * Sanitize a string for safe innerHTML insertion
 */
export function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Update adaptive glassmorphism CSS variables based on physics sky brightness.
 *
 * The sky colours themselves are painted directly onto the photo by
 * skyCanvas.js via mix-blend-mode — there's no CSS gradient overlay any more.
 * What this function still owns is the glass-card adaptation: bright vivid
 * skies → crisp transparent cards, dim overcast → opaque frosted cards.
 *
 * Parameters `score`, `turbidity`, `palette`, `beltOfVenus` are kept in the
 * signature for call-site compatibility (main-screen.js:startLiveGradient)
 * but only `skyColors` actually affects the output.
 *
 * @param {number} _score         (unused, kept for API parity)
 * @param {number} _turbidity     (unused)
 * @param {string} [_palette]     (unused)
 * @param {object|null} skyColors physics sky colours from skyColor.js
 * @param {number} [_beltOfVenus] (unused)
 */
export function updateDynamicGradient(_score = 5, _turbidity = 0.3, _palette = '', skyColors = null, _beltOfVenus = 0) {
  const root = document.documentElement.style;
  const skyBrightness = skyColors
    ? Math.min((skyColors.skyTop.r + skyColors.skyTop.g + skyColors.skyTop.b) / 765, 1)
    : 0.5; // neutral default when physics data hasn't loaded
  root.setProperty('--glass-blur',     `${(2 + (1 - skyBrightness) * 8).toFixed(1)}px`);
  root.setProperty('--glass-alpha',    (0.32 + (1 - skyBrightness) * 0.28).toFixed(2));
  root.setProperty('--glass-saturate', `${Math.round(110 + skyBrightness * 40)}%`);
}

// ✓ ui.js — complete
