// ═══════════════════════════════════════════
//  TWILIGHT — spots/quality.js
//  Pure location-quality scoring: potential (1-5 ★), location quality (1-100),
//  and per-day sky-score assembly for a spot.
//
//  Extracted from spots-screen.js. Stateless — sunsetAz / nextEventAzimuth
//  are explicit params (matches the signature used by js/workers/spotsWorker.js).
// ═══════════════════════════════════════════

import { calcBearing, isWesternCoastBeach, estimateDriveMin, getNextEvent } from './geo.js';

export function fmtScore(v) { return v.toFixed(1); }

// ─── Spot Potential (1-5 stars) ──────────
// Based on location traits + next event direction
export function calcSpotPotential(spot, bearing, nextEventAzimuth) {
  let p = 2.0; // baseline
  const elev = spot.elevation || 0;
  // Elevation
  if (elev > 600) p += 1.2;
  else if (elev > 300) p += 0.8;
  else if (elev > 150) p += 0.4;
  // Azimuth for next event
  const diff = Math.abs(bearing - nextEventAzimuth);
  const norm = diff > 180 ? 360 - diff : diff;
  if (norm <= 25) p += 1.0;
  else if (norm <= 50) p += 0.5;
  // Type
  if (isWesternCoastBeach(spot)) p += 0.6;
  else if (spot.type === 'חוף') p += 0.2;
  if (spot.type === 'נקודת תצפית') p += 0.4;
  if (spot.type === 'מצוק') p += 0.3;

  return Math.max(1, Math.min(5, Math.round(p * 2) / 2)); // round to 0.5
}

// ─── Location Quality Score (1-100) ──────────────────────────────────────────
// Rates the geographic quality of a spot for a specific event (sunset/sunrise).
// Pure geography — independent of weather conditions.
//
// Scoring (100 pts total):
//   A. Direction alignment to sun azimuth  30 pts  (event-specific, inverted between events)
//   B. Horizon clearance quality           25 pts  (terrain type + obstruction warning)
//   C. Elevation above cloud layer         20 pts  (cleaner air, above low cloud)
//   D. Accessibility from user location    15 pts  (estimated drive time)
//   E. Terrain / landscape suitability    10 pts  (coast bonus for relevant event)
export function calcLocationQuality(spot, bearing, sunsetAz, mode = 'sunset') {
  const elev = spot.elevation ?? 0;

  // Target azimuth: sunset faces west, sunrise faces opposite (east)
  const targetAz = mode === 'sunrise' ? (sunsetAz + 180) % 360 : sunsetAz;
  const diff     = Math.abs(bearing - targetAz);
  const norm     = diff > 180 ? 360 - diff : diff;

  // A. Direction — 30 pts (most important factor, event-specific)
  const dirPts = norm <= 10 ? 30 : norm <= 25 ? 24 : norm <= 45 ? 16
               : norm <= 70 ?  8 : norm <= 100 ?  2 : 0;

  // B. Horizon quality — 25 pts (open sky toward event direction)
  const hasWarning = !!spot._horizonWarning;
  const horizPts = hasWarning ? 0
    : (isWesternCoastBeach(spot) && mode === 'sunset') ? 25
    : spot.type === 'מצוק'         ? 20
    : spot.type === 'פסגה'         ? 16
    : spot.type === 'נקודת תצפית' ? 14
    : spot.type === 'חוף'          ? 12 : 5;

  // C. Elevation — 20 pts (above marine boundary layer + cleaner air)
  const elevPts = elev >= 800 ? 20 : elev >= 500 ? 16 : elev >= 300 ? 11
               : elev >= 150 ?  7 : elev >= 50  ?  3 : 0;

  // D. Accessibility — 15 pts (estimated drive time from user)
  const driveMin  = estimateDriveMin(spot.dist || 0);
  const accessPts = driveMin < 10 ? 15 : driveMin < 20 ? 12
                  : driveMin < 35 ?  8 : driveMin < 60 ?  4 : 1;

  // E. Terrain type — 10 pts (landscape suitability, coast bonus is event-specific)
  const typePts = (isWesternCoastBeach(spot) && mode === 'sunset') ? 10
                : spot.type === 'מצוק'         ?  8
                : spot.type === 'נקודת תצפית'  ?  8
                : spot.type === 'פסגה'          ?  6
                : spot.type === 'חוף'           ?  3 : 1;

  return Math.max(1, Math.min(100, dirPts + horizPts + elevPts + accessPts + typePts));
}

// ─── Per-spot per-day sky score assembly ────────────────────────────────────
// Sky quality (ss/sr/tw/combined) = day.score from the physics engine.
// The atmosphere is the same at every spot — only location quality differs.
// Location quality is handled separately via _locationQualitySunset / _locationQualitySunrise.
export function calcSpotScores(spot, weekData, userLat, userLon) {
  const bearing = calcBearing(userLat, userLon, spot.lat, spot.lon);
  spot._bearing = bearing;
  const nextAz = getNextEvent(weekData, { lat: userLat, lon: userLon }).azimuth;
  spot._potential = calcSpotPotential(spot, bearing, nextAz);

  const days = (weekData || []).slice(0, 5).map(day => {
    if (!day) return { ss: 5.0, sr: 5.0, tw: 5.0, combined: 5.0 };
    return {
      ss:       Math.round((day.ssScore ?? day.score ?? 5.0) * 10) / 10,
      sr:       Math.round((day.srScore ?? day.score ?? 5.0) * 10) / 10,
      tw:       Math.round((day.twScore ?? day.score ?? 5.0) * 10) / 10,
      combined: Math.round((day.score   ?? 5.0)              * 10) / 10,
    };
  });

  return days.length ? days : [{ ss: 5.0, sr: 5.0, tw: 5.0, combined: 5.0 }];
}
