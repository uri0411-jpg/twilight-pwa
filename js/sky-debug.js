// ═══════════════════════════════════════════
//  TWILIGHT — sky-debug.js (TEMPORARY)
//  Live overlay showing the values the sky-gradient update() loop
//  computes each tick. Used to debug a "background stays bright at
//  night" report. REVERT after diagnosis.
// ═══════════════════════════════════════════

let _overlay = null;
let _tickCount = 0;

function _ensure() {
  if (_overlay) return _overlay;
  _overlay = document.createElement('div');
  _overlay.id = 'sky-debug';
  _overlay.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:99999;' +
    'background:rgba(0,0,0,0.88);color:#7fbfff;' +
    "font:11px/1.4 ui-monospace,Consolas,monospace;" +
    'padding:8px 10px;border-radius:6px;max-width:60vw;' +
    'pointer-events:none;direction:ltr;text-align:left;' +
    'white-space:pre-wrap';
  (document.body || document.documentElement).appendChild(_overlay);
  return _overlay;
}

export function skyDebugTick({ liveElevDeg, nf, displayScore, locProvided, locResolved, isReady, bgFilter }) {
  _tickCount++;
  const now = new Date();
  const t = now.toTimeString().slice(0, 8);
  const lines = [
    `tick #${_tickCount} @ ${t}`,
    `locResolved: ${locResolved}  loc.lat: ${locProvided ?? 'NULL'}`,
    `isReady: ${isReady}`,
    `displayScore: ${displayScore?.toFixed?.(1) ?? displayScore}`,
    `liveElevDeg: ${liveElevDeg?.toFixed?.(2) ?? liveElevDeg}°`,
    `nightFactor: ${nf?.toFixed?.(3) ?? nf}`,
    `bg.filter: ${bgFilter || '(empty)'}`,
  ];
  _ensure().textContent = lines.join('\n');
}
