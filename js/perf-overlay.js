// ═══════════════════════════════════════════
//  TWILIGHT — perf-overlay.js (TEMPORARY)
//  Baseline instrumentation for B.0 — REVERT after capture.
//  Renders a fixed overlay (top-right) with key boot timings.
// ═══════════════════════════════════════════

let _overlay  = null;
const _records = [];
const _t0     = performance.now();
let _calcCount      = 0;
let _fetchResolved  = null;
let _paintMarked    = false;

function _render() {
  if (!_overlay) {
    _overlay = document.createElement('div');
    _overlay.id = 'perf-overlay';
    _overlay.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:99999;' +
      'background:rgba(0,0,0,0.88);color:#7fff7f;' +
      "font:11px/1.4 ui-monospace,Consolas,monospace;" +
      'padding:8px 10px;border-radius:6px;max-width:70vw;' +
      'pointer-events:none;direction:ltr;text-align:left;' +
      'white-space:pre-wrap;word-break:break-all';
    (document.body || document.documentElement).appendChild(_overlay);
  }
  _overlay.textContent = _records.join('\n');
}

export function perfRecord(line) {
  console.log('[perf]', line);
  _records.push(line);
  if (typeof document !== 'undefined') _render();
}

export function perfRecordDevice() {
  // Priority order: Chrome's UA contains "Safari", Edge's contains "Chrome", etc.
  const u = navigator.userAgent;
  const m = u.match(/Edg\/[\d.]+/) || u.match(/SamsungBrowser\/[\d.]+/) || u.match(/Chrome\/[\d.]+/) || u.match(/Firefox\/[\d.]+/) || u.match(/Safari\/[\d.]+/);
  const browser = m ? m[0] : 'unknown';
  const platform = /Android/.test(u) ? 'Android' : /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Windows/.test(u) ? 'Win' : /Mac/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '?';
  const cores = navigator.hardwareConcurrency ?? '?';
  const mem   = navigator.deviceMemory          ?? '?';
  const dpr   = (window.devicePixelRatio || 1).toFixed(2);
  const vp    = `${window.innerWidth}x${window.innerHeight}`;
  const sw    = navigator.serviceWorker?.controller ? 'sw:on' : 'sw:off';
  perfRecord(`device: ${browser} | ${platform} | ${cores}c | ${mem}GB | DPR ${dpr} | ${vp} | ${sw}`);
}

export function perfTimeCalcWeekData(label, fn) {
  const start = performance.now();
  const result = fn();
  const dur = (performance.now() - start).toFixed(1);
  _calcCount++;
  perfRecord(`calcWeekData[${label}] #${_calcCount}: ${dur}ms`);
  return result;
}

export function markFetchWeekFastResolved() {
  if (_fetchResolved != null) return;
  _fetchResolved = performance.now();
  perfRecord(`fetchWeekFast resolved: T+${(_fetchResolved - _t0).toFixed(1)}ms`);
}

export function markGaugePainted() {
  if (_paintMarked) return;
  _paintMarked = true;
  const now = performance.now();
  if (_fetchResolved != null) {
    perfRecord(`fetch → gauge paint: ${(now - _fetchResolved).toFixed(1)}ms`);
  }
  perfRecord(`boot total: ${(now - _t0).toFixed(1)}ms`);
}
