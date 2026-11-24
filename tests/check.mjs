#!/usr/bin/env node
/* QuizForge repo checks — zero dependencies, no build step.
   Run from the repo root:  node tests/check.mjs
   Exits 1 with a readable list when anything fails. */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let failures = 0;
const bad = (msg) => { failures++; console.error('  ✗ ' + msg); };
const ok = (msg) => console.log('  ✓ ' + msg);

/* ---------- 1. questions.json: same rules as validate() in app.js ---------- */
console.log('\n[1] questions.json (demo bank)');
let bank;
try { bank = JSON.parse(read('questions.json')); }
catch (e) { bad('questions.json does not parse: ' + e.message); }

function qType(q) {
  if (q && ['mcq', 'tf', 'essay', 'fill', 'coding', 'matching', 'ordering'].includes(q.type)) return q.type;
  if (q && Array.isArray(q.options) && q.options.length === 2) return 'tf';
  return 'mcq';
}

if (bank) {
  if (!Array.isArray(bank.questions) || bank.questions.length === 0) {
    bad('bank has no questions array (or it is empty)');
  } else {
    bank.questions.forEach((q, i) => {
      const n = i + 1;
      if (typeof q.question !== 'string' || !q.question) return bad(`Q${n}: missing question text`);
      const qt = qType(q);
      if (qt === 'essay') {
        if (typeof q.rubric !== 'string' || !q.rubric.trim()) bad(`Q${n} (essay): missing rubric`);
        if (q.maxScore !== undefined && (typeof q.maxScore !== 'number' || q.maxScore < 1 || q.maxScore > 100))
          bad(`Q${n} (essay): maxScore out of range 1-100`);
      } else if (qt === 'tf') {
        if (!Array.isArray(q.options) || q.options.length < 2) bad(`Q${n} (tf): needs 2 options`);
        else if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) bad(`Q${n} (tf): answer out of range`);
        if (typeof q.justification !== 'string' || !q.justification.trim()) bad(`Q${n} (tf): missing justification`);
      } else if (qt === 'fill') {
        if (!Array.isArray(q.answers) || q.answers.length < 1 || q.answers.some((a) => typeof a !== 'string' || !a.trim()))
          bad(`Q${n} (fill): needs at least one non-empty accepted answer`);
        if (!q.question.includes('___')) bad(`Q${n} (fill): question text has no ___ blank`);
      } else if (qt === 'matching') {
        if (!Array.isArray(q.pairs) || q.pairs.length < 2) bad(`Q${n} (matching): needs at least 2 pairs`);
        else {
          const lefts = q.pairs.map((p) => p && String(p.left || '').trim());
          const rights = q.pairs.map((p) => p && String(p.right || '').trim());
          if (lefts.some((s) => !s) || rights.some((s) => !s)) bad(`Q${n} (matching): empty left/right`);
          if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length) bad(`Q${n} (matching): duplicate sides`);
        }
      } else if (qt === 'ordering') {
        if (!Array.isArray(q.items) || q.items.length < 2) bad(`Q${n} (ordering): needs at least 2 items`);
        else if (new Set(q.items.map((s) => String(s).trim())).size !== q.items.length) bad(`Q${n} (ordering): duplicate items`);
      } else if (qt === 'coding') {
        const lang = String(q.language || 'JavaScript').toLowerCase();
        if (lang !== 'javascript' && lang !== 'js') bad(`Q${n} (coding): only JavaScript runs in the sandbox`);
        if (typeof q.starterCode !== 'string' || !q.starterCode.trim()) bad(`Q${n} (coding): missing starterCode`);
        if (!Array.isArray(q.tests) || q.tests.length < 1) bad(`Q${n} (coding): needs at least one test`);
        else q.tests.forEach((tc, j) => {
          if (tc.input === undefined || tc.expected === undefined) bad(`Q${n} (coding): test ${j + 1} needs input and expected`);
        });
      } else {
        if (!Array.isArray(q.options) || q.options.length < 2) bad(`Q${n} (mcq): needs at least 2 options`);
        else if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length) bad(`Q${n} (mcq): answer out of range`);
      }
    });
    if (!failures) ok(`${bank.questions.length} questions valid`);
  }
}

