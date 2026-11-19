// Shared test helpers: loads the extension's scripts in a Node VM with a
// stubbed chrome API, so the real code runs without a browser.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const EXT = path.join(__dirname, '..', 'extension');
const SAMPLE_POLICY = require('./fixtures/sample-policy.json');

/**
 * Loads background.js (which imports managed-config.js) and applies `policy`
 * as the managed configuration. `removed` and `scrubbed` record tab closes
 * and history deletions.
 */
function loadBackground(policy = SAMPLE_POLICY) {
  const removed = [];
  const scrubbed = [];
  const generic = new Proxy(function () {}, {
    get: (t, p) => (p === 'then' ? undefined : generic),
    apply: () => Promise.resolve({})
  });
  const chrome = new Proxy({}, {
    get: (t, p) => {
      if (p === 'tabs') {
        return new Proxy({}, {
          get: (_, q) => q === 'remove'
            ? (id) => { removed.push(id); return Promise.resolve(); }
            : generic[q]
        });
      }
      if (p === 'history') {
        return { deleteUrl: ({ url }) => { scrubbed.push(url); return Promise.resolve(); } };
      }
      return generic;
    }
  });
  const ctx = vm.createContext({ console, URL, setTimeout, clearTimeout, Promise, chrome });
  ctx.importScripts = (f) => vm.runInContext(fs.readFileSync(path.join(EXT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext(fs.readFileSync(path.join(EXT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
  ctx.__policy = policy;
  vm.runInContext('config = parseManagedConfig(__policy); spiralEvents = []; lockdownExpiresAt = 0;', ctx);
  const run = (code) => vm.runInContext(code, ctx);
  return { ctx, run, removed, scrubbed };
}

/** Loads managed-config.js on its own. */
function loadConfigModule() {
  const ctx = vm.createContext({ console, URL });
  vm.runInContext(fs.readFileSync(path.join(EXT, 'managed-config.js'), 'utf8'), ctx);
  return { ctx, run: (code) => vm.runInContext(code, ctx) };
}

/** A tiny assertion counter that prints one line per check. */
function checker() {
  let fails = 0;
  return {
    expect(label, ok) {
      if (!ok) fails++;
      console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`);
    },
    section(name) {
      console.log(`\n-- ${name} --`);
    },
    finish() {
      console.log(fails ? `\n${fails} FAILED` : '\nall passed');
      process.exitCode = fails ? 1 : 0;
      return fails;
    }
  };
}

module.exports = { EXT, SAMPLE_POLICY, loadBackground, loadConfigModule, checker };
