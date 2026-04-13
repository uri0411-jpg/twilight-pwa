// ═══════════════════════════════════════════
//  TWILIGHT — store.js
//  Central state store — single source of truth for app-level state.
//  Replaces scattered module-scope variables in app.js / main-screen.js.
// ═══════════════════════════════════════════

const _state = {
  loc:              null,   // {lat, lon, isFallback?}
  city:             '',
  weekData:         null,
  airQuality:       null,
  locGen:           0,      // monotonic — guards location-related async
  dataGen:          0,      // monotonic — guards fetch-related async
  isRefreshing:     false,
  bootAborted:      false,
  locationResolved: false,  // gate — render/UI must not start without this
  spotsInitialized: false,
};

const _listeners = new Set();

export function getState() { return _state; }

export function setState(patch) {
  if (window.__twl_debug?.logState) {
    const prev = { ..._state };
    Object.assign(_state, patch);
    console.log('[STATE]', { prev, next: { ..._state }, patch });
  } else {
    Object.assign(_state, patch);
  }
  _listeners.forEach(fn => {
    try { fn(_state); } catch (e) { console.warn('[store] listener error:', e); }
  });
}

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function bumpLocGen() {
  return ++_state.locGen;
}

export function bumpDataGen() {
  return ++_state.dataGen;
}

/**
 * Contract 1 — isStale(gen)
 * Unified freshness gate for location-related async continuations.
 */
export function isStale(gen) {
  const stale = gen !== _state.locGen || _state.bootAborted;
  if (stale && window.__twl_debug) window.__twl_debug.staleDrops++;
  return stale;
}

/**
 * Data freshness gate — guards fetch continuations against
 * stale responses that arrive after a newer fetch was initiated.
 */
export function isDataStale(gen) {
  return gen !== _state.dataGen;
}

// Debug access
if (typeof window !== 'undefined') {
  window.__twl_store = _state;
}