/* ---------- 2. i18n: en/ar key parity + index.html keys exist ---------- */
console.log('\n[2] i18n.js (English/Arabic parity)');
const window = {};
const documentStub = new Proxy({}, { get: () => () => documentStub });
try {
  const fn = new Function('window', 'document', 'localStorage', read('i18n.js'));
  fn(window, documentStub, { getItem: () => null, setItem: () => {} });
} catch (e) { bad('i18n.js failed to evaluate: ' + e.message); }
const STRINGS = window.STRINGS;
if (!STRINGS || !STRINGS.en || !STRINGS.ar) {
  bad('window.STRINGS with en + ar not exported');
} else {
  const en = Object.keys(STRINGS.en);
  const ar = Object.keys(STRINGS.ar);
  en.filter((k) => !(k in STRINGS.ar)).forEach((k) => bad(`key "${k}" missing in Arabic`));
  ar.filter((k) => !(k in STRINGS.en)).forEach((k) => bad(`key "${k}" missing in English`));
  // {token} placeholders must match between languages
  const toks = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(' ');
  en.forEach((k) => {
    if (k in STRINGS.ar && toks(STRINGS.en[k]) !== toks(STRINGS.ar[k]))
      bad(`key "${k}": placeholders differ (en ${toks(STRINGS.en[k]) || 'none'} / ar ${toks(STRINGS.ar[k]) || 'none'})`);
  });
  // keys referenced by index.html must exist
  const html = read('index.html');
  const referenced = [...html.matchAll(/data-i18n(?:-title)?="(\w+)"/g)].map((m) => m[1]);
  referenced.forEach((k) => { if (!(k in STRINGS.en)) bad(`index.html references missing key "${k}"`); });
  if (!failures) ok(`${en.length} keys, en/ar in sync, ${referenced.length} html references resolve`);
}

/* ---------- 3. manifest.json ---------- */
console.log('\n[3] manifest.json (PWA)');
try {
  const m = JSON.parse(read('manifest.json'));
  ['name', 'short_name', 'start_url', 'display', 'icons'].forEach((f) => {
    if (m[f] === undefined) bad(`manifest missing "${f}"`);
  });
  if (Array.isArray(m.icons)) m.icons.forEach((ic) => { if (ic.src && !existsSync(join(root, ic.src))) bad(`manifest icon missing on disk: ${ic.src}`); });
  if (!failures) ok('manifest valid, icons exist');
} catch (e) { bad('manifest.json does not parse: ' + e.message); }

/* ---------- 4. index.html references ---------- */
console.log('\n[4] index.html asset references');
{
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1])
    .filter((u) => !u.startsWith('http') && !u.startsWith('data:'));
  refs.forEach((r) => { if (!existsSync(join(root, r))) bad(`index.html references missing file: ${r}`); });
  if (!failures) ok(`${refs.length} local references resolve`);
}

/* ---------- 5. sw.js SHELL files ---------- */
console.log('\n[5] sw.js (service worker shell)');
{
  const sw = read('sw.js');
  const shell = [...sw.matchAll(/^\s*'([^']+)',?\s*$/gm)].map((m) => m[1])
    .filter((s) => !s.startsWith('.') && !s.includes('quizforge-'));
  shell.forEach((f) => { if (!existsSync(join(root, f))) bad(`sw.js SHELL lists missing file: ${f}`); });
  if (!failures) ok(`${shell.length} cached shell files exist`);
}

/* ---------- 6. README references ---------- */
console.log('\n[6] README.md references');
{
  const md = read('README.md');
  const refs = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)|\[[^\]]+\]\(([^)#]+)\)/g)]
    .map((m) => m[1] || m[2])
    .filter((u) => u && !u.startsWith('http') && !u.startsWith('mailto:'));
  refs.forEach((r) => { if (!existsSync(join(root, r.split('#')[0]))) bad(`README references missing file: ${r}`); });
  if (!failures) ok(`${refs.length} local references resolve`);
}

console.log(failures ? `\n${failures} check(s) FAILED\n` : '\nAll checks passed\n');
process.exit(failures ? 1 : 0);
