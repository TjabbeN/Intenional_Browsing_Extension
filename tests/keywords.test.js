// Keyword matching: disguised spellings are caught, ordinary text is not.
'use strict';
const { SAMPLE_POLICY, loadBackground, checker } = require('./helpers');

const bg = loadBackground();
const t = checker();
const hit = (url) => bg.run(`keywordTrigger(${JSON.stringify(url)})`);
const soft = (url) => bg.run(`containsSoftTrigger(${JSON.stringify(url)})`);
const reason = (url) => bg.run(`blockReason(${JSON.stringify(url)})`);
const q = (s) => 'https://search.example/search?q=' + encodeURIComponent(s);

t.section('caught in searches');
for (const s of [
  'new brrowser', 'nieuwe brrowser', 'new browserr', 'borwser download', 'brwser',
  'b r o w s e r', 'brоwser', 'br0wser', 'ｂｒｏｗｓｅｒ',
  'bro​wser', 'brow ser', 's3arch 3ngine', 'zoekmachiene', 'incognitoo', 'unbl0ck',
  'browsr', 'BROWSER', 'brówser', 'webbrowzer'
]) t.expect(`block ${JSON.stringify(s)}`, !!hit(q(s)));

t.section('caught anywhere in the URL');
for (const u of [
  'https://example.com/gone-wild/', 'https://example.com/p0rn', 'https://example.com/pooorn/x',
  'https://example.com/n-s-f-w', 'https://example.com/x/inter-course'
]) t.expect(`block ${u}`, !!hit(u));

t.section('split versions of a short keyword');
for (const s of ['n s f w', 'n.s.f.w', 'n-s-f-w', 'n_s_f_w', 'nsffw', 'N S F W', 'ns fw', 'n sfw', 'nsf w', 'nsf-w']) {
  t.expect(`block ${JSON.stringify(s)}`, !!hit('https://example.com/' + encodeURIComponent(s)));
}

t.section('must stay allowed');
for (const s of [
  'browse recipes', 'bowser mario', 'unlock iphone', 'baby stroller', 'eating disorder',
  'bubble tea', 'exotic cars', 'kitties', '1080p monitor', 'assessment criteria', 'class schedule',
  'browsing history', 'eyebrows', 'research methods', 'new brewer', 'sunblock lotion'
]) t.expect(`allow ${JSON.stringify(s)}`, !hit(q(s)));
for (const u of [
  'https://example.com/winter-course/2026', 'https://www.bobsburgers.com/bobs-burgers',
  'https://x.com/home', 'https://en.wikipedia.org/wiki/Breast_cancer_awareness',
  'https://github.com/user/repo/blob/main/src/index.js', 'https://docs.example.com/document/d/1AbC3xYz57/edit',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://maps.example.com/maps?q=brussels'
]) t.expect(`allow ${u}`, !hit(u));

t.section('soft triggers');
t.expect('allow "eating out"', !soft(q('eating out')));
t.expect('allow "bubble tea"', !soft(q('bubble tea')));
t.expect('soft "datiing"', soft(q('datiing')));
t.expect('soft "g1rls"', soft(q('g1rls')));

t.section('blocked sites and exceptions');
t.expect('blockedSites closes', reason('https://www.blocked.example/') === 'blockedSites');
t.expect('path rule closes', reason('https://example.org/blocked-path/x') === 'blockedSites');
t.expect('allowed subdomain stays open', !reason('https://allowed.blocked.example/'));
t.expect('allowed path is exempt from keywords', !reason('https://forum.example/r/allowed/nsfw'));

t.section('everything the pre-2.1 matcher caught is still caught');
function oldNorm(s) {
  if (!s) return '';
  try { s = decodeURIComponent(s); } catch {}
  try { s = decodeURIComponent(s); } catch {}
  return s.toLowerCase().replace(/\+/g, ' ').replace(/[_\-.\/]/g, ' ');
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oldRe = (k) => new RegExp('(?:^|\\W)' + esc(k) + '(?:$|\\W)');
const list = (k) => (SAMPLE_POLICY[k] || []).map((x) => oldNorm(x.trim())).filter((x) => x.trim());
const oldAny = list('keywordsAnywhere').map(oldRe);
const oldSub = list('keywordsSubstring');
const oldSearch = list('keywordsSearch').map(oldRe);
const samples = [];
for (const k of [...SAMPLE_POLICY.keywordsAnywhere, ...SAMPLE_POLICY.keywordsSubstring]) {
  samples.push(`https://example.com/${encodeURIComponent(k)}/page`, `https://example.com/a-${k.replace(/ /g, '-')}-b`);
}
for (const k of SAMPLE_POLICY.keywordsSearch) samples.push(q(k), q('best ' + k + ' 2026'), q(k.toUpperCase()));
let checked = 0;
let missed = 0;
for (const url of samples) {
  const u = new URL(url);
  const full = oldNorm(u.hostname + ' ' + u.pathname + ' ' + u.search + ' ' + u.hash);
  const v = u.searchParams.get('q');
  const old = oldAny.some((r) => r.test(full)) || oldSub.some((k) => full.includes(k)) ||
              (v && oldSearch.some((r) => r.test(oldNorm(v))));
  if (old) {
    checked++;
    if (!hit(url)) { missed++; console.log('     missed', url); }
  }
}
t.expect(`${checked} URLs, ${missed} missed`, checked > 0 && missed === 0);

t.section('speed');
const t0 = process.hrtime.bigint();
const N = 2000;
for (let i = 0; i < N; i++) {
  hit(`https://news.example.com/2026/11/09/article-${i}-about-local-elections?ref=home&utm_source=x&q=city+council+meeting+${i}`);
}
const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
t.expect(`${ms.toFixed(3)} ms per URL (limit 2 ms)`, ms < 2);

t.finish();
