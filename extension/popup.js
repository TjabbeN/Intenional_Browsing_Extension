// Intentional Browsing: popup.
//   - Status of the managed configuration (counts only, never entries)
//   - Mindful delays: list and add (add-only)
//   - Block a site (add-only, with a confirm step)
//   - Remote block lists: status and manual update
//   - Overlay appearance: colour, image, text panel opacity

'use strict';

const $ = (id) => document.getElementById(id);

const PRESET_COLOURS = [
  { color: '#F4F1EA', label: 'Warm white' },
  { color: '#E8EEF2', label: 'Mist' },
  { color: '#ECE9F3', label: 'Lavender' },
  { color: '#2B2F35', label: 'Graphite' },
  { color: '#2E3B33', label: 'Forest' }
];
const DEFAULT_COLOUR = '#E8EEF2';      // the overlay's own default
const DEFAULT_PANEL_OPACITY = 0.85;
const MAX_IMAGE_DIMENSION = 3840;      // 4K; larger screens still look sharp

function plural(n, word) {
  return `${Number(n).toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => {
        void chrome.runtime.lastError;
        resolve(resp);
      });
    } catch {
      resolve(undefined);
    }
  });
}

// ─── Header and managed status ──────────────────────────────────────────────
function renderStatus(cfg) {
  const box = $('status');
  if (!cfg.present) {
    box.classList.add('missing');
    $('statusTitle').textContent = 'No managed configuration';
    $('statusDetail').textContent = 'Only your delays and blocked sites are active.';
    return;
  }
  box.classList.remove('missing');
  const c = cfg.counts;
  const keywords = c.keywordsAnywhere + c.keywordsSubstring + c.keywordsSearch + c.keywordsSoft + c.keywordsFuzzy;
  let detail = [
    plural(c.blockedSites, 'site'),
    plural(keywords, 'keyword'),
    plural(c.blocklistUrls, 'remote list')
  ].join(' · ');
  const skipped = Object.values(cfg.skipped).reduce((a, b) => a + b, 0);
  if (skipped) detail += skipped === 1 ? ' (1 malformed entry ignored)' : ` (${skipped} malformed entries ignored)`;
  $('statusTitle').textContent = 'Protection active';
  $('statusDetail').textContent = detail;
}

function loadStatus() {
  // Read directly from managed storage, so the status is right even when the
  // service worker is not running.
  let request;
  try {
    request = chrome.storage.managed.get(null);
  } catch {
    request = Promise.resolve({});
  }
  Promise.resolve(request)
    .catch(() => ({}))
    .then((raw) => renderStatus(parseManagedConfig(raw || {})));
}

// ─── Folding sections ───────────────────────────────────────────────────────
function setupFold(sectionId) {
  const section = $(sectionId);
  const toggle = section.querySelector('.fold-toggle');
  const body = $(toggle.getAttribute('aria-controls'));
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    section.classList.toggle('open', open);
    body.hidden = !open;
  });
}

// ─── Mindful delays (add-only) ──────────────────────────────────────────────
function delayRow(site) {
  const li = document.createElement('li');
  const host = document.createElement('span');
  host.className = 'host';
  host.textContent = site.url;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${Number(site.delay) || 0} s · +${Number(site.delayIncrement) || 0} s per visit`;
  li.append(host, meta);
  return li;
}

function renderDelays(websites) {
  const list = $('delayList');
  list.textContent = '';
  for (const site of websites) {
    if (site && typeof site.url === 'string') list.appendChild(delayRow(site));
  }
  list.hidden = list.children.length === 0;
}

/** Shows the list, resetting delays to their start value once a day first. */
function loadDelays() {
  chrome.storage.sync.get(['websites', 'lastResetDate'], (result) => {
    const websites = Array.isArray(result.websites) ? result.websites : [];
    const today = new Date().toISOString().split('T')[0];
    if (result.lastResetDate === today) {
      renderDelays(websites);
      return;
    }
    const reset = websites.map((site) => {
      const initialDelay = site.initialDelay !== undefined ? site.initialDelay : site.delay;
      return { ...site, initialDelay, delay: initialDelay };
    });
    chrome.storage.sync.set({ websites: reset, lastResetDate: today }, () => renderDelays(reset));
  });
}

