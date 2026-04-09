// ═══════════════════════════════════════════
//  TWILIGHT — learning-screen.js
//
//  Dedicated full-screen view of the self-learning system.
//  Two display modes:
//    Basic    — human-readable summaries, explanations, chart legend
//    Advanced — raw params, table filters, debug access
//
//  Layout:
//    1. Header (back arrow + title)
//    2. Natural language summary (basic)
//    3. KPI strip            — דיוק / דגימות / מגמה / ביטחון + explanations
//    4. Accuracy time chart  — full-width SVG + legend + tooltips
//    5. Forecast bias panel  — 4 cards with plain-language explanations
//    6. Histogram            — with summary sentence
//    7. Learned parameters   — (advanced only) drama weights, bell peaks, model biases
//    8. Entries table        — (advanced only) with filters
//    9. Reset button
// ═══════════════════════════════════════════

import { showToast, isAdvancedMode } from './ui.js';
import { showScreen } from './nav.js';
import { getLearningStats, clearLearningData } from './engine/learningEngine.js';
import { getCalibrationStats } from './calibration.js';

// ─────────────────────────────────────────────
//  Public entry point
// ─────────────────────────────────────────────
export function initLearningScreen() {
  const container = document.getElementById('screen-learning');
  if (!container) return;

  const lStats = getLearningStats();
  const cStats = getCalibrationStats();

  container.innerHTML = buildShell(lStats, cStats);
  attachEvents(lStats);
}

// ─────────────────────────────────────────────
//  Shell HTML
// ─────────────────────────────────────────────
function buildShell(lStats, cStats) {
  const empty = lStats.sampleSize === 0;
  const adv = isAdvancedMode();

  if (empty) {
    return `
    <div class="learning-content">
      ${renderHeader()}
      <div class="glass" style="padding:24px;text-align:center;font-size:13px;color:var(--cream-faint);line-height:1.9">
        אין עדיין נתוני למידה.<br>
        המערכת תתחיל ללמוד אחרי 10 שקיעות עם נתוני מזג אוויר בפועל.<br>
        בינתיים — נסה לרענן את האפליקציה כדי לטעון את ה-seed ההיסטורי.
      </div>
    </div>`;
  }

  return `
  <div class="learning-content">
    ${renderHeader()}
    ${renderNaturalSummary(lStats)}
    ${renderKPIs(lStats)}
    ${renderAccuracyChart(lStats)}
    ${renderBiasPanel(lStats)}
    ${renderHistogram(lStats)}
    ${adv ? renderParamsPanel(lStats) : ''}
    ${adv ? renderEntriesTable(lStats) : ''}
    ${renderResetBtn()}
  </div>`;
}

// ─────────────────────────────────────────────
//  Header — back arrow + title
// ─────────────────────────────────────────────
function renderHeader() {
  return `
  <div class="learning-header">
    <button class="learning-back-btn" id="learning-back-btn" aria-label="חזרה להגדרות">
      <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
    <div class="learning-title">מערכת הלמידה</div>
    <div style="width:36px"></div>
  </div>`;
}

// ─────────────────────────────────────────────
//  Natural language summary (#2)
// ─────────────────────────────────────────────
function renderNaturalSummary(stats) {
  const n   = stats.sampleSize;
  const acc = stats.forecastAccuracy;
  const tr  = stats.trend;

  // Build a human sentence
  const parts = [];
  if (n < 15)       parts.push(`המערכת למדה רק מ-${n} שקיעות — עדיין מוקדם להסיק מסקנות`);
  else if (n < 40)  parts.push(`המערכת למדה מ-${n} שקיעות ועדיין מתכיילת`);
  else              parts.push(`המערכת למדה מ-${n} שקיעות`);

  if (acc != null) {
    if (acc >= 85)      parts.push(`הדיוק מצוין (${acc}%)`);
    else if (acc >= 70) parts.push(`הדיוק סביר (${acc}%)`);
    else                parts.push(`הדיוק עדיין נמוך (${acc}%) — צפוי להשתפר עם הזמן`);
  }

  if (tr === 'improving')     parts.push('ויש מגמת שיפור');
  else if (tr === 'worsening') parts.push('אבל יש מגמת ירידה');
  else if (n >= 20)            parts.push('והדיוק יציב');

  return `
  <div class="glass learning-summary">
    <div class="learning-summary-text">${parts.join(', ')}.</div>
  </div>`;
}

