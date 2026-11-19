// Intentional Browsing: content script.
//   - Delay overlay: visible-time countdown, reason or puzzle, grace period
//   - Loop-break dot: opens the configured loop-break page
//   - archive.org item scan (only when the administrator enables it)

(() => {
  // The background re-injects this file into tabs that were open before the
  // extension was installed; skip if a live copy is already running here.
  if (typeof window.__intentionalBrowsingAlive === 'function' && window.__intentionalBrowsingAlive()) return;
  window.__intentionalBrowsingAlive = () => {
    try { return !!chrome.runtime.id; } catch { return false; }
  };

  const DEBUG = false;
  const debug = (...args) => { if (DEBUG) console.log('[IntentionalBrowsing]', ...args); };

  const OVERLAY_ID = 'intentional-browsing-overlay';
  const DOT_ID = 'loop-break-dot';

  // ─── archive.org flagged-item scan ────────────────────────────────────────
  // Backs up the background metadata check: some flagged items carry no
  // metadata signal, but the page itself shows a warning notice.
  function archiveFlagScan() {
    const FLAG_PATTERNS = [
      /content\s+may\s+be\s+inappropriate/i,
      /this\s+item\s+contains\s+content\s+that\s+may\s+be\s+inappropriate/i
    ];
    let triggered = false;

    function checkAndClose() {
      if (triggered) return true;
      const text = (document.body && document.body.textContent) || '';
      if (!FLAG_PATTERNS.some(re => re.test(text))) return false;
      triggered = true;
      debug('archive.org notice found, closing tab');
      try { chrome.runtime.sendMessage({ action: 'closeTab', scrub: true }); } catch {}
      return true;
    }

    if (checkAndClose()) return;
    // The notice can be rendered after first paint; watch briefly.
    const startObserver = () => {
      if (!document.body) return;
      const obs = new MutationObserver(() => {
        if (checkAndClose()) obs.disconnect();
      });
      try {
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 4000);
      } catch {}
    };
    if (document.body) startObserver();
    else document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  }

  const onArchiveItemPage =
    (location.hostname === 'archive.org' || location.hostname.endsWith('.archive.org')) &&
    /^\/details\//.test(location.pathname);
  if (onArchiveItemPage) {
    try {
      chrome.runtime.sendMessage({ action: 'getContentSettings' }, (settings) => {
        void chrome.runtime.lastError;
        if (settings && settings.archiveScan) archiveFlagScan();
      });
    } catch {}
  }

  // Inline SVG icons: no external font, so they render regardless of page CSP.
  const SVG_CANCEL =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="36" height="36" fill="currentColor">' +
    '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>' +
    '</svg>';
  const SVG_CHECKBOX_BLANK =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="currentColor">' +
    '<path d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"/>' +
    '</svg>';
  const SVG_CHECKBOX_CHECKED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="currentColor">' +
    '<path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>' +
    '</svg>';

  // ─── Puzzles (soft-trigger overlay) ───────────────────────────────────────
  // A random maths or typing problem per prompt; a wrong answer gets a new one.
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function genSquare() {
    const n = randInt(13, 28);
    return { q: `What is ${n}² ?`, a: String(n * n) };
  }
  function genSqrt() {
    const n = randInt(13, 28);
    return { q: `What is √${n * n} ?`, a: String(n) };
  }
  function genCube() {
    const n = randInt(5, 13);
    return { q: `What is ${n}³ ?`, a: String(n * n * n) };
  }
  function genCbrt() {
    const n = randInt(4, 11);
    return { q: `What is ∛${n * n * n} ?`, a: String(n) };
  }
  function genChained() {
    const a = randInt(5, 25), b = randInt(3, 14), c = randInt(2, 9);
    if (Math.random() < 0.5) {
      return { q: `${a} + ${b} × ${c} = ?`, a: String(a + b * c) };
    }
    return { q: `(${a} + ${b}) × ${c} = ?`, a: String((a + b) * c) };
  }
  function genMod() {
    const b = randInt(7, 19);
    const a = randInt(80, 400);
    return { q: `${a} mod ${b} = ?`, a: String(a % b) };
  }
  function genFactorial() {
    const n = randInt(4, 7);
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return { q: `What is ${n}! ?`, a: String(f) };
  }
  function genLog() {
    const base = pick([2, 3, 5, 10]);
    const maxExp = base === 2 ? 10 : base === 3 ? 6 : 4;
    const exp = randInt(2, maxExp);
    return { q: `log_${base}(${Math.pow(base, exp)}) = ?`, a: String(exp) };
  }
  function genDeriv() {
    // f(x) = A x³ + B x² + C x + D; asks for f'(x0)
    const A = randInt(1, 4), B = randInt(1, 5) * (Math.random() < 0.3 ? -1 : 1),
          C = randInt(1, 9) * (Math.random() < 0.3 ? -1 : 1), D = randInt(0, 9),
          x0 = randInt(2, 5);
    const fp = 3 * A * x0 * x0 + 2 * B * x0 + C;
    const term = (k, expr) => k === 0 ? '' : (k > 0 ? ' + ' : ' − ') + Math.abs(k) + expr;
    const q = `f(x) = ${A}x³${term(B, 'x²')}${term(C, 'x')}${term(D, '')}.  What is f'(${x0}) ?`;
    return { q, a: String(fp) };
  }
  function genIntegral() {
    // ∫₀^end (a x² + b x + c) dx, coefficients chosen for an integer result
    const a = pick([3, 6, 9]), b = pick([2, 4, 6]), c = randInt(0, 9), end = pick([2, 3, 4]);
    const result = (a / 3) * end * end * end + (b / 2) * end * end + c * end;
    const cTerm = c === 0 ? '' : ` + ${c}`;
    return { q: `∫(${a}x² + ${b}x${cTerm}) dx  from 0 to ${end}  = ?`, a: String(result) };
  }
  function genSumSeries() {
    const n = randInt(8, 20);
    if (Math.random() < 0.5) {
      return { q: `Σ k from k=1 to ${n}  = ?`, a: String(n * (n + 1) / 2) };
    }
    return { q: `Σ k² from k=1 to ${n}  = ?`, a: String(n * (n + 1) * (2 * n + 1) / 6) };
  }
  function genBackward() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return { q: `Type this backwards:  ${s}`, a: s.split('').reverse().join(''), monospace: true };
  }

  const PUZZLE_GENERATORS = [
    { w: 2, fn: genSquare },
    { w: 2, fn: genSqrt },
    { w: 2, fn: genCube },
    { w: 1, fn: genCbrt },
    { w: 2, fn: genChained },
    { w: 1, fn: genMod },
    { w: 1, fn: genFactorial },
    { w: 1, fn: genLog },
    { w: 1, fn: genDeriv },
    { w: 1, fn: genIntegral },
    { w: 1, fn: genSumSeries },
    { w: 5, fn: genBackward }   // about a quarter of prompts
  ];

  function generatePuzzle() {
    const totalW = PUZZLE_GENERATORS.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * totalW;
    for (const item of PUZZLE_GENERATORS) {
      r -= item.w;
      if (r <= 0) return item.fn();
    }
    return PUZZLE_GENERATORS[0].fn();
  }

  function normalizePuzzleAnswer(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
  }

  const MONOSPACE_FONT = 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Courier New", monospace';

  // ─── Visibility tracking ──────────────────────────────────────────────────
  // The countdown only advances while the page is visible and its window has
  // focus.
  let windowHasFocus = !document.hidden;
  window.addEventListener('focus', () => { windowHasFocus = true; });
  window.addEventListener('blur', () => { windowHasFocus = false; });

  function isPageTrulyVisible() {
    return !document.hidden && windowHasFocus;
  }

  // ─── Messages from the background ─────────────────────────────────────────
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'ping') {
      sendResponse({ status: 'ready' });
      return true;
    }
    if (request.action === 'interceptWebsite') {
      const { site, customization } = request;
      if (document.getElementById(OVERLAY_ID)) {
        sendResponse({ status: 'skipped', reason: 'overlay exists' });
        return true;
      }
      checkGracePeriod(site, (inGracePeriod) => {
        if (inGracePeriod) {
          sendResponse({ status: 'skipped', reason: 'within grace period' });
        } else {
          createAndShowOverlay(site, customization || {}, sendResponse);
        }
      });
      return true;
    }
  });

  // ─── Grace period ─────────────────────────────────────────────────────────
  /** Grace periods are keyed by the site's hostname without "www.". */
  function siteKey(site) {
    try {
      const s = /^https?:\/\//.test(site.url) ? site.url : 'https://' + site.url;
      return new URL(s).hostname.replace(/^www\./, '');
    } catch {
      return site.url;
    }
  }

  function checkGracePeriod(site, callback) {
    const key = siteKey(site);
    chrome.storage.local.get(['gracePeriods'], (result) => {
      const entry = (result.gracePeriods || {})[key];
      callback(!!entry && Date.now() < entry.expiryTime);
    });
  }

  function setGracePeriod(site) {
    const key = siteKey(site);
    const expiryTime = Date.now() + site.gracePeriod * 1000;
    chrome.storage.local.get(['gracePeriods'], (result) => {
      const gracePeriods = result.gracePeriods || {};
      gracePeriods[key] = { expiryTime };
      chrome.storage.local.set({ gracePeriods });
    });
  }

  // ─── Delay overlay ────────────────────────────────────────────────────────
  function createAndShowOverlay(site, customization, sendResponse) {
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: customization.backgroundColor || '#f0f0f0',
      zIndex: '9999',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      fontFamily: 'Arial, sans-serif',
      padding: '20px'
    });

    // Optional background image: full-bleed, under a light scrim so the text
    // stays readable. Both live in background-image, behind the content.
    if (customization.backgroundImage) {
      const scrim = 'linear-gradient(rgba(255,255,255,0.72), rgba(255,255,255,0.72))';
      overlay.style.backgroundImage = `${scrim}, url("${customization.backgroundImage}")`;
      overlay.style.backgroundSize = 'cover';
      overlay.style.backgroundPosition = 'center';
      overlay.style.backgroundRepeat = 'no-repeat';
    }

    // Soft-trigger mode: a reflection message and a puzzle to solve.
    let currentPuzzle = null;
    let puzzleDisplay = null;
    if (customization.softReflect) {
      const reflectMsg = document.createElement('div');
      reflectMsg.textContent = customization.reflectionMessage || 'Pause. What are you actually looking for?';
      Object.assign(reflectMsg.style, {
        fontSize: '1.5em',
        maxWidth: '600px',
        textAlign: 'center',
        marginBottom: '24px',
        fontWeight: '500',
        color: '#000000'
      });
      overlay.appendChild(reflectMsg);

      currentPuzzle = generatePuzzle();
      puzzleDisplay = document.createElement('div');
      puzzleDisplay.textContent = currentPuzzle.q;
      Object.assign(puzzleDisplay.style, {
        fontSize: '1.4em',
        fontFamily: currentPuzzle.monospace ? MONOSPACE_FONT : 'Arial, sans-serif',
        padding: '16px 24px',
        marginBottom: '20px',
        background: '#ffffff',
        border: '2px solid #333',
        borderRadius: '8px',
        color: '#000000',
        maxWidth: '600px',
        textAlign: 'center',
        userSelect: 'none'   // discourages copying into a calculator
      });
      overlay.appendChild(puzzleDisplay);
    }

    const timerDisplay = document.createElement('div');
    timerDisplay.style.fontSize = '2em';
    timerDisplay.style.marginBottom = '20px';
    overlay.appendChild(timerDisplay);

    const inputContainer = document.createElement('div');
    Object.assign(inputContainer.style, {
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      maxWidth: '500px'
    });

    const closeTabContainer = document.createElement('div');
    Object.assign(closeTabContainer.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      width: '36px',
      height: '36px'
    });
    closeTabContainer.title = 'Close this tab';

    const closeTabIcon = document.createElement('span');
    Object.assign(closeTabIcon.style, {
      display: 'inline-flex',
      width: '36px',
      height: '36px',
      color: '#000000',
      transition: 'transform 0.2s'
    });
    closeTabIcon.innerHTML = SVG_CANCEL;
    closeTabContainer.appendChild(closeTabIcon);

    const reasonInput = document.createElement('input');
    reasonInput.type = 'text';
    reasonInput.placeholder = customization.softReflect ? 'Type your answer' : 'Enter your reason for visiting';
    reasonInput.style.padding = '10px';
    reasonInput.style.fontSize = '1em';
    reasonInput.style.flexGrow = '1';
    reasonInput.disabled = true;   // enabled when the countdown ends

    const checkboxIcon = document.createElement('span');
    checkboxIcon.title = 'Continue to site';
    Object.assign(checkboxIcon.style, {
      cursor: 'pointer',
      color: '#000000',
      width: '48px',
      height: '48px',
      alignItems: 'center',
      justifyContent: 'center',
      display: 'none'
    });
    checkboxIcon.innerHTML = SVG_CHECKBOX_BLANK;

    inputContainer.appendChild(closeTabContainer);
    inputContainer.appendChild(reasonInput);
    inputContainer.appendChild(checkboxIcon);
    overlay.appendChild(inputContainer);
    document.body.appendChild(overlay);

    // Countdown: only seconds where the page is truly visible count.
    let timeSpentVisible = 0;
    const updateTimer = () => {
      if (!isPageTrulyVisible()) return;
      timeSpentVisible++;
      const timeLeft = site.delay - timeSpentVisible;
      if (timeLeft >= 0) {
        timerDisplay.textContent = customization.softReflect
          ? `Take a breath — ${timeLeft}s`
          : `Wait ${timeLeft} seconds`;
      } else {
        clearInterval(timerInterval);
        timerDisplay.textContent = customization.softReflect ? 'Solve to continue' : 'Enter your reason to continue';
        reasonInput.disabled = false;
        reasonInput.focus();
      }
    };
    const timerInterval = setInterval(updateTimer, 1000);

    reasonInput.addEventListener('input', (e) => {
      checkboxIcon.style.display = e.target.value.trim() !== '' ? 'inline-flex' : 'none';
    });

    reasonInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !reasonInput.disabled && reasonInput.value.trim() !== '') {
        e.preventDefault();
        checkboxIcon.click();
      }
    });

    closeTabContainer.addEventListener('click', () => {
      closeTabIcon.style.transform = 'scale(1.2)';
      setTimeout(() => {
        closeTabIcon.style.transform = 'scale(1.0)';
        chrome.runtime.sendMessage({ action: 'closeTab' });
      }, 200);
    });

    // Guards against a double click re-entering the dismissal.
    let dismissing = false;

    function dismissOverlay() {
      if (dismissing) return;
      dismissing = true;
      try { clearInterval(timerInterval); } catch {}

      // Storage is updated after the overlay is gone, so a storage failure
      // can never keep it on screen.
      setTimeout(() => {
        try { overlay.remove(); } catch {}

        // Each completed visit to a delay site raises its next delay.
        // Soft-trigger overlays use a synthetic site and change nothing.
        if (customization.softReflect) return;
        try {
          chrome.storage.sync.get(['websites'], (result) => {
            const websites = (result.websites || []).map((w) => {
              if (w.url === site.url) w.delay = (w.delay || 0) + (w.delayIncrement || 0);
              return w;
            });
            chrome.storage.sync.set({ websites });
          });
        } catch (e) {
          debug('Delay update failed:', e);
        }
      }, 1000);
    }

    checkboxIcon.addEventListener('click', () => {
      try {
        if (customization.softReflect && currentPuzzle) {
          const given = normalizePuzzleAnswer(reasonInput.value);
          const expected = normalizePuzzleAnswer(currentPuzzle.a);
          if (given !== expected) {
            // Wrong: flash, new puzzle, and report it to spiral detection.
            try { chrome.runtime.sendMessage({ action: 'spiralEvent', kind: 'wrongPuzzle' }); } catch {}
            const origBg = reasonInput.style.background;
            reasonInput.style.background = '#ffd0d0';
            reasonInput.style.transition = 'background 0.4s';
            setTimeout(() => { reasonInput.style.background = origBg; }, 600);
            currentPuzzle = generatePuzzle();
            if (puzzleDisplay) {
              puzzleDisplay.textContent = currentPuzzle.q;
              puzzleDisplay.style.fontFamily = currentPuzzle.monospace ? MONOSPACE_FONT : 'Arial, sans-serif';
            }
            reasonInput.value = '';
            checkboxIcon.style.display = 'none';
            reasonInput.focus();
            return;
          }
        }

        checkboxIcon.innerHTML = SVG_CHECKBOX_CHECKED;
        if (site.gracePeriod && site.gracePeriod > 0) {
          try { setGracePeriod(site); } catch (e) { debug('setGracePeriod failed:', e); }
        }
        dismissOverlay();
      } catch (e) {
        // Last resort: never leave the user stuck on the overlay.
        debug('Continue handler failed:', e);
        dismissOverlay();
      }
    });

    sendResponse({ status: 'overlay_created' });
  }

  // ─── Loop-break dot ───────────────────────────────────────────────────────
  // A small dot in the bottom-right corner that opens the loop-break page set
  // in the popup. Shown only when that URL is set, and hidden on the loop-break
  // site itself and while an overlay is showing.
  (function loopBreakDot() {
    if (location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:') return;

    const pageHost = location.hostname.replace(/^www\./, '').toLowerCase();
    let enabled = false;

    function applyLoopBreakUrl(value) {
      const url = String(value || '').trim();
      let host = '';
      try {
        host = /^https?:\/\//i.test(url) ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : '';
      } catch {}
      enabled = !!host && pageHost !== host && !pageHost.endsWith('.' + host);
      tick();
    }

    function injectDot() {
      if (!document.body || document.getElementById(DOT_ID) || document.getElementById(OVERLAY_ID)) return;
      const dot = document.createElement('div');
      dot.id = DOT_ID;
      dot.setAttribute('role', 'button');
      dot.setAttribute('aria-label', 'Open loop-break page');
      dot.setAttribute('title', '');
      // Inline styles only, so page CSS can't restyle it.
      dot.style.cssText = [
        'position:fixed',
        'right:14px',
        'bottom:14px',
        'width:12px',
        'height:12px',
        'border-radius:50%',
        'background:#7a8a99',
        'opacity:0.28',
        'cursor:pointer',
        'z-index:2147483646',
        'transition:opacity 0.18s ease, transform 0.18s ease',
        'box-shadow:0 0 0 0 rgba(0,0,0,0)',
        'pointer-events:auto'
      ].join(';');
      dot.addEventListener('mouseenter', () => {
        dot.style.opacity = '0.85';
        dot.style.transform = 'scale(1.15)';
      });
      dot.addEventListener('mouseleave', () => {
        dot.style.opacity = '0.28';
        dot.style.transform = 'scale(1)';
      });
      dot.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          chrome.runtime.sendMessage({ action: 'openLoopBreak' }, () => { void chrome.runtime.lastError; });
        } catch {}
      });
      document.body.appendChild(dot);
    }

    function removeDot() {
      const el = document.getElementById(DOT_ID);
      if (el) el.remove();
    }

    function tick() {
      if (!enabled || document.getElementById(OVERLAY_ID)) removeDot();
      else injectDot();
    }

    try {
      chrome.storage.sync.get(['loopBreakUrl'], (r) => applyLoopBreakUrl(r && r.loopBreakUrl));
    } catch {}

    // Keeps the dot through SPA navigation and brings it back after an overlay.
    const obs = new MutationObserver(() => {
      const hasOverlay = !!document.getElementById(OVERLAY_ID);
      const hasDot = !!document.getElementById(DOT_ID);
      if (hasDot && (hasOverlay || !enabled)) removeDot();
      else if (!hasDot && !hasOverlay && enabled) injectDot();
    });
    const startObs = () => {
      if (!document.body) return;
      try { obs.observe(document.body, { childList: true, subtree: false }); } catch {}
      tick();
    };
    if (document.body) startObs();
    else document.addEventListener('DOMContentLoaded', startObs, { once: true });

    // When lockdown starts, the dot briefly grows and pulses twice. The cue
    // says that it started, not how long is left.
    function flashDot() {
      if (!enabled) return;
      injectDot();
      const dot = document.getElementById(DOT_ID);
      if (!dot || typeof dot.animate !== 'function') return;
      try {
        dot.animate(
          [
            { transform: 'scale(1)',   opacity: 0.28, background: '#7a8a99' },
            { transform: 'scale(2.0)', opacity: 0.95, background: '#c89a6b' },
            { transform: 'scale(1.3)', opacity: 0.55, background: '#a08470' },
            { transform: 'scale(1.8)', opacity: 0.85, background: '#c89a6b' },
            { transform: 'scale(1)',   opacity: 0.28, background: '#7a8a99' }
          ],
          { duration: 1800, easing: 'ease-in-out' }
        );
      } catch {}
    }

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.loopBreakUrl) {
        applyLoopBreakUrl(changes.loopBreakUrl.newValue);
      }
      if (area === 'local' && changes.lockdownExpiresAt) {
        const c = changes.lockdownExpiresAt;
        const now = Date.now();
        // Only on inactive -> active, not on renewals or on expiry.
        if (!(c.oldValue && c.oldValue > now) && c.newValue && c.newValue > now) flashDot();
      }
    });
  })();
})();
