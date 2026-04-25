// ═══════════════════════════════════════════
//  TWILIGHT — spots/geo.js
//  Pure geographic + temporal helpers: compass, bearing, azimuth, type icons.
//
//  Extracted from spots-screen.js. All functions here are stateless.
//  Two functions that logically need "current day + user location" take
//  them as explicit parameters (weekData, loc) so this module stays pure —
//  spots-screen.js wraps them with thin closures that inject its module state.
// ═══════════════════════════════════════════

import { calcSolarAzimuth, addMinutes } from '../utils.js';

// ─── Type icons ──────────────────────────
export const TYPE_ICONS = {
  'פסגה': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 21l4-11 4 11"/><path d="M2 21h20"/><path d="M12 6l2 4"/></svg>`,
  'נקודת תצפית': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="5" r="3"/><path d="M5 21l3-12h8l3 12"/></svg>`,
  'מצוק': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 21V8l5-5 4 7 5-3 4 4v10H3z"/></svg>`,
  'חוף': `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 20c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><path d="M2 17c2-1 4-1 6 0s4 1 6 0 4-1 6 0"/><circle cx="16" cy="6" r="3"/></svg>`,
};
export function getTypeIcon(type) { return TYPE_ICONS[type] || TYPE_ICONS['נקודת תצפית']; }

// ─── Compass arrow ───────────────────────
export function compassArrow(bearing) {
  return `<svg class="spot-compass" width="20" height="20" viewBox="0 0 24 24" style="transform:rotate(${bearing}deg)">
    <path d="M12 2l3 8h-6l3-8z" fill="var(--gold-light)" opacity="0.9"/>
    <path d="M12 22l-3-8h6l-3 8z" fill="var(--cream-faint)" opacity="0.4"/>
    <circle cx="12" cy="12" r="2" fill="none" stroke="var(--cream-faint)" stroke-width="1"/>
  </svg>`;
}

// ─── Bearing / azimuth ───────────────────
export function calcBearing(lat1, lon1, lat2, lon2) {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const la1 = lat1 * Math.PI / 180, la2 = lat2 * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
export function isWestFacing(b) { return b >= 210 && b <= 330; }
export function isEastFacing(b) { return b >= 30 && b <= 150; }

export function getSunsetAzimuth(weekData, loc) {
  // Use accurate solar azimuth at today's sunset if weekData is available
  const today = weekData?.[0];
  if (today?.sunset && loc?.lat) {
    const [h, m] = today.sunset.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return calcSolarAzimuth(loc.lat, loc.lon, d);
  }
  // Fallback: seasonal approximation
  const month = new Date().getMonth() + 1;
  if (month >= 5 && month <= 8) return 295;
  if (month >= 11 || month <= 2) return 245;
  return 270;
}
export function getNextEvent(weekData, loc) {
  const today = weekData?.[0];
  if (!today?.sunrise || !today?.sunset) return { type: 'sunset', azimuth: getSunsetAzimuth(weekData, loc) };
  const now = new Date();
  const [srH, srM] = today.sunrise.split(':').map(Number);
  const [ssH, ssM] = today.sunset.split(':').map(Number);
  const sunriseTime = new Date(); sunriseTime.setHours(srH, srM, 0, 0);
  const sunsetTime  = new Date(); sunsetTime.setHours(ssH, ssM, 0, 0);
  const ssAz = getSunsetAzimuth(weekData, loc);
  const srAz = (ssAz + 180) % 360;
  if (now < sunriseTime) return { type: 'sunrise', azimuth: srAz };
  if (now < sunsetTime)  return { type: 'sunset',  azimuth: ssAz };
  return { type: 'sunrise', azimuth: srAz }; // after sunset → next is sunrise
}

export function azimuthBonus(bearing, idealAz) {
  const diff = Math.abs(bearing - idealAz);
  const norm = diff > 180 ? 360 - diff : diff;
  if (norm <= 30) return 0.15;
  if (norm <= 60) return 0.07;
  return 0;
}

// ─── Helpers ─────────────────────────────
export function estimateDriveMin(dist) {
  if (dist <= 3)  return Math.round(dist * 3);
  if (dist <= 15) return Math.round(dist * 2.2);
  return Math.round(dist * 1.5);
}
export function calcDepartureTime(driveMin, eventTime, eventType) {
  if (!eventTime || eventTime === '--:--') return null;
  const buffer = eventType === 'sunrise' ? 15 : 30;
  return addMinutes(eventTime, -(driveMin + buffer));
}
export function isWesternCoastBeach(spot) { return spot.type === 'חוף' && spot.lon < 34.75; }
export function spotKey(name, lat) { return name + '|' + Math.round(lat * 1000); }

export function bearingToHeb(b) {
  if (b >= 337 || b < 23)  return 'צפון';
  if (b < 68)  return 'צפון-מזרח';
  if (b < 113) return 'מזרח';
  if (b < 158) return 'דרום-מזרח';
  if (b < 203) return 'דרום';
  if (b < 248) return 'דרום-מערב';
  if (b < 293) return 'מערב';
  return 'צפון-מערב';
}