// ─────────────────────────────────────────────
//  1. KPI strip — with sub-explanations
// ─────────────────────────────────────────────
function renderKPIs(stats) {
  const acc       = stats.forecastAccuracy;
  const accColor  = acc == null         ? 'var(--cream-faint)'
                  : acc >= 85           ? 'var(--gold)'
                  : acc >= 70           ? '#ffd580'
                  :                       '#ffaaaa';

  const trendIcon  = stats.trend === 'improving' ? '↗'
                   : stats.trend === 'worsening' ? '↘'
                   :                                '→';
  const trendColor = stats.trend === 'improving' ? '#aaffcc'
                   : stats.trend === 'worsening' ? '#ffaaaa'
                   :                                'var(--cream-faint)';

  // Explanation strings for basic mode
  const accExplain = acc == null ? 'לא מספיק נתונים'
                   : acc >= 85  ? 'הניבויים קולעים ברוב המקרים'
                   : acc >= 70  ? 'דיוק סביר, המערכת ממשיכה ללמוד'
                   :              'המערכת עדיין לומדת את התנאים המקומיים';

  const sampleExplain = stats.sampleSize < 20  ? 'צריך לפחות 20 שקיעות לדיוק טוב'
                       : stats.sampleSize < 50 ? 'מצטבר מאגר נתונים'
                       :                          'מאגר נתונים בוגר';

  const trendExplain = stats.trend === 'improving' ? 'הדיוק משתפר'
                     : stats.trend === 'worsening' ? 'יש ירידה בדיוק לאחרונה'
                     :                                'הדיוק יציב';

  const confExplain = stats.confidence >= 80 ? 'המערכת בטוחה בניבויים שלה'
                    : stats.confidence >= 50 ? 'ביטחון בינוני — עוד מתכיילת'
                    :                           'ביטחון נמוך — צריך עוד נתונים';

  return `
  <div class="learning-kpi-grid">
    <div class="glass learning-kpi">
      <div class="kpi-value" style="color:${accColor}">${acc != null ? acc + '%' : '—'}</div>
      <div class="kpi-label">דיוק תחזית</div>
      <div class="kpi-explain">${accExplain}</div>
    </div>
    <div class="glass learning-kpi">
      <div class="kpi-value" style="color:var(--cream)">${stats.sampleSize}</div>
      <div class="kpi-label">דגימות</div>
      <div class="kpi-explain">${sampleExplain}</div>
    </div>
    <div class="glass learning-kpi">
      <div class="kpi-value" style="color:${trendColor}">${trendIcon}</div>
      <div class="kpi-label">מגמה</div>
      <div class="kpi-explain">${trendExplain}</div>
    </div>
    <div class="glass learning-kpi">
      <div class="kpi-value" style="color:var(--gold)">${stats.confidence}%</div>
      <div class="kpi-label">ביטחון</div>
      <div class="kpi-explain">${confExplain}</div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────
//  2. Accuracy time chart — full-width SVG + tooltips
// ─────────────────────────────────────────────
function renderAccuracyChart(stats) {
  const ts = stats.timeSeries;
  if (!ts || ts.length < 2) {
    return `
    <div class="settings-section-label">דיוק לאורך זמן</div>
    <div class="glass" style="padding:16px;text-align:center;font-size:11px;color:var(--cream-faint)">
      מצטברים נתונים…
    </div>`;
  }

  const W = 320, H = 140, padX = 8, padY = 12;
  const innerW = W - padX * 2;
  const innerH = H - padY * 2;
  const n = ts.length;
  const xStep = n > 1 ? innerW / (n - 1) : 0;

  const yScale = (v) => v == null ? null : padY + ((10 - v) / 9) * innerH;

  const buildPolyline = (key) => {
    const pts = ts.map((e, i) => {
      const v = e[key];
      const y = yScale(v);
      return y != null ? `${(padX + i * xStep).toFixed(1)},${y.toFixed(1)}` : null;
    }).filter(Boolean).join(' ');
    return pts;
  };

  const predPts  = buildPolyline('predicted');
  const reconPts = buildPolyline('reconstructed');
  const ratingDots = ts.map((e, i) => {
    if (e.userRating == null) return '';
    const cx = (padX + i * xStep).toFixed(1);
    const cy = yScale(e.userRating).toFixed(1);
    return `<circle cx="${cx}" cy="${cy}" r="3" fill="#b39ddb"/>`;
  }).join('');

  // Invisible hit areas for tooltip tap targets
  const hitAreas = ts.map((e, i) => {
    const cx = (padX + i * xStep).toFixed(1);
    const pred = e.predicted != null ? e.predicted.toFixed(1) : '—';
    const recon = e.reconstructed != null ? e.reconstructed.toFixed(1) : '—';
    const err = (e.predicted != null && e.reconstructed != null)
      ? (e.predicted - e.reconstructed).toFixed(1) : '—';
    const dateStr = e.date ? e.date.slice(5) : '';
    return `<rect x="${(cx - 10).toFixed ? (parseFloat(cx) - 10).toFixed(1) : 0}" y="0" width="20" height="${H}"
              fill="transparent" class="chart-hit"
              data-date="${dateStr}" data-pred="${pred}" data-recon="${recon}" data-err="${err}"/>`;
  }).join('');

  // y-axis grid lines (3, 5, 7, 9)
  const grid = [3, 5, 7, 9].map(v => {
    const y = yScale(v).toFixed(1);
    return `<line x1="${padX}" y1="${y}" x2="${W - padX}" y2="${y}" stroke="rgba(245,220,180,0.08)" stroke-width="1" stroke-dasharray="2 4"/>
            <text x="${W - padX - 2}" y="${y - 2}" font-size="8" fill="rgba(245,220,180,0.35)" text-anchor="end">${v}</text>`;
  }).join('');

  return `
  <div class="settings-section-label">דיוק לאורך זמן (${n} דגימות אחרונות)</div>
  <div class="glass learning-chart-wrap">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="learning-chart" id="learning-accuracy-chart">
      ${grid}
      ${predPts  ? `<polyline points="${predPts}"  fill="none" stroke="var(--gold)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>` : ''}
      ${reconPts ? `<polyline points="${reconPts}" fill="none" stroke="#7eefb2"     stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>` : ''}
      ${ratingDots}
      ${hitAreas}
    </svg>
    <div id="chart-tooltip" class="chart-tooltip" style="display:none"></div>
    <div class="learning-legend">
      <span><span class="legend-line" style="background:var(--gold)"></span>ניבוי</span>
      <span><span class="legend-line" style="background:#7eefb2"></span>בפועל</span>
      <span><span class="legend-dot"  style="background:#b39ddb"></span>דירוג שלך</span>
    </div>
    <div class="chart-explain">לחץ על נקודה בגרף לפרטים</div>
  </div>`;
}

// ─────────────────────────────────────────────
//  3. Forecast bias panel — 4 cards with explanations
// ─────────────────────────────────────────────
function renderBiasPanel(stats) {
  const { cloudBias, humidityBias, dustBias, visibilityBias } = stats.forecastBias;

  const card = (label, val, paramHe) => {
    if (val == null) {
      return `
      <div class="glass bias-card">
        <div class="bias-label">${label}</div>
        <div class="bias-value" style="color:var(--cream-faint)">—</div>
        <div class="bias-hint">אין נתונים</div>
      </div>`;
    }
    const scale = 1 + val;
    const arrow = scale > 1.05 ? '↑' : scale < 0.95 ? '↓' : '✓';
    const color = (scale > 1.20 || scale < 0.80) ? '#ffaaaa'
                : (scale > 1.10 || scale < 0.90) ? '#ffd580'
                : '#aaffcc';

    // Human explanation
    let explain;
    if (Math.abs(val) < 0.05) {
      explain = `התחזית מדויקת לגבי ${paramHe}`;
    } else if (val > 0) {
      explain = `המערכת מזלזלת קצת ב${paramHe} — מתקנת כלפי מעלה`;
    } else {
      explain = `המערכת מגזימה קצת ב${paramHe} — מתקנת כלפי מטה`;
    }

    const adv = isAdvancedMode();
    return `
    <div class="glass bias-card">
      <div class="bias-label">${label}</div>
      <div class="bias-value" style="color:${color}">${adv ? scale.toFixed(2) + '×' : ''} ${arrow}</div>
      <div class="bias-hint">${explain}</div>
    </div>`;
  };

  return `
  <div class="settings-section-label">הטיית תחזית מול מציאות</div>
  <div class="learning-bias-grid">
    ${card('ענן',    cloudBias,      'עננים')}
    ${card('לחות',  humidityBias,   'לחות')}
    ${card('אבק',   dustBias,       'אבק')}
    ${card('נראות', visibilityBias, 'נראות')}
  </div>`;
}

// ─────────────────────────────────────────────
//  4. Error histogram — with summary
// ─────────────────────────────────────────────
function renderHistogram(stats) {
  const ts = stats.timeSeries;
  if (!ts || ts.length < 6) return '';

  const errors = ts
    .filter(e => e.predicted != null && e.reconstructed != null)
    .map(e => e.predicted - e.reconstructed);
  if (errors.length < 4) return '';

  const bins = [
    { lo: -5,   hi: -3,   count: 0, label: '-3<' },
    { lo: -3,   hi: -1.5, count: 0, label: '-2'  },
    { lo: -1.5, hi: -0.5, count: 0, label: '-1'  },
    { lo: -0.5, hi:  0.5, count: 0, label: '0'   },
    { lo:  0.5, hi:  1.5, count: 0, label: '+1'  },
    { lo:  1.5, hi:  3,   count: 0, label: '+2'  },
    { lo:  3,   hi:  5,   count: 0, label: '+3<' },
  ];
  for (const err of errors) {
    for (const b of bins) {
      if (err >= b.lo && err < b.hi) { b.count++; break; }
    }
  }

  const max = Math.max(...bins.map(b => b.count), 1);
  const bars = bins.map(b => {
    const heightPct = (b.count / max) * 100;
    return `
      <div class="hist-col">
        <div class="hist-bar" style="height:${heightPct}%"></div>
        <div class="hist-label">${b.label}</div>
      </div>`;
  }).join('');

  // Summary sentence
  const centerBin = bins[3].count;
  const total = errors.length;
  const centerPct = Math.round(centerBin / total * 100);
  const avgErr = (errors.reduce((s, e) => s + Math.abs(e), 0) / total).toFixed(1);

  let summary;
  if (centerPct >= 50) summary = `רוב הניבויים קולעים למטרה (${centerPct}% בטווח ±0.5)`;
  else if (centerPct >= 30) summary = `חלק מהניבויים מדויקים, שגיאה ממוצעת: ${avgErr} נקודות`;
  else summary = `שגיאה ממוצעת: ${avgErr} נקודות — המערכת עדיין מתכיילת`;

  return `
  <div class="settings-section-label">התפלגות שגיאת תחזית</div>
  <div class="glass learning-hist-wrap">
    <div class="hist-explain">${summary}</div>
    <div class="learning-hist">${bars}</div>
    <div class="hist-axis-label">שגיאה (ניבוי − בפועל), נקודות</div>
  </div>`;
}

// ─────────────────────────────────────────────
//  5. Learned parameters (advanced only)
// ─────────────────────────────────────────────
function renderParamsPanel(stats) {
  const w  = stats.currentWeights;
  const mb = stats.modelBiases;

  const param = (label, val, def, unit = '') => {
    const diff = Math.abs(val - def);
    const diffColor = diff < 0.02 ? '#aaffcc' : diff < 0.08 ? '#ffd580' : '#ffaaaa';
    return `
    <div class="param-row">
      <span class="param-label">${label}</span>
      <span class="param-value" style="color:${diffColor}">${val}${unit}</span>
      <span class="param-default">ברירת מחדל ${def}${unit}</span>
    </div>`;
  };

  return `
  <div class="settings-section-label">פרמטרים נלמדים</div>
  <div class="glass learning-params">
    <div class="param-group-title">משקלי דרמה</div>
    ${param('ענן',       w.cloudDramaW,      0.30)}
    ${param('אבק',       w.dustDramaW,       0.27)}
    ${param('אטמוספרה', w.atmosphereDramaW, 0.27)}

    <div class="param-group-title">אופטימום בלי</div>
    ${param('לחות', w.humidityOptimum, 60, '%')}
    ${param('אבק',  w.dustOptimum,     25, ' µg')}

    <div class="param-group-title">הטיית מודלים</div>
    ${param('Cloud',    (mb.CloudModel    > 0 ? '+' : '') + mb.CloudModel,    '0')}
    ${param('Dust',     (mb.DustModel     > 0 ? '+' : '') + mb.DustModel,     '0')}
    ${param('ClearSky', (mb.ClearSkyModel > 0 ? '+' : '') + mb.ClearSkyModel, '0')}
  </div>`;
}

// ─────────────────────────────────────────────
//  6. Entries table (advanced only) — with filter
// ─────────────────────────────────────────────
function renderEntriesTable(stats) {
  const ts = stats.timeSeries;
  if (!ts || ts.length === 0) return '';

  return `
  <div class="settings-section-label">היסטוריית דגימות (${ts.length})</div>
  <div class="entries-filter-row">
    <button class="entries-filter-btn active" data-filter="all">הכל</button>
    <button class="entries-filter-btn" data-filter="high-error">שגיאה גבוהה</button>
    <button class="entries-filter-btn" data-filter="rated">עם דירוג</button>
  </div>
  <div class="glass entries-table" id="entries-table-wrap">
    <div class="entries-row entries-head">
      <div class="entries-cell entries-date">תאריך</div>
      <div class="entries-cell entries-pred">תחזית</div>
      <div class="entries-cell entries-actual">בפועל</div>
      <div class="entries-cell entries-err">שגיאה</div>
      <div class="entries-cell entries-rating">דירוג</div>
    </div>
    <div class="entries-scroll" id="entries-scroll">${buildRows(ts, 'all')}</div>
  </div>`;
}

function buildRows(ts, filter) {
  return ts.slice().reverse().filter(e => {
    if (filter === 'high-error') {
      const err = (e.predicted != null && e.reconstructed != null)
        ? Math.abs(e.predicted - e.reconstructed) : 0;
      return err >= 1.5;
    }
    if (filter === 'rated') return e.userRating != null;
    return true;
  }).map(e => {
    const err = (e.predicted != null && e.reconstructed != null)
      ? Math.round((e.predicted - e.reconstructed) * 10) / 10
      : null;
    const errStr   = err == null ? '—' : (err > 0 ? '+' : '') + err.toFixed(1);
    const errColor = err == null            ? 'var(--cream-faint)'
                   : Math.abs(err) < 0.5    ? '#aaffcc'
                   : Math.abs(err) < 1.5    ? '#ffd580'
                   :                          '#ffaaaa';
    const rowClass = (err != null && Math.abs(err) >= 2) ? ' entries-row-bad' : '';
    const dateShort = e.date ? e.date.slice(5) : '—';
    return `
      <div class="entries-row${rowClass}">
        <div class="entries-cell entries-date">${dateShort}</div>
        <div class="entries-cell entries-pred">${e.predicted != null ? e.predicted.toFixed(1) : '—'}</div>
        <div class="entries-cell entries-actual">${e.reconstructed != null ? e.reconstructed.toFixed(1) : '—'}</div>
        <div class="entries-cell entries-err" style="color:${errColor}">${errStr}</div>
        <div class="entries-cell entries-rating">${e.userRating != null ? e.userRating.toFixed(1) : '—'}</div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  7. Reset button
// ─────────────────────────────────────────────
function renderResetBtn() {
  return `
  <div class="learning-reset-wrap">
    <button class="learning-reset-btn" id="learning-reset-btn">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0 .57-4.3"/></svg>
      אפס נתוני למידה
    </button>
  </div>`;
}

// ─────────────────────────────────────────────
//  Events
// ─────────────────────────────────────────────
function attachEvents(lStats) {
  document.getElementById('learning-back-btn')?.addEventListener('click', () => {
    showScreen('settings');
  });

  document.getElementById('learning-reset-btn')?.addEventListener('click', () => {
    if (!confirm('לאפס את כל נתוני הלמידה? לא ניתן לשחזור.')) return;
    clearLearningData();
    showToast('נתוני הלמידה אופסו', 'info');
    initLearningScreen();
  });

  // Chart tooltip on tap
  const chart = document.getElementById('learning-accuracy-chart');
  const tooltip = document.getElementById('chart-tooltip');
  if (chart && tooltip) {
    chart.querySelectorAll('.chart-hit').forEach(rect => {
      rect.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const d = rect.dataset;
        tooltip.innerHTML = `<strong>${d.date}</strong><br>ניבוי: ${d.pred} · בפועל: ${d.recon}<br>הפרש: ${d.err}`;
        tooltip.style.display = 'block';
        // Position near tap
        const chartRect = chart.getBoundingClientRect();
        const tapX = ev.clientX - chartRect.left;
        tooltip.style.left = Math.min(tapX, chartRect.width - 140) + 'px';
      });
    });
    // Dismiss tooltip on tap outside
    document.getElementById('screen-learning')?.addEventListener('click', () => {
      tooltip.style.display = 'none';
    });
  }

  // Table filter buttons (advanced mode)
  const filterBtns = document.querySelectorAll('.entries-filter-btn');
  const scrollWrap = document.getElementById('entries-scroll');
  if (filterBtns.length && scrollWrap && lStats) {
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        scrollWrap.innerHTML = buildRows(lStats.timeSeries, btn.dataset.filter);
      });
    });
  }
}

// ✓ learning-screen.js — complete
