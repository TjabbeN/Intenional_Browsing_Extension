// The popup: status, add-only delays and blocks, remote lists, appearance.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { EXT, SAMPLE_POLICY, checker } = require('./helpers');

const HTML = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
const CONFIG_JS = fs.readFileSync(path.join(EXT, 'managed-config.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(EXT, 'popup.js'), 'utf8');
const t = checker();
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().split('T')[0];

function openPopup({ policy = SAMPLE_POLICY, sync = {}, local = {} } = {}) {
  // Scripts are evaluated by hand below, so the page's own tags stay inert.
  const dom = new JSDOM(HTML.replace(/<script src="[^"]+"><\/script>/g, ''), {
    url: 'chrome-extension://test/popup.html', runScripts: 'outside-only'
  });
  const w = dom.window;
  const store = { sync: JSON.parse(JSON.stringify(sync)), local: JSON.parse(JSON.stringify(local)) };
  const sent = [];
  const area = (name) => ({
    get: (keys, cb) => cb(JSON.parse(JSON.stringify(store[name]))),
    set: (obj, cb) => { Object.assign(store[name], JSON.parse(JSON.stringify(obj))); if (cb) cb(); },
    remove: (keys, cb) => { for (const k of [].concat(keys)) delete store[name][k]; if (cb) cb(); }
  });
  const replies = {
    getUserBlockedCount: { count: 3 },
    getBlocklistStatus: { configured: 2, failed: 0 },
    addUserBlockedSite: { success: true, domain: 'example.com', already: false },
    refreshBlocklist: { success: true }
  };
  w.chrome = {
    runtime: {
      lastError: undefined,
      getManifest: () => ({ version: '3.0.0' }),
      sendMessage: (msg, cb) => { sent.push(msg); if (cb) setTimeout(() => cb(replies[msg.action]), 0); }
    },
    storage: {
      sync: area('sync'),
      local: area('local'),
      managed: { get: () => Promise.resolve(policy) },
      onChanged: { addListener() {} }
    }
  };
  // One evaluation, so popup.js sees managed-config.js's globals as it does
  // in the browser (a strict-mode eval would keep them to itself).
  w.eval(CONFIG_JS + '\n;\n' + POPUP_JS);
  // jsdom fires DOMContentLoaded itself while the document is still loading.
  if (w.document.readyState !== 'loading') w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const $ = (id) => w.document.getElementById(id);
  const submit = (form) => form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  return { w, $, store, sent, submit };
}

(async () => {
  t.section('status');
  let p = openPopup();
  await tick();
  t.expect('version shown as 3.0', p.$('version').textContent === '3.0');
  t.expect('"Protection active" with a policy', p.$('statusTitle').textContent === 'Protection active');
  t.expect(`counts shown: "${p.$('statusDetail').textContent}"`, /^2 sites · \d+ keywords · 0 remote lists$/.test(p.$('statusDetail').textContent));
  p = openPopup({ policy: {} });
  await tick();
  t.expect('no policy is stated plainly', p.$('statusTitle').textContent === 'No managed configuration');

  t.section('mindful delays');
  p = openPopup({ sync: {
    lastResetDate: '2020-01-01',
    websites: [{ url: 'youtube.com', delay: 45, initialDelay: 20, delayIncrement: 5, gracePeriod: 0 }]
  } });
  await tick();
  const rows = p.w.document.querySelectorAll('#delayList li');
  t.expect('existing delay site listed', rows.length === 1 && rows[0].textContent.includes('youtube.com'));
  t.expect('daily reset back to the start delay', rows[0].textContent.includes('20 s · +5 s per visit') && p.store.sync.websites[0].delay === 20);
  t.expect('add form closed at first', p.$('addDelayForm').hidden && !p.$('openAddDelay').hidden);
  p.$('openAddDelay').click();
  t.expect('"Add a site" opens the form', !p.$('addDelayForm').hidden && p.$('openAddDelay').hidden);
  p.$('delaySite').value = 'news.example';
  p.submit(p.$('addDelayForm'));
  t.expect('incomplete entry refused with a message', p.store.sync.websites.length === 1 &&
    p.$('delayNote').classList.contains('danger-text'));
  p.$('delayStart').value = '10';
  p.$('delayStep').value = '3';
  p.$('delayGrace').value = '60';
  p.submit(p.$('addDelayForm'));
  const added = p.store.sync.websites[1];
  t.expect('new site saved', added && added.url === 'news.example' && added.delay === 10 &&
    added.initialDelay === 10 && added.delayIncrement === 3 && added.gracePeriod === 60 && added.minutesPerIncrement === 0);
  t.expect('form closes and the list updates', p.$('addDelayForm').hidden && p.w.document.querySelectorAll('#delayList li').length === 2);

  t.section('add-only');
  t.expect('no remove or edit controls in the delay list', p.w.document.querySelectorAll('#delayList button, #delayList input').length === 0);
  const removeLike = [...p.w.document.querySelectorAll('button')].filter((b) => /remove|delete|unblock|undo/i.test(b.textContent));
  t.expect('the only "Remove" button is the background image\'s', removeLike.length === 1 && removeLike[0].id === 'removeImage');

  t.section('block a site');
  p = openPopup();
  await tick();
  t.expect('blocked count shown', p.$('blockStatus').textContent === '3 sites blocked by you');
  p.$('blockSite').value = 'https://www.Example.com/path';
  p.$('blockButton').click();
  await tick();
  t.expect('first click asks to confirm the normalised domain', p.$('blockButton').textContent === 'Confirm: block example.com' &&
    !p.$('blockConfirmNote').hidden);
  t.expect('nothing blocked after one click', !p.sent.some((m) => m.action === 'addUserBlockedSite'));
  p.$('blockButton').click();
  await tick();
  t.expect('second click blocks', p.sent.some((m) => m.action === 'addUserBlockedSite' && m.site === 'https://www.Example.com/path'));
  t.expect('confirmation cleared afterwards', p.$('blockButton').textContent === 'Block permanently' && p.$('blockConfirmNote').hidden);
  p.$('blockSite').value = 'nodomain';
  p.$('blockButton').click();
  t.expect('invalid input refused', p.$('blockStatus').textContent === 'Not a valid domain.');

  t.section('remote lists and folding');
  t.expect('list count in the header', p.$('listsMeta').textContent === '2 lists');
  const toggle = p.w.document.querySelector('#listsFold .fold-toggle');
  t.expect('folded at first', p.$('listsBody').hidden && toggle.getAttribute('aria-expanded') === 'false');
  toggle.click();
  t.expect('opens on click', !p.$('listsBody').hidden && toggle.getAttribute('aria-expanded') === 'true');
  p.$('updateLists').click();
  await tick();
  t.expect('update requested', p.sent.some((m) => m.action === 'refreshBlocklist') && p.$('updateLists').textContent === 'Updated');

  t.section('appearance');
  p = openPopup({ sync: { customization: { backgroundColor: '#2b2f35', panelOpacity: 0.7 } },
                  local: { bgImage: 'data:image/png;base64,AAAA', bgImageName: 'mountains.jpg' } });
  await tick();
  const swatches = [...p.w.document.querySelectorAll('#swatches .swatch')];
  t.expect('five presets plus a custom colour', swatches.length === 6 && p.$('customColour').type === 'color');
  const graphite = swatches.find((s) => s.getAttribute('aria-label') === 'Graphite');
  t.expect('saved colour selected', graphite.classList.contains('selected') && !p.$('customColour').classList.contains('selected'));
  swatches.find((s) => s.getAttribute('aria-label') === 'Mist').click();
  t.expect('picking a preset saves it', p.store.sync.customization.backgroundColor === '#e8eef2');
  p.$('customColour').value = '#123456';
  p.$('customColour').dispatchEvent(new p.w.Event('change'));
  t.expect('custom colour saved and selected', p.store.sync.customization.backgroundColor === '#123456' &&
    p.$('customColour').classList.contains('selected'));
  t.expect('saved panel opacity shown', p.$('panelOpacity').value === '70' && p.$('panelValue').textContent === '70%');
  p.$('panelOpacity').value = '90';
  p.$('panelOpacity').dispatchEvent(new p.w.Event('change'));
  t.expect('panel opacity saved', p.store.sync.customization.panelOpacity === 0.9);
  t.expect('saved image shown with its name', !p.$('imageRow').hidden && p.$('imageName').textContent === 'mountains.jpg');
  p.$('removeImage').click();
  t.expect('image can be removed', p.$('imageRow').hidden && !('bgImage' in p.store.local));
  t.expect('other settings untouched by the image', p.store.sync.customization.panelOpacity === 0.9);

  t.finish();
  process.exit(process.exitCode);
})();
