/* QuizForge — turn any material into exams.
   Static site, no build step: plain HTML/CSS/JS. The quiz engine (timer,
   shuffle, review, retry-wrong-only, topics, best score, dark mode) is the
   Practice Quiz Builder engine, refactored to take any bank object
   {title, subtitle, questions[]}. Exam generation is bring-your-own-key:
   the user's API key lives only in their own browser's localStorage and is
   sent only to the provider they choose. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var quiz = null;         // current question bank {title, subtitle, questions[]}
  var sampleQuiz = null;   // the bundled questions.json demo bank
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  var LS_SETTINGS = 'pqb-settings';
  var LS_BEST = 'pqb-best';
  var LS_DARK = 'pqb-dark';
  var LS_BYOK = 'qf-byok';       // {provider, apiKey, model, baseUrl, proxyUrl}
  var LS_LIB = 'qf-library';     // [{id, title, subtitle, date, count, provider, model, bank}]
  var LS_WIZ = 'qf-wizard';      // wizard draft (exam settings only — never the key)
  var LS_REVIEW = 'qf-review';   // {bankKey: {title, items: {qid: {streak, added}}}}
  var LS_STATS = 'qf-stats';     // [{id, ts, title, total, score, secs, items: [{topic, correct, secs}]}]
  var STATS_MAX = 50;            // keep only the newest 50 attempts
  var REV_NEEDED = 2;            // consecutive correct answers to master a question

  /* Share via link: the exam rides in the URL hash (#exam=<payload>).
     MAX_SHARE_URL is the practical chat-message limit — longer links
     are refused with a size warning instead of a broken link. */
  var SHARE_HASH = '#exam=';
  var MAX_SHARE_URL = 8000;
  var sharedExam = null;   // bank loaded from a #exam= link (not in the library)

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  /* SheetJS (xlsx) loads LAZILY, only when an .xlsx file is added —
     same pattern as pdf.js above. CSV paste/upload never needs it. */
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var CHUNK_CHARS = 12000;

  var settings = loadSettings();   // { shuffle, perQTimer, perQSeconds }
  var selectedTopic = 'All';
  var topics = [];
  var run = null;                  // current attempt, see startQuiz()
  var fc = null;                   // flashcards session, see openFlashcards()
  var totalTimerId = null;
  var perQTimerId = null;
  /* Strict exam mode (Feature 8): per-exam toggle on the start screen,
     off by default. strictMode is the toggle state; the rest lives on
     the run while a strict attempt is in progress. */
  var strictMode = false;
  var strictTimerId = null;
  var strictWarned = false;      // one fullscreen-exit warning per attempt
  var strictFsAttempted = false; // fullscreen was requested this attempt
  /* Exam translation (Feature 12): the original questions are kept
     untouched in trState.original; quiz.questions is swapped between
     the original and the translated copy. trState.bank remembers
     which bank object was translated, so loadBank() can restore it
     before clearing the state. */
  var trState = { original: null, translated: null, lang: null, sourceLang: null, bank: null, busy: false };
  var currentView = 'create';      // 'create' | 'library' | 'stats' | 'quiz'

  /* ---------- offline (Feature 14) ----------
     navigator.onLine is false when the browser knows it is offline.
     Every network feature checks isOffline() first and says so
     plainly; everything local keeps working. */
  function isOffline() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  }

  /* ---------- providers ----------
     Model IDs verified 2026-11-20 against the providers' own docs and
     deprecation pages. Model IDs change fast — every model field is
     editable, so a newer model can always be typed in.
     - Gemini: gemini-3.5-flash-lite is the default. Google retires
       gemini-2.5-flash on 2026-12-01 and serves it only to projects
       that already used it, so a brand-new key cannot call it.
     - OpenAI: gpt-4o-mini still works, but OpenAI retires it
       2027-01-14 — the field is editable for whatever mini replaces it.
     - Claude: claude-sonnet-4-5 is RETIRED by Anthropic on 2026-11-30,
       so the default is its named replacement claude-sonnet-5-5.
       Do NOT use claude-sonnet-4-5 after 2026-11-30. */
  var PROVIDERS = {
    gemini: {
      label: 'Google Gemini', keyLabel: 'Gemini API key',
      keyUrl: 'https://aistudio.google.com/apikey',
      defaultModel: 'gemini-3.5-flash-lite',
      needsProxy: false
    },
    openai: {
      label: 'OpenAI (ChatGPT)', keyLabel: 'OpenAI API key',
      keyUrl: 'https://platform.openai.com/api-keys',
      defaultModel: 'gpt-4o-mini',
      needsProxy: false
    },
    claude: {
      label: 'Anthropic Claude', keyLabel: 'Anthropic API key',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      defaultModel: 'claude-sonnet-5-5',
      needsProxy: true
    },
    custom: {
      label: 'Custom (OpenAI-compatible)', keyLabel: 'API key',
      keyUrl: '',
      defaultModel: 'gpt-4o-mini',
      defaultBaseUrl: 'https://api.openai.com/v1',
      needsProxy: false
    }
  };

  /* ---------- wizard state ---------- */
  var wiz = loadWizard();   // { step, title, count, types:{mcq,tf}, difficulty, language, focus, perQTimer }
  var material = { files: [], pasted: '', text: '', pdfPages: 0, pdfFailed: false };
  // material.files: [{name, size, kind: 'pdf'|'text'|'bank', chars, pages?}]
  var byok = loadByok();    // {provider, apiKey, model, baseUrl, proxyUrl}
  var genState = { busy: false, error: '', progress: '', lastBank: null };

  /* Material summary (Feature 9): {keyPoints: [string], definitions:
     [{term, definition}]} generated from the same material with the
     same key. Cleared whenever the material changes, so a summary can
     never describe material it was not made from. sumReturn remembers
     where the summary screen should go back to. */
  var sumState = { data: null, busy: false, error: '' };
  var sumReturn = { kind: 'wizard', step: 3, backStep: 1 };

  /* ---------- helpers ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function fmtTime(totalSeconds) {
    var m = Math.floor(totalSeconds / 60);
    var s = totalSeconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function icon(name, size) {
    var s = size || 15;
    var inner = {
      clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
      hourglass: '<path d="M7 4h10"/><path d="M7 20h10"/><path d="M8.5 4c0 4.5 7 4.5 7 8s-7 3.5-7 8"/>',
      pointer: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
      list: '<circle cx="5" cy="12" r="2.6"/><circle cx="12" cy="12" r="2.6"/><circle cx="19" cy="12" r="2.6"/><path d="M7.6 12h1.8M14.6 12h1.8"/>',
      grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>'
    }[name] || '';
    return '<svg class="ic" viewBox="0 0 24 24" width="' + s + '" height="' + s +
      '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
  }

  function topicIcon(t) {
    if (t === 'All') return icon('grid', 24);
    if (t === 'Pointers') return icon('pointer', 24);
    return icon('list', 24);
  }

  /* ---------- validation ---------- */

  function validate(data) {
    if (!data || !Array.isArray(data.questions) || data.questions.length === 0)
      throw new Error(t('valNoQuestions'));
    data.questions.forEach(function (q, i) {
      var n = i + 1;
      if (typeof q.question !== 'string' || !q.question)
        throw new Error(t('valNoQText', { n: n }));
      var qt = qType(q);
      if (qt === 'essay') {
        if (typeof q.rubric !== 'string' || !q.rubric.trim())
          throw new Error(t('valRubric', { n: n }));
        if (q.maxScore !== undefined &&
          (typeof q.maxScore !== 'number' || q.maxScore < 1 || q.maxScore > 100))
          throw new Error(t('valMaxScore', { n: n }));
      } else if (qt === 'fill') {
        if (!Array.isArray(q.answers) || q.answers.length < 1 ||
          q.answers.some(function (a) { return typeof a !== 'string' || !a.trim(); }))
          throw new Error(t('valFillAnswers', { n: n }));
        if (q.question.indexOf('____') === -1 && q.question.indexOf('___') === -1)
          throw new Error(t('valFillBlank', { n: n }));
      } else if (qt === 'matching') {
        if (!Array.isArray(q.pairs) || q.pairs.length < 2 ||
          q.pairs.some(function (p) {
            return !p || typeof p.left !== 'string' || !p.left.trim() ||
              typeof p.right !== 'string' || !p.right.trim();
          }))
          throw new Error(t('valMatchPairs', { n: n }));
        var lefts = q.pairs.map(function (p) { return p.left.trim(); });
        var rights = q.pairs.map(function (p) { return p.right.trim(); });
        if (new Set(lefts).size !== lefts.length || new Set(rights).size !== rights.length)
          throw new Error(t('valMatchDup', { n: n }));
      } else if (qt === 'ordering') {
        if (!Array.isArray(q.items) || q.items.length < 2 ||
          q.items.some(function (s) { return typeof s !== 'string' || !s.trim(); }))
          throw new Error(t('valOrderItems', { n: n }));
        var trimmed = q.items.map(function (s) { return s.trim(); });
        if (new Set(trimmed).size !== trimmed.length)
          throw new Error(t('valOrderDup', { n: n }));
      } else if (qt === 'coding') {
        /* Coding runs only in JavaScript (see runCodeTests): any other
           language is rejected here, never silently accepted. */
        var lang = (q.language || 'JavaScript').toString().toLowerCase();
        if (lang !== 'javascript' && lang !== 'js')
          throw new Error(t('valCodeLang', { n: n }));
        if (typeof q.starterCode !== 'string' || !q.starterCode.trim())
          throw new Error(t('valCodeStarter', { n: n }));
        if (!Array.isArray(q.tests) || q.tests.length < 1 ||
          q.tests.some(function (tc) {
            return !tc || typeof tc.input !== 'string' || typeof tc.expected !== 'string';
          }))
          throw new Error(t('valCodeTests', { n: n }));
      } else {
        if (!Array.isArray(q.options) || q.options.length < 2)
          throw new Error(t('valOptions', { n: n }));
        if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length)
          throw new Error(t('valAnswerRange', { n: n }));
      }
      if (q.type !== undefined && ['mcq', 'tf', 'essay', 'fill', 'coding', 'matching', 'ordering'].indexOf(q.type) === -1)
        throw new Error(t('valType', { n: n }));
      if (q.topic !== undefined && typeof q.topic !== 'string')
        throw new Error(t('valTopic', { n: n }));
      if (q.explanation !== undefined && typeof q.explanation !== 'string')
        throw new Error(t('valExplanation', { n: n }));
      if (q.code !== undefined && typeof q.code !== 'string')
        throw new Error(t('valCode', { n: n }));
      if (q.difficulty !== undefined && typeof q.difficulty !== 'string')
        throw new Error(t('valDifficulty', { n: n }));
    });
  }

  function scoreMessage(pct) {
    if (pct >= 90) return t('scoreExcellent');
    if (pct >= 70) return t('scoreSolid');
    if (pct >= 50) return t('scoreGetting');
    return t('scoreKeep');
  }

  /* ---------- question types (Feature 6 + Feature 10 + Feature 11) ----------
     'mcq' (default, 4 options) and 'tf' (2 options) are the old
     shapes; 'essay' is free text graded by the provider's model
     against a rubric, 'fill' is one blank checked locally against
     an "answers" list, 'coding' (Feature 10) is a JavaScript
     task with starter code and tests, run in a Web Worker,
     'matching' (Feature 11) pairs each left item with one right
     item from "pairs", and 'ordering' (Feature 11) puts the
     "items" strings in their correct order. Older banks carry no
     "type" — a 2-option question is True/False, anything else is
     multiple choice. */
  function qType(q) {
    if (q && ['mcq', 'tf', 'essay', 'fill', 'coding', 'matching', 'ordering'].indexOf(q.type) !== -1) return q.type;
    if (q && Array.isArray(q.options) && q.options.length === 2) return 'tf';
    return 'mcq';
  }

  function essayMax(q) {
    return (typeof q.maxScore === 'number' && q.maxScore >= 1 && q.maxScore <= 100)
      ? q.maxScore : 5;
  }

  /* Essay counts as correct at 60% of its max score. */
  function essayPass(score, max) {
    return score * 5 >= max * 3;
  }

  function normalizeFill(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '');
  }

  function gradeFill(q, text) {
    var got = normalizeFill(text);
    if (!got) return false;
    return (q.answers || []).some(function (a) { return normalizeFill(a) === got; });
  }

  /* ---------- matching + ordering grading (Feature 11) ----------
     Both grade by fraction: matching counts correct pairs,
     ordering counts items in the correct position. A question
     counts as fully correct only when the fraction is 1 — partial
     credit is shown honestly in the results, never rounded up to
     a pass. picks is an array of right-side strings ('' = unpicked)
     aligned with q.pairs; order is an array of item strings. */
  function gradeMatching(q, picks) {
    var pairs = q.pairs || [];
    var got = 0;
    pairs.forEach(function (p, i) {
      if (picks && picks[i] === p.right) got++;
    });
    return { got: got, total: pairs.length, correct: pairs.length > 0 && got === pairs.length };
  }

  function gradeOrdering(q, order) {
    var items = q.items || [];
    var got = 0;
    items.forEach(function (s, i) {
      if (order && order[i] === s) got++;
    });
    return { got: got, total: items.length, correct: items.length > 0 && got === items.length };
  }

  /* Right-column order for a matching question: shuffled when the
     shuffle setting is on, otherwise rotated by one — never left in
     the pairs order, where every right partner would sit next to its
     left item and the question would answer itself. Same idea for
     ordering: shuffled, otherwise reversed. */
  function scrambleRights(q, doShuffle) {
    var rights = (q.pairs || []).map(function (p) { return p.right; });
    if (doShuffle) return shuffle(rights);
    return rights.length > 1 ? rights.slice(1).concat(rights.slice(0, 1)) : rights;
  }

  function scrambleItems(q, doShuffle) {
    var items = (q.items || []).slice();
    if (doShuffle) return shuffle(items);
    return items.reverse();
  }

  /* ---------- persistence ---------- */

  function loadSettings() {
    var d = { shuffle: true, perQTimer: false, perQSeconds: 60 };
    try {
      var raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        var s = JSON.parse(raw);
        if (typeof s.shuffle === 'boolean') d.shuffle = s.shuffle;
        if (typeof s.perQTimer === 'boolean') d.perQTimer = s.perQTimer;
        if (typeof s.perQSeconds === 'number' && s.perQSeconds >= 5 && s.perQSeconds <= 600)
          d.perQSeconds = Math.round(s.perQSeconds);
      }
    } catch (e) { /* corrupted settings: fall back to defaults */ }
    return d;
  }

  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); } catch (e) {}
  }

  function loadBest() {
    try {
      var raw = localStorage.getItem(LS_BEST);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveBest(score, total, pct) {
    var best = loadBest();
    if (!best || pct > best.pct) {
      try {
        localStorage.setItem(LS_BEST, JSON.stringify({
          score: score, total: total, pct: pct,
          bank: quiz.title || 'Practice Quiz',
          date: new Date().toISOString().slice(0, 10)
        }));
      } catch (e) {}
    }
  }

  function applyDark() {
    var dark = false;
    try { dark = localStorage.getItem(LS_DARK) === '1'; } catch (e) {}
    document.body.classList.toggle('dark', dark);
    var lbl = document.getElementById('dark-label');
    if (lbl) lbl.textContent = dark ? t('light') : t('dark');
  }

  /* BYO key: stored ONLY in this browser's localStorage, sent only to the
     provider the user picked. Never logged, never shown in full. */
  function loadByok() {
    var d = { provider: 'gemini', apiKey: '', model: '', baseUrl: '', proxyUrl: '' };
    try {
      var raw = localStorage.getItem(LS_BYOK);
      if (raw) {
        var s = JSON.parse(raw);
        if (s.provider && PROVIDERS[s.provider]) d.provider = s.provider;
        if (typeof s.apiKey === 'string') d.apiKey = s.apiKey;
        if (typeof s.model === 'string') d.model = s.model;
        if (typeof s.baseUrl === 'string') d.baseUrl = s.baseUrl;
        if (typeof s.proxyUrl === 'string') d.proxyUrl = s.proxyUrl;
      }
    } catch (e) {}
    return d;
  }

  function saveByok() {
    try { localStorage.setItem(LS_BYOK, JSON.stringify(byok)); } catch (e) {}
  }

  function effectiveModel() {
    return (byok.model || '').trim() || PROVIDERS[byok.provider].defaultModel;
  }

  function maskedKey() {
    if (!byok.apiKey) return '';
    var k = byok.apiKey;
    return '••••••••' + k.slice(-4);
  }

  function loadWizard() {
    var d = { step: 1, title: '', count: 10, types: { mcq: true, tf: false, essay: false, fill: false, coding: false, matching: false, ordering: false },
      difficulty: 'Mixed', language: 'English', focus: '', perQTimer: false };
    try {
      var raw = localStorage.getItem(LS_WIZ);
      if (raw) {
        var s = JSON.parse(raw);
        if (typeof s.step === 'number' && s.step >= 1 && s.step <= 4) d.step = s.step;
        if (typeof s.title === 'string') d.title = s.title;
        if (typeof s.count === 'number') d.count = Math.max(5, Math.min(50, Math.round(s.count)));
        if (s.types) {
          if (typeof s.types.mcq === 'boolean') d.types.mcq = s.types.mcq;
          if (typeof s.types.tf === 'boolean') d.types.tf = s.types.tf;
          if (typeof s.types.essay === 'boolean') d.types.essay = s.types.essay;
          if (typeof s.types.fill === 'boolean') d.types.fill = s.types.fill;
          if (typeof s.types.coding === 'boolean') d.types.coding = s.types.coding;
          if (typeof s.types.matching === 'boolean') d.types.matching = s.types.matching;
          if (typeof s.types.ordering === 'boolean') d.types.ordering = s.types.ordering;
        }
        if (typeof s.difficulty === 'string') d.difficulty = s.difficulty;
        if (typeof s.language === 'string') d.language = s.language;
        if (typeof s.focus === 'string') d.focus = s.focus;
        if (typeof s.perQTimer === 'boolean') d.perQTimer = s.perQTimer;
      }
    } catch (e) {}
    return d;
  }

  function saveWizard() {
    try { localStorage.setItem(LS_WIZ, JSON.stringify(wiz)); } catch (e) {}
  }

  function loadLibrary() {
    try {
      var raw = localStorage.getItem(LS_LIB);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) { return []; }
  }

  function saveLibrary(list) {
    try { localStorage.setItem(LS_LIB, JSON.stringify(list)); } catch (e) {}
    updateLibCount();
  }

  function updateLibCount() {
    var n = loadLibrary().length;
    var badge = document.getElementById('nav-lib-count');
    if (badge) {
      badge.hidden = n === 0;
      badge.textContent = String(n);
    }
  }

  /* ---------- smart review (spaced repetition) ----------
     After any quiz, wrong answers land in a persistent review queue
     (localStorage, LS_REVIEW). A question is keyed by a hash of its
     text + options, and the queue is keyed by a hash of the whole bank,
     so the same question in a different exam never mixes in, and the
     queue survives reloads. A question leaves the queue only after
     REV_NEEDED consecutive correct answers in review sessions; a wrong
     answer resets its streak to 0. Reviewing never touches the library
     or the best score. */
  function hashStr(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  function bankKey(bank) {
    if (!bank || !bank.questions) return 'none';
    return hashStr((bank.title || '') + '|' + bank.questions.length + '|' +
      bank.questions.map(function (q) { return q.question || ''; }).join('|'));
  }

  function qId(q) {
    return hashStr((q.question || '') + '|' + (q.options || []).join('|') +
      '|' + (q.answers || []).join('|') + '|' + (q.rubric || '') +
      '|' + (q.starterCode || '') + '|' +
      (q.tests || []).map(function (tc) { return tc.input + '=>' + tc.expected; }).join('|') +
      '|' + (q.pairs || []).map(function (p) { return p.left + '=>' + p.right; }).join('|') +
      '|' + (q.items || []).join('|'));
  }

  function loadReview() {
    try {
      var raw = localStorage.getItem(LS_REVIEW);
      var d = raw ? JSON.parse(raw) : {};
      return d && typeof d === 'object' ? d : {};
    } catch (e) { return {}; }
  }

  function saveReview(d) {
    try { localStorage.setItem(LS_REVIEW, JSON.stringify(d)); } catch (e) {}
  }

  function reviewEntries(bank) {
    var d = loadReview();
    var e = d[bankKey(bank)];
    return e && e.items ? e.items : {};
  }

  function reviewCountFor(bank) {
    return Object.keys(reviewEntries(bank)).length;
  }

  function reviewTotalCount() {
    var d = loadReview();
    var n = 0;
    Object.keys(d).forEach(function (k) {
      if (d[k] && d[k].items) n += Object.keys(d[k].items).length;
    });
    return n;
  }

  function addWrongToReview(bank, wrongIndexes) {
    if (!bank || !wrongIndexes || !wrongIndexes.length) return;
    var d = loadReview();
    var key = bankKey(bank);
    if (!d[key]) d[key] = { title: bank.title || '', items: {} };
    var items = d[key].items;
    wrongIndexes.forEach(function (qi) {
      var id = qId(bank.questions[qi]);
      if (!items[id]) items[id] = { streak: 0, added: new Date().toISOString().slice(0, 10) };
    });
    saveReview(d);
  }

  /* Record one review answer: correct bumps the streak, wrong resets
     it to 0; at REV_NEEDED the question is mastered and drops out.
     Returns {streak, mastered}. */
  function recordReviewAnswer(bank, q, correct) {
    var d = loadReview();
    var key = bankKey(bank);
    var e = d[key];
    if (!e || !e.items) return { streak: 0, mastered: false };
    var id = qId(q);
    var item = e.items[id];
    if (!item) return { streak: 0, mastered: false };
    var mastered = false;
    if (correct) {
      item.streak = Math.min((item.streak || 0) + 1, REV_NEEDED);
      if (item.streak >= REV_NEEDED) { delete e.items[id]; mastered = true; }
    } else {
      item.streak = 0;
    }
    saveReview(d);
    return { streak: mastered ? REV_NEEDED : (item.streak || 0), mastered: mastered };
  }

  function reviewStreak(bank, q) {
    var items = reviewEntries(bank);
    var item = items[qId(q)];
    return item ? (item.streak || 0) : 0;
  }

  function clearReviewFor(bank) {
    var d = loadReview();
    delete d[bankKey(bank)];
    saveReview(d);
  }

  /* ---------- stats (Feature 5): attempt history ----------
     Every completed quiz attempt is recorded in LS_STATS, newest
     first, capped at STATS_MAX so localStorage never grows without
     limit. Loading is defensive: a missing key, a non-array, or any
     malformed/corrupt entry falls back to an empty list, so an older
     shape or a hand-edited value can never break the dashboard. */
  function loadStats() {
    try {
      var raw = localStorage.getItem(LS_STATS);
      if (!raw) return [];
      var list = JSON.parse(raw);
      if (!Array.isArray(list)) return [];
      return list.filter(function (a) {
        return a && typeof a === 'object' && Array.isArray(a.items) &&
          typeof a.total === 'number' && typeof a.score === 'number';
      });
    } catch (e) { return []; }
  }

  function saveStats(list) {
    try { localStorage.setItem(LS_STATS, JSON.stringify(list)); } catch (e) {}
  }

  function recordAttempt(attempt) {
    if (!attempt || !attempt.items || !attempt.items.length) return;
    var list = loadStats();
    list.unshift(attempt);
    if (list.length > STATS_MAX) list.length = STATS_MAX;
    saveStats(list);
  }

  /* Start a review session for one bank: the queued questions, in
     their bank order. Returns false when the queue is empty. */
  function startReview(bank) {
    if (!bank) return false;
    var items = reviewEntries(bank);
    var indexes = [];
    bank.questions.forEach(function (q, i) {
      if (items[qId(q)]) indexes.push(i);
    });
    if (!indexes.length) return false;
    quiz = bank;
    startQuiz(indexes, { isReview: true });
    return true;
  }

  /* One review button (with count) appended to a button row, only
     when this bank has queued questions. */
  function addReviewButton(bank, rowEl, primary) {
    var n = reviewCountFor(bank);
    if (!n) return null;
    var b = el('button', 'btn ' + (primary ? 'btn-primary' : 'btn-secondary'), t('revStart', { n: n }));
    b.type = 'button';
    b.addEventListener('click', function () { startReview(bank); });
    rowEl.appendChild(b);
    return b;
  }

  /* Debug/test handle (like window.__qfLastShare for sharing). */
  window.__qfReview = {
    bankKey: bankKey, qId: qId, loadReview: loadReview,
    reviewCountFor: reviewCountFor, reviewTotalCount: reviewTotalCount,
    startReview: startReview, clearReviewFor: clearReviewFor,
    needed: REV_NEEDED
  };

  /* ---------- flashcards (Feature 7: quick revision) ----------
     Built from the exam's own questions — no provider calls, no key.
     fc = {bank, order:[question indexes], pos, flipped, shuffled}.
     The flip is a CSS 3D rotateY on .fc-inner; both faces are in the
     same grid cell so the card sizes to the taller face, and rotateY
     works identically in LTR and RTL. */
  function addFlashcardsButton(bank, rowEl) {
    if (!bank || !bank.questions || !bank.questions.length) return null;
    var b = el('button', 'btn btn-secondary', t('fcBtn'));
    b.type = 'button';
    b.addEventListener('click', function () { openFlashcards(bank); });
    rowEl.appendChild(b);
    return b;
  }

  function openFlashcards(bank) {
    if (!bank || !bank.questions || !bank.questions.length) return;
    stopTimers();
    run = null;
    quiz = bank;
    fc = {
      bank: bank,
      order: bank.questions.map(function (_, i) { return i; }),
      pos: 0, flipped: false, shuffled: false
    };
    currentView = 'flashcards';
    document.getElementById('nav-create').classList.remove('active');
    document.getElementById('nav-library').classList.remove('active');
    document.getElementById('nav-stats').classList.remove('active');
    renderFlashcards();
    window.scrollTo({ top: 0 });
  }

  function fcQuestion() {
    return fc.bank.questions[fc.order[fc.pos]];
  }

  function fcFlip() {
    if (!fc) return;
    fc.flipped = !fc.flipped;
    var inner = document.getElementById('fc-inner');
    if (inner) inner.classList.toggle('flipped', fc.flipped);
    var card = document.getElementById('fc-card');
    if (card) card.setAttribute('aria-pressed', fc.flipped ? 'true' : 'false');
  }

  function fcGo(d) {
    if (!fc) return;
    var n = fc.pos + d;
    if (n < 0 || n >= fc.order.length) return;
    fc.pos = n;
    fc.flipped = false;
    renderFlashcards();
  }

  function fcToggleShuffle() {
    if (!fc) return;
    fc.shuffled = !fc.shuffled;
    fc.order = shuffle(fc.bank.questions.map(function (_, i) { return i; }));
    fc.pos = 0;
    fc.flipped = false;
    renderFlashcards();
  }

  function renderFlashcards() {
    if (!fc) return;
    app.innerHTML = '';
    var q = fcQuestion();
    var qt = qType(q);
    var total = fc.order.length;

    var backRow = el('div', 'btnrow back-row');
    var back = el('button', 'btn btn-secondary btn-small', t('fcBackToExam'));
    back.addEventListener('click', function () { showStart(); });
    backRow.appendChild(back);
    app.appendChild(backRow);

    var hero = el('section', 'card hero');
    hero.appendChild(el('p', 'kicker', t('fcKicker')));
    hero.appendChild(el('h2', null, fc.bank.title || t('fcTitle')));
    hero.appendChild(el('p', 'hero-text', t('fcHero')));
    app.appendChild(hero);

    var bar = el('div', 'fc-bar');
    var counter = el('span', 'fc-counter', t('fcCounter', { pos: fc.pos + 1, total: total }));
    counter.id = 'fc-counter';
    bar.appendChild(counter);
    var shBtn = el('button', 'btn btn-secondary btn-small', fc.shuffled ? t('fcShuffled') : t('fcShuffle'));
    shBtn.id = 'fc-shuffle';
    shBtn.type = 'button';
    shBtn.setAttribute('aria-pressed', fc.shuffled ? 'true' : 'false');
    shBtn.addEventListener('click', function () { fcToggleShuffle(); });
    bar.appendChild(shBtn);
    app.appendChild(bar);

    var scene = el('div', 'fc-scene');
    var card = el('div', 'fc-card');
    card.id = 'fc-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-pressed', fc.flipped ? 'true' : 'false');
    card.setAttribute('aria-label', t('fcFlipHint'));
    var inner = el('div', 'fc-inner' + (fc.flipped ? ' flipped' : ''));
    inner.id = 'fc-inner';

    var front = el('div', 'fc-face fc-front');
    front.appendChild(el('p', 'kicker', t('fcFrontLabel') + (q.topic ? ' · ' + q.topic : '')));
    front.appendChild(el('p', 'fc-q', q.question));
    if (q.code) {
      var code = el('pre', 'fc-code', q.code);
      front.appendChild(code);
    }
    if (q.starterCode) {
      var sc = el('pre', 'fc-code', q.starterCode);
      front.appendChild(sc);
    }
    front.appendChild(el('p', 'fc-hint', t('fcFlipHint')));
    inner.appendChild(front);

    var backFace = el('div', 'fc-face fc-back');
    backFace.appendChild(el('p', 'kicker', t('fcBackLabel')));
    if (qt === 'essay') {
      backFace.appendChild(el('p', 'fc-answer', t('fcRubric') + (q.rubric || '')));
      backFace.appendChild(el('p', 'fc-meta', t('fcMaxScore', { n: essayMax(q) })));
    } else if (qt === 'fill') {
      backFace.appendChild(el('p', 'fc-answer', t('fcAccepted') + (q.answers || []).join(', ')));
    } else if (qt === 'matching') {
      backFace.appendChild(el('p', 'fc-answer', t('matchCorrectPairs') +
        (q.pairs || []).map(function (p) { return p.left + ' → ' + p.right; }).join(' · ')));
    } else if (qt === 'ordering') {
      backFace.appendChild(el('p', 'fc-answer', t('orderCorrectOrder') +
        (q.items || []).map(function (s, i) { return (i + 1) + '. ' + s; }).join(' · ')));
    } else if (qt === 'coding') {
      backFace.appendChild(el('p', 'fc-answer', t('codeTestsLabel') + ': ' +
        (q.tests || []).map(function (tc) { return tc.input + ' → ' + tc.expected; }).join(' · ')));
      backFace.appendChild(el('p', 'fc-meta', t('codeLangNote')));
    } else {
      var letter = LETTERS[q.answer] || '';
      backFace.appendChild(el('p', 'fc-answer', t('fcAnswer') + (letter ? letter + ' — ' : '') + q.options[q.answer]));
    }
    if (q.explanation) backFace.appendChild(el('p', 'fc-why', t('printWhy') + q.explanation));
    backFace.appendChild(el('p', 'fc-hint', t('fcFlipHint')));
    inner.appendChild(backFace);

    card.appendChild(inner);
    card.addEventListener('click', function () { fcFlip(); });
    card.addEventListener('keydown', function (e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); fcFlip(); }
    });
    scene.appendChild(card);
    app.appendChild(scene);

    var nav = el('div', 'fc-nav');
    var prev = el('button', 'btn btn-secondary', t('fcPrev'));
    prev.id = 'fc-prev';
    prev.type = 'button';
    prev.disabled = fc.pos === 0;
    prev.addEventListener('click', function () { fcGo(-1); });
    nav.appendChild(prev);
    var next = el('button', 'btn btn-primary', t('fcNext'));
    next.id = 'fc-next';
    next.type = 'button';
    next.disabled = fc.pos === total - 1;
    next.addEventListener('click', function () { fcGo(1); });
    nav.appendChild(next);
    app.appendChild(nav);
    app.appendChild(el('div', 'hint', t('fcKeysHint')));
  }

  /* Keyboard: Space/Enter flips, arrows move. In RTL the forward
     direction is left, so the arrow mapping follows the page dir. */
  document.addEventListener('keydown', function (e) {
    if (!fc) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    /* A focused button handles Space/Enter itself (click) — never
       flip on top of its own action. The card handles its own keys
       too, so skip it here to avoid flipping twice. */
    if (tag === 'BUTTON') return;
    if (e.target && e.target.id === 'fc-card') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      fcFlip();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      fcGo(document.documentElement.dir === 'rtl' ? -1 : 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      fcGo(document.documentElement.dir === 'rtl' ? 1 : -1);
    }
  });

  /* Debug/test handle for flashcards. */
  window.__qfFlashcards = {
    open: openFlashcards,
    state: function () {
      if (!fc) return null;
      return { pos: fc.pos, total: fc.order.length, flipped: fc.flipped, shuffled: fc.shuffled };
    }
  };

  /* Debug/test handle for strict mode. setTotalSeconds shortens the
     running strict countdown (used by the smoke test so it does not
     have to wait out a full exam); it never touches a live provider. */
  window.__qfStrict = {
    enable: function () { strictMode = true; var c = document.getElementById('strict-toggle'); if (c) c.checked = true; },
    setTotalSeconds: function (n) {
      if (run && run.strict) {
        run.strictTotal = Math.max(1, Math.round(n));
        run.strictLeft = run.strictTotal;
        var c = document.getElementById('timer-strict');
        if (c) c.textContent = fmtTime(run.strictLeft);
      }
    },
    state: function () {
      return {
        toggleOn: strictMode,
        running: !!(run && run.strict),
        left: run ? run.strictLeft : null,
        total: run ? run.strictTotal : null,
        warned: strictWarned,
        fsAttempted: strictFsAttempted,
        fullscreen: !!document.fullscreenElement
      };
    }
  };

  /* Leaving fullscreen mid-exam in strict mode earns one clear
     warning — never an auto-fail. Exiting fullscreen to auto-submit
     at zero, or after results, does not warn. */
  document.addEventListener('fullscreenchange', function () {
    if (!run || !run.strict || run.resultsShown || strictWarned) return;
    if (!document.fullscreenElement && run.strictLeft > 0) {
      strictWarned = true;
      showToast(t('strictFsWarn'), true);
    }
  });

  /* Stored exam values stay English internally (they feed the AI prompt);
     these map them to the UI language for display only. */
  function localizedDifficulty(d) {
    var m = { Easy: 'diffEasy', Medium: 'diffMedium', Hard: 'diffHard', Mixed: 'diffMixed' };
    return m[d] ? t(m[d]) : d;
  }

  function localizedLanguage(l) {
    return l === 'Arabic' ? t('langOptArabic') : t('langOptEnglish');
  }

  /* ---------- views / navigation ---------- */

  function setView(v) {
    currentView = v;
    if (run && run.strict) exitFullscreen();
    stopTimers();
    run = null;
    fc = null;
    document.getElementById('nav-create').classList.toggle('active', v === 'create');
    document.getElementById('nav-library').classList.toggle('active', v === 'library');
    document.getElementById('nav-stats').classList.toggle('active', v === 'stats');
    if (v === 'create') renderWizard();
    else if (v === 'library') renderLibrary();
    else if (v === 'stats') renderStats();
    window.scrollTo({ top: 0 });
  }

  /* Phase 2 i18n: re-render the current view after a language switch
     (called by setLang in i18n.js). During a quiz run the attempt state
     is preserved: renderQuestion() rebuilds the screen from `run`, and
     the per-question countdown is restored so the switch does not reset
     the timer. */
  window.__qfRerender = function () {
    if (currentView === 'create') renderWizard();
    else if (currentView === 'summary') {
      if (sumState.data || (quiz && quiz.summary)) showSummaryScreen(sumReturn);
      else renderWizard();
    }
    else if (currentView === 'library') renderLibrary();
    else if (currentView === 'stats') renderStats();
    else if (currentView === 'flashcards') {
      if (fc) renderFlashcards();
      else showStart();
    }
    else if (currentView === 'quiz') {
      if (run) {
        if (run.reviewDone) { showReviewResults(); return; }
        if (run.resultsShown) { showResults(); return; }
        var savedLeft = run.perQLeft;
        renderQuestion();
        if (run) {
          run.perQLeft = savedLeft;
          /* renderQuestion() restarts the countdown chip at full time —
             put the saved value back so the display matches the timer. */
          var chip = document.getElementById('timer-perq');
          if (chip) {
            chip.textContent = fmtTime(Math.max(savedLeft, 0));
            var w = chip.closest('.tchip');
            if (w) w.classList.toggle('low', savedLeft <= 10);
          }
        }
      } else showStart(sharedExam ? t('shareLoadedNote') : null);
    }
  };

  function wireNav() {
    document.getElementById('nav-create').addEventListener('click', function () { setView('create'); });
    document.getElementById('nav-library').addEventListener('click', function () { setView('library'); });
    document.getElementById('nav-stats').addEventListener('click', function () { setView('stats'); });
  }

  /* ---------- wizard ---------- */

  function materialChars() {
    return material.text.length + material.pasted.length;
  }

  /* A summary belongs to the exact material it was made from — any
     change to the material drops it (and its error) so it can never
     be shown against different material. */
  function clearSummary() {
    sumState.data = null;
    sumState.error = '';
  }

  function updateSumStatus() {
    var box = document.getElementById('sum-status');
    if (!box) return;
    if (sumState.error) {
      box.className = 'bank-error show';
      box.textContent = sumState.error;
    } else if (sumState.data) {
      box.className = 'gen-success show';
      box.textContent = t('sumReady', { n: sumState.data.keyPoints.length, m: sumState.data.definitions.length });
    } else {
      box.className = 'bank-error';
      box.textContent = '';
    }
  }

  function renderWizard() {
    app.innerHTML = '';
    var wrap = el('div');

    // Step indicator
    var steps = el('ol', 'steps');
    [t('step1'), t('step2'), t('step3'), t('step4')].forEach(function (name, i) {
      var li = el('li', 'step' + (i + 1 === wiz.step ? ' current' : '') + (i + 1 < wiz.step ? ' done' : ''));
      li.appendChild(el('span', 'step-dot', String(i + 1)));
      li.appendChild(el('span', 'step-name', name));
      steps.appendChild(li);
    });
    wrap.appendChild(steps);

    if (wiz.step === 1) renderStepUpload(wrap);
    else if (wiz.step === 2) renderStepKey(wrap);
    else if (wiz.step === 3) renderStepSettings(wrap);
    else renderStepGenerate(wrap);

    app.appendChild(wrap);
    updateLibCount();
  }

  function wizardNav(wrap, opts) {
    // opts: {back: step|null, next: step|null, nextLabel, nextDisabled, onNext}
    var row = el('div', 'btnrow wizard-nav');
    if (opts.back) {
      var back = el('button', 'btn btn-secondary', t('back'));
      back.addEventListener('click', function () { wiz.step = opts.back; saveWizard(); renderWizard(); });
      row.appendChild(back);
    }
    if (opts.next) {
      var next = el('button', 'btn btn-primary btn-big', opts.nextLabel || t('continue'));
      if (opts.nextDisabled) next.disabled = true;
      next.addEventListener('click', function () {
        if (opts.onNext) opts.onNext();
        wiz.step = opts.next; saveWizard(); renderWizard();
      });
      row.appendChild(next);
    }
    wrap.appendChild(row);
  }

  function fieldRow(labelText, inputNode, hintText) {
    var row = el('div', 'field');
    row.appendChild(el('label', 'field-label', labelText));
    row.appendChild(inputNode);
    if (hintText) row.appendChild(el('p', 'field-hint', hintText));
    return row;
  }

  /* ----- Step 1: upload material ----- */

  function renderStepUpload(wrap) {
    var card = el('section', 'card');
    card.appendChild(el('p', 'kicker', t('kicker1')));
    card.appendChild(el('h2', null, t('s1Title')));
    card.appendChild(el('p', 'hero-text', t('s1Hero')));

    var dz = el('div', 'dropzone');
    dz.id = 'dropzone';
    dz.tabIndex = 0;
    dz.setAttribute('role', 'button');
    dz.setAttribute('aria-label', t('s1DzAria'));
    dz.innerHTML = '<div class="dz-big">' + t('s1DzBig') + '</div>' +
      '<div class="dz-small">' + t('s1DzSmall') + '</div>';
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.pdf,.txt,.md,.json,.csv,.xlsx,application/pdf,text/plain,text/markdown,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    picker.multiple = true;
    picker.addEventListener('change', function () {
      addFiles(picker.files);
      picker.value = '';
    });
    dz.appendChild(picker);
    dz.addEventListener('click', function () { picker.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
    });
    card.appendChild(dz);

    var list = el('div', 'file-list');
    list.id = 'file-list';
    card.appendChild(list);

    var pasteLabel = el('label', 'field-label', t('s1PasteLabel'));
    pasteLabel.htmlFor = 'paste-text';
    card.appendChild(pasteLabel);
    var ta = document.createElement('textarea');
    ta.id = 'paste-text';
    ta.className = 'input textarea';
    ta.rows = 6;
    ta.placeholder = t('s1PastePh');
    ta.value = material.pasted;
    ta.addEventListener('input', function () {
      material.pasted = ta.value;
      clearSummary();
      refreshFileList();
    });
    card.appendChild(ta);

    /* ----- Spreadsheet import (Feature 13) ----- */
    var sheetBox = el('div', 'sheet-box');
    sheetBox.appendChild(el('h3', null, t('sheetTitle')));
    sheetBox.appendChild(el('p', 'hero-text', t('sheetHero')));
    sheetBox.appendChild(el('p', 'field-label', t('sheetFormatLabel')));
    var fmtPre = el('pre', 'sheet-format', t('sheetFormat'));
    sheetBox.appendChild(fmtPre);
    sheetBox.appendChild(el('p', 'field-label', t('sheetExampleLabel')));
    sheetBox.appendChild(el('pre', 'sheet-format', t('sheetExample')));
    sheetBox.appendChild(el('p', 'field-hint', t('sheetTypeNote')));
    var sheetPasteLabel = el('label', 'field-label', t('sheetPasteLabel'));
    sheetPasteLabel.htmlFor = 'sheet-csv';
    sheetBox.appendChild(sheetPasteLabel);
    var sheetTa = document.createElement('textarea');
    sheetTa.id = 'sheet-csv';
    sheetTa.className = 'input textarea';
    sheetTa.rows = 4;
    sheetTa.placeholder = t('sheetPastePh');
    sheetTa.setAttribute('dir', 'ltr');
    sheetTa.style.textAlign = 'left';
    sheetBox.appendChild(sheetTa);
    var sheetFileRow = el('div', 'btnrow sheet-file-row');
    var sheetPicker = document.createElement('input');
    sheetPicker.type = 'file';
    sheetPicker.id = 'sheet-file';
    sheetPicker.accept = '.csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    sheetPicker.hidden = true;
    sheetPicker.addEventListener('change', function () {
      if (sheetPicker.files && sheetPicker.files.length) {
        addFiles(sheetPicker.files);
        sheetPicker.value = '';
      }
    });
    sheetFileRow.appendChild(sheetPicker);
    var sheetFileBtn = el('button', 'btn btn-secondary btn-small', t('sheetFileBtn'));
    sheetFileBtn.type = 'button';
    sheetFileBtn.addEventListener('click', function () { sheetPicker.click(); });
    sheetFileRow.appendChild(sheetFileBtn);
    var sheetImportBtn = el('button', 'btn btn-primary btn-small', t('sheetImportBtn'));
    sheetImportBtn.id = 'sheet-import-btn';
    sheetImportBtn.type = 'button';
    sheetImportBtn.addEventListener('click', function () {
      var text = sheetTa.value;
      if (!text.trim()) { showSheetStatus({ ok: false, error: t('sheetEmpty') }); return; }
      importSpreadsheetRows(parseCsvText(text), t('sheetImportedTitle'));
    });
    sheetFileRow.appendChild(sheetImportBtn);
    sheetBox.appendChild(sheetFileRow);
    var sheetStatus = el('div', 'bank-error');
    sheetStatus.id = 'sheet-status';
    sheetBox.appendChild(sheetStatus);
    card.appendChild(sheetBox);

    var summary = el('p', 'material-summary');
    summary.id = 'material-summary';
    card.appendChild(summary);

    var sumRow = el('div', 'btnrow sum-row');
    var sumBtn = el('button', 'btn btn-secondary', t('sumBtn'));
    sumBtn.id = 'sum-btn';
    sumBtn.type = 'button';
    sumBtn.disabled = materialChars() === 0;
    sumBtn.addEventListener('click', function () { generateSummary(); });
    sumRow.appendChild(sumBtn);
    var sumViewBtn = el('button', 'btn btn-secondary', t('sumView'));
    sumViewBtn.id = 'sum-view-btn';
    sumViewBtn.type = 'button';
    sumViewBtn.hidden = true;
    sumViewBtn.addEventListener('click', function () {
      showSummaryScreen({ kind: 'wizard', step: 3, backStep: 1 });
    });
    sumRow.appendChild(sumViewBtn);
    card.appendChild(sumRow);
    var sumStatus = el('div', 'bank-error');
    sumStatus.id = 'sum-status';
    card.appendChild(sumStatus);

    var pdfNote = el('p', 'field-hint');
    pdfNote.id = 'pdf-note';
    card.appendChild(pdfNote);

    wrap.appendChild(card);
    refreshFileList();
    wizardNav(wrap, {
      back: null, next: 2, nextLabel: t('toKey'),
      onNext: function () { material.pasted = ta.value; }
    });
  }

  function refreshFileList() {
    var list = document.getElementById('file-list');
    var summary = document.getElementById('material-summary');
    var pdfNote = document.getElementById('pdf-note');
    if (!list) return;
    list.innerHTML = '';
    material.files.forEach(function (f, idx) {
      var row = el('div', 'file-row');
      row.appendChild(el('span', 'file-ic', f.kind === 'pdf' ? '📕' : (f.kind === 'bank' ? '🗂️' : '📝')));
      var meta = el('div', 'file-meta');
      meta.appendChild(el('span', 'file-name', f.name));
      var sub = f.kind === 'pdf'
        ? fmtSize(f.size) + ' · ' + t('s1PagesLabel', { n: f.pages }) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() })
        : f.kind === 'bank'
          ? fmtSize(f.size) + ' · ' + t('s1BankSaved')
          : fmtSize(f.size) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() });
      meta.appendChild(el('span', 'file-sub muted', sub));
      row.appendChild(meta);
      var rm = el('button', 'file-remove', '✕');
      rm.type = 'button';
      rm.title = t('s1RemoveFile');
      rm.setAttribute('aria-label', t('s1RemoveAria', { name: f.name }));
      rm.addEventListener('click', function () {
        removeMaterialFile(idx);
        refreshFileList();
      });
      row.appendChild(rm);
      list.appendChild(row);
    });
    if (summary) {
      var chars = materialChars();
      var parts = [];
      if (material.files.length) parts.push(t('s1FilesLabel', { n: material.files.length }));
      if (material.pdfPages) parts.push(t('s1PagesLabel', { n: material.pdfPages }));
      parts.push(t('s1CharsTotal', { n: chars.toLocaleString() }));
      summary.textContent = chars > 0
        ? t('s1Ready', { parts: parts.join(' · ') })
        : t('s1NoMaterial');
    }
    if (pdfNote) {
      pdfNote.textContent = material.pdfFailed ? t('s1PdfFail') : '';
    }
    var nextBtn = document.querySelector('.wizard-nav .btn-primary');
    if (nextBtn) nextBtn.disabled = materialChars() === 0;
    var sumBtn2 = document.getElementById('sum-btn');
    if (sumBtn2) {
      sumBtn2.disabled = materialChars() === 0 || sumState.busy;
      sumBtn2.textContent = sumState.data ? t('sumBtnAgain') : t('sumBtn');
    }
    var sumViewBtn2 = document.getElementById('sum-view-btn');
    if (sumViewBtn2) sumViewBtn2.hidden = !sumState.data;
    updateSumStatus();
  }

  function removeMaterialFile(idx) {
    var f = material.files[idx];
    if (!f) return;
    clearSummary();
    material.files.splice(idx, 1);
    if (f.kind !== 'bank') {
      material.text = material.files
        .filter(function (g) { return g.kind !== 'bank'; })
        .map(function (g) { return g.text || ''; })
        .join('\n\n');
      material.pdfPages = material.files.reduce(function (sum, g) {
        return sum + (g.kind === 'pdf' ? (g.pages || 0) : 0);
      }, 0);
    }
  }

  function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return addOneFile(file); });
    });
    chain.then(refreshFileList).catch(function (e) {
      var note = document.getElementById('pdf-note');
      if (note) note.textContent = e.message;
      refreshFileList();
    });
  }

  function addOneFile(file) {
    var name = file.name || 'file';
    var lower = name.toLowerCase();
    if (lower.endsWith('.pdf')) return addPdfFile(file);
    if (lower.endsWith('.json')) return addJsonFile(file);
    if (lower.endsWith('.xlsx')) return addXlsxFile(file);
    if (lower.endsWith('.csv')) return addCsvFile(file);
    // .txt / .md / anything else readable as text
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        pushMaterial({ name: name, size: file.size, kind: 'text', chars: text.length, pages: 0 }, text);
        resolve();
      };
      reader.onerror = function () { reject(new Error(t('errReadFile', { name: name }))); };
      reader.readAsText(file);
    });
  }

  function pushMaterial(meta, text) {
    clearSummary();
    meta.text = text;
    meta.start = material.text.length;
    material.text += (material.text ? '\n\n' : '') + text;
    meta.chars = text.length;
    material.files.push(meta);
    if (meta.kind === 'pdf') material.pdfPages += (meta.pages || 0);
  }

  function addJsonFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result || ''));
          validate(data);
          var lib = loadLibrary();
          lib.unshift({
            id: 'bank-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
            title: data.title || file.name.replace(/\.json$/i, ''),
            subtitle: data.subtitle || t('libImportedBank', { n: data.questions.length }),
            date: new Date().toISOString().slice(0, 10),
            count: data.questions.length,
            provider: 'import',
            model: '',
            bank: data
          });
          saveLibrary(lib);
          material.files.push({ name: file.name, size: file.size, kind: 'bank', chars: 0, pages: 0 });
          resolve();
        } catch (e) {
          // Not a valid bank — treat its raw text as material.
          var text = String(reader.result || '');
          pushMaterial({ name: file.name, size: file.size, kind: 'text', chars: text.length, pages: 0 }, text);
          resolve();
        }
      };
      reader.onerror = function () { reject(new Error(t('errReadFile', { name: file.name }))); };
      reader.readAsText(file);
    });
  }

  /* ----- Spreadsheet import (Feature 13) -----
     One documented column format, shared by CSV paste, .csv upload
     and .xlsx upload:
       type | question | options | correct | explanation | topic
     - type: mcq (default), tf, fill. options are separated by ';'.
     - correct for mcq: a letter (A, B, C…), a 1-based number, or the
       exact option text. For tf: True / False (also 1 / 0). For fill:
       the accepted answer(s), separated by ';'.
     - A row with more than 6 cells (a sheet with one option per
       column) is read as: type, question, option…, correct,
       explanation, topic. explanation and topic are always optional.
     Rows are converted one by one and each candidate question is
     checked with the same validate() the JSON import uses; bad rows
     are reported and skipped, good rows are saved to My exams. */

  function parseCsvText(text) {
    var src = String(text || '').replace(/^\uFEFF/, '');
    /* Delimiter sniff: tabs win only when they clearly outnumber
       commas in the first few lines, so a normal comma CSV keeps
       working and a TSV paste works too. */
    var head = src.split(/\r?\n/).slice(0, 5).join('\n');
    var commas = (head.match(/,/g) || []).length;
    var tabs = (head.match(/\t/g) || []).length;
    var delim = tabs > commas ? '\t' : ',';
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    for (var i = 0; i < src.length; i++) {
      var ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && src[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map(function (r) {
      return r.map(function (c) { return String(c == null ? '' : c).trim(); });
    });
  }

  function sheetIsHeader(cells) {
    var a = (cells[0] || '').toLowerCase();
    var b = (cells[1] || '').toLowerCase();
    return a === 'type' || a === 'النوع' || b === 'question' || b === 'السؤال';
  }

  function sheetSplitOptions(raw) {
    return String(raw || '').split(';').map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; });
  }

  /* Returns {q} on success or {error} with a human-readable reason. */
  function sheetRowToQuestion(cells, rowNum) {
    var c = cells.slice();
    /* Trailing empty cells carry no meaning — and SheetJS pads every
       row to the sheet's widest row, so without this trim a normal
       6-column row from a sheet that also has an expanded row would
       look like an expanded row. */
    while (c.length && c[c.length - 1] === '') c.pop();
    while (c.length < 6) c.push('');
    var typeRaw = (c[0] || '').toLowerCase();
    var type = typeRaw === '' ? 'mcq' : typeRaw;
    if (['mcq', 'tf', 'fill'].indexOf(type) === -1)
      return { error: t('sheetSkipType', { v: c[0] || '' }) };
    var question = c[1] || '';
    if (!question) return { error: t('sheetSkipNoQ') };
    /* Expanded layout: type, question, option…, correct,
       explanation, topic — the options are all cells but the last
       three before the tail. */
    var optionsRaw, correctRaw, explRaw, topicRaw;
    if (c.length > 6) {
      optionsRaw = c.slice(2, c.length - 3).filter(function (s) { return s !== ''; });
      correctRaw = c[c.length - 3] || '';
      explRaw = c[c.length - 2] || '';
      topicRaw = c[c.length - 1] || '';
    } else {
      optionsRaw = sheetSplitOptions(c[2]);
      correctRaw = c[3] || '';
      explRaw = c[4] || '';
      topicRaw = c[5] || '';
    }
    var q;
    if (type === 'fill') {
      var answers = sheetSplitOptions(correctRaw);
      if (!answers.length) answers = optionsRaw; // forgiving: answers in the options column
      if (question.indexOf('____') === -1 && question.indexOf('___') === -1 || !answers.length)
        return { error: t('sheetSkipFill') };
      q = { type: 'fill', question: question, answers: answers };
    } else if (type === 'tf') {
      var low = String(correctRaw).trim().toLowerCase();
      var ans;
      if (low === 'true' || low === '1' || low === 'yes' || low === 'صح' || low === 'صواب') ans = 0;
      else if (low === 'false' || low === '0' || low === 'no' || low === 'خطأ') ans = 1;
      else if (low === 'a') ans = 0;
      else if (low === 'b') ans = 1;
      else return { error: t('sheetSkipCorrect') };
      q = { type: 'tf', question: question, options: ['True', 'False'], answer: ans };
    } else {
      if (optionsRaw.length < 2) return { error: t('sheetSkipOptions') };
      var corr = String(correctRaw).trim().replace(/[.)]$/, '');
      var idx = -1;
      if (/^[a-zA-Z]$/.test(corr)) idx = corr.toUpperCase().charCodeAt(0) - 65;
      else if (/^\d+$/.test(corr)) idx = parseInt(corr, 10) - 1;
      else {
        optionsRaw.some(function (o, i) {
          if (o.toLowerCase() === corr.toLowerCase()) { idx = i; return true; }
          return false;
        });
      }
      if (idx < 0 || idx >= optionsRaw.length) return { error: t('sheetSkipCorrect') };
      q = { type: 'mcq', question: question, options: optionsRaw, answer: idx };
    }
    if (explRaw) q.explanation = explRaw;
    if (topicRaw) q.topic = topicRaw;
    /* Same bank validation as the JSON import — never trust a row
       the validator would reject. */
    try {
      validate({ title: 'sheet', questions: [q] });
    } catch (e) {
      return { error: e.message };
    }
    return { q: q };
  }

  function rowsToBank(rows, sourceName) {
    var questions = [];
    var skipped = [];
    var dataRows = 0;
    rows.forEach(function (cells, i) {
      if (!cells.some(function (c) { return c !== ''; })) return; // blank line
      if (dataRows === 0 && sheetIsHeader(cells)) return; // header row
      dataRows++;
      var r = sheetRowToQuestion(cells, i + 1);
      if (r.q) questions.push(r.q);
      else skipped.push({ row: i + 1, reason: r.error });
    });
    if (!questions.length) return { bank: null, imported: 0, skipped: skipped };
    return {
      bank: {
        title: sourceName || t('sheetTitle'),
        subtitle: t('libImportedBank', { n: questions.length }),
        questions: questions
      },
      imported: questions.length,
      skipped: skipped
    };
  }

  function showSheetStatus(result) {
    var box = document.getElementById('sheet-status');
    if (!box) return;
    if (result.ok === false) {
      box.className = 'bank-error show';
      box.textContent = result.error;
      return;
    }
    box.className = 'gen-success show';
    box.textContent = '';
    box.appendChild(document.createTextNode(t('sheetImported', { n: result.imported })));
    if (result.skipped && result.skipped.length) {
      box.appendChild(el('p', null, t('sheetSkipped', { n: result.skipped.length })));
      var ul = el('ul', 'sheet-skip');
      result.skipped.slice(0, 10).forEach(function (s) {
        ul.appendChild(el('li', null, t('sheetRowLabel', { n: s.row, reason: s.reason })));
      });
      box.appendChild(ul);
    }
  }

  function importSpreadsheetRows(rows, sourceName) {
    var result = rowsToBank(rows, sourceName);
    if (!result.bank) {
      showSheetStatus({ ok: false, error: t('sheetNoValid') });
      return result;
    }
    var lib = loadLibrary();
    lib.unshift({
      id: 'sheet-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
      title: result.bank.title,
      subtitle: result.bank.subtitle,
      date: new Date().toISOString().slice(0, 10),
      count: result.bank.questions.length,
      provider: 'import',
      model: '',
      bank: result.bank
    });
    saveLibrary(lib);
    material.files.push({ name: sourceName || t('sheetTitle'), size: 0, kind: 'bank', chars: 0, pages: 0 });
    showSheetStatus({ ok: true, imported: result.imported, skipped: result.skipped });
    refreshFileList();
    return result;
  }

  function addCsvFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        importSpreadsheetRows(parseCsvText(String(reader.result || '')), file.name.replace(/\.csv$/i, ''));
        resolve();
      };
      reader.onerror = function () { reject(new Error(t('errReadFile', { name: file.name }))); };
      reader.readAsText(file);
    });
  }

  /* SheetJS loads LAZILY, only when an .xlsx file is added, from
     cdnjs — same pattern as pdf.js. If the CDN cannot be reached,
     the error is shown and CSV paste/upload keep working. */
  var xlsxPromise = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxPromise) return xlsxPromise;
    xlsxPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = function () {
        if (!window.XLSX) { reject(new Error(t('sheetXlsxFail'))); return; }
        resolve(window.XLSX);
      };
      s.onerror = function () { reject(new Error(t('sheetXlsxFail'))); };
      document.head.appendChild(s);
    });
    return xlsxPromise;
  }

  function addXlsxFile(file) {
    var box = document.getElementById('sheet-status');
    if (box) { box.className = 'gen-success show'; box.textContent = t('sheetXlsxLoading'); }
    return loadXlsx().then(function () {
      return file.arrayBuffer();
    }).then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new Error(t('sheetNoValid'));
      var rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
      importSpreadsheetRows(rows, file.name.replace(/\.xlsx$/i, ''));
    }).catch(function (e) {
      showSheetStatus({ ok: false, error: e.message || t('sheetXlsxFail') });
    });
  }

  /* Test hook (no UI): lets the headless smoke test call the pure
     parser without driving the DOM. */
  window.__qfSheet = { parseCsvText: parseCsvText, rowsToBank: rowsToBank };

  /* PDF text extraction — pdf.js loads LAZILY, only when a PDF is added,
     from cdnjs. Plain text extraction only, no OCR. If the CDN cannot be
     reached, the rest of the app keeps working and the user is told to
     paste the text instead. */
  var pdfJsPromise = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfJsPromise) return pdfJsPromise;
    pdfJsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = PDFJS_URL;
      s.onload = function () {
        if (!window.pdfjsLib) { reject(new Error(t('errPdfJsInit'))); return; }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { reject(new Error(t('errPdfJsLoad'))); };
      document.head.appendChild(s);
    });
    return pdfJsPromise;
  }

  function addPdfFile(file) {
    return loadPdfJs().then(function (pdfjsLib) {
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.pdfjsLib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pageTexts = [];
      var chain = Promise.resolve();
      for (var p = 1; p <= pdf.numPages; p++) {
        (function (pageNum) {
          chain = chain.then(function () {
            return pdf.getPage(pageNum).then(function (page) {
              return page.getTextContent();
            }).then(function (content) {
              var txt = content.items.map(function (it) { return it.str; }).join(' ');
              pageTexts[pageNum - 1] = txt;
            });
          });
        })(p);
      }
      return chain.then(function () {
        var text = pageTexts.join('\n\n');
        pushMaterial({ name: file.name, size: file.size, kind: 'pdf', chars: text.length, pages: pdf.numPages }, text);
      });
    }).catch(function (e) {
      material.pdfFailed = true;
      var msg = t('errReadFileDetail', { name: file.name, detail: e.message });
      var note = document.getElementById('pdf-note');
      if (note) note.textContent = msg;
      throw new Error(msg);
    });
  }

  /* ----- Step 2: your AI key (BYO) ----- */

  function renderStepKey(wrap) {
    var card = el('section', 'card');
    card.appendChild(el('p', 'kicker', t('kicker2')));
    card.appendChild(el('h2', null, t('s2Title')));
    card.appendChild(el('p', 'hero-text', t('s2Hero')));
    var privacy = el('p', 'privacy-note');
    privacy.textContent = t('s2Privacy');
    card.appendChild(privacy);

    var provRow = el('div', 'prov-row');
    Object.keys(PROVIDERS).forEach(function (id) {
      var b = el('button', 'prov-btn' + (byok.provider === id ? ' selected' : ''), PROVIDERS[id].label);
      b.type = 'button';
      b.addEventListener('click', function () {
        byok.provider = id;
        saveByok();
        renderWizard();
      });
      provRow.appendChild(b);
    });
    card.appendChild(provRow);

    var p = PROVIDERS[byok.provider];

    var keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.id = 'byok-key';
    keyInput.className = 'input';
    keyInput.autocomplete = 'off';
    keyInput.spellcheck = false;
    keyInput.placeholder = t('s2KeyPh', { label: p.label });
    keyInput.value = byok.apiKey;
    keyInput.addEventListener('input', function () {
      byok.apiKey = keyInput.value.trim();
      saveByok();
      // The Continue button starts disabled when there is no key — re-enable
      // it live as soon as a key is typed (no re-render, so focus is kept).
      var navBtn = document.querySelector('.wizard-nav .btn-primary');
      if (navBtn) navBtn.disabled = !byok.apiKey;
      var warn = document.querySelector('.wizard-nav .field-hint');
      if (warn) warn.style.display = byok.apiKey ? 'none' : '';
      // Keep the "saved as ••••1234" hint live too.
      var hint = keyInput.closest('.field');
      hint = hint ? hint.querySelector('.field-hint') : null;
      if (hint) {
        hint.textContent = byok.apiKey
          ? t('s2KeySaved', { masked: maskedKey() })
          : (p.keyUrl ? t('s2GetKey', { url: p.keyUrl }) : t('s2GetKeyDash'));
      }
    });
    card.appendChild(fieldRow(t('keyLabel.' + byok.provider), keyInput,
      byok.apiKey ? t('s2KeySaved', { masked: maskedKey() })
        : (p.keyUrl ? t('s2GetKey', { url: p.keyUrl }) : t('s2GetKeyDash'))));

    var modelInput = document.createElement('input');
    modelInput.type = 'text';
    modelInput.id = 'byok-model';
    modelInput.className = 'input';
    modelInput.spellcheck = false;
    modelInput.placeholder = p.defaultModel;
    modelInput.value = byok.model;
    modelInput.addEventListener('input', function () { byok.model = modelInput.value.trim(); saveByok(); });
    card.appendChild(fieldRow(t('s2ModelLabel'), modelInput,
      t('s2ModelHint', { model: p.defaultModel })));

    if (byok.provider === 'custom') {
      var baseInput = document.createElement('input');
      baseInput.type = 'text';
      baseInput.id = 'byok-base';
      baseInput.className = 'input';
      baseInput.spellcheck = false;
      baseInput.placeholder = p.defaultBaseUrl;
      baseInput.value = byok.baseUrl;
      baseInput.addEventListener('input', function () { byok.baseUrl = baseInput.value.trim(); saveByok(); });
      card.appendChild(fieldRow(t('s2BaseLabel'), baseInput,
        t('s2BaseHint', { url: p.defaultBaseUrl })));
    }

    if (byok.provider === 'claude') {
      var proxyInput = document.createElement('input');
      proxyInput.type = 'text';
      proxyInput.id = 'byok-proxy';
      proxyInput.className = 'input';
      proxyInput.spellcheck = false;
      proxyInput.placeholder = 'https://your-cors-proxy.example.com';
      proxyInput.value = byok.proxyUrl;
      proxyInput.addEventListener('input', function () { byok.proxyUrl = proxyInput.value.trim(); saveByok(); });
      card.appendChild(fieldRow(t('s2ProxyLabel'), proxyInput, t('s2ProxyHint')));
    }

    var testRow = el('div', 'btnrow');
    var testBtn = el('button', 'btn btn-secondary', t('s2Test'));
    testBtn.id = 'test-conn-btn';
    testBtn.addEventListener('click', function () { testConnection(); });
    testRow.appendChild(testBtn);
    var clearBtn = el('button', 'btn btn-secondary btn-small', t('s2Forget'));
    clearBtn.addEventListener('click', function () {
      byok.apiKey = '';
      saveByok();
      renderWizard();
    });
    testRow.appendChild(clearBtn);
    card.appendChild(testRow);

    var testOut = el('div', 'test-out');
    testOut.id = 'test-out';
    card.appendChild(testOut);

    wrap.appendChild(card);
    wizardNav(wrap, {
      back: 1, next: 3, nextLabel: t('toSettings'),
      nextDisabled: !byok.apiKey
    });
    if (!byok.apiKey) {
      var nav = wrap.querySelector('.wizard-nav');
      if (nav) {
        var warn = el('p', 'field-hint', t('s2Warn'));
        nav.appendChild(warn);
      }
    }
  }

  function testConnection() {
    var out = document.getElementById('test-out');
    var btn = document.getElementById('test-conn-btn');
    if (!byok.apiKey) {
      if (out) { out.className = 'test-out err'; out.textContent = t('s2TestNeedKey'); }
      return;
    }
    if (isOffline()) {
      if (out) { out.className = 'test-out err'; out.textContent = '✗ ' + t('offlineNeedNet'); }
      return;
    }
    if (out) { out.className = 'test-out'; out.textContent = t('s2Testing'); }
    if (btn) btn.disabled = true;
    callProvider('Reply with exactly this JSON and nothing else: {"ok": true}', 1, 'test')
      .then(function (text) {
        if (out) {
          out.className = 'test-out ok';
          out.textContent = t('s2Connected', { label: PROVIDERS[byok.provider].label, model: effectiveModel() });
        }
      })
      .catch(function (e) {
        if (out) {
          out.className = 'test-out err';
          out.textContent = '✗ ' + plainError(e);
        }
      })
      .then(function () { if (btn) btn.disabled = false; });
  }

  /* ----- Step 3: exam settings ----- */

  /* At least one question type must stay selected in Step 3. */
  function anyType() {
    return !!(wiz.types.mcq || wiz.types.tf || wiz.types.essay || wiz.types.fill || wiz.types.coding || wiz.types.matching || wiz.types.ordering);
  }

  function renderStepSettings(wrap) {
    var card = el('section', 'card');
    card.appendChild(el('p', 'kicker', t('kicker3')));
    card.appendChild(el('h2', null, t('s3Title')));

    var titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.id = 'ex-title';
    titleInput.className = 'input';
    titleInput.placeholder = t('s3TitlePh');
    titleInput.value = wiz.title;
    titleInput.addEventListener('input', function () { wiz.title = titleInput.value; saveWizard(); });
    card.appendChild(fieldRow(t('s3TitleLabel'), titleInput, ''));

    var countInput = document.createElement('input');
    countInput.type = 'number';
    countInput.id = 'ex-count';
    countInput.className = 'input input-narrow';
    countInput.min = '5'; countInput.max = '50';
    countInput.value = String(wiz.count);
    countInput.addEventListener('change', function () {
      var v = parseInt(countInput.value, 10);
      if (!isNaN(v)) { wiz.count = Math.max(5, Math.min(50, v)); countInput.value = String(wiz.count); saveWizard(); }
    });
    card.appendChild(fieldRow(t('s3CountLabel'), countInput, ''));

    var typesRow = el('div', 'field');
    typesRow.appendChild(el('span', 'field-label', t('s3TypesLabel')));
    var mcqLbl = el('label', 'set-row');
    var mcq = document.createElement('input');
    mcq.type = 'checkbox'; mcq.checked = wiz.types.mcq;
    mcq.addEventListener('change', function () {
      wiz.types.mcq = mcq.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    mcqLbl.appendChild(mcq);
    mcqLbl.appendChild(el('span', null, t('s3Mcq')));
    typesRow.appendChild(mcqLbl);
    var tfLbl = el('label', 'set-row');
    var tf = document.createElement('input');
    tf.type = 'checkbox'; tf.checked = wiz.types.tf;
    tf.addEventListener('change', function () {
      wiz.types.tf = tf.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    tfLbl.appendChild(tf);
    tfLbl.appendChild(el('span', null, t('s3Tf')));
    typesRow.appendChild(tfLbl);
    var essayLbl = el('label', 'set-row');
    var essayCb = document.createElement('input');
    essayCb.type = 'checkbox'; essayCb.id = 'ex-type-essay'; essayCb.checked = !!wiz.types.essay;
    essayCb.addEventListener('change', function () {
      wiz.types.essay = essayCb.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    essayLbl.appendChild(essayCb);
    essayLbl.appendChild(el('span', null, t('s3Essay')));
    typesRow.appendChild(essayLbl);
    var fillLbl = el('label', 'set-row');
    var fillCb = document.createElement('input');
    fillCb.type = 'checkbox'; fillCb.id = 'ex-type-fill'; fillCb.checked = !!wiz.types.fill;
    fillCb.addEventListener('change', function () {
      wiz.types.fill = fillCb.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    fillLbl.appendChild(fillCb);
    fillLbl.appendChild(el('span', null, t('s3Fill')));
    typesRow.appendChild(fillLbl);
    var codeLbl = el('label', 'set-row');
    var codeCb = document.createElement('input');
    codeCb.type = 'checkbox'; codeCb.id = 'ex-type-coding'; codeCb.checked = !!wiz.types.coding;
    codeCb.addEventListener('change', function () {
      wiz.types.coding = codeCb.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    codeLbl.appendChild(codeCb);
    codeLbl.appendChild(el('span', null, t('s3Coding')));
    typesRow.appendChild(codeLbl);
    var matchLbl = el('label', 'set-row');
    var matchCb = document.createElement('input');
    matchCb.type = 'checkbox'; matchCb.id = 'ex-type-matching'; matchCb.checked = !!wiz.types.matching;
    matchCb.addEventListener('change', function () {
      wiz.types.matching = matchCb.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    matchLbl.appendChild(matchCb);
    matchLbl.appendChild(el('span', null, t('s3Matching')));
    typesRow.appendChild(matchLbl);
    var orderLbl = el('label', 'set-row');
    var orderCb = document.createElement('input');
    orderCb.type = 'checkbox'; orderCb.id = 'ex-type-ordering'; orderCb.checked = !!wiz.types.ordering;
    orderCb.addEventListener('change', function () {
      wiz.types.ordering = orderCb.checked;
      if (!anyType()) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    orderLbl.appendChild(orderCb);
    orderLbl.appendChild(el('span', null, t('s3Ordering')));
    typesRow.appendChild(orderLbl);
    var codeNote = el('p', 'field-hint', t('codeLangNote'));
    typesRow.appendChild(codeNote);
    card.appendChild(typesRow);

    var diffSel = document.createElement('select');
    diffSel.id = 'ex-diff';
    diffSel.className = 'input';
    [['Easy', 'diffEasy'], ['Medium', 'diffMedium'], ['Hard', 'diffHard'], ['Mixed', 'diffMixed']].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0]; o.textContent = t(pair[1]);
      if (wiz.difficulty === pair[0]) o.selected = true;
      diffSel.appendChild(o);
    });
    diffSel.addEventListener('change', function () { wiz.difficulty = diffSel.value; saveWizard(); });
    card.appendChild(fieldRow(t('s3Diff'), diffSel, ''));

    var langSel = document.createElement('select');
    langSel.id = 'ex-lang';
    langSel.className = 'input';
    [['English', 'langOptEnglish'], ['Arabic', 'langOptArabic']].forEach(function (pair) {
      var o = document.createElement('option');
      o.value = pair[0]; o.textContent = t(pair[1]);
      if (wiz.language === pair[0]) o.selected = true;
      langSel.appendChild(o);
    });
    langSel.addEventListener('change', function () { wiz.language = langSel.value; saveWizard(); });
    card.appendChild(fieldRow(t('s3Lang'), langSel, ''));

    var focusTa = document.createElement('textarea');
    focusTa.id = 'ex-focus';
    focusTa.className = 'input textarea';
    focusTa.rows = 3;
    focusTa.placeholder = t('s3FocusPh');
    focusTa.value = wiz.focus;
    focusTa.addEventListener('input', function () { wiz.focus = focusTa.value; saveWizard(); });
    card.appendChild(fieldRow(t('s3FocusLabel'), focusTa, t('s3FocusHint')));

    var perqLbl = el('label', 'set-row');
    var perq = document.createElement('input');
    perq.type = 'checkbox'; perq.checked = wiz.perQTimer;
    perq.addEventListener('change', function () {
      wiz.perQTimer = perq.checked;
      settings.perQTimer = perq.checked;
      saveSettings(); saveWizard();
    });
    perqLbl.appendChild(perq);
    perqLbl.appendChild(el('span', null, t('s3PerQ')));
    var perqRow = el('div', 'field');
    perqRow.appendChild(perqLbl);
    card.appendChild(perqRow);

    wrap.appendChild(card);
    wizardNav(wrap, { back: 2, next: 4, nextLabel: t('toGenerate') });
  }

  /* ----- Step 4: generate ----- */

  function renderStepGenerate(wrap) {
    var card = el('section', 'card');
    card.appendChild(el('p', 'kicker', t('kicker4')));
    card.appendChild(el('h2', null, t('s4Title')));
    var sum = el('div', 'gen-summary');
    sum.innerHTML =
      '<div><b>' + esc(t('s4Material')) + '</b> ' + esc(materialChars().toLocaleString()) + ' ' + esc(t('s4Chars')) +
      (material.pdfPages ? ' · ' + material.pdfPages + ' ' + esc(t('s4PdfPages')) : '') + '</div>' +
      '<div><b>' + esc(t('s4Provider')) + '</b> ' + esc(PROVIDERS[byok.provider].label) + ' · ' + esc(effectiveModel()) + '</div>' +
      '<div><b>' + esc(t('s4Exam')) + '</b> ' + esc(wiz.title || t('s4Untitled')) + ' · ' + wiz.count + ' ' + esc(t('s4QuestionsLabel')) + ' · ' +
      esc(questionTypeSummary()) + ' · ' + esc(localizedDifficulty(wiz.difficulty)) + ' · ' + esc(localizedLanguage(wiz.language)) + '</div>';
    card.appendChild(sum);
    if (sumState.data) {
      var sRow = document.createElement('div');
      sRow.innerHTML = '<b>' + esc(t('sumTitle')) + '</b> ' +
        esc(t('s4SummaryReady', { n: sumState.data.keyPoints.length, m: sumState.data.definitions.length }));
      sum.appendChild(sRow);
    }

    var genBtn = el('button', 'btn btn-primary btn-big', t('s4Generate'));
    genBtn.id = 'gen-btn';
    genBtn.addEventListener('click', function () { generateExam(); });
    var btnRow = el('div', 'btnrow');
    btnRow.appendChild(genBtn);
    if (sumState.data) {
      var viewSum = el('button', 'btn btn-secondary btn-big', t('sumView'));
      viewSum.id = 'view-summary-btn';
      viewSum.addEventListener('click', function () {
        showSummaryScreen({ kind: 'wizard', step: 4, backStep: 4 });
      });
      btnRow.appendChild(viewSum);
    }
    card.appendChild(btnRow);

    var prog = el('div', 'gen-progress');
    prog.id = 'gen-progress';
    card.appendChild(prog);
    var errBox = el('div', 'bank-error');
    errBox.id = 'gen-error';
    card.appendChild(errBox);
    var okBox = el('div', 'gen-success');
    okBox.id = 'gen-success';
    card.appendChild(okBox);

    wrap.appendChild(card);
    wizardNav(wrap, { back: 3, next: null });
    if (genState.error) showGenError(genState.error);
    if (genState.progress) {
      var pr = document.getElementById('gen-progress');
      if (pr) pr.textContent = genState.progress;
    }
  }

  function questionTypeSummary() {
    var parts = [];
    if (wiz.types.mcq) parts.push(t('typeMcqShort'));
    if (wiz.types.tf) parts.push(t('typeTfShort'));
    if (wiz.types.essay) parts.push(t('typeEssayShort'));
    if (wiz.types.fill) parts.push(t('typeFillShort'));
    if (wiz.types.coding) parts.push(t('typeCodingShort'));
    if (wiz.types.matching) parts.push(t('typeMatchingShort'));
    if (wiz.types.ordering) parts.push(t('typeOrderingShort'));
    return parts.join(' + ') || t('typeMcqShort');
  }

  function showGenError(msg) {
    genState.error = msg;
    var box = document.getElementById('gen-error');
    if (box) {
      box.textContent = msg;
      box.classList.add('show');
      var retry = document.createElement('button');
      retry.className = 'btn btn-secondary btn-small';
      retry.style.marginTop = '8px';
      retry.textContent = t('s4Retry');
      retry.addEventListener('click', function () { generateExam(); });
      box.appendChild(retry);
    }
  }

  function clearGenError() {
    genState.error = '';
    var box = document.getElementById('gen-error');
    if (box) { box.textContent = ''; box.classList.remove('show'); }
    var ok = document.getElementById('gen-success');
    if (ok) { ok.textContent = ''; ok.classList.remove('show'); }
  }

  /* ---------- provider calls ---------- */

  function plainError(e) {
    var msg = (e && e.message) || String(e || 'Unknown error');
    if (/401|unauthenticated|invalid api key|incorrect api key|invalid x-api-key/i.test(msg))
      return t('errKey');
    if (/402|insufficient_quota|quota|billing|exceeded/i.test(msg))
      return t('errQuota');
    if (/429|rate limit|too many requests/i.test(msg))
      return t('errRate');
    if (/404|not found|model_not_found/i.test(msg))
      return t('errModel', { model: effectiveModel() });
    if (/timed out|timeout/i.test(msg))
      return t('errTimeout');
    if (/Failed to fetch|NetworkError|network|CORS|cors/i.test(msg))
      return t('errNetwork');
    return msg;
  }

  function fetchWithTimeout(url, options, ms) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms || 120000);
    var opts = options || {};
    opts.signal = controller.signal;
    return fetch(url, opts).then(function (res) {
      clearTimeout(timer);
      return res;
    }).catch(function (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error(t('errTimeoutLong'));
      throw e;
    });
  }

  function extractJsonText(raw) {
    var t = String(raw || '').trim();
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/g, '').trim();
    return t;
  }

  function parseQuestionsResponse(rawText, partLabel) {
    var text = extractJsonText(rawText);
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(t('errBadJson', { label: partLabel ? ' (' + partLabel + ')' : '' }));
    }
    if (Array.isArray(data)) data = { questions: data };
    try {
      validate(data);
    } catch (e) {
      throw new Error(t('errBadFormat', {
        label: partLabel ? ' (' + partLabel + ')' : '',
        detail: e.message
      }));
    }
    return data.questions;
  }

  /* One model call. Returns the raw text of the model's reply.
     mode 'test' sends a tiny prompt; 'gen' sends the full exam prompt. */
  function callProvider(prompt, maxQuestions, mode) {
    /* Backstop for every provider call (generation, summary,
       translation, essay grading, connection test): never attempt a
       network call while offline — the caller shows this message. */
    if (isOffline()) return Promise.reject(new Error(t('offlineNeedNet')));
    var provider = byok.provider;
    var model = effectiveModel();
    var key = byok.apiKey;
    if (!key) return Promise.reject(new Error(t('errNoKey')));
    if (provider === 'claude' && !(byok.proxyUrl || '').trim()) {
      return Promise.reject(new Error(t('errClaudeProxy')));
    }

    if (provider === 'gemini') {
      var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
      return fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      }).then(function (res) { return readProviderResponse(res, 'Gemini'); })
      .then(function (data) {
        var text = data && data.candidates && data.candidates[0] &&
          data.candidates[0].content && data.candidates[0].content.parts &&
          data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
        if (!text) throw new Error(t('errEmptyReply', { who: 'Gemini' }));
        return text;
      });
    }

    if (provider === 'openai' || provider === 'custom') {
      var base = (provider === 'custom' ? (byok.baseUrl || PROVIDERS.custom.defaultBaseUrl) : 'https://api.openai.com/v1')
        .replace(/\/+$/, '');
      return fetchWithTimeout(base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        })
      }).then(function (res) { return readProviderResponse(res, provider === 'custom' ? 'Custom provider' : 'OpenAI'); })
      .then(function (data) {
        var text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!text) throw new Error(t('errEmptyReply', { who: provider === 'custom' ? 'Custom provider' : 'OpenAI' }));
        return text;
      });
    }

    // claude — always through the user's CORS proxy
    var proxy = (byok.proxyUrl || '').trim().replace(/\/+$/, '');
    return fetchWithTimeout(proxy + '/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    }).then(function (res) { return readProviderResponse(res, 'Claude'); })
    .then(function (data) {
      var text = data && data.content && data.content[0] && data.content[0].text;
      if (!text) throw new Error(t('errEmptyReply', { who: 'Claude' }));
      return text;
    });
  }

  function readProviderResponse(res, who) {
    if (res.ok) return res.json().catch(function () { return {}; });
    return res.text().then(function (body) {
      var detail = '';
      try {
        var j = JSON.parse(body);
        detail = (j.error && (j.error.message || j.error.type)) || j.message || '';
      } catch (e) { detail = body.slice(0, 200); }
      throw new Error(who + ' error (HTTP ' + res.status + ')' + (detail ? ': ' + detail : ''));
    });
  }

  /* ---------- exam translation (Feature 12) ----------
     One-tap translation of the exam CONTENT — not the UI language
     (the two are independent: translating the exam never calls
     setLang, and switching the UI language never re-translates).
     Translated: question text, options, explanations, essay rubrics,
     matching pairs (left + right) and ordering items. NEVER
     translated: code snippets (q.code), coding starterCode, test
     inputs / expected outputs, fill-in accepted answers, topics
     (they are the filter and stats keys) and the exam title /
     subtitle (they are the best-score / library identity). Options
     that are numbers, code or symbols must come back identical —
     the prompt says so, and the mock in the smoke test checks it.
     Translation is atomic: the strings go to the provider in small
     batches; if ANY batch fails, or any id comes back missing or
     empty, nothing is applied and the original stays intact. The
     answer key never moves — options keep their order, so the
     correct-option index, matching pairs, ordering items, fill-in
     answers and coding tests all still grade exactly as before. */
  var TR_BATCH = 20;

  function trDeepCopy(o) { return JSON.parse(JSON.stringify(o)); }

  function trLangName(code) { return code === 'ar' ? t('trLangArabic') : t('trLangEnglish'); }

  /* Source language by script: Arabic letters vs Latin letters in
     the translatable prose. Mixed banks follow the majority. */
  function detectExamLang(questions) {
    var ar = 0, lat = 0;
    (questions || []).forEach(function (q) {
      [q.question, q.explanation].concat(q.options || []).forEach(function (s) {
        String(s || '').split('').forEach(function (ch) {
          if (/[\u0600-\u06FF\u0750-\u077F]/.test(ch)) ar++;
          else if (/[A-Za-z]/.test(ch)) lat++;
        });
      });
    });
    return ar > lat ? 'ar' : 'en';
  }

  /* Every translatable string, each with a stable id. Anything not
     listed here is never sent to the provider, so it can never be
     translated by accident. */
  function collectTranslatables(questions) {
    var items = [];
    function add(id, val) {
      if (typeof val === 'string' && val.trim()) items.push({ id: id, text: val });
    }
    (questions || []).forEach(function (q, i) {
      add('q' + i + '.question', q.question);
      add('q' + i + '.explanation', q.explanation);
      (q.options || []).forEach(function (o, j) { add('q' + i + '.options.' + j, o); });
      add('q' + i + '.rubric', q.rubric);
      (q.pairs || []).forEach(function (p, j) {
        add('q' + i + '.pairs.' + j + '.left', p.left);
        add('q' + i + '.pairs.' + j + '.right', p.right);
      });
      (q.items || []).forEach(function (s, j) { add('q' + i + '.items.' + j, s); });
    });
    return items;
  }

  function buildTranslatePrompt(items, from, to) {
    var fromName = from === 'ar' ? 'Arabic' : 'English';
    var toName = to === 'ar' ? 'Arabic' : 'English';
    return 'You are a translator. Translate each "text" below from ' + fromName +
      ' to ' + toName + '. Reply with JSON ONLY — no markdown fences, no extra text. ' +
      'The JSON must be an object with "translations": an array of objects with "id" ' +
      '(exactly as given) and "text" (the translation). Translate every item, keep the ' +
      'same ids, and keep the same meaning and tone. Rules: do NOT translate code, ' +
      'variable names, numbers, symbols, or units — return those strings exactly as ' +
      'they are (for example "5", "a = 3, b = 9" or "True" / "False" stay unchanged ' +
      'unless the target language has its own standard words for them). Do NOT add ' +
      'explanations or extra items. Keep any blank written as ____ exactly as ____.' +
      '\n\nITEMS:\n' + JSON.stringify(items);
  }

  /* The provider reply must be {"translations":[{"id","text"}, ...]}
     (a bare {"id":"text"} map is also accepted). Every requested id
     must be present with a non-empty string, or the whole batch is
     rejected — a half-translated exam is never applied. */
  function parseTranslateResponse(raw, batch) {
    var data;
    try { data = JSON.parse(extractJsonText(raw)); }
    catch (e) { throw new Error(t('errBadJson', { label: '' })); }
    var map = {};
    if (data && Array.isArray(data.translations)) {
      data.translations.forEach(function (en) {
        if (en && typeof en.id === 'string' && typeof en.text === 'string') map[en.id] = en.text;
      });
    } else if (data && data.translations && typeof data.translations === 'object') {
      Object.keys(data.translations).forEach(function (k) {
        if (typeof data.translations[k] === 'string') map[k] = data.translations[k];
      });
    } else if (data && typeof data === 'object') {
      Object.keys(data).forEach(function (k) {
        if (typeof data[k] === 'string') map[k] = data[k];
      });
    }
    batch.forEach(function (it) {
      if (typeof map[it.id] !== 'string' || !map[it.id].trim()) {
        throw new Error(t('errBadFormat', { label: '', detail: 'missing translation for ' + it.id }));
      }
    });
    return map;
  }

  function applyTranslations(questions, map) {
    function get(id) { return map[id]; }
    questions.forEach(function (q, i) {
      if (get('q' + i + '.question') !== undefined) q.question = get('q' + i + '.question');
      if (get('q' + i + '.explanation') !== undefined) q.explanation = get('q' + i + '.explanation');
      (q.options || []).forEach(function (o, j) {
        if (get('q' + i + '.options.' + j) !== undefined) q.options[j] = get('q' + i + '.options.' + j);
      });
      if (q.rubric && get('q' + i + '.rubric') !== undefined) q.rubric = get('q' + i + '.rubric');
      (q.pairs || []).forEach(function (p, j) {
        if (get('q' + i + '.pairs.' + j + '.left') !== undefined) p.left = get('q' + i + '.pairs.' + j + '.left');
        if (get('q' + i + '.pairs.' + j + '.right') !== undefined) p.right = get('q' + i + '.pairs.' + j + '.right');
      });
      (q.items || []).forEach(function (s, j) {
        if (get('q' + i + '.items.' + j) !== undefined) q.items[j] = get('q' + i + '.items.' + j);
      });
    });
  }

  function translateButtonLabel() {
    if (trState.lang) {
      return t('trShowOriginal', { lang: trLangName(trState.sourceLang || 'en') });
    }
    var src = quiz ? detectExamLang(quiz.questions) : 'en';
    return src === 'ar' ? t('trToEnglish') : t('trToArabic');
  }

  /* Toggle between the original exam and its translation. Resolves
     {ok, message}. On translate: no key -> clear message, no call;
     any provider failure -> original intact, no partial exam. On
     restore: the stored original is swapped back exactly. */
  function toggleTranslation() {
    if (!quiz || !quiz.questions || !quiz.questions.length) {
      return Promise.resolve({ ok: false, message: t('trFailed', { detail: '' }) });
    }
    if (trState.busy) return Promise.resolve({ ok: false, message: t('trTranslating') });
    if (trState.lang) {
      var srcLang = trState.sourceLang || 'en';
      quiz.questions = trDeepCopy(trState.original);
      trState.translated = null; trState.lang = null; trState.sourceLang = null;
      return Promise.resolve({ ok: true, message: t('trRestored', { lang: trLangName(srcLang) }) });
    }
    if (!byok.apiKey) return Promise.resolve({ ok: false, message: t('trNoKey') });
    if (isOffline()) return Promise.resolve({ ok: false, message: t('offlineNeedNet') });
    var source = detectExamLang(quiz.questions);
    var target = source === 'ar' ? 'en' : 'ar';
    var items = collectTranslatables(quiz.questions);
    if (!items.length) return Promise.resolve({ ok: false, message: t('trFailed', { detail: '' }) });
    trState.busy = true;
    var batches = [];
    for (var i = 0; i < items.length; i += TR_BATCH) batches.push(items.slice(i, i + TR_BATCH));
    var merged = {};
    var chain = Promise.resolve();
    batches.forEach(function (batch) {
      chain = chain.then(function () {
        return callProvider(buildTranslatePrompt(batch, source, target), 1, 'translate')
          .then(function (raw) {
            var map = parseTranslateResponse(raw, batch);
            batch.forEach(function (it) { merged[it.id] = map[it.id]; });
          });
      });
    });
    return chain.then(function () {
      var translated = trDeepCopy(quiz.questions);
      applyTranslations(translated, merged);
      trState.original = trDeepCopy(quiz.questions);
      trState.translated = trDeepCopy(translated);
      trState.lang = target; trState.sourceLang = source; trState.bank = quiz;
      quiz.questions = translated;
      trState.busy = false;
      return { ok: true, message: t('trDone', { lang: trLangName(target) }) };
    }).catch(function (e) {
      trState.busy = false;
      return { ok: false, message: t('trFailed', { detail: plainError(e) }) };
    });
  }

  /* The button for the start and results screens. After a successful
     toggle the current screen is re-rendered so every question text
     updates; after a failure the button just gets its label back and
     the exam is untouched. */
  function addTranslateButton(rowEl) {
    if (!quiz || !quiz.questions || !quiz.questions.length) return null;
    var b = el('button', 'btn btn-secondary btn-big', translateButtonLabel());
    b.id = 'translate-exam-btn';
    b.addEventListener('click', function () {
      if (trState.busy) return;
      b.disabled = true;
      var oldLabel = b.textContent;
      b.textContent = t('trTranslating');
      toggleTranslation().then(function (res) {
        b.disabled = false;
        if (res && res.ok) {
          showToast(res.message);
          if (run && run.resultsShown) showResults();
          else if (!run) showStart();
          else renderQuestion();
        } else if (res) {
          showToast(res.message, true);
          b.textContent = oldLabel;
        }
      }).catch(function (e) {
        b.disabled = false;
        b.textContent = oldLabel;
        showToast(t('trFailed', { detail: plainError(e) }), true);
      });
    });
    rowEl.appendChild(b);
    return b;
  }

  window.__qfTranslate = {
    state: function () { return trState; },
    toggle: toggleTranslation,
    detect: detectExamLang,
    collect: collectTranslatables,
    apply: applyTranslations,
    parse: parseTranslateResponse,
    label: translateButtonLabel
  };

  /* ---------- generation ---------- */

  function splitChunks(text) {
    if (text.length <= CHUNK_CHARS) return [text];
    var paras = text.split(/\n\s*\n/);
    var chunks = [];
    var cur = '';
    paras.forEach(function (para) {
      if (!para.trim()) return;
      if (cur && (cur.length + para.length + 2) > CHUNK_CHARS) {
        chunks.push(cur);
        cur = para;
      } else {
        cur = cur ? cur + '\n\n' + para : para;
      }
    });
    if (cur) chunks.push(cur);
    // A single giant paragraph still gets hard-split.
    var out = [];
    chunks.forEach(function (c) {
      while (c.length > CHUNK_CHARS) {
        var cut = c.lastIndexOf(' ', CHUNK_CHARS);
        if (cut < 1000) cut = CHUNK_CHARS;
        out.push(c.slice(0, cut));
        c = c.slice(cut).trim();
      }
      if (c) out.push(c);
    });
    return out;
  }

  function buildPrompt(chunkText, nQuestions, chunkLabel) {
    var types = [];
    if (wiz.types.mcq) types.push('multiple-choice questions with exactly 4 options');
    if (wiz.types.tf) types.push('True/False questions with exactly 2 options: "True" and "False"');
    if (wiz.types.essay) types.push('essay questions: a free-text question with a short grading rubric and a "maxScore" of 5');
    if (wiz.types.fill) types.push('fill-in-the-blank questions: a sentence with exactly one blank written as ____, plus an "answers" array of accepted answers');
    if (wiz.types.coding) types.push('coding questions in JavaScript ONLY: a programming task with "language" set to "JavaScript", "starterCode" (the code the student starts from), and "tests" (an array of objects with "input" — a JavaScript expression that calls the student\'s function, e.g. "sum(2, 3)" — and "expected" — the exact expected result as a string, e.g. "5"). Never use any other language.');
    if (wiz.types.matching) types.push('matching questions: two columns to connect, with "pairs" (an array of 3–5 objects, each with "left" — a term — and "right" — its correct partner, e.g. a definition). The left and right values must each be unique within the question.');
    if (wiz.types.ordering) types.push('ordering questions: a list of steps to put in order, with "items" (an array of 4–6 short strings in the CORRECT order, e.g. the steps of a process from first to last). Every item must be unique.');
    var typeText = types.join(' and ');
    var diffText = wiz.difficulty === 'Mixed'
      ? 'a mix of Easy, Medium and Hard questions'
      : wiz.difficulty + ' questions';
    var schema = 'Each question must have: "question" (string), "type" ("mcq", "tf", "essay", "fill", "coding", "matching" or "ordering"), ' +
      '"explanation" (string), "topic" (short string, e.g. a chapter or sub-topic), ' +
      '"difficulty" ("Easy", "Medium" or "Hard"). ' +
      'Multiple-choice and True/False questions ALSO need "options" (array of ' +
      (wiz.types.mcq && wiz.types.tf ? '4 strings for multiple-choice or 2 strings ("True","False") for True/False' :
        wiz.types.tf ? '2 strings: "True" and "False"' : '4 strings') +
      ') and "answer" (0-based index of the correct option). ' +
      'Essay questions need "rubric" (a short grading rubric string) and "maxScore" (a number, use 5), ' +
      'and must NOT have "options" or "answer". ' +
      'Fill-in-the-blank questions need "answers" (an array of 2–4 accepted answers for the blank, ' +
      'e.g. the word with and without an article), and must NOT have "options" or "answer". ' +
      'Coding questions need "language" ("JavaScript"), "starterCode" (a string with the starting code, ' +
      'e.g. "function sum(a, b) {\\n  // write your code here\\n}"), and "tests" (an array of 2–4 objects, ' +
      'each with "input" — a JavaScript expression calling the function, e.g. "sum(2, 3)" — and "expected" ' +
      '— the exact result as a string, e.g. "5"), and must NOT have "options" or "answer". ' +
      'Matching questions need "pairs" (an array of 3–5 objects, each with "left" and "right" strings — ' +
      'the "right" is the correct partner for that "left"), and must NOT have "options" or "answer". ' +
      'Ordering questions need "items" (an array of 4–6 strings in the CORRECT order), and must NOT ' +
      'have "options" or "answer". ' +
      'Optionally "code" (a short code snippet string) only if the question is about code.';
    return 'You are an exam writer. Write ' + nQuestions + ' ' + typeText +
      ' in ' + wiz.language + ' based ONLY on the material below' +
      (chunkLabel ? ' (' + chunkLabel + ')' : '') + '. ' +
      'Difficulty: ' + diffText + '.' +
      (wiz.focus ? ' Focus notes from the teacher: ' + wiz.focus + '.' : '') +
      ' Every question must be answerable from the material, have exactly one correct answer, ' +
      'and include a short explanation of why the answer is correct.' +
      '\n\nReply with JSON ONLY — no markdown fences, no extra text. The JSON must be an object with a "questions" array. ' +
      schema +
      '\n\nMATERIAL:\n' + chunkText;
  }

  /* ---------- material summary (Feature 9) ----------
     Same provider, same key, same chunking as exam generation
     (splitChunks). The reply is JSON: key points + term definitions,
     both taken ONLY from the material — never invented. */

  function buildSummaryPrompt(chunkText, chunkLabel) {
    return 'You are a study assistant. Summarize the material below' +
      (chunkLabel ? ' (' + chunkLabel + ')' : '') + ' in ' + wiz.language + '. ' +
      'Reply with JSON ONLY — no markdown fences, no extra text. ' +
      'The JSON must be an object with "keyPoints" (an array of 5–8 short strings, ' +
      'each one key idea from the material) and "definitions" (an array of objects ' +
      'with "term" and "definition", one per important term in the material). ' +
      'Base everything ONLY on the material below — do not invent facts, terms ' +
      'or definitions that are not in it. If the material defines no terms, ' +
      'use an empty "definitions" array.\n\nMATERIAL:\n' + chunkText;
  }

  function parseSummaryResponse(rawText, partLabel) {
    var data;
    try { data = JSON.parse(extractJsonText(rawText)); }
    catch (e) { throw new Error(t('errBadJson', { label: partLabel ? ' (' + partLabel + ')' : '' })); }
    var points = (data && Array.isArray(data.keyPoints) ? data.keyPoints : [])
      .filter(function (s) { return typeof s === 'string' && s.trim(); })
      .map(function (s) { return s.trim(); });
    var defs = (data && Array.isArray(data.definitions) ? data.definitions : [])
      .filter(function (d) {
        return d && typeof d.term === 'string' && d.term.trim() &&
          typeof d.definition === 'string' && d.definition.trim();
      })
      .map(function (d) { return { term: d.term.trim(), definition: d.definition.trim() }; });
    if (!points.length && !defs.length) throw new Error(t('sumEmpty'));
    return { keyPoints: points, definitions: defs };
  }

  function generateSummary() {
    if (sumState.busy) return;
    if (isOffline()) {
      sumState.error = t('offlineNeedNet');
      updateSumStatus();
      return;
    }
    var fullText = (material.text + (material.pasted ? '\n\n' + material.pasted : '')).trim();
    if (!fullText) {
      sumState.error = t('sumNoMaterial');
      updateSumStatus();
      return;
    }
    if (!byok.apiKey) {
      /* No key, no summary — a clear message, never invented content. */
      sumState.error = t('sumNoKey');
      updateSumStatus();
      return;
    }
    sumState.busy = true;
    sumState.error = '';
    var box = document.getElementById('sum-status');
    var btn = document.getElementById('sum-btn');
    if (btn) btn.disabled = true;
    var chunks = splitChunks(fullText);
    var mergedPoints = [];
    var mergedDefs = [];
    var seenPoints = {};
    var seenTerms = {};
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, i) {
      chain = chain.then(function () {
        if (box) {
          box.className = 'gen-progress';
          box.textContent = t('sumGenerating', { i: i + 1, n: chunks.length });
        }
        var label = chunks.length > 1 ? 'part ' + (i + 1) + ' of ' + chunks.length + ' of the material' : '';
        return callProvider(buildSummaryPrompt(chunk, label), 1, 'summary');
      }).then(function (raw) {
        var part = parseSummaryResponse(raw, chunks.length > 1 ? 'part ' + (i + 1) : '');
        part.keyPoints.forEach(function (p) {
          var k = p.toLowerCase();
          if (!seenPoints[k]) { seenPoints[k] = true; mergedPoints.push(p); }
        });
        part.definitions.forEach(function (d) {
          var k = d.term.toLowerCase();
          if (!seenTerms[k]) { seenTerms[k] = true; mergedDefs.push(d); }
        });
      });
    });
    chain.then(function () {
      sumState.data = {
        keyPoints: mergedPoints.slice(0, 12),
        definitions: mergedDefs.slice(0, 20)
      };
      sumState.busy = false;
      updateSumStatus();
      refreshFileList();
      showSummaryScreen({ kind: 'wizard', step: 3, backStep: 1 });
    }).catch(function (e) {
      sumState.busy = false;
      sumState.error = (e.message === t('sumEmpty')) ? t('sumEmpty')
        : t('sumFail', { detail: plainError(e) });
      updateSumStatus();
      refreshFileList();
    });
  }

  /* The summary's own screen: key points, then term definitions.
     From the wizard it continues to exam settings (step 3, or back to
     step 4 when opened from the generate step); from an exam start
     screen it goes back to that exam. */
  function showSummaryScreen(ret) {
    if (ret) sumReturn = ret;
    var data = sumState.data || (quiz && quiz.summary);
    if (!data || !Array.isArray(data.keyPoints)) return;
    currentView = 'summary';
    app.innerHTML = '';
    var wrap = el('div');
    var card = el('section', 'card sum-card');
    card.appendChild(el('p', 'kicker', t('sumKicker')));
    card.appendChild(el('h2', null, t('sumTitle')));
    card.appendChild(el('p', 'hero-text', t('sumHint')));
    card.appendChild(el('h3', 'sum-sec', t('sumKeyPoints')));
    var ul = el('ul', 'sum-list');
    data.keyPoints.forEach(function (p) { ul.appendChild(el('li', null, p)); });
    card.appendChild(ul);
    if (data.definitions && data.definitions.length) {
      card.appendChild(el('h3', 'sum-sec', t('sumTerms')));
      var dl = document.createElement('dl');
      dl.className = 'sum-defs';
      data.definitions.forEach(function (d) {
        dl.appendChild(el('dt', null, d.term));
        dl.appendChild(el('dd', null, d.definition));
      });
      card.appendChild(dl);
    }
    if (sumReturn.kind === 'start') card.appendChild(el('p', 'field-hint', t('sumSavedNote')));
    var row = el('div', 'btnrow');
    if (sumReturn.kind === 'wizard' && sumReturn.step === 3) {
      var cont = el('button', 'btn btn-primary btn-big', t('sumContinue'));
      cont.id = 'sum-continue-btn';
      cont.addEventListener('click', function () {
        wiz.step = 3; saveWizard(); renderWizard();
      });
      row.appendChild(cont);
    }
    var back = el('button', 'btn btn-secondary btn-big',
      sumReturn.kind === 'start' ? t('sumBackStart')
        : (sumReturn.backStep === 4 ? t('sumBackGen') : t('sumBack')));
    back.id = 'sum-back-btn';
    back.addEventListener('click', function () {
      if (sumReturn.kind === 'start') showStart();
      else { wiz.step = sumReturn.backStep; saveWizard(); renderWizard(); }
    });
    row.appendChild(back);
    card.appendChild(row);
    wrap.appendChild(card);
    app.appendChild(wrap);
    window.scrollTo({ top: 0 });
  }

  /* ---------- essay grading (Feature 6) ----------
     One extra model call per essay answer. Returns a promise of
     {score, maxScore, feedback}. Never invents a grade: with no key
     it rejects with '__NOKEY__', and any other failure rejects too —
     the caller shows the rubric instead of a fake score. */
  function gradeEssay(q, answerText) {
    if (!byok.apiKey) return Promise.reject(new Error('__NOKEY__'));
    if (isOffline()) return Promise.reject(new Error(t('offlineNeedNet')));
    var max = essayMax(q);
    var prompt = 'You are a strict but fair exam grader. Grade the student answer below ' +
      'against the rubric. Reply with JSON ONLY — no markdown fences, no extra text. ' +
      'The JSON must be an object with "score" (a whole number from 0 to ' + max + '), ' +
      '"maxScore" (' + max + ') and "feedback" (1–2 short sentences in ' +
      (wiz.language || 'English') + ' explaining the score).\n\n' +
      'QUESTION: ' + q.question + '\n' +
      'RUBRIC: ' + q.rubric + '\n' +
      'MAX SCORE: ' + max + '\n' +
      'STUDENT ANSWER: ' + answerText;
    return callProvider(prompt, 1, 'grade').then(function (raw) {
      var data;
      try { data = JSON.parse(extractJsonText(raw)); }
      catch (e) { throw new Error(t('errBadJson', { label: '' })); }
      var score = Number(data && data.score);
      var fb = data && typeof data.feedback === 'string' ? data.feedback.trim() : '';
      if (isNaN(score) || !fb) throw new Error(t('errBadJson', { label: '' }));
      score = Math.max(0, Math.min(max, Math.round(score)));
      return { score: score, maxScore: max, feedback: fb };
    });
  }

  /* ---------- coding questions: in-browser test runner (Feature 10) ----------
     JavaScript ONLY — no other language can run reliably in this static
     app, and the UI and validator say so plainly. Student code runs in
     a Web Worker built from a Blob URL: the worker has no DOM and no
     access to the page or to QuizForge's own state, and the main thread
     kills it (worker.terminate) if it does not answer within
     CODE_TIMEOUT_MS — so an infinite loop is stopped instead of
     hanging the page. If Workers are unavailable (some file://
     contexts), the same runner runs synchronously on the main thread
     as a fallback, and the user is warned that a loop may freeze the
     page there. A test's "input" is a JavaScript expression that calls
     the student's function (e.g. "sum(2, 3)"); "expected" is the exact
     result as a string. console.log output counts when the expression
     itself returns undefined. */
  var CODE_TIMEOUT_MS = 3000;

  var CODE_RUNNER_SRC = [
    'function fmt(v){',
    '  if(v===undefined) return "undefined";',
    '  if(v===null) return "null";',
    '  if(typeof v==="string") return v;',
    '  try{ var j=JSON.stringify(v); return j===undefined?String(v):j; }',
    '  catch(e){ return String(v); }',
    '}',
    'function runOne(code, input, logs){',
    '  logs.length=0;',
    '  var fakeConsole={',
    '    log:function(){ var a=[]; for(var i=0;i<arguments.length;i++){a.push(fmt(arguments[i]));} logs.push(a.join(" ")); },',
    '    error:function(){ var a=[]; for(var i=0;i<arguments.length;i++){a.push(fmt(arguments[i]));} logs.push(a.join(" ")); },',
    '    warn:function(){ var a=[]; for(var i=0;i<arguments.length;i++){a.push(fmt(arguments[i]));} logs.push(a.join(" ")); }',
    '  };',
    '  try{',
    '    var f=new Function("console", code+"\\n;return ("+input+");");',
    '    var r=f(fakeConsole);',
    '    var actual=(r===undefined)?(logs.length?logs.join("\\n"):"undefined"):fmt(r);',
    '    return { actual: actual };',
    '  }catch(err){ return { error: String((err&&err.message)||err) }; }',
    '}',
    'self.onmessage=function(e){',
    '  var d=e.data||{}; var tests=d.tests||[]; var out=[];',
    '  for(var i=0;i<tests.length;i++){',
    '    var logs=[];',
    '    var res=runOne(d.code||"", tests[i].input||"", logs);',
    '    var expected=String(tests[i].expected==null?"":tests[i].expected).trim();',
    '    var actual=(res.error!==undefined)?"":String(res.actual).trim();',
    '    var passed=res.error===undefined&&actual===expected;',
    '    out.push({ input: tests[i].input, expected: tests[i].expected,',
    '      actual: res.error!==undefined?"":res.actual, passed: passed,',
    '      error: res.error||null });',
    '  }',
    '  self.postMessage({ results: out });',
    '};'
  ].join('\n');

  /* Same runner, on the main thread — only used when Workers cannot
     start. Identical logic to the worker above; keep both in sync. */
  function fmtCodeValue(v) {
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'string') return v;
    try {
      var j = JSON.stringify(v);
      return j === undefined ? String(v) : j;
    } catch (e) { return String(v); }
  }

  function runTestsSync(code, tests) {
    return (tests || []).map(function (tc) {
      var logs = [];
      var fakeConsole = {
        log: function () { logs.push(Array.prototype.map.call(arguments, fmtCodeValue).join(' ')); },
        error: function () { logs.push(Array.prototype.map.call(arguments, fmtCodeValue).join(' ')); },
        warn: function () { logs.push(Array.prototype.map.call(arguments, fmtCodeValue).join(' ')); }
      };
      try {
        var f = new Function('console', code + '\n;return (' + (tc.input || '') + ');');
        var r = f(fakeConsole);
        var actual = (r === undefined) ? (logs.length ? logs.join('\n') : 'undefined') : fmtCodeValue(r);
        var expected = String(tc.expected == null ? '' : tc.expected).trim();
        return { input: tc.input, expected: tc.expected, actual: actual,
          passed: String(actual).trim() === expected, error: null };
      } catch (err) {
        return { input: tc.input, expected: tc.expected, actual: '',
          passed: false, error: String((err && err.message) || err) };
      }
    });
  }

  /* Run the student's code against the question's tests. Always
     resolves — never rejects — with {results, passed, total,
     timedOut, fallback}. timedOut means the worker was killed after
     CODE_TIMEOUT_MS (infinite loop); fallback means Workers were
     unavailable and the code ran on the main thread. */
  function runCodeTests(q, code) {
    var tests = (q.tests || []).slice();
    function finish(results, timedOut, fallback) {
      var passed = results.filter(function (r) { return r.passed; }).length;
      return { results: results, passed: passed, total: tests.length,
        timedOut: !!timedOut, fallback: !!fallback };
    }
    function blankResults() {
      return tests.map(function (tc) {
        return { input: tc.input, expected: tc.expected, actual: '', passed: false, error: null };
      });
    }
    var worker = null;
    try {
      var blob = new Blob([CODE_RUNNER_SRC], { type: 'text/javascript' });
      worker = new Worker(URL.createObjectURL(blob));
    } catch (e) { worker = null; }
    if (!worker) {
      var res;
      try { res = runTestsSync(code, tests); }
      catch (e) { res = blankResults(); }
      return Promise.resolve(finish(res, false, true));
    }
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { worker.terminate(); } catch (e) {}
        resolve(finish(blankResults(), true, false));
      }, CODE_TIMEOUT_MS);
      worker.onmessage = function (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (err) {}
        resolve(finish((e.data && e.data.results) || [], false, false));
      };
      worker.onerror = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch (err) {}
        var res2;
        try { res2 = runTestsSync(code, tests); } catch (err2) { res2 = blankResults(); }
        resolve(finish(res2, false, true));
      };
      try {
        worker.postMessage({ code: code, tests: tests });
      } catch (err) {
        clearTimeout(timer);
        try { worker.terminate(); } catch (e2) {}
        resolve(finish(runTestsSync(code, tests), false, true));
      }
    });
  }

  /* Test/debug handle for coding questions. */
  window.__qfCoding = {
    qType: qType, runCodeTests: runCodeTests, runTestsSync: runTestsSync,
    timeoutMs: CODE_TIMEOUT_MS, validate: validate
  };

  /* Test/debug handle for the summary (Feature 9). */
  window.__qfSummary = {
    generateSummary: generateSummary,
    showSummaryScreen: showSummaryScreen,
    buildSummaryPrompt: buildSummaryPrompt,
    parseSummaryResponse: parseSummaryResponse,
    state: function () { return sumState; }
  };

  /* Test/debug handle for the new types. */
  window.__qfEssay = {
    qType: qType, gradeFill: gradeFill, normalizeFill: normalizeFill,
    essayMax: essayMax, essayPass: essayPass, gradeEssay: gradeEssay
  };

  function generateExam() {
    if (genState.busy) return;
    clearGenError();
    if (isOffline()) { showGenError(t('offlineNeedNet')); return; }
    var fullText = (material.text + (material.pasted ? '\n\n' + material.pasted : '')).trim();
    if (!fullText) { showGenError(t('errNoMaterial')); return; }
    if (!byok.apiKey) { showGenError(t('errNeedKey')); return; }
    genState.busy = true;
    var btn = document.getElementById('gen-btn');
    if (btn) btn.disabled = true;
    var prog = document.getElementById('gen-progress');

    var chunks = splitChunks(fullText);
    var totalWanted = wiz.count;
    // At least 1 question per chunk when possible, split proportionally.
    var perChunk = chunks.map(function (c) {
      return Math.max(1, Math.round(totalWanted * c.length / fullText.length));
    });
    var allQuestions = [];
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, i) {
      chain = chain.then(function () {
        genState.progress = t('s4Generating', { i: i + 1, n: chunks.length });
        if (prog) prog.textContent = genState.progress;
        var label = chunks.length > 1 ? 'part ' + (i + 1) + ' of ' + chunks.length + ' of the material' : '';
        return callProvider(buildPrompt(chunk, perChunk[i], label), perChunk[i], 'gen');
      }).then(function (raw) {
        var qs = parseQuestionsResponse(raw, chunks.length > 1 ? 'part ' + (i + 1) : '');
        allQuestions = allQuestions.concat(qs);
      });
    });

    chain.then(function () {
      // Dedupe by normalised question text, then shuffle.
      var seen = {};
      var deduped = allQuestions.filter(function (q) {
        var k = q.question.trim().toLowerCase();
        if (seen[k]) return false;
        seen[k] = true;
        return true;
      });
      shuffle(deduped);
      var title = (wiz.title || '').trim() || t('genDefaultTitle');
      var bank = {
        title: title,
        subtitle: t('genSub', {
          n: deduped.length,
          provider: PROVIDERS[byok.provider].label,
          model: effectiveModel(),
          difficulty: localizedDifficulty(wiz.difficulty),
          language: localizedLanguage(wiz.language)
        }),
        questions: deduped
      };
      /* Feature 9: the summary travels with its exam so it can be
         re-read later from the exam start screen. */
      if (sumState.data) bank.summary = sumState.data;
      validate(bank);
      var lib = loadLibrary();
      lib.unshift({
        id: 'gen-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
        title: title,
        subtitle: bank.subtitle,
        date: new Date().toISOString().slice(0, 10),
        count: deduped.length,
        provider: PROVIDERS[byok.provider].label,
        model: effectiveModel(),
        bank: bank
      });
      saveLibrary(lib);
      genState.lastBank = bank;
      genState.progress = '';
      if (prog) prog.textContent = '';
      var ok = document.getElementById('gen-success');
      if (ok) {
        ok.textContent = t('s4Ready', { n: deduped.length });
        ok.classList.add('show');
        var take = document.createElement('button');
        take.className = 'btn btn-primary btn-big';
        take.style.marginTop = '10px';
        take.textContent = t('s4TakeNow');
        take.addEventListener('click', function () { loadBank(bank); });
        ok.appendChild(take);
      }
      if (btn) btn.disabled = false;
      genState.busy = false;
    }).catch(function (e) {
      genState.busy = false;
      genState.progress = '';
      if (prog) prog.textContent = '';
      if (btn) btn.disabled = false;
      showGenError(plainError(e));
    });
  }

  /* ---------- library (My exams) ---------- */

  function renderLibrary() {
    app.innerHTML = '';
    var wrap = el('div');
    var head = el('section', 'card');
    head.appendChild(el('p', 'kicker', t('libKicker')));
    head.appendChild(el('h2', null, t('libTitle')));
    head.appendChild(el('p', 'hero-text', t('libHero')));
    var row = el('div', 'btnrow');
    var createBtn = el('button', 'btn btn-primary', t('libCreate'));
    createBtn.addEventListener('click', function () { setView('create'); });
    row.appendChild(createBtn);
    var impLbl = el('label', 'file-label', t('libImport'));
    var impInput = document.createElement('input');
    impInput.type = 'file';
    impInput.accept = '.json,application/json';
    impInput.addEventListener('change', function () {
      if (impInput.files && impInput.files[0]) importBankFile(impInput.files[0]);
      impInput.value = '';
    });
    impLbl.appendChild(impInput);
    row.appendChild(impLbl);
    var expLibBtn = el('button', 'btn btn-secondary', t('libExportLib'));
    expLibBtn.addEventListener('click', function () { exportLibrary(); });
    row.appendChild(expLibBtn);
    var impLibLbl = el('label', 'file-label', t('libImportLib'));
    var impLibInput = document.createElement('input');
    impLibInput.type = 'file';
    impLibInput.accept = '.json,application/json';
    impLibInput.addEventListener('change', function () {
      if (impLibInput.files && impLibInput.files[0]) importLibraryFile(impLibInput.files[0]);
      impLibInput.value = '';
    });
    impLibLbl.appendChild(impLibInput);
    row.appendChild(impLibLbl);
    head.appendChild(row);
    var impErr = el('div', 'bank-error');
    impErr.id = 'import-error';
    head.appendChild(impErr);
    var backupOk = el('div', 'gen-success');
    backupOk.id = 'backup-status';
    head.appendChild(backupOk);
    wrap.appendChild(head);

    // Demo bank card — no key needed
    if (sampleQuiz) {
      var demo = el('section', 'card lib-card demo-card');
      demo.appendChild(el('p', 'kicker', t('libDemoKicker')));
      demo.appendChild(el('h3', null, sampleQuiz.title || t('libDemoTitle')));
      demo.appendChild(el('p', 'muted', sampleQuiz.subtitle || t('qCount', { n: sampleQuiz.questions.length })));
      var drow = el('div', 'btnrow');
      var takeDemo = el('button', 'btn btn-primary', t('libDemoTake'));
      takeDemo.addEventListener('click', function () { loadBank(sampleQuiz); });
      drow.appendChild(takeDemo);
      var printDemo = el('button', 'btn btn-secondary', t('printBtn'));
      printDemo.addEventListener('click', function () { printExam(sampleQuiz); });
      drow.appendChild(printDemo);
      var ansDemo = el('button', 'btn btn-secondary', t('ansBtn'));
      ansDemo.addEventListener('click', function () { printAnswerSheet(sampleQuiz); });
      drow.appendChild(ansDemo);
      var shareDemo = el('button', 'btn btn-secondary', t('shareBtn'));
      shareDemo.addEventListener('click', function () { shareExam(sampleQuiz, drow); });
      drow.appendChild(shareDemo);
      addFlashcardsButton(sampleQuiz, drow);
      addReviewButton(sampleQuiz, drow, false);
      demo.appendChild(drow);
      wrap.appendChild(demo);
    }

    var lib = loadLibrary();
    if (!lib.length) {
      var empty = el('section', 'card');
      empty.appendChild(el('p', 'muted', t('libEmpty')));
      wrap.appendChild(empty);
    }
    lib.forEach(function (entry) {
      var card = el('section', 'card lib-card');
      card.appendChild(el('h3', null, entry.title));
      card.appendChild(el('p', 'muted',
        t('qCount', { n: entry.count }) + ' · ' + entry.date +
        (entry.provider && entry.provider !== 'import' && entry.provider !== 'shared' ? ' · ' + entry.provider + (entry.model ? ' (' + entry.model + ')' : '') : ' · ' + t('libImported'))));
      var r = el('div', 'btnrow');
      var take = el('button', 'btn btn-primary', t('libTake'));
      take.addEventListener('click', function () { loadBank(entry.bank); });
      r.appendChild(take);
      var exp = el('button', 'btn btn-secondary', t('libExport'));
      exp.addEventListener('click', function () { exportBank(entry); });
      r.appendChild(exp);
      var prt = el('button', 'btn btn-secondary', t('printBtn'));
      prt.addEventListener('click', function () { printExam(entry.bank); });
      r.appendChild(prt);
      var ans = el('button', 'btn btn-secondary', t('ansBtn'));
      ans.addEventListener('click', function () { printAnswerSheet(entry.bank); });
      r.appendChild(ans);
      var shr = el('button', 'btn btn-secondary', t('shareBtn'));
      shr.addEventListener('click', function () { shareExam(entry.bank, r); });
      r.appendChild(shr);
      addFlashcardsButton(entry.bank, r);
      addReviewButton(entry.bank, r, false);
      var del = el('button', 'btn btn-secondary', t('libDelete'));
      del.addEventListener('click', function () {
        saveLibrary(loadLibrary().filter(function (x) { return x.id !== entry.id; }));
        renderLibrary();
      });
      r.appendChild(del);
      card.appendChild(r);
      wrap.appendChild(card);
    });

    app.appendChild(wrap);
    updateLibCount();
  }

  function importBankFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var errBox = document.getElementById('import-error');
      try {
        var data = JSON.parse(String(reader.result || ''));
        validate(data);
        var lib = loadLibrary();
        lib.unshift({
          id: 'imp-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
          title: data.title || file.name.replace(/\.json$/i, ''),
          subtitle: data.subtitle || t('libImportedBank', { n: data.questions.length }),
          date: new Date().toISOString().slice(0, 10),
          count: data.questions.length,
          provider: 'import',
          model: '',
          bank: data
        });
        saveLibrary(lib);
        renderLibrary();
      } catch (e) {
        if (errBox) {
          errBox.textContent = t('libImportErr', { msg: e.message + t('libImportHint') });
          errBox.classList.add('show');
        }
      }
    };
    reader.onerror = function () {
      var errBox = document.getElementById('import-error');
      if (errBox) {
        errBox.textContent = t('libReadErr');
        errBox.classList.add('show');
      }
    };
    reader.readAsText(file);
  }

  function exportBank(entry) {
    var blob = new Blob([JSON.stringify(entry.bank, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (entry.title || 'exam').replace(/[^a-z0-9-_]+/gi, '-').toLowerCase() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  /* ---------- whole-library backup (Feature 16) ----------
     One JSON file holds the entire library: every saved exam with
     its bank (questions, and the material summary when the exam has
     one), plus a version marker and an export date, so the file can
     be recognised on import and moved to another device or browser.
     Import validates every exam with validate() and merges: exams
     whose id is already in the library are skipped, the rest are
     added. A corrupt file, a non-backup file, or a file with zero
     valid exams changes nothing and shows a clear error — the
     existing library is only written once the new exams are known
     good, so a failed import can never wipe it. */
  var BACKUP_VERSION = 1;

  function buildBackup() {
    return {
      quizforgeBackup: true,
      version: BACKUP_VERSION,
      app: 'QuizForge',
      exportedAt: new Date().toISOString(),
      exams: loadLibrary()
    };
  }

  function downloadJson(data, filename) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  }

  function exportLibrary() {
    var errBox = document.getElementById('import-error');
    var okBox = document.getElementById('backup-status');
    var lib = loadLibrary();
    if (!lib.length) {
      if (errBox) {
        errBox.textContent = t('libBackupEmpty');
        errBox.classList.add('show');
      }
      if (okBox) okBox.classList.remove('show');
      return null;
    }
    var data = buildBackup();
    window.__qfLastBackup = data;
    downloadJson(data, 'quizforge-library-' + new Date().toISOString().slice(0, 10) + '.json');
    if (errBox) errBox.classList.remove('show');
    return data;
  }

  /* Validates and merges a backup's text. Returns
     {added, skipped, invalid}; throws a localized Error when the
     text is not JSON, is not a backup, or holds zero valid exams
     (in the last case nothing has been written yet). */
  function importLibraryText(text) {
    var data;
    try {
      data = JSON.parse(String(text || ''));
    } catch (e) {
      throw new Error(t('libBackupInvalid', { msg: e.message }));
    }
    if (!data || typeof data !== 'object' || data.quizforgeBackup !== true ||
      !Array.isArray(data.exams))
      throw new Error(t('libBackupNotBackup'));
    var lib = loadLibrary();
    var seen = {};
    lib.forEach(function (x) { seen[x.id] = true; });
    var added = 0, skipped = 0, invalid = 0;
    var fresh = [];
    data.exams.forEach(function (entry, i) {
      try {
        if (!entry || typeof entry !== 'object' || !entry.bank) throw new Error('bad entry');
        validate(entry.bank);
        var id = (typeof entry.id === 'string' && entry.id)
          ? entry.id : 'imp-lib-' + Date.now() + '-' + i;
        if (seen[id]) { skipped++; return; }
        seen[id] = true;
        fresh.push({
          id: id,
          title: (typeof entry.title === 'string' && entry.title)
            ? entry.title : t('libImportedBank', { n: entry.bank.questions.length }),
          subtitle: (typeof entry.subtitle === 'string')
            ? entry.subtitle : t('libImportedBank', { n: entry.bank.questions.length }),
          date: (typeof entry.date === 'string' && entry.date)
            ? entry.date : new Date().toISOString().slice(0, 10),
          count: entry.bank.questions.length,
          provider: (typeof entry.provider === 'string' && entry.provider) ? entry.provider : 'import',
          model: (typeof entry.model === 'string') ? entry.model : '',
          bank: entry.bank
        });
        added++;
      } catch (e) { invalid++; }
    });
    if (added === 0 && skipped === 0) throw new Error(t('libBackupNoValid'));
    if (added > 0) saveLibrary(fresh.concat(lib));
    return { added: added, skipped: skipped, invalid: invalid };
  }

  function importLibraryFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var errBox, okBox;
      try {
        var res = importLibraryText(String(reader.result || ''));
        /* renderLibrary() rebuilds the header, so the status boxes
           must be looked up (and filled) after it, not before. */
        renderLibrary();
        errBox = document.getElementById('import-error');
        okBox = document.getElementById('backup-status');
        if (errBox) errBox.classList.remove('show');
        if (okBox) {
          okBox.textContent = t('libBackupImported', { added: res.added, skipped: res.skipped }) +
            (res.invalid > 0 ? t('libBackupInvalidNote', { n: res.invalid }) : '');
          okBox.classList.add('show');
        }
      } catch (e) {
        okBox = document.getElementById('backup-status');
        errBox = document.getElementById('import-error');
        if (okBox) okBox.classList.remove('show');
        if (errBox) {
          errBox.textContent = e.message;
          errBox.classList.add('show');
        }
      }
    };
    reader.onerror = function () {
      var errBox = document.getElementById('import-error');
      if (errBox) {
        errBox.textContent = t('libReadErr');
        errBox.classList.add('show');
      }
    };
    reader.readAsText(file);
  }

  /* Test/debug handle (like window.__qfLastShare for sharing). */
  window.__qfBackup = {
    buildBackup: buildBackup,
    exportLibrary: exportLibrary,
    importLibraryText: importLibraryText
  };

  /* ---------- print / PDF export ----------
     Builds a hidden #print-sheet (outside .wrap) with the full exam —
     every question with its options, then an answer key with the correct
     answer and explanation. @media print in style.css hides the app and
     shows only this sheet. window.print() opens the browser's print /
     save-as-PDF dialog; the sheet is rebuilt on every print so it always
     matches the current exam and language. */
  function buildPrintSheet(bank) {
    var sheet = document.getElementById('print-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'print-sheet';
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = '';
    var date = new Date().toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB');

    var head = el('div', 'print-head');
    head.appendChild(el('h1', null, bank.title || t('quizDefaultTitle')));
    if (bank.subtitle) head.appendChild(el('p', 'print-sub', bank.subtitle));
    head.appendChild(el('p', 'print-meta',
      t('qCount', { n: bank.questions.length }) + ' · ' + t('printMeta', { date: date })));
    sheet.appendChild(head);

    sheet.appendChild(el('h2', 'print-sec', t('printQuestions')));
    bank.questions.forEach(function (q, i) {
      var item = el('div', 'print-q');
      var qt = qType(q);
      item.appendChild(el('div', 'print-qtext', (i + 1) + '. ' + q.question +
        (qt === 'essay' ? '  (' + t('qTypeEssay') + ' · ' + t('printEssayMax', { n: essayMax(q) }) + ')' :
          qt === 'fill' ? '  (' + t('qTypeFill') + ')' :
          qt === 'coding' ? '  (' + t('qTypeCoding') + ' · JavaScript)' :
          qt === 'matching' ? '  (' + t('qTypeMatching') + ')' :
          qt === 'ordering' ? '  (' + t('qTypeOrdering') + ')' : '')));
      if (q.code) {
        var pre = el('pre', 'print-code');
        pre.textContent = q.code;
        item.appendChild(pre);
      }
      if (qt === 'coding') {
        var starter = el('pre', 'print-code');
        starter.textContent = q.starterCode || '';
        item.appendChild(starter);
        var testsLine = el('div', 'print-code-tests');
        testsLine.textContent = t('printCodeTests') +
          (q.tests || []).map(function (tc) { return tc.input + ' → ' + tc.expected; }).join(' · ');
        item.appendChild(testsLine);
      }
      if (qt === 'essay') {
        var lines = el('div', 'print-blank');
        for (var li = 0; li < 4; li++) lines.appendChild(el('div', 'print-line'));
        item.appendChild(lines);
      } else if (qt === 'fill') {
        item.appendChild(el('div', 'print-line'));
      } else if (qt === 'matching') {
        /* Left items numbered, right partners lettered in rotated
           order (same rotation as the unshuffled quiz view), so the
           student writes a letter next to each number. */
        var mLeft = el('ol', 'print-opts');
        (q.pairs || []).forEach(function (p) {
          mLeft.appendChild(el('li', null, p.left + '  ______'));
        });
        item.appendChild(mLeft);
        var rights = scrambleRights(q, false);
        var mRight = el('ol', 'print-opts');
        rights.forEach(function (r, idx) {
          mRight.appendChild(el('li', null, LETTERS[idx] + ') ' + r));
        });
        item.appendChild(mRight);
      } else if (qt === 'ordering') {
        /* Items in reverse order; the student numbers them 1..n in
           the correct order. */
        var oList = el('ol', 'print-opts');
        (q.items || []).slice().reverse().forEach(function (s) {
          oList.appendChild(el('li', null, s + '  ______'));
        });
        item.appendChild(oList);
      } else if (qt === 'coding') {
        /* Starter code + tests were already added above; nothing more
           to write on — the student writes the solution here. */
      } else {
        var opts = el('ol', 'print-opts');
        q.options.forEach(function (optText, idx) {
          opts.appendChild(el('li', null, LETTERS[idx] + ') ' + optText));
        });
        item.appendChild(opts);
      }
      sheet.appendChild(item);
    });

    var key = el('div', 'print-key');
    key.appendChild(el('h2', 'print-sec', t('printAnswerKey')));
    key.appendChild(el('p', 'print-meta', t('printKeyNote')));
    bank.questions.forEach(function (q, i) {
      var row = el('div', 'print-keyrow');
      var qt = qType(q);
      if (qt === 'essay') {
        row.appendChild(el('div', 'print-keyans',
          (i + 1) + '. ' + t('printEssayMax', { n: essayMax(q) })));
        row.appendChild(el('div', 'print-keywhy', t('printEssayRubric', { rubric: q.rubric })));
      } else if (qt === 'fill') {
        row.appendChild(el('div', 'print-keyans',
          (i + 1) + '. ' + t('printFillAccepted', { list: (q.answers || []).join(', ') })));
      } else if (qt === 'coding') {
        row.appendChild(el('div', 'print-keyans',
          (i + 1) + '. ' + t('printCodeTests') +
          (q.tests || []).map(function (tc) { return tc.input + ' → ' + tc.expected; }).join(' · ')));
      } else if (qt === 'matching') {
        row.appendChild(el('div', 'print-keyans',
          (i + 1) + '. ' + t('matchCorrectPairs') +
          (q.pairs || []).map(function (p) { return p.left + ' → ' + p.right; }).join(' · ')));
      } else if (qt === 'ordering') {
        row.appendChild(el('div', 'print-keyans',
          (i + 1) + '. ' + t('orderCorrectOrder') +
          (q.items || []).map(function (s, idx) { return (idx + 1) + '. ' + s; }).join(' · ')));
      } else {
        row.appendChild(el('div', 'print-keyans',
          (i + 1) + '. ' + LETTERS[q.answer] + ') ' + q.options[q.answer]));
      }
      if (q.explanation) {
        row.appendChild(el('div', 'print-keywhy', t('printWhy') + q.explanation));
      }
      key.appendChild(row);
    });
    sheet.appendChild(key);
    return sheet;
  }

  function printExam(bank) {
    var target = bank || quiz;
    if (!target || !target.questions || !target.questions.length) return;
    buildPrintSheet(target);
    window.print();
  }

  /* ---------- printable answer sheet (Feature 15) ----------
     A paper bubble sheet for a real exam room: title, blank
     name/date/class fields, then one row per question — a bubble
     (○) per answer option for MCQ, lined write-in space for essay,
     fill-in, coding, matching and ordering. Reuses the same hidden
     #print-sheet + window.print() approach as printExam, so it
     prints clean black-on-white (dark mode included) and follows
     the page direction in RTL. The sheet is rebuilt on every
     print, so it always matches the current exam and language. */
  function buildAnswerSheet(bank) {
    var sheet = document.getElementById('print-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'print-sheet';
      document.body.appendChild(sheet);
    }
    sheet.innerHTML = '';
    var date = new Date().toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB');

    var head = el('div', 'print-head');
    head.appendChild(el('h1', null, bank.title || t('quizDefaultTitle')));
    head.appendChild(el('p', 'print-sub', t('ansTitle')));
    if (bank.subtitle) head.appendChild(el('p', 'print-sub', bank.subtitle));
    head.appendChild(el('p', 'print-meta',
      t('qCount', { n: bank.questions.length }) + ' · ' + t('printMeta', { date: date })));
    sheet.appendChild(head);

    var info = el('div', 'ans-info');
    [t('ansName'), t('ansDate'), t('ansClass')].forEach(function (label) {
      var f = el('div', 'ans-field');
      f.appendChild(el('span', 'ans-label', label + ':'));
      f.appendChild(el('span', 'ans-blank'));
      info.appendChild(f);
    });
    sheet.appendChild(info);
    sheet.appendChild(el('p', 'ans-instructions', t('ansInstructions')));

    bank.questions.forEach(function (q, i) {
      var row = el('div', 'ans-row');
      row.appendChild(el('span', 'ans-num', (i + 1) + '.'));
      var qt = qType(q);
      if (qt === 'mcq' || qt === 'tf') {
        var bubbles = el('div', 'ans-bubbles');
        (q.options || []).forEach(function (_, idx) {
          bubbles.appendChild(el('span', 'ans-bubble', LETTERS[idx] || String(idx + 1)));
        });
        row.appendChild(bubbles);
      } else {
        var write = el('div', 'ans-write');
        var typeLabel = qt === 'essay' ? t('qTypeEssay') + ' · ' + t('printEssayMax', { n: essayMax(q) })
          : qt === 'fill' ? t('qTypeFill')
          : qt === 'coding' ? t('qTypeCoding') + ' · JavaScript'
          : qt === 'matching' ? t('qTypeMatching')
          : t('qTypeOrdering');
        write.appendChild(el('div', 'ans-type', typeLabel));
        if (qt === 'matching') {
          var mWrap = el('div', 'ans-match');
          var mLeft = el('ol', 'print-opts');
          (q.pairs || []).forEach(function (p) {
            mLeft.appendChild(el('li', null, p.left + '  ______'));
          });
          mWrap.appendChild(mLeft);
          var mRight = el('ol', 'print-opts');
          scrambleRights(q, false).forEach(function (r, idx) {
            mRight.appendChild(el('li', null, LETTERS[idx] + ') ' + r));
          });
          mWrap.appendChild(mRight);
          write.appendChild(mWrap);
        } else if (qt === 'ordering') {
          var oList = el('ol', 'print-opts');
          (q.items || []).slice().reverse().forEach(function (s) {
            oList.appendChild(el('li', null, s + '  ______'));
          });
          write.appendChild(oList);
        } else if (qt === 'coding' && q.starterCode) {
          var starter = el('pre', 'print-code');
          starter.textContent = q.starterCode;
          write.appendChild(starter);
          write.appendChild(el('div', 'ans-type', t('ansWriteIn')));
          for (var li = 0; li < 4; li++) write.appendChild(el('div', 'print-line'));
        } else {
          var nLines = qt === 'fill' ? 1 : 4;
          for (var lj = 0; lj < nLines; lj++) write.appendChild(el('div', 'print-line'));
        }
        row.appendChild(write);
      }
      sheet.appendChild(row);
    });
    return sheet;
  }

  function printAnswerSheet(bank) {
    var target = bank || quiz;
    if (!target || !target.questions || !target.questions.length) return;
    buildAnswerSheet(target);
    window.print();
  }

  /* ---------- stats dashboard (Feature 5) ----------
     Aggregates the recorded attempts from loadStats(): overall
     totals, per-topic accuracy + average time, best/worst topics,
     and a recent-attempts list. Works with zero attempts (friendly
     empty state); corrupt or older-shaped data is already filtered
     out by loadStats(), so the dashboard can never break on it. */
  function renderStats() {
    app.innerHTML = '';
    var wrap = el('div');
    var head = el('section', 'card');
    head.appendChild(el('p', 'kicker', t('statsKicker')));
    head.appendChild(el('h2', null, t('statsTitle')));
    var attempts = loadStats();

    if (!attempts.length) {
      head.appendChild(el('p', 'hero-text', t('statsEmptyBody')));
      var row0 = el('div', 'btnrow');
      var startBtn = el('button', 'btn btn-primary', t('statsEmptyCta'));
      startBtn.addEventListener('click', function () { showStart(); });
      row0.appendChild(startBtn);
      head.appendChild(row0);
      wrap.appendChild(head);
      app.appendChild(wrap);
      return;
    }

    head.appendChild(el('p', 'hero-text', t('statsHero')));

    /* Aggregate across all attempts. */
    var totalQ = 0, totalCorrect = 0, totalPct = 0, totalSecs = 0;
    var byTopic = {};
    attempts.forEach(function (a) {
      var tot = a.total || 0, sc = a.score || 0;
      totalQ += tot;
      totalCorrect += sc;
      if (tot) totalPct += sc / tot * 100;
      (a.items || []).forEach(function (it) {
        var name = it.topic || 'General';
        var tp = byTopic[name];
        if (!tp) tp = byTopic[name] = { correct: 0, total: 0, secs: 0 };
        tp.total++;
        if (it.correct) tp.correct++;
        var s = (typeof it.secs === 'number' && it.secs >= 0) ? it.secs : 0;
        tp.secs += s;
        totalSecs += s;
      });
    });
    var avgPct = attempts.length ? Math.round(totalPct / attempts.length) : 0;
    var avgSecs = totalQ ? totalSecs / totalQ : 0;

    var grid = el('div', 'stats-grid');
    grid.appendChild(statCard(t('statsExams'), String(attempts.length)));
    grid.appendChild(statCard(t('statsQuestions'), String(totalQ)));
    grid.appendChild(statCard(t('statsAvgScore'), avgPct + '%'));
    grid.appendChild(statCard(t('statsAvgTime'), t('statsAvgSec', { s: avgSecs.toFixed(1) })));
    head.appendChild(grid);
    wrap.appendChild(head);

    /* Per-topic accuracy, best first. */
    var ranked = Object.keys(byTopic).map(function (name) {
      var tp = byTopic[name];
      return { name: name, pct: tp.total ? Math.round(tp.correct / tp.total * 100) : 0,
        correct: tp.correct, total: tp.total,
        avg: tp.total ? tp.secs / tp.total : 0 };
    }).sort(function (a, b) { return b.pct - a.pct || b.total - a.total; });
    if (ranked.length) {
      var tCard = el('section', 'card');
      tCard.appendChild(el('h2', 'stats-sec', t('statsTopicsTitle')));
      var callouts = el('div', 'stats-callouts');
      callouts.appendChild(el('span', 'stat stat-best',
        t('statsBest', { topic: ranked[0].name, pct: ranked[0].pct })));
      if (ranked.length > 1 && ranked[ranked.length - 1].pct < ranked[0].pct) {
        callouts.appendChild(el('span', 'stat stat-worst',
          t('statsWorst', { topic: ranked[ranked.length - 1].name, pct: ranked[ranked.length - 1].pct })));
      }
      tCard.appendChild(callouts);
      ranked.forEach(function (r) {
        var rowEl = el('div', 'topic-row');
        var top = el('div', 'topic-top');
        top.appendChild(el('span', 'topic-name', r.name));
        top.appendChild(el('span', 'topic-meta',
          t('statsCorrect', { c: r.correct, t: r.total }) + ' · ' + r.pct + '% · ' +
          t('statsAvgSec', { s: r.avg.toFixed(1) })));
        rowEl.appendChild(top);
        var bar = el('div', 'topic-bar');
        var fill = el('div', 'topic-fill');
        fill.style.width = r.pct + '%';
        bar.appendChild(fill);
        rowEl.appendChild(bar);
        tCard.appendChild(rowEl);
      });
      wrap.appendChild(tCard);
    }

    /* Recent attempts, newest first. */
    var rCard = el('section', 'card');
    rCard.appendChild(el('h2', 'stats-sec', t('statsRecentTitle')));
    var list = el('div', 'recent-list');
    attempts.slice(0, 8).forEach(function (a) {
      var item = el('div', 'recent-item');
      item.appendChild(el('span', 'recent-date', fmtAttemptDate(a.ts)));
      item.appendChild(el('span', 'recent-title', a.title || t('quizDefaultTitle')));
      var pct = a.total ? Math.round(a.score / a.total * 100) : 0;
      item.appendChild(el('span', 'recent-score',
        t('statsScore', { score: a.score, total: a.total, pct: pct })));
      list.appendChild(item);
    });
    rCard.appendChild(list);
    var row = el('div', 'btnrow');
    var clearBtn = el('button', 'btn btn-secondary', t('statsClear'));
    clearBtn.addEventListener('click', function () {
      if (!window.confirm(t('statsConfirmClear'))) return;
      saveStats([]);
      showToast(t('statsCleared'));
      renderStats();
    });
    row.appendChild(clearBtn);
    rCard.appendChild(row);
    wrap.appendChild(rCard);

    app.appendChild(wrap);
  }

  function statCard(label, value) {
    var c = el('div', 'stat-card');
    c.appendChild(el('div', 'stat-num', value));
    c.appendChild(el('div', 'stat-label', label));
    return c;
  }

  function fmtAttemptDate(ts) {
    try {
      var d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      var locale = (typeof getLang === 'function' && getLang() === 'ar') ? 'ar-EG' : 'en-US';
      return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) + ' · ' +
        d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /* ---------- share via link ----------
     The whole exam is encoded into the URL hash (#exam=<payload>) so no
     server is needed — the link works from any static host (GitHub
     Pages-style). The payload is the compact exam JSON, deflate-
     compressed when the browser supports CompressionStream (prefix
     'z.'), otherwise plain base64url; the decoder accepts both. Links
     longer than MAX_SHARE_URL are refused with a size warning instead
     of a broken link. The recipient needs no files and no key. */
  function bytesToB64url(bytes) {
    var bin = '';
    var CHUNK = 0x8000;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlToBytes(str) {
    var b64 = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function deflateBytes(bytes) {
    if (typeof CompressionStream === 'undefined')
      return Promise.reject(new Error('no CompressionStream'));
    var cs = new CompressionStream('deflate');
    var writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(cs.readable).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function inflateBytes(bytes) {
    var ds = new DecompressionStream('deflate');
    var writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Response(ds.readable).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function encodeSharePayload(bank) {
    /* The summary is not shared: it would bloat the link past the
       size limit, and the recipient gets the exam itself. The summary
       stays in the owner's library copy. */
    var shareBank = {};
    Object.keys(bank).forEach(function (k) { if (k !== 'summary') shareBank[k] = bank[k]; });
    var bytes = new TextEncoder().encode(JSON.stringify(shareBank));
    return deflateBytes(bytes).then(function (deflated) {
      return 'z.' + bytesToB64url(deflated);
    }).catch(function () {
      return bytesToB64url(bytes);   // older browser: plain base64url
    });
  }

  function decodeSharePayload(payload) {
    /* Never throws synchronously: callers handle a bad link through
       the returned rejection, so a damaged hash can never crash the
       boot chain or a hashchange handler. */
    var p;
    try {
      if (payload.slice(0, 2) === 'z.') {
        p = inflateBytes(b64urlToBytes(payload.slice(2))).then(function (bytes) {
          return new TextDecoder().decode(bytes);
        });
      } else {
        p = Promise.resolve(new TextDecoder().decode(b64urlToBytes(payload)));
      }
    } catch (e) {
      return Promise.reject(e);
    }
    return p.then(function (json) {
      var bank = JSON.parse(json);
      validate(bank);
      return bank;
    });
  }

  function buildShareUrl(bank) {
    return encodeSharePayload(bank).then(function (payload) {
      var url = location.href.split('#')[0] + SHARE_HASH + payload;
      if (url.length > MAX_SHARE_URL) return { tooLarge: true, size: url.length };
      return { url: url };
    });
  }

  function copyTextFallback(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return copyTextFallback(text); });
    }
    return Promise.resolve(copyTextFallback(text));
  }

  var toastTimer = null;
  function showToast(msg, sticky) {
    var toast = document.getElementById('share-toast');
    if (!toast) {
      toast = el('div', 'share-toast');
      toast.id = 'share-toast';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    if (!sticky) {
      toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3500);
    }
    toast.onclick = function () { toast.classList.remove('show'); };
  }

  function clearShareNotes(container) {
    if (!container || !container.parentNode) return;
    Array.prototype.slice.call(container.parentNode.querySelectorAll('.share-note'))
      .forEach(function (n) { n.remove(); });
  }

  function showShareNote(container, text, kind) {
    clearShareNotes(container);
    var note = el('div', 'share-note' + (kind ? ' ' + kind : ''));
    if (text) note.textContent = text;
    if (container && container.parentNode)
      container.parentNode.insertBefore(note, container.nextSibling);
    return note;
  }

  /* Builds the link, copies it, and confirms. If the exam is too big
     for a practical link, shows a size warning instead. If the
     clipboard is unavailable, shows the link in a text field so the
     user can copy it by hand. window.__qfLastShare records the last
     outcome (url / copied / tooLarge) for debugging and tests. */
  function shareExam(bank, rowEl) {
    if (!bank || !bank.questions || !bank.questions.length) return;
    buildShareUrl(bank).then(function (res) {
      if (res.tooLarge) {
        showShareNote(rowEl, t('shareTooLarge', {
          size: fmtSize(res.size), max: fmtSize(MAX_SHARE_URL)
        }), 'warn');
        window.__qfLastShare = { url: null, copied: false, tooLarge: true, size: res.size };
        return;
      }
      window.__qfLastShare = { url: res.url, copied: false, tooLarge: false };
      copyText(res.url).then(function (ok) {
        window.__qfLastShare.copied = ok;
        if (ok) {
          showToast(t('shareCopied'));
        } else {
          var note = showShareNote(rowEl, '', '');
          note.appendChild(el('span', null, t('shareCopyHint') + ' '));
          var input = document.createElement('input');
          input.type = 'text';
          input.className = 'input share-link-input';
          input.readOnly = true;
          input.value = res.url;
          input.setAttribute('aria-label', t('shareLinkLabel'));
          input.addEventListener('click', function () { input.select(); });
          note.appendChild(input);
          var copyBtn = el('button', 'btn btn-secondary btn-small', t('shareCopyBtn'));
          copyBtn.type = 'button';
          copyBtn.addEventListener('click', function () {
            input.select();
            copyText(res.url).then(function (ok2) {
              if (ok2) showToast(t('shareCopied'));
            });
          });
          note.appendChild(copyBtn);
          input.select();
        }
      });
    });
  }

  function saveSharedExam() {
    var lib = loadLibrary();
    lib.unshift({
      id: 'shr-' + Date.now() + '-' + Math.floor(Math.random() * 1e6),
      title: quiz.title || t('quizDefaultTitle'),
      subtitle: quiz.subtitle || t('libImportedBank', { n: quiz.questions.length }),
      date: new Date().toISOString().slice(0, 10),
      count: quiz.questions.length,
      provider: 'shared',
      model: '',
      bank: quiz
    });
    saveLibrary(lib);
    sharedExam = null;
    showStart(t('shareSaved'));
  }

  /* On load, a #exam= hash opens the shared exam straight into the
     quiz engine — even with empty localStorage. The hash is stripped
     afterwards so normal navigation is not sticky. */
  function loadSharedExamFromHash() {
    var payload = location.hash.slice(SHARE_HASH.length);
    decodeSharePayload(payload).then(function (bank) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
      loadBank(bank, { shared: true });
    }).catch(function () {
      setView('create');
      showToast(t('shareBadLink'), true);
    });
  }

  function loadBank(bank, opts) {
    /* A translated exam left behind in another bank is restored to
       its original before the translation state is cleared, so the
       library entry is never left half-translated. */
    if (trState.original && trState.bank) {
      try { trState.bank.questions = trDeepCopy(trState.original); } catch (e) {}
    }
    trState.original = null; trState.translated = null;
    trState.lang = null; trState.sourceLang = null; trState.bank = null; trState.busy = false;
    quiz = bank;
    selectedTopic = 'All';
    sharedExam = (opts && opts.shared) ? bank : null;
    setView('quiz');
    showStart(opts && opts.shared ? t('shareLoadedNote') : null);
  }

  /* ---------- settings panel ---------- */

  function openSettingsPanel() {
    var p = document.getElementById('settings-panel');
    p.hidden = false;
    document.getElementById('settings-btn').setAttribute('aria-expanded', 'true');
  }

  function closeSettingsPanel() {
    var p = document.getElementById('settings-panel');
    p.hidden = true;
    document.getElementById('settings-btn').setAttribute('aria-expanded', 'false');
  }

  function updateSettingsSummary() {
    var sum = document.getElementById('settings-summary');
    if (!sum) return;
    sum.innerHTML = '';
    sum.appendChild(document.createTextNode(t('sumShuffle')));
    sum.appendChild(el('b', null, settings.shuffle ? t('on') : t('off')));
    sum.appendChild(document.createTextNode('  ·  ' + t('sumPerQ')));
    sum.appendChild(el('b', null, settings.perQTimer
      ? t('sumPerQOn', { n: settings.perQSeconds }) : t('off')));
    var sh2 = document.getElementById('strict-hint');
    if (sh2) sh2.textContent = t('strictHint') + ' ' + t('strictTotal', { time: fmtTime(strictTotalFor(quiz ? quiz.questions.length : 0)) });
  }

  function wireSettingsPanel() {
    var btn = document.getElementById('settings-btn');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var p = document.getElementById('settings-panel');
      if (p.hidden) openSettingsPanel(); else closeSettingsPanel();
    });
    document.addEventListener('click', function (e) {
      var p = document.getElementById('settings-panel');
      if (!p.hidden && !e.target.closest('.appbar-wrap')) closeSettingsPanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSettingsPanel();
    });

    var sh = document.getElementById('set-shuffle');
    sh.checked = settings.shuffle;
    sh.addEventListener('change', function () {
      settings.shuffle = sh.checked;
      saveSettings();
      updateSettingsSummary();
    });

    var pq = document.getElementById('set-perq');
    pq.checked = settings.perQTimer;
    var sec = document.getElementById('set-seconds');
    sec.value = String(settings.perQSeconds);
    sec.disabled = !settings.perQTimer;
    pq.addEventListener('change', function () {
      settings.perQTimer = pq.checked;
      sec.disabled = !pq.checked;
      if (!pq.checked && perQTimerId !== null) {
        clearInterval(perQTimerId);
        perQTimerId = null;
      }
      saveSettings();
      updateSettingsSummary();
    });
    sec.addEventListener('change', function () {
      var v = parseInt(sec.value, 10);
      if (!isNaN(v)) {
        settings.perQSeconds = Math.max(5, Math.min(600, v));
        sec.value = String(settings.perQSeconds);
        saveSettings();
        updateSettingsSummary();
      }
    });
  }

  /* ---------- timers ---------- */

  function stopTimers() {
    if (totalTimerId !== null) { clearInterval(totalTimerId); totalTimerId = null; }
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    if (strictTimerId !== null) { clearInterval(strictTimerId); strictTimerId = null; }
  }

  /* Strict mode total time: the per-question setting when it is on,
     otherwise a sensible 60 seconds per question. */
  function strictTotalFor(n) {
    var perQ = settings.perQTimer ? settings.perQSeconds : 60;
    return perQ * Math.max(1, n);
  }

  function requestFullscreen() {
    strictFsAttempted = true;
    try {
      var d = document.documentElement;
      if (d.requestFullscreen) {
        var p = d.requestFullscreen();
        if (p && p.catch) p.catch(function () { /* denied: mode still applies */ });
      }
    } catch (e) { /* fullscreen unavailable: mode still applies */ }
  }

  function exitFullscreen() {
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {}
  }

  function startStrictTimer() {
    if (strictTimerId !== null) clearInterval(strictTimerId);
    strictTimerId = setInterval(function () {
      if (!run || !run.strict) { clearInterval(strictTimerId); strictTimerId = null; return; }
      run.strictLeft--;
      var c = document.getElementById('timer-strict');
      if (c) {
        c.textContent = fmtTime(Math.max(run.strictLeft, 0));
        var wrap = c.closest('.tchip');
        if (wrap) wrap.classList.toggle('low', run.strictLeft <= 60);
      }
      if (run.strictLeft <= 0) {
        clearInterval(strictTimerId);
        strictTimerId = null;
        autoSubmitStrict();
      }
    }, 1000);
  }

  /* Time ran out in strict mode: whatever is answered stands, every
     unanswered question counts as wrong (typed-but-unsubmitted text on
     the current question is kept, like a per-question timeout), then
     the exam submits. Grading in flight is abandoned, never invented. */
  function autoSubmitStrict() {
    if (!run || !run.strict || run.resultsShown) return;
    var pos;
    for (pos = 0; pos < run.qIndexes.length; pos++) {
      if (run.answers[pos] !== null) {
        var a = run.answers[pos];
        if (a.grading) { a.grading = false; a.graded = false; a.correct = false; a.timedOut = true; }
        continue;
      }
      var q = quiz.questions[run.qIndexes[pos]];
      var qt = qType(q);
      var txt = '';
      if (pos === run.current && (qt === 'essay' || qt === 'fill' || qt === 'coding')) {
        var inp = document.getElementById(qt === 'coding' ? 'code-editor' : 'free-answer-input');
        if (inp) txt = inp.value;
        if (qt !== 'coding') txt = txt.trim();
      }
      if ((qt === 'fill' || qt === 'essay' || qt === 'coding') && txt.trim()) {
        if (qt === 'fill') {
          run.answers[pos] = { text: txt, correct: gradeFill(q, txt), timedOut: true, secs: qSecs() };
        } else if (qt === 'coding') {
          run.answers[pos] = {
            text: txt, correct: false, timedOut: true, secs: qSecs(),
            codeScore: 0, codeTotal: (q.tests || []).length
          };
        } else {
          run.answers[pos] = { text: txt, correct: false, graded: false, grading: false, timedOut: true, secs: qSecs() };
        }
      } else if (qt === 'matching') {
        var picks = pos === run.current ? readMatchingDraft(pos)
          : ((run.matchDrafts[pos] || []).slice());
        var gm = gradeMatching(q, picks);
        run.answers[pos] = {
          picks: picks, correct: gm.correct, got: gm.got, total: gm.total,
          timedOut: true, secs: qSecs()
        };
      } else if (qt === 'ordering') {
        var ord = ((run.orderDrafts[pos] || []).slice());
        var go = gradeOrdering(q, ord);
        run.answers[pos] = {
          order: ord, correct: go.correct, got: go.got, total: go.total,
          timedOut: true, secs: qSecs()
        };
      } else {
        run.answers[pos] = { picked: null, text: txt || '', correct: false, timedOut: true, secs: 0 };
      }
    }
    run.qShownAt = null;
    strictMode = false;
    exitFullscreen();
    showToast(t('strictTimeUp'));
    showResults();
  }

  function startTotalTimer() {
    if (totalTimerId !== null) clearInterval(totalTimerId);
    totalTimerId = setInterval(function () {
      var t = document.getElementById('timer-total');
      if (t && run) t.textContent = fmtTime(Math.floor((Date.now() - run.startedAt) / 1000));
    }, 1000);
  }

  function startPerQTimer() {
    if (perQTimerId !== null) clearInterval(perQTimerId);
    run.perQLeft = settings.perQSeconds;
    var chip = document.getElementById('timer-perq');
    if (chip) {
      chip.textContent = fmtTime(run.perQLeft);
      var w = chip.closest('.tchip');
      if (w) w.classList.remove('low');
    }
    perQTimerId = setInterval(function () {
      run.perQLeft--;
      var c = document.getElementById('timer-perq');
      if (c) {
        c.textContent = fmtTime(Math.max(run.perQLeft, 0));
        var wrap = c.closest('.tchip');
        if (wrap && run.perQLeft <= 10) wrap.classList.add('low');
      }
      if (run.perQLeft <= 0) {
        clearInterval(perQTimerId);
        perQTimerId = null;
        onTimeout();
      }
    }, 1000);
  }

  /* ---------- quiz engine: start screen ---------- */

  function buildTopics() {
    var seen = {};
    topics = [];
    quiz.questions.forEach(function (q) {
      var t = q.topic || 'General';
      if (!seen[t]) { seen[t] = true; topics.push(t); }
    });
  }

  function statChip(text, cls) {
    return el('span', 'stat' + (cls ? ' ' + cls : ''), text);
  }

  function howStep(num, title, text) {
    var step = el('div', 'how-step');
    step.appendChild(el('span', 'step-num', num));
    step.appendChild(el('h3', null, title));
    step.appendChild(el('p', null, text));
    return step;
  }

  function showStart(note) {
    if (run && run.strict) exitFullscreen();
    stopTimers();
    run = null;
    fc = null;
    strictMode = false;   // strict is per exam, off by default
    strictWarned = false;
    currentView = 'quiz';
    document.getElementById('nav-create').classList.remove('active');
    document.getElementById('nav-library').classList.remove('active');
    app.innerHTML = '';
    buildTopics();

    var backRow = el('div', 'btnrow back-row');
    var back = el('button', 'btn btn-secondary btn-small', t('quizBack'));
    back.addEventListener('click', function () { setView('library'); });
    backRow.appendChild(back);
    app.appendChild(backRow);

    var hero = el('section', 'card hero');
    hero.appendChild(el('p', 'kicker', quiz.subtitle || t('quizDefaultSub')));
    hero.appendChild(el('h2', null, quiz.title || t('quizDefaultTitle')));
    hero.appendChild(el('p', 'hero-text', t('quizHero')));
    var stats = el('div', 'stats');
    stats.appendChild(statChip(t('qCount', { n: quiz.questions.length })));
    stats.appendChild(statChip(t('quizTopicsLabel', { n: topics.length })));
    var best = loadBest();
    if (best && best.bank === (quiz.title || 'Practice Quiz')) {
      stats.appendChild(statChip(t('quizBest', { score: best.score, total: best.total, pct: best.pct }), 'stat-best'));
    } else {
      stats.appendChild(statChip(t('quizNoAttempts')));
    }
    hero.appendChild(stats);
    if (note) hero.appendChild(el('p', 'bank-note', note));
    app.appendChild(hero);

    var topicsWrap = el('div', 'topics');
    var all = ['All'].concat(topics);
    all.forEach(function (topic) {
      var n = topic === 'All' ? quiz.questions.length
        : quiz.questions.filter(function (q) { return (q.topic || 'General') === topic; }).length;
      var card = el('button', 'topic-card' + (selectedTopic === topic ? ' selected' : ''));
      card.type = 'button';
      var ic = el('span', 'topic-icon');
      ic.innerHTML = topicIcon(topic);
      card.appendChild(ic);
      card.appendChild(el('span', 'topic-name', topic === 'All' ? t('quizAllTopics') : topic));
      card.appendChild(el('span', 'topic-count', t('qCount', { n: n })));
      card.appendChild(el('span', 'topic-go', t('quizStartTopic')));
      card.addEventListener('click', function () {
        selectedTopic = topic;
        startQuiz();
      });
      topicsWrap.appendChild(card);
    });
    app.appendChild(topicsWrap);

    var startCard = el('section', 'card');
    var strictRow = el('label', 'set-row strict-row');
    var strictChk = document.createElement('input');
    strictChk.type = 'checkbox';
    strictChk.id = 'strict-toggle';
    strictChk.checked = false;
    strictChk.addEventListener('change', function () { strictMode = strictChk.checked; });
    strictRow.appendChild(strictChk);
    strictRow.appendChild(el('span', null, t('strictToggle')));
    startCard.appendChild(strictRow);
    var strictHint = el('p', 'hint strict-hint',
      t('strictHint') + ' ' + t('strictTotal', { time: fmtTime(strictTotalFor(quiz.questions.length)) }));
    strictHint.id = 'strict-hint';
    startCard.appendChild(strictHint);
    var row = el('div', 'btnrow');
    var start = el('button', 'btn btn-primary btn-big', t('quizStart'));
    start.id = 'start-quiz-btn';
    start.addEventListener('click', function () { startQuiz(); });
    row.appendChild(start);
    var printBtn = el('button', 'btn btn-secondary btn-big', t('printBtn'));
    printBtn.id = 'print-exam-btn';
    printBtn.addEventListener('click', function () { printExam(); });
    row.appendChild(printBtn);
    var ansBtn = el('button', 'btn btn-secondary btn-big', t('ansBtn'));
    ansBtn.id = 'print-answer-sheet-btn';
    ansBtn.addEventListener('click', function () { printAnswerSheet(); });
    row.appendChild(ansBtn);
    var shareBtn = el('button', 'btn btn-secondary btn-big', t('shareBtn'));
    shareBtn.id = 'share-exam-btn';
    shareBtn.addEventListener('click', function () { shareExam(quiz, row); });
    row.appendChild(shareBtn);
    addTranslateButton(row);
    if (quiz.summary && Array.isArray(quiz.summary.keyPoints)) {
      var viewSum = el('button', 'btn btn-secondary btn-big', t('sumView'));
      viewSum.id = 'view-summary-btn';
      viewSum.addEventListener('click', function () {
        showSummaryScreen({ kind: 'start' });
      });
      row.appendChild(viewSum);
    }
    addFlashcardsButton(quiz, row);
    addReviewButton(quiz, row, false);
    if (sharedExam) {
      var saveBtn = el('button', 'btn btn-secondary btn-big', t('shareSave'));
      saveBtn.id = 'save-shared-btn';
      saveBtn.addEventListener('click', function () { saveSharedExam(); });
      row.appendChild(saveBtn);
    }
    startCard.appendChild(row);
    if (trState.lang) {
      startCard.appendChild(el('p', 'hint', t('trNote', { lang: trLangName(trState.lang) })));
    }

    var sum = el('p', 'settings-summary');
    sum.id = 'settings-summary';
    startCard.appendChild(sum);
    var changeBtn = el('button', 'btn btn-secondary btn-small', t('quizChangeSettings'));
    changeBtn.addEventListener('click', function () { openSettingsPanel(); });
    var changeRow = el('div', 'btnrow');
    changeRow.style.marginTop = '4px';
    changeRow.appendChild(changeBtn);
    startCard.appendChild(changeRow);

    startCard.appendChild(el('div', 'hint', t('quizShortcuts')));
    app.appendChild(startCard);

    var how = el('section', 'card how');
    how.appendChild(el('h2', null, t('quizHowTitle')));
    var steps = el('div', 'how-steps');
    steps.appendChild(howStep('1', t('quizHow1T'), t('quizHow1')));
    steps.appendChild(howStep('2', t('quizHow2T'), t('quizHow2')));
    steps.appendChild(howStep('3', t('quizHow3T'), t('quizHow3')));
    how.appendChild(steps);
    app.appendChild(how);

    updateSettingsSummary();
  }

  /* ---------- quiz engine: run ---------- */

  function startQuiz(qIndexes, opts) {
    stopTimers();
    var indexes;
    if (qIndexes) {
      indexes = qIndexes.slice();
    } else {
      indexes = quiz.questions.map(function (_, i) { return i; })
        .filter(function (i) {
          return selectedTopic === 'All' || (quiz.questions[i].topic || 'General') === selectedTopic;
        });
    }
    if (settings.shuffle && !(opts && opts.isReview)) indexes = shuffle(indexes);

    var optOrders = indexes.map(function (qi) {
      var q = quiz.questions[qi];
      if (qType(q) === 'essay' || qType(q) === 'fill' || qType(q) === 'coding' ||
        qType(q) === 'matching' || qType(q) === 'ordering') return [];
      var opts = (q.options || []).map(function (text, idx) {
        return { text: text, correct: idx === q.answer };
      });
      return settings.shuffle ? shuffle(opts) : opts;
    });

    /* Matching/ordering need their own per-position orders: the
       shuffled right column (matching) and the starting order
       (ordering). Review sessions keep the deterministic scramble
       (rotate/reverse) so streaks stay easy to follow. */
    var doScramble = settings.shuffle && !(opts && opts.isReview);
    var matchOrders = indexes.map(function (qi) {
      var q = quiz.questions[qi];
      return qType(q) === 'matching' ? scrambleRights(q, doScramble) : [];
    });
    var orderOrders = indexes.map(function (qi) {
      var q = quiz.questions[qi];
      return qType(q) === 'ordering' ? scrambleItems(q, doScramble) : [];
    });

    run = {
      qIndexes: indexes,
      optOrders: optOrders,
      matchOrders: matchOrders,
      orderOrders: orderOrders,
      matchDrafts: {},   // matching: chosen right partner per left item, per position
      orderDrafts: {},   // ordering: current item order, per position
      answers: indexes.map(function () { return null; }),
      current: 0,
      startedAt: Date.now(),
      qShownAt: null,             // when the current question was first shown (for per-question time)
      perQLeft: settings.perQSeconds,
      /* Strict mode never applies to review sessions; retry runs from
         the results screen start normal unless re-enabled there. */
      strict: strictMode && !(opts && opts.isReview),
      strictTotal: 0,
      strictLeft: 0,
      isRetry: !!qIndexes,
      isReview: !!(opts && opts.isReview),
      reviewMastered: 0,
      reviewTotal: (opts && opts.isReview) ? indexes.length : 0,
      reviewBank: (opts && opts.isReview) ? quiz : null,
      codeDrafts: {},    // coding: typed code per position (survives re-renders)
      codeResults: {}    // coding: last runCodeTests() result per position
    };
    if (run.strict) {
      run.strictTotal = strictTotalFor(indexes.length);
      run.strictLeft = run.strictTotal;
      strictWarned = false;
      strictFsAttempted = false;
      requestFullscreen();
    }
    renderQuestion();
    startTotalTimer();
    if (run.strict) startStrictTimer();
  }

  function renderProgress() {
    var done = run.answers.filter(function (a) { return a !== null; }).length;
    var score = run.answers.filter(function (a) { return a && a.correct; }).length;
    var total = run.qIndexes.length;
    var p = document.getElementById('progress-text');
    if (p) p.textContent = t('quizAnswered', { done: done, total: total, score: score });
    var f = document.getElementById('progress-fill');
    if (f) f.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
  }

  /* Seconds spent on the current question so far, to 0.1s (0 when
     the clock never started). */
  function qSecs() {
    if (!run.qShownAt) return 0;
    return Math.max(0, Math.round((Date.now() - run.qShownAt) / 100) / 10);
  }

  function renderQuestion() {
    var pos = run.current;
    var qi = run.qIndexes[pos];
    var q = quiz.questions[qi];
    var state = run.answers[pos];
    var qt = qType(q);
    /* Start the per-question clock the first time this question is
       shown unanswered; a re-render (e.g. language switch) keeps the
       original start so the time is not reset. */
    if (!state && !run.qShownAt) run.qShownAt = Date.now();
    app.innerHTML = '';

    var top = el('div', 'card quiz-top');
    var row1 = el('div', 'top-row');
    row1.appendChild(el('span', 'counter', t('quizCounter', { pos: pos + 1, total: run.qIndexes.length })));
    var timers = el('span', 'timers');
    if (run.strict) {
      /* Strict mode: the fixed total countdown replaces the elapsed
         timer; the per-question chip (if enabled) stays alongside it. */
      var sc = el('span', 'tchip strict');
      sc.innerHTML = icon('hourglass', 15);
      var st = el('span');
      st.id = 'timer-strict';
      st.textContent = fmtTime(run.strictLeft);
      st.title = t('strictCountdown', { time: fmtTime(run.strictLeft) });
      sc.appendChild(st);
      timers.appendChild(sc);
    } else {
      var totalChip = el('span', 'tchip');
      totalChip.innerHTML = icon('clock', 15);
      var tt = el('span');
      tt.id = 'timer-total';
      tt.textContent = '00:00';
      totalChip.appendChild(tt);
      timers.appendChild(totalChip);
    }
    if (settings.perQTimer) {
      var perq = el('span', 'tchip perq');
      perq.innerHTML = icon('hourglass', 15);
      var pt = el('span');
      pt.id = 'timer-perq';
      pt.textContent = fmtTime(run.perQLeft);
      perq.appendChild(pt);
      timers.appendChild(perq);
    }
    row1.appendChild(timers);
    top.appendChild(row1);
    if (run.strict) top.appendChild(el('span', 'strict-badge', t('strictBadge')));
    var progWrap = el('div', 'progress-wrap');
    var bar = el('div', 'bar');
    var fill = el('div');
    fill.id = 'progress-fill';
    bar.appendChild(fill);
    progWrap.appendChild(bar);
    var ptext = el('span', 'progress-text');
    ptext.id = 'progress-text';
    progWrap.appendChild(ptext);
    top.appendChild(progWrap);
    app.appendChild(top);
    renderProgress();

    var card = el('section', 'card q-card');
    var meta = el('div', 'q-meta');
    meta.appendChild(el('span', 'qnum', 'Q' + (pos + 1)));
    if (q.topic) meta.appendChild(el('span', 'topic-tag', q.topic));
    if (q.difficulty) meta.appendChild(el('span', 'topic-tag', q.difficulty));
    if (qt === 'essay' || qt === 'fill' || qt === 'coding' || qt === 'matching' || qt === 'ordering')
      meta.appendChild(el('span', 'topic-tag', t(
        qt === 'essay' ? 'qTypeEssay' : qt === 'fill' ? 'qTypeFill' : qt === 'coding' ? 'qTypeCoding' :
        qt === 'matching' ? 'qTypeMatching' : 'qTypeOrdering')));
    if (run.isReview) {
      meta.appendChild(el('span', 'topic-tag rev-streak',
        t('revStreak', { n: reviewStreak(quiz, q) })));
    }
    card.appendChild(meta);
    card.appendChild(el('h2', 'q-text', q.question));
    if (q.code) {
      var pre = el('pre', 'q-code');
      pre.textContent = q.code;
      card.appendChild(pre);
    }
    if (qt === 'mcq' || qt === 'tf') {
      var list = el('div', 'opts');
      run.optOrders[pos].forEach(function (opt, idx) {
        var btn = el('button', 'opt');
        btn.type = 'button';
        btn.appendChild(el('span', 'letter', LETTERS[idx]));
        var txt = el('span', 'opt-text');
        txt.textContent = opt.text;
        btn.appendChild(txt);
        if (state) {
          btn.disabled = true;
          if (opt.correct) btn.classList.add('correct');
          if (idx === state.picked && !state.correct) btn.classList.add('wrong');
          if (!opt.correct && idx !== state.picked) btn.classList.add('dim');
        }
        btn.addEventListener('click', function () {
          btn.blur();
          onPick(pos, idx);
        });
        list.appendChild(btn);
      });
      card.appendChild(list);
    } else if (qt === 'coding') {
      /* Coding: a monospace editor prefilled with the starter code, a
         Run tests button (checks without submitting) and a Submit
         button (runs the tests if needed, then grades by the fraction
         of tests passed). The draft lives on run.codeDrafts so a
         re-render (language switch, test run) never loses typed code. */
      if (state) {
        var shownCode = el('pre', 'q-code code-answer');
        shownCode.textContent = state.text || '';
        card.appendChild(shownCode);
        var resBoxDone = el('div', 'code-results');
        card.appendChild(resBoxDone);
        if (state.results) renderCodeResults(state.results, resBoxDone);
      } else {
        var codeWrap = el('div', 'code-wrap');
        codeWrap.appendChild(el('p', 'field-hint', t('codeLangNote')));
        var editor = document.createElement('textarea');
        editor.id = 'code-editor';
        editor.className = 'input code-editor';
        editor.rows = 10;
        editor.spellcheck = false;
        editor.placeholder = t('codeEditorPh');
        editor.setAttribute('aria-label', t('codeEditorPh'));
        editor.value = (run.codeDrafts && run.codeDrafts[pos] !== undefined)
          ? run.codeDrafts[pos] : (q.starterCode || '');
        editor.addEventListener('input', function () {
          if (!run.codeDrafts) run.codeDrafts = {};
          run.codeDrafts[pos] = editor.value;
        });
        codeWrap.appendChild(editor);
        var codeBtns = el('div', 'btnrow');
        var runBtn = el('button', 'btn btn-secondary', t('codeRunTests'));
        runBtn.type = 'button';
        runBtn.id = 'code-run-btn';
        runBtn.addEventListener('click', function () { runBtn.blur(); runCodingTests(pos); });
        codeBtns.appendChild(runBtn);
        var subBtn = el('button', 'btn btn-primary', t('codeSubmit'));
        subBtn.type = 'button';
        subBtn.id = 'code-submit-btn';
        subBtn.addEventListener('click', function () { subBtn.blur(); submitCoding(pos); });
        codeBtns.appendChild(subBtn);
        codeWrap.appendChild(codeBtns);
        var resBox = el('div', 'code-results');
        resBox.id = 'code-results';
        codeWrap.appendChild(resBox);
        card.appendChild(codeWrap);
        /* Re-show the last run's results after a re-render. */
        if (run.codeResults && run.codeResults[pos])
          renderCodeResults(run.codeResults[pos], resBox);
      }
    } else if (qt === 'matching') {
      /* Matching: each left item gets a dropdown of the shuffled
         right partners. The draft lives on run.matchDrafts so a
         re-render (language switch) never loses the picks. */
      var matchWrap = el('div', 'match-wrap');
      matchWrap.appendChild(el('p', 'field-hint', t('matchRule')));
      var headRow = el('div', 'match-row match-head');
      headRow.appendChild(el('span', 'match-col', t('matchLeftCol')));
      headRow.appendChild(el('span', 'match-col', t('matchRightCol')));
      matchWrap.appendChild(headRow);
      if (!run.matchDrafts[pos]) {
        run.matchDrafts[pos] = (q.pairs || []).map(function () { return ''; });
      }
      if (state) {
        (q.pairs || []).forEach(function (p, i) {
          var row = el('div', 'match-row answered');
          row.appendChild(el('span', 'match-left', p.left));
          var ok = state.picks && state.picks[i] === p.right;
          var pick = el('span', 'match-pick ' + (ok ? 'ok' : 'no'),
            (ok ? '✓ ' : '✗ ') + (state.picks ? (state.picks[i] || t('resNoAnswer')) : ''));
          row.appendChild(pick);
          matchWrap.appendChild(row);
        });
      } else {
        (q.pairs || []).forEach(function (p, i) {
          var row = el('div', 'match-row');
          row.appendChild(el('span', 'match-left', p.left));
          var sel = document.createElement('select');
          sel.className = 'input match-select';
          sel.id = 'match-select-' + i;
          sel.setAttribute('aria-label', p.left + ' → ' + t('matchRightCol'));
          var ph = document.createElement('option');
          ph.value = '';
          ph.textContent = t('matchChoose');
          sel.appendChild(ph);
          (run.matchOrders[pos] || []).forEach(function (r) {
            var o = document.createElement('option');
            o.value = r;
            o.textContent = r;
            if (run.matchDrafts[pos][i] === r) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener('change', function () {
            run.matchDrafts[pos][i] = sel.value;
          });
          row.appendChild(sel);
          matchWrap.appendChild(row);
        });
        var mSubmit = el('button', 'btn btn-primary', t('freeSubmit'));
        mSubmit.type = 'button';
        mSubmit.id = 'match-submit-btn';
        mSubmit.addEventListener('click', function () { mSubmit.blur(); submitMatching(pos); });
        matchWrap.appendChild(mSubmit);
      }
      card.appendChild(matchWrap);
    } else if (qt === 'ordering') {
      /* Ordering: up/down buttons move an item (no drag-and-drop —
         simple and reliable on touch and keyboard). The draft lives
         on run.orderDrafts so a re-render never loses the order. */
      var orderWrap = el('div', 'order-wrap');
      orderWrap.appendChild(el('p', 'field-hint', t('orderRule')));
      if (!run.orderDrafts[pos]) {
        run.orderDrafts[pos] = (run.orderOrders[pos] || []).slice();
      }
      var orderList = el('ol', 'order-list');
      var curOrder = state ? state.order : run.orderDrafts[pos];
      curOrder.forEach(function (item, i) {
        var li = el('li', 'order-item');
        var ok = state ? (q.items[i] === item) : null;
        li.appendChild(el('span', 'order-text' + (ok === null ? '' : ok ? ' ok' : ' no'),
          (state ? (ok ? '✓ ' : '✗ ') : '') + item));
        if (!state) {
          var btns = el('span', 'order-btns');
          var up = el('button', 'btn btn-secondary btn-small order-up', '↑');
          up.type = 'button';
          up.id = 'order-up-' + i;
          up.disabled = i === 0;
          up.setAttribute('aria-label', t('orderMoveUp') + ': ' + item);
          up.addEventListener('click', function () { moveOrderItem(pos, i, -1); });
          btns.appendChild(up);
          var down = el('button', 'btn btn-secondary btn-small order-down', '↓');
          down.type = 'button';
          down.id = 'order-down-' + i;
          down.disabled = i === curOrder.length - 1;
          down.setAttribute('aria-label', t('orderMoveDown') + ': ' + item);
          down.addEventListener('click', function () { moveOrderItem(pos, i, 1); });
          btns.appendChild(down);
          li.appendChild(btns);
        }
        orderList.appendChild(li);
      });
      orderWrap.appendChild(orderList);
      if (!state) {
        var oSubmit = el('button', 'btn btn-primary', t('freeSubmit'));
        oSubmit.type = 'button';
        oSubmit.id = 'order-submit-btn';
        oSubmit.addEventListener('click', function () { oSubmit.blur(); submitOrdering(pos); });
        orderWrap.appendChild(oSubmit);
      }
      card.appendChild(orderWrap);
    } else {
      /* Essay: textarea. Fill-in: one-line input. Both submit with a
         button (Enter in a textarea must stay a newline). While an
         essay is being graded the input is replaced by a "grading…"
         note and the Next button stays hidden until grading resolves. */
      var freeWrap = el('div', 'free-wrap');
      if (state && state.grading) {
        freeWrap.appendChild(el('div', 'grading-note', t('essayGrading')));
      } else if (!state) {
        var input;
        if (qt === 'essay') {
          input = document.createElement('textarea');
          input.className = 'input textarea essay-input';
          input.rows = 6;
        } else {
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'input fill-input';
        }
        input.id = 'free-answer-input';
        input.placeholder = t(qt === 'essay' ? 'essayPh' : 'fillPh');
        input.setAttribute('aria-label', t(qt === 'essay' ? 'essayPh' : 'fillPh'));
        if (qt === 'fill') {
          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); submitFreeText(pos); }
          });
        }
        freeWrap.appendChild(input);
        var submit = el('button', 'btn btn-primary', t('freeSubmit'));
        submit.type = 'button';
        submit.id = 'free-submit-btn';
        submit.addEventListener('click', function () { submit.blur(); submitFreeText(pos); });
        freeWrap.appendChild(submit);
      } else {
        var shown = el('div', 'free-answer');
        shown.textContent = state.text || '';
        freeWrap.appendChild(shown);
      }
      card.appendChild(freeWrap);
    }

    if (state && !state.grading) {
      var ex = el('div', 'explain show');
      if (qt === 'coding') {
        if (state.timedOut && !state.results) {
          ex.appendChild(el('div', 'verdict timeout', t('resTimeout')));
        } else if (state.results) {
          if (state.results.timedOut) {
            ex.appendChild(el('div', 'verdict timeout', t('codeTimeout')));
          } else {
            ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
              t('codeTestsPassed', { passed: state.results.passed, total: state.results.total })));
          }
          if (state.results.fallback)
            ex.appendChild(el('div', null, t('codeFallback')));
        } else {
          ex.appendChild(el('div', 'verdict', t('codeNotRun')));
        }
      } else if (qt === 'essay') {
        if (state.timedOut && !state.graded) {
          ex.appendChild(el('div', 'verdict timeout', t('resTimeout')));
          ex.appendChild(el('b', null, t('essayRubric')));
          ex.appendChild(document.createTextNode(q.rubric));
        } else if (state.graded) {
          ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
            t('essayScore', { score: state.score, max: state.maxScore })));
          ex.appendChild(el('b', null, t('essayFeedback')));
          ex.appendChild(document.createTextNode(state.feedback || ''));
        } else {
          ex.appendChild(el('div', 'verdict', t('essayNotGraded')));
          ex.appendChild(document.createTextNode(state.gradeError || t('essayNoKey')));
          ex.appendChild(document.createElement('br'));
          ex.appendChild(el('b', null, t('essayRubric')));
          ex.appendChild(document.createTextNode(q.rubric));
        }
      } else if (qt === 'fill') {
        if (state.timedOut) {
          ex.appendChild(el('div', 'verdict timeout', t('resTimeout')));
        } else {
          ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
            state.correct ? t('quizCorrect') : t('fillNotQuite')));
        }
        ex.appendChild(el('b', null, t('fillAccepted')));
        ex.appendChild(document.createTextNode((q.answers || []).join(', ')));
      } else if (qt === 'matching') {
        if (state.timedOut) {
          ex.appendChild(el('div', 'verdict timeout', t('resTimeout')));
        } else {
          ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
            t('matchScore', { n: state.got, total: state.total })));
        }
        (q.pairs || []).forEach(function (p, i) {
          var ok = state.picks && state.picks[i] === p.right;
          var line = el('div', 'pair-line ' + (ok ? 'ok' : 'no'));
          line.appendChild(document.createTextNode(
            p.left + ' → ' + (state.picks ? (state.picks[i] || t('resNoAnswer')) : '') +
            (ok ? ' ✓' : ' ✗ · ' + t('matchCorrectPairs') + p.right)));
          ex.appendChild(line);
        });
      } else if (qt === 'ordering') {
        if (state.timedOut) {
          ex.appendChild(el('div', 'verdict timeout', t('resTimeout')));
        } else {
          ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
            t('orderScore', { n: state.got, total: state.total })));
        }
        var ord = el('div', 'pair-line');
        ord.appendChild(el('b', null, t('orderCorrectOrder')));
        ord.appendChild(document.createTextNode(
          (q.items || []).map(function (s, i) { return (i + 1) + '. ' + s; }).join(' · ')));
        ex.appendChild(ord);
      } else if (state.timedOut) {
        ex.appendChild(el('div', 'verdict timeout', t('quizTimeout', {
          letter: LETTERS[run.optOrders[pos].findIndex(function (o) { return o.correct; })]
        })));
      } else {
        ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
          state.correct ? t('quizCorrect')
            : t('quizNotQuite', {
              letter: LETTERS[run.optOrders[pos].findIndex(function (o) { return o.correct; })]
            })));
      }
      if (q.explanation) {
        ex.appendChild(document.createElement('br'));
        ex.appendChild(el('b', null, t('quizWhy')));
        ex.appendChild(document.createTextNode(q.explanation));
      }
      card.appendChild(ex);
    }
    if (run.isReview && state) {
      var res = run.reviewLast || { streak: 0, mastered: false };
      var sl = el('div', 'rev-streak-line' + (res.mastered ? ' mastered' : ''));
      sl.textContent = res.mastered ? t('revMastered')
        : (state.correct ? t('revStreakAfter', { n: res.streak }) : t('revNotYet'));
      card.appendChild(sl);
    }
    app.appendChild(card);

    if (state && !state.grading) {
      var row = el('div', 'btnrow');
      var last = pos === run.qIndexes.length - 1;
      var next = el('button', 'btn btn-primary btn-big', last ? t('quizResultsBtn') : t('quizNext'));
      next.id = 'next-btn';
      next.addEventListener('click', function () { next.blur(); nextQuestion(); });
      row.appendChild(next);
      app.appendChild(row);
    } else if (!state) {
      if (run.strict) app.appendChild(el('div', 'hint', t('strictForwardHint')));
      if (qt === 'mcq' || qt === 'tf') {
        app.appendChild(el('div', 'hint', t('quizKeysHint', { n: Math.min(run.optOrders[pos].length, 6) })));
      } else {
        app.appendChild(el('div', 'hint', t(
          qt === 'essay' ? 'essayHint' : qt === 'fill' ? 'fillHint' :
          qt === 'matching' ? 'matchHint' : qt === 'ordering' ? 'orderHint' : 'codeHint')));
      }
    }

    if (!state && settings.perQTimer) startPerQTimer();
  }

  /* Submit a fill-in or essay answer. Fill-in is graded locally and
     immediately; an essay answer is sent to the provider for grading
     and the question shows a "grading…" state until it resolves. An
     ungraded essay (no key, or grading failed) keeps its rubric
     visible and never gets an invented score. */
  function submitFreeText(pos) {
    if (!run || run.answers[pos] !== null) return;
    var q = quiz.questions[run.qIndexes[pos]];
    var qt = qType(q);
    var input = document.getElementById('free-answer-input');
    var text = input ? input.value.trim() : '';
    if (!text) {
      showToast(t(qt === 'essay' ? 'essayEmpty' : 'fillEmpty'));
      if (input) input.focus();
      return;
    }
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var secs = qSecs();
    run.qShownAt = null;
    if (qt === 'fill') {
      var correct = gradeFill(q, text);
      run.answers[pos] = { text: text, correct: correct, timedOut: false, secs: secs };
      if (run.isReview) {
        var r = recordReviewAnswer(quiz, q, correct);
        run.reviewLast = r;
        if (r.mastered) run.reviewMastered++;
      }
      renderQuestion();
      var next = document.getElementById('next-btn');
      if (next) next.focus();
      return;
    }
    run.answers[pos] = {
      text: text, correct: null, graded: false, grading: true,
      timedOut: false, secs: secs
    };
    renderQuestion();
    gradeEssay(q, text).then(function (res) {
      var a = run && run.answers[pos];
      if (!a || a.text !== text) return;
      a.grading = false;
      a.graded = true;
      a.score = res.score;
      a.maxScore = res.maxScore;
      a.feedback = res.feedback;
      a.correct = essayPass(res.score, res.maxScore);
      if (run.isReview) {
        var rr = recordReviewAnswer(quiz, q, a.correct);
        run.reviewLast = rr;
        if (rr.mastered) run.reviewMastered++;
      }
      renderQuestion();
      var nx = document.getElementById('next-btn');
      if (nx) nx.focus();
    }).catch(function (e) {
      var a = run && run.answers[pos];
      if (!a || a.text !== text) return;
      a.grading = false;
      a.graded = false;
      a.correct = false;
      a.gradeError = (e && e.message === '__NOKEY__')
        ? t('essayNoKey')
        : t('essayGradeFail', { detail: plainError(e) });
      renderQuestion();
      var nx2 = document.getElementById('next-btn');
      if (nx2) nx2.focus();
    });
  }

  /* Read the matching picks currently on screen (the selects), falling
     back to the stored draft when the question is not on screen
     (timeout / strict auto-submit). '' means "not picked yet". */
  function readMatchingDraft(pos) {
    var q = quiz.questions[run.qIndexes[pos]];
    var picks = (q.pairs || []).map(function (_, i) {
      var sel = document.getElementById('match-select-' + i);
      if (sel) return sel.value;
      return (run.matchDrafts[pos] && run.matchDrafts[pos][i]) || '';
    });
    return picks;
  }

  function moveOrderItem(pos, idx, dir) {
    if (!run || run.answers[pos] !== null) return;
    var order = run.orderDrafts[pos];
    if (!order) return;
    var j = idx + dir;
    if (j < 0 || j >= order.length) return;
    var tmp = order[idx];
    order[idx] = order[j];
    order[j] = tmp;
    /* Re-rendering restarts the per-question countdown — save and
       restore it, like __qfRerender does on a language switch. */
    var savedLeft = run.perQLeft;
    renderQuestion();
    if (run) {
      run.perQLeft = savedLeft;
      var chip = document.getElementById('timer-perq');
      if (chip) {
        chip.textContent = fmtTime(Math.max(savedLeft, 0));
        var w = chip.closest('.tchip');
        if (w) w.classList.toggle('low', savedLeft <= 10);
      }
    }
  }

  /* Submit a matching answer. Every left item must have a partner
     picked. Graded by the fraction of correct pairs; the question
     counts as correct only when every pair matches. */
  function submitMatching(pos) {
    if (!run || run.answers[pos] !== null) return;
    var q = quiz.questions[run.qIndexes[pos]];
    var picks = readMatchingDraft(pos);
    if (picks.some(function (p) { return !p; })) {
      showToast(t('matchEmpty'));
      var first = document.querySelector('.match-select');
      if (first) first.focus();
      return;
    }
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var secs = qSecs();
    run.qShownAt = null;
    run.matchDrafts[pos] = picks.slice();
    var g = gradeMatching(q, picks);
    run.answers[pos] = {
      picks: picks, correct: g.correct, got: g.got, total: g.total,
      timedOut: false, secs: secs
    };
    if (run.isReview) {
      var r = recordReviewAnswer(quiz, q, g.correct);
      run.reviewLast = r;
      if (r.mastered) run.reviewMastered++;
    }
    renderQuestion();
    var next = document.getElementById('next-btn');
    if (next) next.focus();
  }

  /* Submit an ordering answer. Graded by the fraction of items in
     the correct position; the question counts as correct only when
     the whole order is right. */
  function submitOrdering(pos) {
    if (!run || run.answers[pos] !== null) return;
    var q = quiz.questions[run.qIndexes[pos]];
    var order = ((run.orderDrafts[pos] || []).slice());
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var secs = qSecs();
    run.qShownAt = null;
    var g = gradeOrdering(q, order);
    run.answers[pos] = {
      order: order, correct: g.correct, got: g.got, total: g.total,
      timedOut: false, secs: secs
    };
    if (run.isReview) {
      var r = recordReviewAnswer(quiz, q, g.correct);
      run.reviewLast = r;
      if (r.mastered) run.reviewMastered++;
    }
    renderQuestion();
    var next = document.getElementById('next-btn');
    if (next) next.focus();
  }

  /* Render one runCodeTests() result into a .code-results box: a
     headline (passed count, or the timeout message) plus one row per
     test with input, expected, actual output (or the error). */
  function renderCodeResults(result, container) {
    var box = container || document.getElementById('code-results');
    if (!box || !result) return;
    box.innerHTML = '';
    var head = el('div', 'verdict ' +
      ((result.passed === result.total && !result.timedOut) ? 'ok' : 'no'),
      result.timedOut ? t('codeTimeout')
        : t('codeTestsPassed', { passed: result.passed, total: result.total }));
    box.appendChild(head);
    if (result.fallback) box.appendChild(el('p', 'field-hint', t('codeFallback')));
    (result.results || []).forEach(function (r, i) {
      var row = el('div', 'test-row ' + (r.passed ? 'pass' : 'fail'));
      row.appendChild(el('div', 'test-verdict',
        (i + 1) + '. ' + (r.passed ? t('codeTestPass') : t('codeTestFail'))));
      var io = el('div', 'test-io');
      io.appendChild(el('div', null, t('codeTestInput') + r.input));
      io.appendChild(el('div', null, t('codeTestExpected') + r.expected));
      if (r.error) io.appendChild(el('div', null, t('codeTestError') + r.error));
      else io.appendChild(el('div', null, t('codeTestActual') + r.actual));
      row.appendChild(io);
      box.appendChild(row);
    });
  }

  /* Run the tests for the code currently in the editor, without
     submitting — the student can fix the code and run again. */
  function runCodingTests(pos) {
    if (!run) return;
    var q = quiz.questions[run.qIndexes[pos]];
    var editor = document.getElementById('code-editor');
    var code = editor ? editor.value : '';
    if (!code.trim()) {
      showToast(t('codeEmpty'));
      if (editor) editor.focus();
      return;
    }
    if (!run.codeDrafts) run.codeDrafts = {};
    run.codeDrafts[pos] = code;
    var box = document.getElementById('code-results');
    var runBtn = document.getElementById('code-run-btn');
    if (runBtn) runBtn.disabled = true;
    if (box) {
      box.innerHTML = '';
      box.appendChild(el('div', 'grading-note', t('codeRunning')));
    }
    runCodeTests(q, code).then(function (result) {
      result.code = code;
      if (!run.codeResults) run.codeResults = {};
      run.codeResults[pos] = result;
      if (runBtn) runBtn.disabled = false;
      renderCodeResults(result, box);
      if (result.fallback) showToast(t('codeFallback'));
    });
  }

  /* Submit a coding answer. Grades by the fraction of tests passed;
     the question counts as correct only when every test passes. A
     previous run for the exact same code is reused instead of running
     the tests again. */
  function submitCoding(pos) {
    if (!run || run.answers[pos] !== null) return;
    var q = quiz.questions[run.qIndexes[pos]];
    var editor = document.getElementById('code-editor');
    var code = editor ? editor.value
      : ((run.codeDrafts && run.codeDrafts[pos]) || q.starterCode || '');
    if (!code.trim()) {
      showToast(t('codeEmpty'));
      if (editor) editor.focus();
      return;
    }
    if (!run.codeDrafts) run.codeDrafts = {};
    run.codeDrafts[pos] = code;
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var secs = qSecs();
    run.qShownAt = null;
    var last = run.codeResults && run.codeResults[pos];
    var subBtn = document.getElementById('code-submit-btn');
    if (subBtn) subBtn.disabled = true;
    var runBtn = document.getElementById('code-run-btn');
    if (runBtn) runBtn.disabled = true;
    function finish(result) {
      var correct = result.total > 0 && result.passed === result.total && !result.timedOut;
      run.answers[pos] = {
        text: code, correct: correct, timedOut: !!result.timedOut,
        secs: secs, results: result,
        codeScore: result.passed, codeTotal: result.total
      };
      if (run.isReview) {
        var r = recordReviewAnswer(quiz, q, correct);
        run.reviewLast = r;
        if (r.mastered) run.reviewMastered++;
      }
      renderQuestion();
      var next = document.getElementById('next-btn');
      if (next) next.focus();
    }
    if (last && last.code === code) { finish(last); return; }
    var box = document.getElementById('code-results');
    if (box) {
      box.innerHTML = '';
      box.appendChild(el('div', 'grading-note', t('codeRunning')));
    }
    runCodeTests(q, code).then(function (result) {
      result.code = code;
      if (!run.codeResults) run.codeResults = {};
      run.codeResults[pos] = result;
      finish(result);
    });
  }

  function onPick(pos, displayIdx) {
    if (run.answers[pos] !== null) return;
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var correct = run.optOrders[pos][displayIdx].correct;
    run.answers[pos] = { picked: displayIdx, correct: correct, timedOut: false, secs: qSecs() };
    run.qShownAt = null;
    if (run.isReview) {
      var r = recordReviewAnswer(quiz, quiz.questions[run.qIndexes[pos]], correct);
      run.reviewLast = r;
      if (r.mastered) run.reviewMastered++;
    }
    renderQuestion();
    var next = document.getElementById('next-btn');
    if (next) next.focus();
  }

  function onTimeout() {
    if (!run || run.answers[run.current] !== null) return;
    var q = quiz.questions[run.qIndexes[run.current]];
    var qt = qType(q);
    var txt = '';
    if (qt === 'essay' || qt === 'fill' || qt === 'coding') {
      var inp = document.getElementById(qt === 'coding' ? 'code-editor' : 'free-answer-input');
      if (inp) txt = inp.value.trim();
    }
    if (qt === 'fill' && txt) {
      var fc = gradeFill(q, txt);
      run.answers[run.current] = { text: txt, correct: fc, timedOut: true, secs: qSecs() };
      if (run.isReview) run.reviewLast = recordReviewAnswer(quiz, q, fc);
    } else if (qt === 'matching') {
      /* Time ran out: keep whatever pairs were picked, unpicked
         items count as wrong. */
      var picks = readMatchingDraft(run.current);
      var gm = gradeMatching(q, picks);
      run.answers[run.current] = {
        picks: picks, correct: gm.correct, got: gm.got, total: gm.total,
        timedOut: true, secs: qSecs()
      };
      if (run.isReview) run.reviewLast = recordReviewAnswer(quiz, q, gm.correct);
    } else if (qt === 'ordering') {
      /* Time ran out: keep the order as it stands. */
      var ord = ((run.orderDrafts[run.current] || []).slice());
      var go = gradeOrdering(q, ord);
      run.answers[run.current] = {
        order: ord, correct: go.correct, got: go.got, total: go.total,
        timedOut: true, secs: qSecs()
      };
      if (run.isReview) run.reviewLast = recordReviewAnswer(quiz, q, go.correct);
    } else if (qt === 'coding') {
      /* Time ran out: keep the typed code, mark it wrong for this
         attempt, do not run the tests (time is up). */
      run.answers[run.current] = {
        text: txt, correct: false, timedOut: true, secs: qSecs(),
        codeScore: 0, codeTotal: (q.tests || []).length
      };
      if (run.isReview) run.reviewLast = recordReviewAnswer(quiz, q, false);
    } else if (qt === 'essay' && txt) {
      /* Time ran out with text typed: keep the text, mark it wrong
         for this attempt, do not grade it (time is up). */
      run.answers[run.current] = {
        text: txt, correct: false, graded: false, grading: false,
        timedOut: true, secs: qSecs()
      };
      if (run.isReview) run.reviewLast = recordReviewAnswer(quiz, q, false);
    } else {
      run.answers[run.current] = { picked: null, correct: false, timedOut: true, secs: qSecs() };
      if (run.isReview) {
        run.reviewLast = recordReviewAnswer(quiz, q, false);
      }
    }
    run.qShownAt = null;
    renderQuestion();
    var next = document.getElementById('next-btn');
    if (next) next.focus();
  }

  function nextQuestion() {
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    if (run.current < run.qIndexes.length - 1) {
      run.current++;
      renderQuestion();
    } else {
      showResults();
    }
  }

  /* ---------- quiz engine: results ---------- */

  function ringSVG(score, total, pct) {
    var C = 2 * Math.PI * 70;
    var off = (C * (1 - pct / 100)).toFixed(1);
    return '<svg class="ring" viewBox="0 0 160 160" width="150" height="150" role="img" aria-label="' +
      esc(t('ringAria', { score: score, total: total })) + '">' +
      '<circle class="ring-track" cx="80" cy="80" r="70"/>' +
      '<circle class="ring-fill" cx="80" cy="80" r="70" stroke-dasharray="' + C.toFixed(1) +
      '" stroke-dashoffset="' + off + '" transform="rotate(-90 80 80)"/>' +
      '<text class="ring-score" x="80" y="78" text-anchor="middle">' + score + '/' + total + '</text>' +
      '<text class="ring-pct" x="80" y="100" text-anchor="middle">' + pct + '%</text>' +
      '</svg>';
  }

  function showResults() {
    stopTimers();
    if (run.isReview) { showReviewResults(); return; }
    if (run) run.resultsShown = true;
    /* A strict attempt ends here: leave fullscreen, and a re-take from
       this screen starts normal unless strict is re-enabled. */
    var wasStrict = !!(run && run.strict);
    if (wasStrict) exitFullscreen();
    strictMode = false;
    var total = run.qIndexes.length;
    var score = run.answers.filter(function (a) { return a && a.correct; }).length;
    var pct = total ? Math.round(score / total * 100) : 0;
    if (!run.isRetry) saveBest(score, total, pct);
    /* Wrong answers join the persistent review queue (spaced
       repetition). Retry-wrong-only runs re-add any still-wrong ones,
       which are already queued — addWrongToReview is idempotent. */
    var wrongNow = run.qIndexes.filter(function (_, pos) {
      var a = run.answers[pos];
      return !a || !a.correct;
    });
    addWrongToReview(quiz, wrongNow);
    /* Record the completed attempt for the stats dashboard (review
       sessions never reach here — they return early above). Guarded
       by run.statsRecorded: showResults() is also the re-render
       path after a translation or a UI-language switch on this
       screen, and re-recording would duplicate the attempt. */
    if (!run.statsRecorded) {
      run.statsRecorded = true;
      recordAttempt({
      id: 'a' + Date.now().toString(36),
      ts: Date.now(),
      title: quiz.title || t('quizDefaultTitle'),
      total: total,
      score: score,
      strict: wasStrict,
      secs: Math.floor((Date.now() - run.startedAt) / 1000),
      items: run.qIndexes.map(function (qi, pos) {
        var a = run.answers[pos];
        return {
          topic: (quiz.questions[qi].topic || 'General'),
          correct: !!(a && a.correct),
          secs: (a && typeof a.secs === 'number') ? a.secs : 0
        };
      })
    });
    }

    app.innerHTML = '';
    var card = el('section', 'card results-card');
    card.appendChild(el('p', 'kicker', t('resKicker')));
    card.appendChild(el('h2', null, t('resTitle')));
    if (wasStrict) card.appendChild(el('p', 'strict-badge', t('strictResults')));

    var ringWrap = el('div', 'ring-wrap');
    var ringBox = el('div', 'ring-box');
    ringBox.innerHTML = ringSVG(score, total, pct);
    ringWrap.appendChild(ringBox);
    var side = el('div', 'ring-side');
    side.appendChild(el('div', 'big-pct', pct + '%'));
    var secs = Math.floor((Date.now() - run.startedAt) / 1000);
    side.appendChild(el('p', null, scoreMessage(pct)));
    side.appendChild(el('p', 'muted', t('resFinished', { time: fmtTime(secs), n: total })));
    var best = loadBest();
    if (best && best.bank === (quiz.title || 'Practice Quiz')) {
      side.appendChild(el('div', 'best',
        t('resBest', { score: best.score, total: best.total, pct: best.pct })));
    }
    ringWrap.appendChild(side);
    card.appendChild(ringWrap);

    var reviewTitle = el('h2', 'review-title', t('resReview'));
    card.appendChild(reviewTitle);
    run.qIndexes.forEach(function (qi, pos) {
      var q = quiz.questions[qi];
      var a = run.answers[pos];
      var opts = run.optOrders[pos];
      var correctIdx = opts.findIndex(function (o) { return o.correct; });
      var qt = qType(q);
      var item = el('div', 'review-item');
      var ungraded = qt === 'essay' && a && !a.graded && !a.timedOut;
      var status = el('span', 'status-chip ' + ((a && a.correct) ? 'ok' : (ungraded ? 'pend' : 'no')),
        a && a.correct ? t('resCorrect')
          : (ungraded ? t('essayNotGraded')
            : (a && a.timedOut ? t('resTimeout') : t('resWrong'))));
      item.appendChild(status);
      item.appendChild(el('div', 'rq', (pos + 1) + '. ' + q.question));
      if (q.code) {
        var pre = el('pre', 'q-code');
        pre.textContent = q.code;
        item.appendChild(pre);
      }
      var yours = (a && a.picked !== null && a.picked !== undefined) ? opts[a.picked].text : null;
      var line = el('div', 'ra');
      if (qt === 'essay') {
        line.appendChild(document.createTextNode(t('essayYourAnswer')));
        line.appendChild(el('span', 'yours' + ((a && a.correct) ? ' ok' : ''),
          (a && a.text) ? a.text : t('resNoAnswer')));
        item.appendChild(line);
        if (a && a.graded) {
          var fb = el('div', 'rex');
          fb.appendChild(el('b', null, t('essayScore', { score: a.score, max: a.maxScore }) + ' · '));
          fb.appendChild(document.createTextNode((a.feedback || '')));
          item.appendChild(fb);
        } else if (a && !a.timedOut) {
          var ng = el('div', 'rex');
          ng.appendChild(document.createTextNode(a.gradeError || t('essayNoKey')));
          item.appendChild(ng);
          var rb = el('div', 'rex');
          rb.appendChild(el('b', null, t('essayRubric')));
          rb.appendChild(document.createTextNode(q.rubric));
          item.appendChild(rb);
        }
      } else if (qt === 'fill') {
        line.appendChild(document.createTextNode(t('fillYourAnswer')));
        line.appendChild(el('span', 'yours' + ((a && a.correct) ? ' ok' : ''),
          ((a && a.correct) ? '✓ ' : '✗ ') + ((a && a.text) ? a.text : t('resNoAnswer'))));
        if (!(a && a.correct)) {
          line.appendChild(document.createTextNode(t('fillAccepted')));
          line.appendChild(el('span', 'right', (q.answers || []).join(', ')));
        }
        item.appendChild(line);
      } else if (qt === 'matching') {
        line.appendChild(document.createTextNode(
          t('matchScore', { n: (a && a.got) || 0, total: (a && a.total) || (q.pairs || []).length })));
        item.appendChild(line);
        (q.pairs || []).forEach(function (p, i) {
          var ok = a && a.picks && a.picks[i] === p.right;
          var pl = el('div', 'ra');
          pl.appendChild(document.createTextNode(
            p.left + ' → ' + ((a && a.picks && a.picks[i]) || t('resNoAnswer')) +
            (ok ? ' ✓' : ' ✗ · ' + t('matchCorrectPairs') + p.right)));
          item.appendChild(pl);
        });
      } else if (qt === 'ordering') {
        line.appendChild(document.createTextNode(
          t('orderScore', { n: (a && a.got) || 0, total: (a && a.total) || (q.items || []).length })));
        item.appendChild(line);
        var ol = el('div', 'ra');
        ol.appendChild(el('b', null, t('orderYourOrder')));
        ol.appendChild(document.createTextNode(
          ((a && a.order) || []).map(function (s, i) {
            var ok = q.items[i] === s;
            return (i + 1) + '. ' + s + (ok ? ' ✓' : ' ✗');
          }).join(' · ') || t('resNoAnswer')));
        item.appendChild(ol);
        var oc = el('div', 'ra');
        oc.appendChild(el('b', null, t('orderCorrectOrder')));
        oc.appendChild(document.createTextNode(
          (q.items || []).map(function (s, i) { return (i + 1) + '. ' + s; }).join(' · ')));
        item.appendChild(oc);
      } else if (qt === 'coding') {
        line.appendChild(document.createTextNode(t('codeYourCode')));
        item.appendChild(line);
        var codePre = el('pre', 'q-code code-answer');
        codePre.textContent = (a && a.text) ? a.text : t('resNoAnswer');
        item.appendChild(codePre);
        if (a && a.results) {
          var resBox = el('div', 'code-results');
          item.appendChild(resBox);
          renderCodeResults(a.results, resBox);
        } else if (a && a.timedOut) {
          item.appendChild(el('div', 'rex', t('resTimeout')));
        }
        if (a) {
          var sc = el('div', 'rex');
          sc.appendChild(el('b', null, t('codeScore', {
            passed: a.codeScore || 0,
            total: a.codeTotal || (q.tests || []).length
          })));
          item.appendChild(sc);
        }
      } else if (a && a.correct) {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours ok', '✓ ' + yours));
        item.appendChild(line);
      } else if (a && a.timedOut) {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours', t('resNoAnswerTimeout')));
        line.appendChild(document.createTextNode(t('resCorrectIs')));
        line.appendChild(el('span', 'right', LETTERS[correctIdx] + ') ' + opts[correctIdx].text));
        item.appendChild(line);
      } else {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours', '✗ ' + (yours !== null ? yours : t('resNoAnswer'))));
        line.appendChild(document.createTextNode(t('resCorrectIs')));
        line.appendChild(el('span', 'right', LETTERS[correctIdx] + ') ' + opts[correctIdx].text));
        item.appendChild(line);
      }
      if (q.explanation) {
        var rex = el('div', 'rex');
        rex.appendChild(el('b', null, t('quizWhy')));
        rex.appendChild(document.createTextNode(q.explanation));
        item.appendChild(rex);
      }
      card.appendChild(item);
    });

    var row = el('div', 'btnrow');
    var wrongIndexes = run.qIndexes.filter(function (_, pos) {
      var a = run.answers[pos];
      return !a || !a.correct;
    });
    if (wrongIndexes.length > 0) {
      var retryWrong = el('button', 'btn btn-primary', t('resRetryWrong', { n: wrongIndexes.length }));
      retryWrong.addEventListener('click', function () { startQuiz(wrongIndexes); });
      row.appendChild(retryWrong);
      addReviewButton(quiz, row, true);
    }
    var again = el('button', 'btn btn-secondary', t('resAgain'));
    again.addEventListener('click', function () { startQuiz(); });
    row.appendChild(again);
    var home = el('button', 'btn btn-secondary', t('resBackTopics'));
    home.addEventListener('click', function () { showStart(); });
    row.appendChild(home);
    var printRes = el('button', 'btn btn-secondary', t('printBtn'));
    printRes.addEventListener('click', function () { printExam(); });
    row.appendChild(printRes);
    var shareRes = el('button', 'btn btn-secondary', t('shareBtn'));
    shareRes.addEventListener('click', function () { shareExam(quiz, row); });
    row.appendChild(shareRes);
    addTranslateButton(row);
    addFlashcardsButton(quiz, row);
    var statsBtn = el('button', 'btn btn-secondary', t('resStats'));
    statsBtn.addEventListener('click', function () { setView('stats'); });
    row.appendChild(statsBtn);
    card.appendChild(row);
    app.appendChild(card);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- smart review: session results ----------
     Reached instead of showResults when run.isReview. Nothing here
     touches the best score or the library — only the review queue,
     which onPick/onTimeout already updated. */
  function showReviewResults() {
    stopTimers();
    if (run) run.reviewDone = true;
    var bank = run.reviewBank || quiz;
    var total = run.reviewTotal || run.qIndexes.length;
    var mastered = run.reviewMastered || 0;
    var remaining = reviewCountFor(bank);
    app.innerHTML = '';
    var card = el('section', 'card results-card');
    card.appendChild(el('p', 'kicker', t('revKicker')));
    card.appendChild(el('h2', null, t('revSessionTitle')));
    card.appendChild(el('p', 'hero-text', t('revHero')));
    var stats = el('div', 'stats');
    stats.appendChild(statChip(t('revMasteredCount', { n: mastered })));
    stats.appendChild(statChip(t('revRemaining', { n: remaining })));
    card.appendChild(stats);
    if (remaining === 0) {
      card.appendChild(el('p', 'best', t('revAllMastered')));
    } else {
      card.appendChild(el('p', 'muted',
        t('revProgress', { done: total - remaining, total: total })));
    }
    var row = el('div', 'btnrow');
    if (remaining > 0) {
      var cont = el('button', 'btn btn-primary', t('revContinue', { n: remaining }));
      cont.addEventListener('click', function () { startReview(bank); });
      row.appendChild(cont);
    }
    var backExam = el('button', 'btn btn-secondary', t('revBackTopics'));
    backExam.addEventListener('click', function () { showStart(); });
    row.appendChild(backExam);
    var backLib = el('button', 'btn btn-secondary', t('revBack'));
    backLib.addEventListener('click', function () { setView('library'); });
    row.appendChild(backLib);
    if (remaining > 0) {
      var clr = el('button', 'btn btn-secondary', t('revClear'));
      clr.addEventListener('click', function () {
        clearReviewFor(bank);
        showToast(t('revCleared'));
        setView('library');
      });
      row.appendChild(clr);
    }
    card.appendChild(row);
    app.appendChild(card);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- keyboard shortcuts ---------- */

  document.addEventListener('keydown', function (e) {
    if (!run) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var state = run.answers[run.current];
    if (!state && /^[1-6]$/.test(e.key)) {
      var idx = parseInt(e.key, 10) - 1;
      if (idx < run.optOrders[run.current].length) {
        e.preventDefault();
        onPick(run.current, idx);
      }
    } else if (state && e.key === 'Enter') {
      e.preventDefault();
      nextQuestion();
    }
  });

  /* ---------- dark mode toggle ---------- */

  document.getElementById('dark-toggle').addEventListener('click', function () {
    var dark = !document.body.classList.contains('dark');
    try { localStorage.setItem(LS_DARK, dark ? '1' : '0'); } catch (e) {}
    applyDark();
  });

  /* ---------- load error ---------- */

  function showLoadError(err) {
    var box = el('div', 'error');
    box.innerHTML =
      '<b>' + esc(t('loadErrTitle')) + '</b><br>' +
      esc(t('loadErrBody')) + '<br><br>' +
      '<code>' + esc(t('loadErrCmd')) + '</code><br>' +
      esc(t('loadErrOpen')) + '<br><br>' +
      esc(t('loadErrDetails')) + esc(err.message);
    app.innerHTML = '';
    app.appendChild(box);
  }

  /* ---------- boot ---------- */

  /* A share link pasted into a tab where the app is already open
     (same-document navigation) still loads the exam. */
  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf(SHARE_HASH) === 0) loadSharedExamFromHash();
  });

  /* ---------- offline mode / PWA (Feature 14) ---------- */

  /* Offline indicator: a small bar under the header, shown only while
     the browser reports offline. Online/offline events keep it live. */
  function updateOfflineUI() {
    var bar = document.getElementById('offline-bar');
    if (bar) bar.hidden = !isOffline();
  }
  window.addEventListener('online', updateOfflineUI);
  window.addEventListener('offline', updateOfflineUI);
  updateOfflineUI();

  /* Service worker: caches the app shell so the app loads and works
     offline. Registration is best-effort — file:// or an insecure
     context simply skips it and the app works exactly as before. */
  try {
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  } catch (e) {}

  /* Install prompt: the header button only appears when the browser
     offers installation (beforeinstallprompt). */
  var deferredInstall = null;
  var installBtn = document.getElementById('install-btn');
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
    if (installBtn) installBtn.hidden = false;
  });
  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall = null;
      installBtn.hidden = true;
    });
  }

  applyDark();
  wireSettingsPanel();
  wireNav();
  fetch('questions.json')
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' while fetching questions.json');
      return res.json();
    })
    .then(function (data) {
      validate(data);
      quiz = data;
      sampleQuiz = data;
      if (location.hash.indexOf(SHARE_HASH) === 0) loadSharedExamFromHash();
      else setView('create');
    })
    .catch(showLoadError);
})();
