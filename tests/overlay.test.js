// The delay overlay: countdown, hold to continue, soft-trigger puzzle.
// Runs content.js in jsdom pages with real timers, so it takes a few seconds.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { EXT, checker } = require('./helpers');

const SRC = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
const OVERLAY_ID = 'intentional-browsing-overlay';
const t = checker();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openPage({ websites = [], random } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><p>page</p></body></html>', {
    url: 'https://example.com/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  if (random) w.Math.random = random;
  const sent = [];
  const sync = { websites: JSON.parse(JSON.stringify(websites)) };
  let listener = null;
  w.chrome = {
    runtime: {
      id: 'test',
      lastError: undefined,
      sendMessage: (msg, cb) => { sent.push(msg); if (cb) cb({}); },
      onMessage: { addListener: (fn) => { listener = fn; } }
    },
    storage: {
      sync: {
        get: (k, cb) => cb(JSON.parse(JSON.stringify(sync))),
        set: (obj, cb) => { Object.assign(sync, obj); if (cb) cb(); }
      },
      local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() },
      onChanged: { addListener() {} }
    }
  };
  w.eval(SRC);
  const open = (site, customization = {}) => new Promise((resolve) => {
    listener({ action: 'interceptWebsite', site, customization }, {}, resolve);
  });
  const host = () => w.document.getElementById(OVERLAY_ID);
  const q = (sel) => host() && host().shadowRoot.querySelector(sel);
  const fire = (el, type, init = {}) => {
    const Ctor = type.startsWith('key') ? w.KeyboardEvent : w.MouseEvent;
    el.dispatchEvent(new Ctor(type, { bubbles: true, composed: true, cancelable: true, ...init }));
  };
  return { dom, w, sent, sync, open, host, q, fire };
}

(async () => {
  t.section('countdown');
  let p = openPage({ websites: [{ url: 'example.com', delay: 2, delayIncrement: 5 }] });
  let resp = await p.open({ url: 'example.com', delay: 2, delayIncrement: 5, gracePeriod: 0 },
    { backgroundColor: '#2b2f35', backgroundImage: 'data:image/png;base64,AAAA', panelOpacity: 0.7 });
  t.expect('overlay created', resp && resp.status === 'overlay_created');
  t.expect('isolated in a shadow root', !!p.host().shadowRoot);
  t.expect('on the highest stacking level', p.host().style.zIndex === '2147483647');
  t.expect('countdown shows the delay', p.q('.count').textContent === '2');
  t.expect('hold circle hidden while waiting', p.q('.hold').hidden);
  t.expect('question hidden while waiting', p.q('.message').hidden);
  t.expect('chosen colour applied', p.q('.backdrop').style.backgroundColor === 'rgb(43, 47, 53)');
  t.expect('image fills the backdrop, no white wash', /url\("data:image\/png;base64,AAAA"\)/.test(p.q('.backdrop').style.backgroundImage) &&
    !/gradient/.test(p.q('.backdrop').style.backgroundImage));
  t.expect('panel opacity applied over an image', p.q('.panel').style.background.includes('0.7'));
  await wait(1100);
  t.expect('counts down', p.q('.count').textContent === '1');
  await wait(1100);
  t.expect('hold circle shown after the countdown', !p.q('.hold').hidden && !p.q('.message').hidden);
  t.expect('question shown', p.q('.message').textContent === 'What are you here for?');

  t.section('hold to continue');
  const hold = p.q('.hold');
  p.fire(hold, 'pointerdown', { button: 0 });
  await wait(1200);
  const mid = Number(p.q('.ring').getAttribute('stroke-dashoffset'));
  t.expect(`ring fills while held (offset ${mid.toFixed(0)} of 364)`, mid < 300 && mid > 0);
  t.expect('label says keep holding', p.q('.hold .label').textContent === 'Keep holding');
  p.fire(hold, 'pointerup', { button: 0 });
  await wait(50);
  t.expect('letting go resets the ring', Number(p.q('.ring').getAttribute('stroke-dashoffset')) > 364);
  t.expect('still on the overlay', !!p.host());

  let outsideKeys = 0;
  p.w.document.addEventListener('keydown', () => { outsideKeys++; });
  p.fire(hold, 'pointerdown', { button: 0 });
  await wait(1000);
  p.w.dispatchEvent(new p.w.Event('blur'));
  await wait(50);
  t.expect('switching away stops the hold', p.q('.hold .label').textContent === 'Hold');
  p.w.dispatchEvent(new p.w.Event('focus'));

  p.fire(hold, 'keydown', { key: ' ' });
  t.expect('keys on the overlay do not reach the page', outsideKeys === 0);
  await wait(3300);
  t.expect('holding Space for 3 seconds continues', p.q('.hold') === null || p.q('.hold').classList.contains('done') || !p.host());
  await wait(600);
  t.expect('overlay removed', !p.host());
  t.expect('next delay raised by the increment', p.sync.websites[0].delay === 7);

  t.section('close tab');
  p = openPage();
  await p.open({ url: 'example.com', delay: 5, delayIncrement: 1, gracePeriod: 0 }, { backgroundColor: '#2b2f35', panelOpacity: 0.7 });
  t.expect('solid panel over a plain colour', p.q('.panel').style.background === 'rgb(255, 255, 255)');
  p.q('.close').click();
  t.expect('close button asks the background to close the tab', p.sent.some((m) => m.action === 'closeTab'));

  t.section('soft-trigger puzzle');
  // Math.random() = 0 makes every puzzle "What is 13² ?".
  p = openPage({ random: () => 0 });
  await p.open({ url: 'https://example.com/?q=x', delay: 0, gracePeriod: 0 },
    { softReflect: true, reflectionMessage: 'Pause. What are you actually looking for right now?' });
  t.expect('reflection message shown', p.q('.message').textContent.startsWith('Pause.'));
  t.expect('puzzle shown, no hold circle', !p.q('.puzzle').hidden && p.q('.hold').hidden);
  t.expect('puzzle text', p.q('.puzzle').textContent === 'What is 13² ?');
  const input = p.q('.answer input');
  input.value = '12';
  p.q('.answer').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  t.expect('wrong answer reported to spiral detection', p.sent.some((m) => m.action === 'spiralEvent'));
  t.expect('still on the overlay after a wrong answer', !!p.host());
  input.value = '169';
  p.q('.answer').dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(600);
  t.expect('right answer continues', !p.host());
  t.expect('soft triggers change no delays', p.sync.websites.length === 0);

  t.finish();
  process.exit(process.exitCode);
})();
