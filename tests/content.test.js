// Runs content.js in jsdom pages and checks what it reports for pageCheck.
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { EXT, checker } = require('./helpers');

const SRC = fs.readFileSync(path.join(EXT, 'content.js'), 'utf8');
const t = checker();

function runPage(html, settings, url = 'https://example.com/page') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const sent = [];
  dom.window.chrome = {
    runtime: {
      id: 'test',
      lastError: undefined,
      sendMessage: (msg, cb) => {
        sent.push(msg);
        if (msg.action === 'getContentSettings' && cb) cb(settings);
        else if (cb) cb({});
      },
      onMessage: { addListener() {} }
    },
    storage: {
      sync: { get: (k, cb) => cb({}) },
      local: { get: (k, cb) => cb({}) },
      onChanged: { addListener() {} }
    }
  };
  dom.window.eval(SRC);
  return { dom, sent, signals: () => sent.filter((m) => m.action === 'pageSignals').map((m) => m.signals) };
}

const page = (head) => `<!doctype html><html><head><title>t</title>${head}</head><body><p>hi</p></body></html>`;
const ON = { pageCheck: true, archiveScan: false };

t.section('labels and descriptions');
let r = runPage(page('<meta name="RATING" content="RTA-5042-1996-1400-1577-RTA">'), ON);
t.expect('RTA label found', r.signals()[0] && r.signals()[0].adultLabel === true);

r = runPage(page('<meta http-equiv="PICS-Label" content=\'(pics-1.1 "http://www.rsac.org" l r (rta-5042-1996-1400-1577-rta))\'>'), ON);
t.expect('RTA label inside a PICS label found', r.signals()[0].adultLabel === true);

r = runPage(page('<meta name="rating" content="adult">'), ON);
t.expect('rating=adult found', r.signals()[0].adultLabel === true);

r = runPage(page('<meta name="rating" content="General">'), ON);
t.expect('rating=General is not a label', r.signals()[0].adultLabel === false);

r = runPage(page('<meta name="description" content="Daily news"><meta property="og:title" content="Story">' +
  '<meta name="twitter:description" content="More"><meta name="keywords" content="ignored">' +
  '<meta name="viewport" content="width=device-width">'), ON);
const s = r.signals()[0];
t.expect('description, og:title and twitter:description collected; keywords and viewport not',
  s.adultLabel === false && JSON.stringify(s.texts) === JSON.stringify(['Daily news', 'Story', 'More']));

t.section('when it runs');
r = runPage(page('<meta name="description" content="x">'), { pageCheck: false, archiveScan: false });
t.expect('nothing reported with pageCheck off', r.signals().length === 0);

r = runPage(page(''), ON, 'file:///C:/notes.html');
t.expect('no settings request on non-web pages', r.sent.length === 0);

r = runPage(page('<meta name="description" content="Home">'), ON);
r.dom.window.document.querySelector('meta[name=description]').setAttribute('content', 'Changed later');
setTimeout(() => {
  const all = r.signals();
  t.expect(`a changed description is reported again (${all.length} reports)`,
    all.length === 2 && all[1].texts[0] === 'Changed later');
  r.dom.window.document.head.appendChild(r.dom.window.document.createElement('link'));
  setTimeout(() => {
    t.expect('no repeat report when nothing changed', r.signals().length === 2);
    t.finish();
  }, 700);
}, 700);