function setupDelays() {
  const form = $('addDelayForm');
  const openButton = $('openAddDelay');
  const note = $('delayNote');
  const NOTE = 'Added sites can’t be removed.';

  openButton.addEventListener('click', () => {
    form.hidden = false;
    openButton.hidden = true;
    $('delaySite').focus();
  });

  const int = (id) => {
    const v = parseInt($(id).value, 10);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = $('delaySite').value.trim();
    const delay = int('delayStart');
    const delayIncrement = int('delayStep');
    if (!url || delay === null || delayIncrement === null) {
      note.textContent = 'Enter a site, a start delay and the time added per visit.';
      note.classList.add('danger-text');
      return;
    }
    const newSite = {
      url,
      delay,
      initialDelay: delay,                       // restored by the daily reset
      delayIncrement,
      gracePeriod: int('delayGrace') || 0,
      // Minutes of focused time that earn one extra delayIncrement; 0 = off.
      minutesPerIncrement: int('delayMinutes') || 0
    };
    chrome.storage.sync.get(['websites'], (result) => {
      const websites = Array.isArray(result.websites) ? result.websites : [];
      websites.push(newSite);
      chrome.storage.sync.set({ websites }, () => {
        form.reset();
        form.hidden = true;
        openButton.hidden = false;
        note.textContent = NOTE;
        note.classList.remove('danger-text');
        renderDelays(websites);
      });
    });
  });
}

// ─── Block a site (add-only) ────────────────────────────────────────────────
/** The domain the background will store, using the same rules it uses. */
function previewDomain(raw) {
  return raw.toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0].split('?')[0].split('#')[0]
    .split('@').pop().split(':')[0]
    .replace(/^www\./, '').replace(/\.+$/, '');
}

async function showBlockedCount() {
  const resp = await sendMessage({ action: 'getUserBlockedCount' });
  if (!resp) return;
  $('blockStatus').textContent = resp.count === 1 ? '1 site blocked by you' : `${resp.count} sites blocked by you`;
}

function setupBlock() {
  const input = $('blockSite');
  const button = $('blockButton');
  const confirmNote = $('blockConfirmNote');
  const status = $('blockStatus');
  // Two steps: entries are permanent, so the normalised domain is shown for
  // review before it is committed. Guards against typos, not against intent.
  let pending = null;

  const reset = () => {
    pending = null;
    button.textContent = 'Block permanently';
    button.classList.remove('confirm');
    confirmNote.hidden = true;
  };
  input.addEventListener('input', reset);

  button.addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!raw) return;
    if (pending !== raw) {
      const domain = previewDomain(raw);
      if (!domain || !domain.includes('.')) {
        status.textContent = 'Not a valid domain.';
        return;
      }
      pending = raw;
      button.textContent = `Confirm: block ${domain}`;
      button.classList.add('confirm');
      confirmNote.hidden = false;
      return;
    }
    const resp = await sendMessage({ action: 'addUserBlockedSite', site: raw });
    reset();
    if (!resp || !resp.success) {
      status.textContent = resp && resp.reason === 'invalid' ? 'Not a valid domain.' : 'Could not save.';
      return;
    }
    input.value = '';
    status.textContent = resp.already ? `${resp.domain} was already blocked.` : `${resp.domain} blocked.`;
    setTimeout(showBlockedCount, 2500);
  });
}

// ─── Remote block lists ─────────────────────────────────────────────────────
async function showListsStatus() {
  const resp = await sendMessage({ action: 'getBlocklistStatus' });
  const meta = $('listsMeta');
  const button = $('updateLists');
  if (!resp) return;
  button.disabled = !resp.configured;
  if (!resp.configured) {
    meta.textContent = 'None';
    return;
  }
  let text = plural(resp.configured, 'list');
  if (resp.failed) text += ` · ${resp.failed} failed`;
  meta.textContent = text;
}

function setupLists() {
  const button = $('updateLists');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Updating…';
    const resp = await sendMessage({ action: 'refreshBlocklist' });
    button.textContent = resp && resp.success ? 'Updated' : 'Update failed';
    await showListsStatus();
    setTimeout(() => { button.textContent = 'Update now'; }, 2500);
  });
}

// ─── Overlay appearance ─────────────────────────────────────────────────────
function saveCustomization(changes) {
  chrome.storage.sync.get(['customization'], (result) => {
    const customization = { ...(result.customization || {}), ...changes };
    chrome.storage.sync.set({ customization });
  });
}

