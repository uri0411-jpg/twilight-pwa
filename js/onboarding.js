// ═══════════════════════════════════════════
//  TWILIGHT — onboarding.js
//  First-launch walkthrough (3 screens) + re-showable from settings
// ═══════════════════════════════════════════

import { isOnboardingDone, markOnboardingDone } from './ui.js';

const SLIDES = [
  {
    title: 'ברוכים הבאים ל-TWILIGHT',
    body:  'האפליקציה מנתחת תנאי מזג אוויר ומנבאת כמה צבעונית תהיה השקיעה — כל יום, 7 ימים קדימה.',
    icon:  '<svg width="48" height="48" fill="none" stroke="var(--gold)" stroke-width="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
  },
  {
    title: 'מה הציון אומר?',
    body:  `<div class="onboard-scale">
              <div class="onboard-scale-row"><span class="onboard-score onboard-score-high">9+</span> <span>מעולה — שווה לצאת עכשיו</span></div>
              <div class="onboard-scale-row"><span class="onboard-score onboard-score-good">7-9</span> <span>טוב מאוד — צפויים צבעים חמים</span></div>
              <div class="onboard-scale-row"><span class="onboard-score onboard-score-ok">5-7</span> <span>טוב — שקיעה נאה</span></div>
              <div class="onboard-scale-row"><span class="onboard-score onboard-score-low">3-5</span> <span>בינוני — צבעים עמומים</span></div>
              <div class="onboard-scale-row"><span class="onboard-score onboard-score-bad">&lt;3</span> <span>חלש — שמיים אפורים</span></div>
            </div>
            <div style="margin-top:10px;font-size:11px;color:var(--cream-faint)">לחץ על הציון במסך הראשי לפירוט מלא</div>`,
    icon:  '<svg width="48" height="48" fill="none" stroke="var(--gold)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
  },
  {
    title: 'המערכת לומדת',
    body:  'עם כל שקיעה, TWILIGHT משווה את הניבוי למציאות ומשפרת את עצמה. ככל שתצטבר יותר היסטוריה — הניבויים ידויקו יותר.<br><br>תוכל לראות את כל הנתונים במסך "מערכת הלמידה" בהגדרות.',
    icon:  '<svg width="48" height="48" fill="none" stroke="var(--gold)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>'
  }
];

let _currentSlide = 0;
let _overlayEl = null;

export function showOnboarding(force = false) {
  if (!force && isOnboardingDone()) return;
  _currentSlide = 0;
  _render();
}

export function initOnboarding() {
  // Listen for re-show from settings
  window.addEventListener('twilight:showOnboarding', () => showOnboarding(true));

  // Auto-show on first launch
  if (!isOnboardingDone()) {
    // Small delay so the main screen renders first
    setTimeout(() => showOnboarding(), 600);
  }
}

function _render() {
  if (_overlayEl) _overlayEl.remove();

  const slide = SLIDES[_currentSlide];
  const isLast = _currentSlide === SLIDES.length - 1;
  const isFirst = _currentSlide === 0;

  _overlayEl = document.createElement('div');
  _overlayEl.className = 'onboarding-overlay';
  _overlayEl.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-icon">${slide.icon}</div>
      <div class="onboarding-title">${slide.title}</div>
      <div class="onboarding-body">${slide.body}</div>
      <div class="onboarding-dots">
        ${SLIDES.map((_, i) => `<div class="onboarding-dot${i === _currentSlide ? ' active' : ''}"></div>`).join('')}
      </div>
      <div class="onboarding-actions">
        ${!isFirst ? '<button class="onboarding-btn onboarding-btn-back" id="onboard-back">הקודם</button>' : ''}
        <button class="onboarding-btn onboarding-btn-next" id="onboard-next">${isLast ? 'התחל!' : 'הבא'}</button>
      </div>
      <button class="onboarding-skip" id="onboard-skip">דלג</button>
    </div>
  `;

  document.body.appendChild(_overlayEl);

  // Force reflow then add visible class for animation
  requestAnimationFrame(() => _overlayEl.classList.add('visible'));

  _overlayEl.querySelector('#onboard-next')?.addEventListener('click', () => {
    if (isLast) {
      _dismiss();
    } else {
      _currentSlide++;
      _render();
    }
  });

  _overlayEl.querySelector('#onboard-back')?.addEventListener('click', () => {
    if (_currentSlide > 0) {
      _currentSlide--;
      _render();
    }
  });

  _overlayEl.querySelector('#onboard-skip')?.addEventListener('click', _dismiss);
}

function _dismiss() {
  markOnboardingDone();
  if (_overlayEl) {
    _overlayEl.classList.remove('visible');
    setTimeout(() => _overlayEl?.remove(), 300);
  }
}
