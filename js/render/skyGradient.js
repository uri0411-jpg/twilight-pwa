/**
 * skyGradient.js — CSS variable renderer for physics-based sky colours.
 *
 * Receives the { skyTop, skyMid, horizon } zones from skyColor.js and writes
 * five --dyn-bg-* CSS custom properties used by .home-content in app.css:
 *
 *   --dyn-bg-top    0%   zenith zone    (Rayleigh dominant, blue/violet)
 *   --dyn-bg-mid   25%   mid sky        (warm transition, pink/amber)
 *   --dyn-bg-belt  55%   Belt of Venus  (anti-twilight arch, pink-purple)
 *   --dyn-bg-earth 80%   earth shadow   (dark band just above horizon)
 *   --dyn-bg-bottom 100% ground level   (deep dark)
 *
 * Alpha values scale with physical sky brightness so that a vivid clear-sky
 * sunset dominates the background photo while a dim overcast day stays subtle.
 *
 * @param {{ skyTop:{r,g,b}, skyMid:{r,g,b}, horizon:{r,g,b} }} skyColors
 * @param {number} [beltOfVenus=0]  0–1 visibility probability from goldenWindow.js
 */
export function renderSkyGradient(skyColors, beltOfVenus = 0) {
  const { skyTop, skyMid, horizon } = skyColors;

  // Alpha scales with perceived brightness: brighter sky → stronger overlay
  const topBright = (skyTop.r + skyTop.g + skyTop.b) / 765;
  const topAlpha  = (0.65 + topBright * 0.30).toFixed(2);
  const midAlpha  = (0.55 + topBright * 0.28).toFixed(2);

  // Belt of Venus: pink-purple tint, alpha = 0 when invisible, up to 0.55 at full probability
  // Guard against NaN — ?? doesn't filter NaN, so check explicitly
  const bov  = Number.isFinite(beltOfVenus) ? Math.max(0, Math.min(1, beltOfVenus)) : 0;
  const beltA = (bov * 0.55).toFixed(2);
  const beltR = Math.round(_lerp(horizon.r, 180, bov));
  const beltG = Math.round(_lerp(horizon.g,  60, bov));
  const beltB = Math.round(_lerp(horizon.b, 160, bov));

  // Earth shadow: desaturated dark band derived from horizon colour
  const earthR = Math.round(horizon.r * 0.25);
  const earthG = Math.round(horizon.g * 0.18);
  const earthB = Math.round(horizon.b * 0.35);

  const root = document.documentElement.style;
  root.setProperty('--dyn-bg-top',
    `rgba(${skyTop.r},${skyTop.g},${skyTop.b},${topAlpha})`);
  root.setProperty('--dyn-bg-mid',
    `rgba(${skyMid.r},${skyMid.g},${skyMid.b},${midAlpha})`);
  root.setProperty('--dyn-bg-belt',
    `rgba(${beltR},${beltG},${beltB},${beltA})`);
  root.setProperty('--dyn-bg-earth',
    `rgba(${earthR},${earthG},${earthB},0.65)`);
  root.setProperty('--dyn-bg-bottom',
    `rgba(${horizon.r},${horizon.g},${horizon.b},0.97)`);
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}
