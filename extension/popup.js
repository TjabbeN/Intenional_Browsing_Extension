document.addEventListener('DOMContentLoaded', function() {
  const websiteInput = document.getElementById('websiteInput');
  const delayInput = document.getElementById('delayInput');
  const delayIncrementInput = document.getElementById('delayIncrementInput');
  const gracePeriodInput = document.getElementById('gracePeriodInput');
  const minutesPerIncrementInput = document.getElementById('minutesPerIncrementInput');
  const addWebsiteButton = document.getElementById('addWebsite');
  const websiteList = document.getElementById('websiteList');
  const backgroundImageInput = document.getElementById('backgroundImage');
  const backgroundColorInput = document.getElementById('backgroundColor');

  // ── Managed configuration status ───────────────────────────────────────
  // Read directly from chrome.storage.managed so the notice is right even if
  // the service worker is not running. Only counts are shown, never entries.
  const managedStatus = document.getElementById('managedStatus');

  function plural(n, word) {
    return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  }

  function renderManagedStatus(cfg) {
    managedStatus.textContent = '';
    const title = document.createElement('strong');
    const detail = document.createElement('div');

    if (!cfg.present) {
      managedStatus.className = 'notice missing';
      title.textContent = 'No managed configuration found.';
      detail.textContent =
        'Block lists, exceptions, keywords and protection settings are supplied by an ' +
        'administrator through enterprise policy. Until then only your delay sites and ' +
        'the sites you block below are active.';
    } else {
      const c = cfg.counts;
      const keywords = c.keywordsAnywhere + c.keywordsSubstring + c.keywordsSearch +
                       c.keywordsSoft + c.keywordsFuzzy;
      const skipped = Object.values(cfg.skipped).reduce((a, b) => a + b, 0);
      managedStatus.className = 'notice active';
      title.textContent = 'Managed configuration active.';
      detail.textContent = [
        plural(c.blockedSites, 'blocked site'),
        plural(c.allowedSubdomains + c.allowedPaths, 'exception'),
        plural(keywords, 'keyword'),
        plural(c.blocklistUrls, 'remote list')
      ].join(' · ');
      if (skipped) {
        detail.textContent += skipped === 1
          ? ' (1 malformed entry ignored)'
          : ` (${skipped} malformed entries ignored)`;
      }
    }
    managedStatus.appendChild(title);
    managedStatus.appendChild(detail);
  }

  function loadManagedStatus() {
    let request;
    try {
      request = chrome.storage.managed.get(null);
    } catch {
      request = Promise.resolve({});
    }
    Promise.resolve(request)
      .catch(() => ({}))
      .then(raw => renderManagedStatus(parseManagedConfig(raw || {})));
  }

  loadManagedStatus();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed') {
      loadManagedStatus();
      showBlocklistStatus();
    }
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Remote block lists ──────────────────────────────────────────────────
  const blocklistStatus = document.getElementById('blocklistStatus');
  const updateBlocklistBtn = document.getElementById('updateBlocklist');

  function showBlocklistStatus() {
    chrome.runtime.sendMessage({ action: 'getBlocklistStatus' }, (resp) => {
      void chrome.runtime.lastError;
      if (!resp) return;
      updateBlocklistBtn.disabled = !resp.configured;
      if (!resp.configured) {
        blocklistStatus.textContent = 'No remote lists configured.';
      } else if (resp.count > 0) {
        const d = resp.lastUpdated ? new Date(resp.lastUpdated).toLocaleDateString() : 'unknown';
        let text = `${resp.count.toLocaleString()} domains blocked, last updated ${d}.`;
        if (resp.failed) text += ` ${plural(resp.failed, 'list')} failed to load.`;
        if (resp.truncated) text += ' Size limit reached; some domains were skipped.';
        blocklistStatus.textContent = text;
      } else {
        blocklistStatus.textContent = 'Lists not downloaded yet.';
      }
    });
  }
  showBlocklistStatus();

  updateBlocklistBtn.addEventListener('click', () => {
    updateBlocklistBtn.disabled = true;
    updateBlocklistBtn.textContent = 'Updating…';
    chrome.runtime.sendMessage({ action: 'refreshBlocklist' }, (resp) => {
      void chrome.runtime.lastError;
      updateBlocklistBtn.disabled = false;
      updateBlocklistBtn.textContent = 'Update Lists Now';
      if (resp && resp.success) {
        showBlocklistStatus();
      } else {
        blocklistStatus.textContent = 'Update failed. Check the network connection.';
      }
    });
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Manual site blocking (add-only) ──────────────────────────────────────
  const blockSiteInput = document.getElementById('blockSiteInput');
  const blockSiteButton = document.getElementById('blockSiteButton');
  const blockSiteStatus = document.getElementById('blockSiteStatus');

  function showBlockedCount() {
    chrome.runtime.sendMessage({ action: 'getUserBlockedCount' }, (resp) => {
      void chrome.runtime.lastError;
      if (!resp) return;
      blockSiteStatus.textContent = resp.count === 1
        ? '1 site blocked manually.'
        : `${resp.count} sites blocked manually.`;
    });
  }
  showBlockedCount();

  // Two-step confirm: entries are permanent, so the normalised domain is shown
  // for review before it is committed. Guards against typos, not against intent.
  let pendingBlock = null;
  function resetPendingBlock() {
    pendingBlock = null;
    blockSiteButton.textContent = 'Block Permanently';
  }

  blockSiteInput.addEventListener('input', resetPendingBlock);

  blockSiteButton.addEventListener('click', () => {
    const raw = (blockSiteInput.value || '').trim();
    if (!raw) return;

    if (pendingBlock !== raw) {
      // Preview the normalised form using the same rules the background uses.
      const preview = raw.toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
        .split('/')[0].split('?')[0].split('#')[0]
        .split('@').pop().split(':')[0]
        .replace(/^www\./, '').replace(/\.+$/, '');
      if (!preview || !preview.includes('.')) {
        blockSiteStatus.textContent = 'Not a valid domain.';
        return;
      }
      pendingBlock = raw;
      blockSiteButton.textContent = `Confirm: block ${preview}`;
      blockSiteStatus.textContent = 'Click again to confirm. This cannot be undone here.';
      return;
    }

    chrome.runtime.sendMessage({ action: 'addUserBlockedSite', site: raw }, (resp) => {
      void chrome.runtime.lastError;
      resetPendingBlock();
      if (!resp || !resp.success) {
        blockSiteStatus.textContent =
          resp && resp.reason === 'invalid' ? 'Not a valid domain.' : 'Could not save.';
        return;
      }
      blockSiteInput.value = '';
      blockSiteStatus.textContent = resp.already
        ? `${resp.domain} was already blocked.`
        : `${resp.domain} blocked. Active now.`;
    });
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Loop-break page ─────────────────────────────────────────────────────
  const loopBreakUrlInput = document.getElementById('loopBreakUrl');
  const saveLoopBreakUrlBtn = document.getElementById('saveLoopBreakUrl');
  const loopBreakStatus = document.getElementById('loopBreakStatus');

  chrome.storage.sync.get(['loopBreakUrl'], (result) => {
    if (result.loopBreakUrl) {
      loopBreakUrlInput.value = result.loopBreakUrl;
      loopBreakStatus.textContent = 'Saved.';
    } else {
      loopBreakStatus.textContent = 'Not set.';
    }
  });

  saveLoopBreakUrlBtn.addEventListener('click', () => {
    const url = (loopBreakUrlInput.value || '').trim();
    if (url && !/^https?:\/\//i.test(url)) {
      loopBreakStatus.textContent = 'URL must start with http(s)://';
      return;
    }
    chrome.storage.sync.set({ loopBreakUrl: url }, () => {
      loopBreakStatus.textContent = url ? 'Saved.' : 'Cleared.';
    });
  });
  // ────────────────────────────────────────────────────────────────────────

  // ── Delay sites ─────────────────────────────────────────────────────────
  loadWebsitesAndCheckReset();

  addWebsiteButton.addEventListener('click', function() {
    const website = websiteInput.value.trim();
    const delay = delayInput.value;
    const delayIncrement = delayIncrementInput.value;
    const gracePeriod = gracePeriodInput.value || 0;
    const minutesPerIncrement = minutesPerIncrementInput.value || 0;

    if (website && delay && delayIncrement) {
      const newSite = {
        url: website,
        delay: parseInt(delay),
        initialDelay: parseInt(delay),   // restored by the daily reset
        delayIncrement: parseInt(delayIncrement),
        gracePeriod: parseInt(gracePeriod),
        // Minutes of focused time that earn one extra delayIncrement.
        // 0 disables time charging (per-visit increments only).
        minutesPerIncrement: parseInt(minutesPerIncrement)
      };

      chrome.storage.sync.get(['websites'], function(result) {
        const websites = result.websites || [];
        websites.push(newSite);

        chrome.storage.sync.set({ websites: websites }, function() {
          websiteInput.value = '';
          delayInput.value = '';
          delayIncrementInput.value = '';
          gracePeriodInput.value = '';
          minutesPerIncrementInput.value = '';
          loadWebsitesAndCheckReset();
        });
      });
    }
  });

  // ── Background image ─────────────────────────────────────────────────────
  // Stored in chrome.storage.local, not sync: sync caps one item at 8 KB, far
  // below any real image. The image is downscaled and re-encoded first.
  const backgroundImageStatus = document.getElementById('backgroundImageStatus');
  const backgroundImagePreview = document.getElementById('backgroundImagePreview');
  const clearBackgroundImageBtn = document.getElementById('clearBackgroundImage');

  const MAX_IMAGE_DIMENSION = 1600;

  function renderImageState(dataUrl) {
    if (dataUrl) {
      backgroundImagePreview.src = dataUrl;
      backgroundImagePreview.style.display = 'block';
      clearBackgroundImageBtn.style.display = 'block';
      const kb = Math.round((dataUrl.length * 3 / 4) / 1024);
      backgroundImageStatus.textContent = `Image saved (~${kb} KB).`;
    } else {
      backgroundImagePreview.removeAttribute('src');
      backgroundImagePreview.style.display = 'none';
      clearBackgroundImageBtn.style.display = 'none';
      backgroundImageStatus.textContent = 'No image set.';
    }
  }

  chrome.storage.local.get(['bgImage'], (r) => renderImageState(r.bgImage || null));

  function downscaleToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onloadend = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode failed'));
        img.onload = () => {
          let { width, height } = img;
          const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          // Flatten onto white so transparent PNGs don't turn black as JPEG.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  backgroundImageInput.addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    backgroundImageStatus.textContent = 'Processing…';

    downscaleToDataUrl(file).then((dataUrl) => {
      chrome.storage.local.set({ bgImage: dataUrl }, () => {
        if (chrome.runtime.lastError) {
          backgroundImageStatus.textContent = 'Could not save: ' + chrome.runtime.lastError.message;
          return;
        }
        renderImageState(dataUrl);
      });
    }).catch(() => {
      backgroundImageStatus.textContent = 'Could not read that image file.';
    });
  });

  clearBackgroundImageBtn.addEventListener('click', () => {
    chrome.storage.local.remove('bgImage', () => {
      backgroundImageInput.value = '';
      renderImageState(null);
    });
  });
  // ────────────────────────────────────────────────────────────────────────

  backgroundColorInput.addEventListener('change', function(e) {
    const color = e.target.value;
    chrome.storage.sync.get(['customization'], function(result) {
      const customization = result.customization || {};
      customization.backgroundColor = color;
      chrome.storage.sync.set({ customization: customization });
    });
  });

  function addWebsiteToList(site) {
    const siteElement = document.createElement('div');
    siteElement.style.marginBottom = '5px';
    siteElement.style.padding = '5px';
    siteElement.style.border = '1px solid #ddd';
    siteElement.style.borderRadius = '4px';

    const mpi = Number(site.minutesPerIncrement) || 0;
    const timeCharge = mpi > 0 ? `, Time: +${site.delayIncrement}s/${mpi}min` : '';
    siteElement.textContent = `${site.url} (Delay: ${site.delay}s, Increase: ${site.delayIncrement}s, Grace: ${site.gracePeriod || 0}s${timeCharge})`;
    websiteList.appendChild(siteElement);
  }

  function loadWebsitesAndCheckReset() {
    websiteList.innerHTML = '';

    chrome.storage.sync.get(['websites', 'customization', 'lastResetDate'], function(result) {
      const websites = result.websites || [];
      const customization = result.customization || {};

      // Daily reset (the background does the same on navigation).
      const currentDate = new Date().toISOString().split('T')[0];
      const lastResetDate = result.lastResetDate || '';

      if (lastResetDate !== currentDate) {
        const resetWebsites = websites.map(site => {
          const initialDelay = site.initialDelay !== undefined ? site.initialDelay : site.delay;
          return { ...site, initialDelay, delay: initialDelay };
        });
        chrome.storage.sync.set({ websites: resetWebsites, lastResetDate: currentDate }, function() {
          resetWebsites.forEach(addWebsiteToList);
        });
      } else {
        websites.forEach(addWebsiteToList);
      }

      if (customization.backgroundColor) {
        backgroundColorInput.value = customization.backgroundColor;
      }
    });
  }
});
