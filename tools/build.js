// Builds the Chrome Web Store upload: dist/intentional-browsing-<version>.zip,
// made from extension/ only, with manifest.json at the top of the zip.
// Refuses to build when a file the manifest names is missing, or when a
// policy file (.reg) has ended up inside extension/.
'use strict';
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const DIST = path.join(ROOT, 'dist');

function fail(message) {
  console.error('Build failed: ' + message);
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (!/^\d+(\.\d+){0,3}$/.test(version || '')) fail(`manifest version "${version}" is not valid`);

// Every file the manifest refers to must exist.
const referenced = new Set();
const add = (p) => { if (typeof p === 'string') referenced.add(p); };
Object.values(manifest.icons || {}).forEach(add);
Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(add);
add(manifest.action && manifest.action.default_popup);
add(manifest.background && manifest.background.service_worker);
add(manifest.storage && manifest.storage.managed_schema);
for (const cs of manifest.content_scripts || []) (cs.js || []).concat(cs.css || []).forEach(add);
const missing = [...referenced].filter((p) => !fs.existsSync(path.join(EXT, p)));
if (missing.length) fail('missing files named in manifest.json: ' + missing.join(', '));

const files = walk(EXT);
const policyFiles = files.filter((f) => f.toLowerCase().endsWith('.reg'));
if (policyFiles.length) {
  fail('policy files must never be uploaded: ' + policyFiles.map((f) => path.relative(ROOT, f)).join(', '));
}

const zip = new AdmZip();
for (const file of files) {
  const rel = path.relative(EXT, file).split(path.sep).join('/');
  if (rel.split('/').some((part) => part.startsWith('.'))) continue;   // .DS_Store and the like
  zip.addFile(rel, fs.readFileSync(file));
}
fs.mkdirSync(DIST, { recursive: true });
const out = path.join(DIST, `intentional-browsing-${version}.zip`);
zip.writeZip(out);
console.log(`Built ${path.relative(ROOT, out)} (${zip.getEntries().length} files, version ${version})`);
