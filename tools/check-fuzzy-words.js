// Lists English words that keywordsFuzzy would catch although they are not the
// keyword itself, so real words can be added to fuzzyIgnoreWords before they
// block an ordinary search.
//
//   npm run check:fuzzy                      (uses the sample policy)
//   npm run check:fuzzy -- my-policy.json    (a JSON file with keywordsFuzzy
//                                             and fuzzyIgnoreWords)
'use strict';
const fs = require('fs');
const path = require('path');
const { SAMPLE_POLICY, loadConfigModule } = require('../tests/helpers');

const policyFile = process.argv[2];
const policy = policyFile ? JSON.parse(fs.readFileSync(path.resolve(policyFile), 'utf8')) : SAMPLE_POLICY;
const wordsFile = path.join(path.dirname(require.resolve('word-list')), 'words.txt');
const words = fs.readFileSync(wordsFile, 'utf8').split(/\r?\n/).filter(Boolean);

const m = loadConfigModule();
m.ctx.__policy = {
  keywordsFuzzy: policy.keywordsFuzzy || [],
  fuzzyIgnoreWords: policy.fuzzyIgnoreWords || []
};
m.ctx.__words = words;
const caught = m.run(`(() => {
  const cfg = parseManagedConfig(__policy);
  const out = {};
  for (const w of __words) {
    const k = matchFuzzyKeywords(prepareText(w), cfg.keywordsFuzzy, cfg.fuzzyIgnoreWords);
    if (k && foldKeyword(w).replace(/ /g, '') !== k.replace(/ /g, '')) (out[k] = out[k] || []).push(w);
  }
  return out;
})()`);

const keys = Object.keys(caught);
if (!keys.length) {
  console.log(`No dictionary words caught (${words.length} checked).`);
} else {
  console.log(`Dictionary words caught by keywordsFuzzy (${words.length} checked).`);
  console.log('Plural and other forms of the keyword itself are expected; add real words to fuzzyIgnoreWords.\n');
  for (const k of keys) console.log(k.padEnd(16), caught[k].join(' '));
}
