// ═══════════════════════════════════════════
//  TWILIGHT — zones.js
//  Weather zones for Israel — reduces API calls by grouping nearby
//  locations that share similar atmospheric conditions.
//
//  Each zone has a representative coordinate used for API fetches.
//  Sun position / physics rendering still uses the user's exact lat/lon.
// ═══════════════════════════════════════════

/**
 * @typedef {Object} Zone
 * @property {string}  zoneId  Unique identifier
 * @property {string}  label   Hebrew display name
 * @property {number}  latMin  Southern boundary
 * @property {number}  latMax  Northern boundary
 * @property {number}  lonMin  Western boundary
 * @property {number}  lonMax  Eastern boundary
 * @property {number}  repLat  Representative latitude for API fetch
 * @property {number}  repLon  Representative longitude for API fetch
 */

/** @type {Zone[]} */
const ZONES = [
  // ── Coastal plain (5) ──────────────────────────────────────────────
  { zoneId: 'coast-north',   label: 'חוף צפון',      latMin: 32.75, latMax: 33.10, lonMin: 34.85, lonMax: 35.10, repLat: 32.92, repLon: 34.99 },
  { zoneId: 'coast-haifa',   label: 'מפרץ חיפה',     latMin: 32.55, latMax: 32.85, lonMin: 34.80, lonMax: 35.10, repLat: 32.70, repLon: 34.95 },
  { zoneId: 'coast-sharon',  label: 'שרון',          latMin: 32.20, latMax: 32.55, lonMin: 34.70, lonMax: 34.95, repLat: 32.33, repLon: 34.85 },
  { zoneId: 'coast-tlv',     label: 'תל אביב-מרכז',  latMin: 31.90, latMax: 32.20, lonMin: 34.60, lonMax: 34.90, repLat: 32.07, repLon: 34.77 },
  { zoneId: 'coast-south',   label: 'חוף דרום',       latMin: 31.55, latMax: 31.90, lonMin: 34.45, lonMax: 34.75, repLat: 31.66, repLon: 34.57 },

  // ── Central hills (5) ─────────────────────────────────────────────
  { zoneId: 'galilee-upper', label: 'גליל עליון',     latMin: 32.85, latMax: 33.35, lonMin: 35.10, lonMax: 35.60, repLat: 33.00, repLon: 35.30 },
  { zoneId: 'galilee-lower', label: 'גליל תחתון',     latMin: 32.55, latMax: 32.85, lonMin: 35.10, lonMax: 35.50, repLat: 32.70, repLon: 35.30 },
  { zoneId: 'samaria',       label: 'שומרון',         latMin: 32.10, latMax: 32.55, lonMin: 34.95, lonMax: 35.40, repLat: 32.33, repLon: 35.18 },
  { zoneId: 'jerusalem',     label: 'הרי ירושלים',    latMin: 31.65, latMax: 32.10, lonMin: 34.95, lonMax: 35.35, repLat: 31.78, repLon: 35.20 },
  { zoneId: 'shephelah',     label: 'שפלה',           latMin: 31.55, latMax: 31.90, lonMin: 34.75, lonMax: 34.95, repLat: 31.73, repLon: 34.85 },

  // ── Valleys (3) ───────────────────────────────────────────────────
  { zoneId: 'jezreel',       label: 'עמק יזרעאל',    latMin: 32.45, latMax: 32.70, lonMin: 35.10, lonMax: 35.45, repLat: 32.58, repLon: 35.28 },
  { zoneId: 'beit-shean',    label: 'בית שאן',        latMin: 32.30, latMax: 32.55, lonMin: 35.40, lonMax: 35.60, repLat: 32.43, repLon: 35.50 },
  { zoneId: 'hula',          label: 'עמק החולה',      latMin: 33.00, latMax: 33.30, lonMin: 35.50, lonMax: 35.70, repLat: 33.10, repLon: 35.60 },

  // ── Jordan Valley / Dead Sea (2) ──────────────────────────────────
  { zoneId: 'jordan-north',  label: 'בקעת הירדן',     latMin: 32.10, latMax: 32.45, lonMin: 35.40, lonMax: 35.65, repLat: 32.28, repLon: 35.52 },
  { zoneId: 'dead-sea',      label: 'ים המלח',        latMin: 31.20, latMax: 31.80, lonMin: 35.30, lonMax: 35.55, repLat: 31.50, repLon: 35.40 },

  // ── Negev (4) ─────────────────────────────────────────────────────
  { zoneId: 'negev-north',   label: 'צפון נגב',       latMin: 31.10, latMax: 31.55, lonMin: 34.30, lonMax: 35.00, repLat: 31.25, repLon: 34.79 },
  { zoneId: 'negev-central', label: 'נגב מרכזי',      latMin: 30.40, latMax: 31.10, lonMin: 34.20, lonMax: 35.10, repLat: 30.85, repLon: 34.68 },
  { zoneId: 'arava',         label: 'ערבה',           latMin: 29.60, latMax: 30.80, lonMin: 34.80, lonMax: 35.40, repLat: 30.20, repLon: 35.10 },
  { zoneId: 'eilat',         label: 'אילת',           latMin: 29.40, latMax: 29.70, lonMin: 34.85, lonMax: 35.05, repLat: 29.56, repLon: 34.95 },

  // ── Golan (2) ─────────────────────────────────────────────────────
  { zoneId: 'golan-north',   label: 'גולן צפון',      latMin: 33.10, latMax: 33.40, lonMin: 35.60, lonMax: 35.90, repLat: 33.25, repLon: 35.75 },
  { zoneId: 'golan-south',   label: 'גולן דרום',      latMin: 32.70, latMax: 33.10, lonMin: 35.55, lonMax: 35.90, repLat: 32.90, repLon: 35.72 },

  // ── Eastern (2) ───────────────────────────────────────────────────
  { zoneId: 'east-samaria',  label: 'מזרח שומרון',    latMin: 32.00, latMax: 32.40, lonMin: 35.30, lonMax: 35.60, repLat: 32.20, repLon: 35.45 },
  { zoneId: 'judean-desert', label: 'מדבר יהודה',     latMin: 31.30, latMax: 31.75, lonMin: 35.20, lonMax: 35.45, repLat: 31.55, repLon: 35.32 },
];

/**
 * Find the weather zone for a given coordinate.
 *
 * Uses bounding-box containment first; falls back to nearest zone
 * (by Euclidean distance to representative point) if outside all boxes.
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {{ zoneId: string, repLat: number, repLon: number, label: string }}
 */
export function getZoneForCoord(lat, lon) {
  // 1. Try exact bounding-box match
  for (const z of ZONES) {
    if (lat >= z.latMin && lat <= z.latMax && lon >= z.lonMin && lon <= z.lonMax) {
      return { zoneId: z.zoneId, repLat: z.repLat, repLon: z.repLon, label: z.label };
    }
  }

  // 2. Fallback: nearest zone by distance to representative point
  let best = ZONES[0];
  let bestDist = Infinity;
  for (const z of ZONES) {
    const dLat = lat - z.repLat;
    const dLon = lon - z.repLon;
    const dist = dLat * dLat + dLon * dLon;
    if (dist < bestDist) {
      bestDist = dist;
      best = z;
    }
  }
  return { zoneId: best.zoneId, repLat: best.repLat, repLon: best.repLon, label: best.label };
}

// Export zone list for debugging / testing
export { ZONES };