function setupColours(current) {
  const group = $('swatches');
  const custom = $('customColour');
  const buttons = PRESET_COLOURS.map(({ color, label }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.background = color;
    b.setAttribute('aria-label', label);
    b.dataset.color = color.toLowerCase();
    group.insertBefore(b, custom);
    return b;
  });

  const select = (color) => {
    const c = String(color || DEFAULT_COLOUR).toLowerCase();
    let matched = false;
    for (const b of buttons) {
      const on = b.dataset.color === c;
      matched = matched || on;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-pressed', String(on));
    }
    custom.classList.toggle('selected', !matched);
    if (!matched && /^#[0-9a-f]{6}$/.test(c)) custom.value = c;
  };

  for (const b of buttons) {
    b.addEventListener('click', () => {
      select(b.dataset.color);
      saveCustomization({ backgroundColor: b.dataset.color });
    });
  }
  custom.addEventListener('input', () => select(custom.value));
  custom.addEventListener('change', () => {
    select(custom.value);
    saveCustomization({ backgroundColor: custom.value });
  });
  select(current);
}

function setupPanelOpacity(current) {
  const slider = $('panelOpacity');
  const value = $('panelValue');
  const pct = Math.round((Number(current) || DEFAULT_PANEL_OPACITY) * 100);
  slider.value = String(Math.min(100, Math.max(50, pct)));
  const show = () => { value.textContent = slider.value + '%'; };
  show();
  slider.addEventListener('input', show);
  slider.addEventListener('change', () => saveCustomization({ panelOpacity: Number(slider.value) / 100 }));
}

/**
 * Scales an image down to the screen's real resolution (never up) and encodes
 * it at high quality. It is stored in storage.local, which has no practical
 * size limit with the unlimitedStorage permission.
 */
function encodeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const screenMax = Math.max(screen.width || 0, screen.height || 0) * (window.devicePixelRatio || 1);
        const limit = Math.min(MAX_IMAGE_DIMENSION, Math.max(1920, Math.round(screenMax)));
        const scale = Math.min(1, limit / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        // Flatten onto white so transparent images don't turn black.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const webp = canvas.toDataURL('image/webp', 0.92);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.92));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function setupImage() {
  const row = $('imageRow');
  const thumb = $('imageThumb');
  const name = $('imageName');
  const file = $('imageFile');
  const choose = $('chooseImage');
  const error = $('imageError');

  const render = (dataUrl, fileName) => {
    row.hidden = !dataUrl;
    if (dataUrl) {
      thumb.src = dataUrl;
      name.textContent = fileName || 'Background image';
      choose.textContent = 'Choose another image';
    } else {
      thumb.removeAttribute('src');
      choose.textContent = 'Choose image';
    }
  };

  chrome.storage.local.get(['bgImage', 'bgImageName'], (r) => render(r.bgImage || null, r.bgImageName));

  choose.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) return;
    error.hidden = true;
    choose.disabled = true;
    choose.textContent = 'Processing…';
    encodeImage(f)
      .then((dataUrl) => new Promise((resolve, reject) => {
        chrome.storage.local.set({ bgImage: dataUrl, bgImageName: f.name }, () => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(dataUrl);
        });
      }))
      .then((dataUrl) => render(dataUrl, f.name))
      .catch(() => {
        error.textContent = 'Could not use that image.';
        error.hidden = false;
        chrome.storage.local.get(['bgImage', 'bgImageName'], (r) => render(r.bgImage || null, r.bgImageName));
      })
      .finally(() => {
        choose.disabled = false;
        file.value = '';
      });
  });

  $('removeImage').addEventListener('click', () => {
    chrome.storage.local.remove(['bgImage', 'bgImageName'], () => render(null));
  });
}

function setupAppearance() {
  chrome.storage.sync.get(['customization'], (result) => {
    const c = result.customization || {};
    setupColours(c.backgroundColor);
    setupPanelOpacity(c.panelOpacity);
  });
  setupImage();
}

// ─── Start ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try {
    $('version').textContent = chrome.runtime.getManifest().version.split('.').slice(0, 2).join('.');
  } catch {}

  loadStatus();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed') {
      loadStatus();
      showListsStatus();
    }
  });

  setupFold('listsFold');
  setupFold('lookFold');
  loadDelays();
  setupDelays();
  setupBlock();
  showBlockedCount();
  setupLists();
  showListsStatus();
  setupAppearance();
});
