/* QuizForge — turn any material into exams.
   Static site, no build step: plain HTML/CSS/JS. The quiz engine (timer,
   shuffle, review, retry-wrong-only, topics, best score, dark mode) is the
   Practice Quiz Builder engine, refactored to take any bank object
   {title, subtitle, questions[]}. Exam generation is bring-your-own-key:
   the user's API key lives only in their own browser's localStorage and is
   sent only to the provider they choose. */
/* Sections (in file order): helpers - validation - question types -
   persistence - smart review - flashcards - views/navigation - wizard
   (steps 1-4) - provider calls - translation - generation - summary -
   variant - chat - past-exam analysis - library & backup - print -
   cheat sheet - stats - share - settings panel - quiz engine (timers,
   start, TTS, oral, run, results) - shortcuts - boot. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var quiz = null;         // current question bank {title, subtitle, questions[]}
  var sampleQuiz = null;   // the bundled questions.json demo bank
  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  /* Option letter for a 0-based option index. LETTERS only covers
     A–F, but validate() allows any option count (an imported bank
     can have 7+ options), so anything past F falls back to its
     1-based number instead of printing "undefined". A missing or
     negative index (no correct option found) renders as nothing,
     never "NaN" or "undefined". */
  function letterFor(idx) {
    if (typeof idx !== 'number' || !isFinite(idx) || idx < 0) return '';
    return LETTERS[idx] || String(idx + 1);
  }
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
  var TTS_RATES = [0.8, 1, 1.25]; // Slow / Normal / Fast reading speeds

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
  /* JSZip (docx/pptx) loads LAZILY, only when a Word or PowerPoint
     file is added — same pattern as pdf.js / SheetJS above. Both are
     ZIP archives of XML, so no heavier reader is needed. */
  var JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  var CHUNK_CHARS = 12000;
  /* Fresh variant (Feature 3 of the new queue, 2026-11-22): the exam's
     source material is stored with the exam so a new variant can be
     generated from it later. Very long material is not stored — the
     variant button simply does not appear for that exam — so one exam
     can never eat the whole localStorage quota. */
  var VARIANT_MATERIAL_MAX = 200000;

  var settings = loadSettings();   // { shuffle, perQTimer, perQSeconds, autoRead, speechRate }
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
  /* Oral exam mode (2026-11-22): per-exam toggle on the start screen,
     off by default. oralMode is the toggle state; run.oral is the
     live flag on the attempt (review sessions never run oral). */
  var oralMode = false;
  /* Exam translation (Feature 12): the original questions are kept
     untouched in trState.original; quiz.questions is swapped between
     the original and the translated copy. trState.bank remembers
     which bank object was translated, so loadBank() can restore it
     before clearing the state. */
  var trState = { original: null, translated: null, lang: null, sourceLang: null, bank: null, busy: false };
  var currentView = 'create';      // 'create' | 'library' | 'stats' | 'quiz' | 'chat' | 'past' | 'summary' | 'flashcards' | 'cheatsheet'

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
  var material = { files: [], pasted: '', text: '', pdfPages: 0, pptxSlides: 0, pdfFailed: false, readError: '', sourceUrl: '' };
  // material.files: [{name, size, kind: 'pdf'|'text'|'bank'|'docx'|'pptx', chars, pages?}]
  var byok = loadByok();    // {provider, apiKey, model, baseUrl, proxyUrl}
  var genState = { busy: false, error: '', progress: '', lastBank: null };
  var variantBusy = false;   // one variant generation at a time

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

  /* Today's date as YYYY-MM-DD, the library's date stamp. */
  function todayStr() { return new Date().toISOString().slice(0, 10); }

  /* Unique library-entry id: prefix + timestamp + random suffix, so
     two imports in the same millisecond still get different ids. */
  function newId(prefix) {
    return prefix + '-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
  }

  /* Status boxes: a small message line under a screen header
     (#backup-status, #import-error, #gen-success). One helper for
     showing (sets the text and reveals it) and one for hiding, so
     call sites stop repeating the two-line pattern - and so a message
     never lands in a box that does not exist. */
  function showStatusBox(box, msg) {
    if (!box) return;
    box.textContent = msg;
    box.classList.add('show');
  }

  function hideStatusBox(box) {
    if (box) box.classList.remove('show');
  }

  /* Both file imports (a single bank, a whole-library backup) show
     the same "could not read the file" message in #import-error. */
  function showImportReadError() {
    showStatusBox(document.getElementById('import-error'), t('libReadErr'));
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
      } else if (qt === 'tf') {
        /* True/False: two options, an in-range answer, and a
           REQUIRED justification — a statement without its reason
           is rejected, like an essay without a rubric. The repair
           (explanation -> justification) happens in
           parseQuestionsResponse / the import paths before this
           runs, so a question that reaches here with no
           justification at all has nothing to repair from. */
        if (!Array.isArray(q.options) || q.options.length < 2)
          throw new Error(t('valOptions', { n: n }));
        if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length)
          throw new Error(t('valAnswerRange', { n: n }));
        if (typeof q.justification !== 'string' || !q.justification.trim())
          throw new Error(t('valTfJustification', { n: n }));
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

  /* ---------- True/False with justification (2026-11-22) ----------
     A 'tf' question is a statement with two options ("True" /
     "False") and a REQUIRED "justification" — the reason the
     statement is true or false, grounded in the material. The
     justification is the point of the type: it is shown right
     after answering and prominently in the results review, on the
     flashcard back, in the print answer key, and it travels with
     the exam through translation and sharing.
     - tfDisplayText: the two option labels are UI chrome, not
       content, so the standard English words are shown in the UI
       language (True/False in English, صح/خطأ in Arabic).
       Anything else the provider stored is shown as-is.
     - tfJustification: the justification, falling back to the
       generic explanation for older banks that never had one, so
       nothing already saved ever shows a blank reason.
     - repairTfQuestions: copy "explanation" into a missing
       "justification" — the repair half of "reject or repair"
       (see validate). */
  function tfDisplayText(text) {
    var s = String(text == null ? '' : text).trim();
    if (/^true$/i.test(s)) return t('tfTrue');
    if (/^false$/i.test(s)) return t('tfFalse');
    return text;
  }

  function tfJustification(q) {
    if (q && typeof q.justification === 'string' && q.justification.trim())
      return q.justification;
    if (q && typeof q.explanation === 'string' && q.explanation.trim())
      return q.explanation;
    return '';
  }

  function repairTfQuestions(data) {
    if (!data || !Array.isArray(data.questions)) return data;
    data.questions.forEach(function (q) {
      if (q && qType(q) === 'tf' &&
        !(typeof q.justification === 'string' && q.justification.trim()) &&
        typeof q.explanation === 'string' && q.explanation.trim()) {
        q.justification = q.explanation;
      }
    });
    return data;
  }

  /* Test/debug handle (like window.__qfSheet / __qfChat): the pure
     True/False helpers, for the headless smoke test. */
  window.__qfTf = {
    displayText: tfDisplayText,
    justificationOf: tfJustification,
    repair: repairTfQuestions
  };

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

  /* Shared localStorage access (Phase 2 hardening): every read
     tolerates a missing key, corrupt JSON or a denied store and
     falls back to the default; every write reports success, so a
     full quota is never a silent lost save — callers that must not
     lose data (library saves) check the return value. */
  function lsGetJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function lsSetJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  function loadSettings() {
    var d = { shuffle: true, perQTimer: false, perQSeconds: 60, autoRead: false, speechRate: 1 };
    var s = lsGetJSON(LS_SETTINGS, null);
    if (s && typeof s === 'object') {
      if (typeof s.shuffle === 'boolean') d.shuffle = s.shuffle;
      if (typeof s.perQTimer === 'boolean') d.perQTimer = s.perQTimer;
      if (typeof s.perQSeconds === 'number' && s.perQSeconds >= 5 && s.perQSeconds <= 600)
        d.perQSeconds = Math.round(s.perQSeconds);
      if (typeof s.autoRead === 'boolean') d.autoRead = s.autoRead;
      if (typeof s.speechRate === 'number' && TTS_RATES.indexOf(s.speechRate) !== -1)
        d.speechRate = s.speechRate;
    }
    return d;
  }

  function saveSettings() {
    lsSetJSON(LS_SETTINGS, settings);
  }

  function loadBest() {
    var best = lsGetJSON(LS_BEST, null);
    /* A hand-edited or older value without a numeric best percentage
       is not a best score — without this, saveBest() would compare
       against undefined and never record a new best. */
    return (best && typeof best === 'object' && typeof best.pct === 'number') ? best : null;
  }

  function saveBest(score, total, pct) {
    var best = loadBest();
    if (!best || pct > best.pct) {
      lsSetJSON(LS_BEST, {
        score: score, total: total, pct: pct,
        bank: quiz.title || 'Practice Quiz',
        date: todayStr()
      });
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
    var s = lsGetJSON(LS_BYOK, null);
    if (s && typeof s === 'object') {
      if (s.provider && PROVIDERS[s.provider]) d.provider = s.provider;
      if (typeof s.apiKey === 'string') d.apiKey = s.apiKey;
      if (typeof s.model === 'string') d.model = s.model;
      if (typeof s.baseUrl === 'string') d.baseUrl = s.baseUrl;
      if (typeof s.proxyUrl === 'string') d.proxyUrl = s.proxyUrl;
    }
    return d;
  }

  function saveByok() {
    lsSetJSON(LS_BYOK, byok);
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
    var s = lsGetJSON(LS_WIZ, null);
    if (s && typeof s === 'object') {
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
      /* A hand-edited or corrupt value must never reach the AI
         prompt as-is: only the known difficulties / languages are
         accepted, anything else falls back to the defaults. */
      if (['Easy', 'Medium', 'Hard', 'Mixed'].indexOf(s.difficulty) !== -1) d.difficulty = s.difficulty;
      if (['English', 'Arabic'].indexOf(s.language) !== -1) d.language = s.language;
      if (typeof s.focus === 'string') d.focus = s.focus;
      if (typeof s.perQTimer === 'boolean') d.perQTimer = s.perQTimer;
    }
    return d;
  }

  function saveWizard() {
    lsSetJSON(LS_WIZ, wiz);
  }

  function loadLibrary() {
    var list = lsGetJSON(LS_LIB, []);
    return Array.isArray(list) ? list : [];
  }

  /* Returns true when the library was actually written. A full
     quota (QuotaExceededError) returns false instead of failing
     silently — generation and import check this and say so. */
  function saveLibrary(list) {
    var ok = lsSetJSON(LS_LIB, list);
    updateLibCount();
    return ok;
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
    var d = lsGetJSON(LS_REVIEW, {});
    return d && typeof d === 'object' ? d : {};
  }

  function saveReview(d) {
    lsSetJSON(LS_REVIEW, d);
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
      if (!items[id]) items[id] = { streak: 0, added: todayStr() };
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

  /* One place for "this answer counts in a review session": correct
     bumps the streak (REV_NEEDED in a row masters the question),
     wrong resets it to 0, and an ungraded answer (correct === null:
     essay/oral with no key, or grading that failed) leaves the
     streak untouched instead of punishing a question that was never
     actually graded. Also keeps run.reviewMastered in sync, so the
     review-results screen counts mastered questions correctly. */
  function applyReviewResult(q, correct) {
    if (!run || !run.isReview) return;
    if (correct === null || correct === undefined) {
      run.reviewLast = { streak: reviewStreak(quiz, q), mastered: false };
      return;
    }
    var r = recordReviewAnswer(quiz, q, correct);
    run.reviewLast = r;
    if (r.mastered) run.reviewMastered++;
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
    var list = lsGetJSON(LS_STATS, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (a) {
      return a && typeof a === 'object' && Array.isArray(a.items) &&
        typeof a.total === 'number' && typeof a.score === 'number';
    });
  }

  function saveStats(list) {
    lsSetJSON(LS_STATS, list);
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
    stopSpeech();
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
    stopSpeech();
    var n = fc.pos + d;
    if (n < 0 || n >= fc.order.length) return;
    fc.pos = n;
    fc.flipped = false;
    renderFlashcards();
  }

  function fcToggleShuffle() {
    if (!fc) return;
    stopSpeech();
    fc.shuffled = !fc.shuffled;
    /* Off means back to the exam's own order — re-shuffling on
       every toggle would make "off" a lie. */
    fc.order = fc.shuffled
      ? shuffle(fc.bank.questions.map(function (_, i) { return i; }))
      : fc.bank.questions.map(function (_, i) { return i; });
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
    /* Read this card aloud. The spoken order for matching / ordering
       is the scrambled one (never the paired / correct order), so
       the answer is not given away. The button stops the click from
       reaching the card, so listening never flips it. */
    var fcSpeak = makeSpeakButton(q,
      qt === 'matching' ? { rights: scrambleRights(q, false) } :
      qt === 'ordering' ? { items: scrambleItems(q, false) } : null);
    if (fcSpeak) {
      fcSpeak.id = 'fc-speak-btn';
      front.appendChild(fcSpeak);
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
      var letter = letterFor(q.answer);
      var ansText = qt === 'tf' ? tfDisplayText(q.options[q.answer]) : q.options[q.answer];
      backFace.appendChild(el('p', 'fc-answer', t('fcAnswer') + (letter ? letter + ' — ' : '') + ansText));
    }
    /* True/False justification on the back of the card — the point
       of the type. The generic explanation is skipped when the
       justification is shown, so the same reason is never printed
       twice. */
    if (qt === 'tf' && tfJustification(q)) {
      backFace.appendChild(el('p', 'fc-why', t('tfJustification') + tfJustification(q)));
    } else if (q.explanation) {
      backFace.appendChild(el('p', 'fc-why', t('printWhy') + q.explanation));
    }
    backFace.appendChild(el('p', 'fc-hint', t('fcFlipHint')));
    inner.appendChild(backFace);

    card.appendChild(inner);
    card.addEventListener('click', function () { fcFlip(); });
    card.addEventListener('keydown', function (e) {
      /* Only flip when the card itself has focus — a focused button
         inside it (e.g. the speaker button) handles its own keys. */
      if (e.target !== card) return;
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
     direction is left, so the arrow mapping follows the page dir.
     Arrows work even when a button has focus (arrows never activate
     a button); Space/Enter are left to the focused button itself,
     or to the card when it has focus, so one press never flips on
     top of the button's own action. */
  document.addEventListener('keydown', function (e) {
    if (!fc) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (tag === 'BUTTON') return;
      if (e.target && e.target.id === 'fc-card') return;
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
    /* Leaving mid-quiz from the nav tabs would silently throw the
       attempt away: confirm first. Results/review-done screens and
       the 'quiz' target (loadBank) never ask. */
    if (run && !run.resultsShown && !run.reviewDone &&
      (v === 'create' || v === 'library' || v === 'stats')) {
      if (!window.confirm(t('quizExitConfirm'))) return;
    }
    currentView = v;
    /* An intentional exit is not a fullscreen escape: mark the
       attempt warned so the fullscreenchange handler stays silent. */
    if (run && run.strict) strictWarned = true;
    if (run && run.strict) exitFullscreen();
    stopTimers();
    stopSpeech();
    stopOralRecognition();
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
    /* A language switch stops any reading in progress — the new
       screen re-renders in the new language. */
    stopSpeech();
    if (currentView === 'create') renderWizard();
    else if (currentView === 'summary') {
      if (sumState.data || (quiz && quiz.summary)) showSummaryScreen(sumReturn);
      else renderWizard();
    }
    else if (currentView === 'library') renderLibrary();
    else if (currentView === 'chat') {
      if (chatState) renderChat();
      else setView('library');
    }
    else if (currentView === 'past') {
      if (pastState) renderPast();
      else setView('library');
    }
    else if (currentView === 'stats') renderStats();
    else if (currentView === 'cheatsheet') {
      if (cheatState.sheet) showCheatSheet(cheatState.sheet, cheatState.returnTo);
      else if (run && run.resultsShown) showResults();
      else renderStats();
    }
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
    /* refreshFileList() also runs inside renderStepUpload, but there
       the new card is still detached, so getElementById finds nothing
       and the file list stays empty after a re-render (e.g. a language
       switch) even though the material is still there — refresh once
       the wizard is attached. Harmless on other steps: the elements
       do not exist and refreshFileList returns early. */
    if (wiz.step === 1) refreshFileList();
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
    picker.accept = '.pdf,.docx,.pptx,.txt,.md,.json,.csv,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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

    /* ----- Generate questions from a link (2026-11-22) -----
       A URL input + Fetch button: the page text becomes material and
       flows into the existing generation pipeline unchanged. Direct
       fetch first; on failure a clear message + paste fallback right
       here. An opt-in, labelled checkbox may route the URL through
       the public reader service r.jina.ai — never silently. */
    var urlBox = el('div', 'url-box');
    urlBox.appendChild(el('h3', null, t('urlTitle')));
    urlBox.appendChild(el('p', 'hero-text', t('urlHero')));
    var urlLabel = el('label', 'field-label', t('urlLabel'));
    urlLabel.htmlFor = 'url-input';
    urlBox.appendChild(urlLabel);
    var urlRow = el('div', 'url-row');
    var urlInput = document.createElement('input');
    urlInput.id = 'url-input';
    urlInput.type = 'url';
    urlInput.className = 'input';
    urlInput.placeholder = t('urlPh');
    urlInput.setAttribute('dir', 'ltr');
    urlInput.style.textAlign = 'left';
    urlInput.value = material.sourceUrl || '';
    urlRow.appendChild(urlInput);
    var urlFetchBtn = el('button', 'btn btn-primary btn-small', t('urlFetch'));
    urlFetchBtn.id = 'url-fetch-btn';
    urlFetchBtn.type = 'button';
    urlFetchBtn.addEventListener('click', function () { fetchUrlMaterial(); });
    urlRow.appendChild(urlFetchBtn);
    urlBox.appendChild(urlRow);
    var urlProxyRow = el('label', 'url-proxy-row');
    var urlProxyOpt = document.createElement('input');
    urlProxyOpt.id = 'url-proxy-opt';
    urlProxyOpt.type = 'checkbox';
    urlProxyRow.appendChild(urlProxyOpt);
    urlProxyRow.appendChild(document.createTextNode(' ' + t('urlProxyOpt')));
    urlBox.appendChild(urlProxyRow);
    var urlStatus = el('div', 'bank-error');
    urlStatus.id = 'url-status';
    urlBox.appendChild(urlStatus);
    /* Paste fallback — hidden until a fetch fails (or the browser is
       offline), so the failure is never silent and never a dead end. */
    var urlFallback = el('div', 'url-fallback');
    urlFallback.id = 'url-fallback';
    urlFallback.hidden = true;
    var urlPasteLabel = el('label', 'field-label', t('urlPasteLabel'));
    urlPasteLabel.htmlFor = 'url-paste';
    urlFallback.appendChild(urlPasteLabel);
    var urlPasteTa = document.createElement('textarea');
    urlPasteTa.id = 'url-paste';
    urlPasteTa.className = 'input textarea';
    urlPasteTa.rows = 5;
    urlPasteTa.placeholder = t('urlPastePh');
    urlFallback.appendChild(urlPasteTa);
    var urlPasteBtn = el('button', 'btn btn-secondary btn-small', t('urlPasteUse'));
    urlPasteBtn.id = 'url-paste-btn';
    urlPasteBtn.type = 'button';
    urlPasteBtn.addEventListener('click', function () { useUrlPaste(); });
    urlFallback.appendChild(urlPasteBtn);
    urlBox.appendChild(urlFallback);
    card.appendChild(urlBox);

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

    /* Past-exam analysis (Feature 2, 2026-11-22): same entry point
       from the create tab, for students starting from old exams. */
    var pastRow = el('div', 'btnrow sum-row');
    var pastStepBtn = el('button', 'btn btn-secondary', t('pastBtn'));
    pastStepBtn.id = 'past-btn-step1';
    pastStepBtn.type = 'button';
    pastStepBtn.addEventListener('click', function () { openPastAnalysis(); });
    pastRow.appendChild(pastStepBtn);
    card.appendChild(pastRow);

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
      row.appendChild(el('span', 'file-ic', f.kind === 'pdf' ? '📕' : (f.kind === 'bank' ? '🗂️' : (f.kind === 'docx' ? '📄' : (f.kind === 'pptx' ? '📽️' : (f.kind === 'url' ? '🔗' : '📝'))))));
      var meta = el('div', 'file-meta');
      meta.appendChild(el('span', 'file-name', f.name));
      var sub = f.kind === 'pdf'
        ? fmtSize(f.size) + ' · ' + t('s1PagesLabel', { n: f.pages }) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() })
        : f.kind === 'pptx'
          ? fmtSize(f.size) + ' · ' + t('s1SlidesLabel', { n: f.pages }) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() })
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
      if (material.pptxSlides) parts.push(t('s1SlidesLabel', { n: material.pptxSlides }));
      parts.push(t('s1CharsTotal', { n: chars.toLocaleString() }));
      summary.textContent = chars > 0
        ? t('s1Ready', { parts: parts.join(' · ') })
        : t('s1NoMaterial');
    }
    if (pdfNote) {
      pdfNote.textContent = material.readError || (material.pdfFailed ? t('s1PdfFail') : '');
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
      material.pptxSlides = material.files.reduce(function (sum, g) {
        return sum + (g.kind === 'pptx' ? (g.pages || 0) : 0);
      }, 0);
    }
    /* A removed link takes its source URL with it — the source is
       always the latest remaining link, or nothing. */
    if (f.kind === 'url') {
      var remaining = material.files.filter(function (g) { return g.kind === 'url'; });
      material.sourceUrl = remaining.length ? remaining[remaining.length - 1].name : '';
      var urlInput = document.getElementById('url-input');
      if (urlInput) urlInput.value = material.sourceUrl;
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
    if (lower.endsWith('.docx')) return addDocxFile(file);
    if (lower.endsWith('.pptx')) return addPptxFile(file);
    if (lower.endsWith('.json')) return addJsonFile(file);
    if (lower.endsWith('.xlsx')) return addXlsxFile(file);
    if (lower.endsWith('.csv')) return addCsvFile(file);
    // .txt / .md / anything else readable as text
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        pushMaterial({ name: name, size: file.size, kind: 'text', chars: text.length, pages: 0 }, text);
        noteNonUtf8(name, text);
        resolve();
      };
      reader.onerror = function () { reject(new Error(t('errReadFile', { name: name }))); };
      reader.readAsText(file);
    });
  }

  function pushMaterial(meta, text) {
    clearSummary();
    material.readError = '';
    /* A later file that reads fine clears the stale "PDF failed"
       flag too — otherwise the failure note would survive even
       after a successful upload. */
    material.pdfFailed = false;
    meta.text = text;
    meta.start = material.text.length;
    material.text += (material.text ? '\n\n' : '') + text;
    meta.chars = text.length;
    material.files.push(meta);
    if (meta.kind === 'pdf') material.pdfPages += (meta.pages || 0);
    if (meta.kind === 'pptx') material.pptxSlides += (meta.pages || 0);
  }

  /* A text file that is not valid UTF-8 is read with replacement
     characters (U+FFFD) — silently garbled material would make
     garbled questions. Keep the text, but warn plainly so the
     student can re-save the file as UTF-8 or paste it instead.
     Called after pushMaterial(), which clears readError. */
  function noteNonUtf8(name, text) {
    if (String(text || '').indexOf('\uFFFD') !== -1)
      material.readError = t('txtNonUtf8', { name: name });
  }

  /* ---------- generate questions from a link (2026-11-22) ----------
     Paste a URL, fetch the page client-side, extract its readable
     text and push it as material (kind 'url'), so the existing
     pipeline — chunking, settings, provider, save with material —
     runs unchanged. The source URL is kept on material.sourceUrl and
     stored with the saved exam.
     - Direct fetch first. Many sites block cross-origin fetches, so
       a failure shows a plain message and offers the paste fallback
       right there — never a silent failure, never a fake fetch.
     - Reader service: only if the student ticks the labelled box,
       the URL may go through the public reader r.jina.ai (no key,
       plain fetch). It is never used silently.
     - Very long pages are capped at VARIANT_MATERIAL_MAX (200,000
       chars, the same cap used elsewhere) with a plain note.
     - Non-HTML responses (plain text) are used as-is. Extracted text
       keeps headings/paragraphs/list items only — links are dropped
       to their text, so there are no relative URLs left to resolve;
       the stored source URL itself is always absolute. */
  var URL_FETCH_TIMEOUT_MS = 30000;
  var READER_BASE = 'https://r.jina.ai/';

  function normalizeUrl(raw) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    /* A URL never contains a literal space — Chrome's URL parser
       would silently percent-encode one ('not a url' becomes a
       "valid" https URL), so reject whitespace up front. */
    if (/\s/.test(s)) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
    try {
      var u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch (e) { return null; }
  }

  function readerUrlFor(pageUrl) {
    return READER_BASE + pageUrl;
  }

  function extractReadableText(html, baseUrl) {
    var doc;
    try {
      doc = new DOMParser().parseFromString(html, 'text/html');
    } catch (e) { return ''; }
    if (!doc || !doc.body) return '';
    /* DOMParser never runs scripts, but the tags are still in the
       tree — drop everything that is not readable content. */
    var drop = doc.querySelectorAll('script, style, noscript, iframe, svg, form, button, input, select, textarea, nav, header, footer, aside');
    Array.prototype.forEach.call(drop, function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    /* Prefer the article/main content when the page marks it. */
    var root = doc.querySelector('article') || doc.querySelector('main') || doc.body;
    var nodes = root.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, td, th, figcaption');
    var parts = [];
    Array.prototype.forEach.call(nodes, function (n) {
      /* Skip text that lives inside a nested picked node (a <p>
         inside an <li> would otherwise appear twice). */
      var p = n.parentNode;
      var nested = false;
      while (p && p !== root) {
        if (p.tagName && /^(H1|H2|H3|H4|P|LI|BLOCKQUOTE|TD|TH|FIGCAPTION)$/.test(p.tagName)) { nested = true; break; }
        p = p.parentNode;
      }
      if (nested) return;
      var txt = (n.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt) parts.push(txt);
    });
    if (!parts.length) {
      var bodyTxt = (root.textContent || '').replace(/\s+/g, ' ').trim();
      if (bodyTxt) parts.push(bodyTxt);
    }
    return parts.join('\n\n');
  }

  function urlStatusBox() {
    return document.getElementById('url-status');
  }

  function showUrlStatus(ok, msg) {
    var box = urlStatusBox();
    if (!box) return;
    box.textContent = msg;
    box.className = ok ? 'gen-success show' : 'bank-error show';
  }

  function hideUrlStatus() {
    var box = urlStatusBox();
    if (box) { box.textContent = ''; box.className = 'bank-error'; }
  }

  function addUrlMaterial(url, text, viaReader) {
    var truncated = text.length > VARIANT_MATERIAL_MAX;
    if (truncated) text = text.slice(0, VARIANT_MATERIAL_MAX);
    pushMaterial({ name: url, size: text.length, kind: 'url', chars: text.length, pages: 0 }, text);
    material.sourceUrl = url;
    var msg = t('urlOk', { n: text.length.toLocaleString() });
    if (truncated) msg += ' ' + t('urlTruncated', { n: VARIANT_MATERIAL_MAX.toLocaleString() });
    if (viaReader) msg += ' ' + t('urlViaReader');
    showUrlStatus(true, msg);
    var fb = document.getElementById('url-fallback');
    if (fb) fb.hidden = true;
    refreshFileList();
  }

  function fetchUrlMaterial() {
    var input = document.getElementById('url-input');
    var btn = document.getElementById('url-fetch-btn');
    var proxyOpt = document.getElementById('url-proxy-opt');
    var url = normalizeUrl(input ? input.value : '');
    if (!url) {
      showUrlStatus(false, t('urlInvalid'));
      var fb0 = document.getElementById('url-fallback');
      if (fb0) fb0.hidden = true;
      return;
    }
    if (isOffline()) {
      showUrlStatus(false, t('offlineNeedNet'));
      var fbOff = document.getElementById('url-fallback');
      if (fbOff) fbOff.hidden = false;
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = t('urlFetching'); }
    hideUrlStatus();
    fetchWithTimeout(url, { method: 'GET' }, URL_FETCH_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var ct = (res.headers.get('content-type') || '').toLowerCase();
        return res.text().then(function (raw) { return { raw: raw, isHtml: ct.indexOf('text/html') !== -1 || /^\s*</.test(raw) }; });
      })
      .then(function (got) {
        var text = got.isHtml ? extractReadableText(got.raw, url) : got.raw.trim();
        if (!text) throw new Error(t('urlNoText'));
        addUrlMaterial(url, text, false);
      })
      .catch(function (e) {
        /* A page that loaded but had no readable text is not a
           blocked fetch — say so plainly, with the same fallback. */
        if (e && e.message === t('urlNoText')) { showUrlBlocked(t('urlNoText')); return; }
        /* Direct fetch failed (usually CORS). Only with the student's
           explicit tick do we try the public reader service. */
        if (proxyOpt && proxyOpt.checked) {
          return fetchWithTimeout(readerUrlFor(url), { method: 'GET' }, URL_FETCH_TIMEOUT_MS)
            .then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.text();
            })
            .then(function (raw) {
              var text = raw.trim();
              if (!text) throw new Error(t('urlNoText'));
              addUrlMaterial(url, text, true);
            })
            .catch(function (e2) {
              if (e2 && e2.message === t('urlNoText')) showUrlBlocked(t('urlNoText'));
              else showUrlBlocked(t('urlBlocked'));
            });
        }
        showUrlBlocked(t('urlBlocked'));
        function showUrlBlocked(msg) {
          showUrlStatus(false, msg);
          var fb = document.getElementById('url-fallback');
          if (fb) { fb.hidden = false; var ta2 = document.getElementById('url-paste'); if (ta2) ta2.focus(); }
        }
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = t('urlFetch'); }
      });
  }

  function useUrlPaste() {
    var input = document.getElementById('url-input');
    var ta2 = document.getElementById('url-paste');
    var text = ta2 ? ta2.value.trim() : '';
    if (!text) { showUrlStatus(false, t('urlPasteEmpty')); return; }
    var url = normalizeUrl(input ? input.value : '');
    pushMaterial({ name: url || t('urlPastedName'), size: text.length, kind: 'url', chars: text.length, pages: 0 }, text);
    if (url) material.sourceUrl = url;
    showUrlStatus(true, t('urlPasteOk'));
    var fb = document.getElementById('url-fallback');
    if (fb) fb.hidden = true;
    if (ta2) ta2.value = '';
    refreshFileList();
  }

  /* Test/debug handle (like window.__qfTf): the pure URL helpers,
     for the headless smoke test. */
  window.__qfUrl = {
    normalizeUrl: normalizeUrl,
    extractReadableText: extractReadableText,
    readerUrlFor: readerUrlFor,
    maxChars: VARIANT_MATERIAL_MAX
  };

  function addJsonFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result || ''));
          repairTfQuestions(data);
          validate(data);
          var lib = loadLibrary();
          lib.unshift({
            id: newId('bank'),
            title: data.title || file.name.replace(/\.json$/i, ''),
            subtitle: data.subtitle || t('libImportedBank', { n: data.questions.length }),
            date: todayStr(),
            count: data.questions.length,
            provider: 'import',
            model: '',
            bank: data
          });
          if (!saveLibrary(lib)) {
            /* The bank was not saved — say so instead of listing it
               as a saved file, or the student will look for an exam
               that is not there. */
            material.readError = t('errSaveFailed');
            var note2 = document.getElementById('pdf-note');
            if (note2) note2.textContent = material.readError;
            resolve();
            return;
          }
          material.files.push({ name: file.name, size: file.size, kind: 'bank', chars: 0, pages: 0 });
          resolve();
        } catch (e) {
          // Not a valid bank — treat its raw text as material.
          var text = String(reader.result || '');
          pushMaterial({ name: file.name, size: file.size, kind: 'text', chars: text.length, pages: 0 }, text);
          noteNonUtf8(file.name, text);
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
      /* A sheet row's explanation column doubles as the tf
         justification, so rows with an explanation still import. */
      if (explRaw) q.justification = explRaw;
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
      id: newId('sheet'),
      title: result.bank.title,
      subtitle: result.bank.subtitle,
      date: todayStr(),
      count: result.bank.questions.length,
      provider: 'import',
      model: '',
      bank: result.bank
    });
    if (!saveLibrary(lib)) {
      showSheetStatus({ ok: false, error: t('errSaveFailed') });
      return result;
    }
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

  /* One lazy CDN script loader for pdf.js, SheetJS and JSZip
     (Phase 2 hardening): the same load-once promise, the same
     "library never arrived" error. loadErrKey is the error when
     the script itself cannot be fetched; initErrKey when it
     arrives but does not expose its global. onReady runs after a
     successful load (pdf.js needs its worker path set). A failed
     load stays rejected, so a retry does not re-add the tag. */
  var scriptPromises = {};
  function loadScriptOnce(url, globalName, loadErrKey, initErrKey, onReady) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (scriptPromises[url]) return scriptPromises[url];
    scriptPromises[url] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () {
        if (!window[globalName]) { reject(new Error(t(initErrKey))); return; }
        if (onReady) {
          try { onReady(window[globalName]); }
          catch (e) { reject(e); return; }
        }
        resolve(window[globalName]);
      };
      s.onerror = function () { reject(new Error(t(loadErrKey))); };
      document.head.appendChild(s);
    });
    return scriptPromises[url];
  }

  /* SheetJS loads LAZILY, only when an .xlsx file is added, from
     cdnjs — same pattern as pdf.js. If the CDN cannot be reached,
     the error is shown and CSV paste/upload keep working. */
  function loadXlsx() {
    return loadScriptOnce(XLSX_URL, 'XLSX', 'sheetXlsxFail', 'sheetXlsxFail');
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
  function loadPdfJs() {
    return loadScriptOnce(PDFJS_URL, 'pdfjsLib', 'errPdfJsLoad', 'errPdfJsInit', function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    });
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
        /* A scanned/image-only PDF extracts no text at all — say so
           plainly instead of adding a 0-character "file" that looks
           like material and then generates from nothing. */
        if (!text.trim()) throw new Error(t('errPdfNoText', { name: file.name }));
        pushMaterial({ name: file.name, size: file.size, kind: 'pdf', chars: text.length, pages: pdf.numPages }, text);
      });
    }).catch(function (e) {
      material.pdfFailed = true;
      var msg = t('errReadFileDetail', { name: file.name, detail: e.message });
      /* Persist the specific message on the material state:
         refreshFileList() rewrites the note line on every render,
         so a message kept only in the DOM would be wiped as soon
         as the list refreshes (the same pattern as officeReadError).
         Before this, the specific error was overwritten by the
         generic s1PdfFail line. */
      material.readError = msg;
      var note = document.getElementById('pdf-note');
      if (note) note.textContent = msg;
      throw new Error(msg);
    });
  }

  /* Word (.docx) + PowerPoint (.pptx) text extraction — both are
     ZIP archives of XML (OOXML). JSZip loads LAZILY, only when a
     .docx or .pptx file is added, from cdnjs — same pattern as
     pdf.js / SheetJS. Plain text extraction only, no OCR: Word gives
     the document body (paragraphs and tables, in order); PowerPoint
     gives the text of every slide, in slide-number order. Images,
     speaker notes and Word headers/footers are not read. If the CDN
     cannot be reached, the error is shown and paste / other uploads
     keep working. */
  function loadJsZip() {
    return loadScriptOnce(JSZIP_URL, 'JSZip', 'errJszipLoad', 'errJszipInit');
  }

  /* Join the text runs of every paragraph in an OOXML part.
     Returns the paragraphs joined with newlines, or null when the
     XML does not parse. Runs inside tracked deletions (w:del) are
     skipped, so deleted text never becomes exam material. */
  function xmlParagraphText(xmlStr, paraTag, textTag) {
    var doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) return null;
    var paras = doc.getElementsByTagName(paraTag);
    var lines = [];
    for (var i = 0; i < paras.length; i++) {
      var runs = paras[i].getElementsByTagName(textTag);
      var line = '';
      for (var j = 0; j < runs.length; j++) {
        var node = runs[j];
        var deleted = false;
        while (node && node !== paras[i]) {
          if (node.tagName === 'w:del') { deleted = true; break; }
          node = node.parentNode;
        }
        if (!deleted) line += runs[j].textContent;
      }
      if (line.trim()) lines.push(line);
    }
    return lines.join('\n');
  }

  function extractDocxText(zip, name) {
    var f = zip.file('word/document.xml');
    if (!f) throw new Error(t('errOfficeZip', { name: name }));
    return f.async('string').catch(function () {
      throw new Error(t('errOfficeZip', { name: name }));
    }).then(function (xml) {
      var text = xmlParagraphText(xml, 'w:p', 'w:t');
      if (text === null) throw new Error(t('errOfficeZip', { name: name }));
      return text;
    });
  }

  function slideFileNum(name) {
    var m = name.match(/slide(\d+)\.xml$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function extractPptxText(zip, name) {
    var names = Object.keys(zip.files).filter(function (n) {
      return /^ppt\/slides\/slide\d+\.xml$/.test(n);
    }).sort(function (a, b) { return slideFileNum(a) - slideFileNum(b); });
    if (!names.length) throw new Error(t('errOfficeNoSlides', { name: name }));
    var slideTexts = [];
    var chain = Promise.resolve();
    names.forEach(function (slideName) {
      chain = chain.then(function () {
        return zip.file(slideName).async('string').catch(function () {
          throw new Error(t('errOfficeZip', { name: name }));
        });
      }).then(function (xml) {
        var text = xmlParagraphText(xml, 'a:p', 'a:t');
        if (text === null) throw new Error(t('errOfficeZip', { name: name }));
        if (text) slideTexts.push(text);
      });
    });
    return chain.then(function () {
      return { text: slideTexts.join('\n\n'), slides: names.length };
    });
  }

  function loadOfficeZip(file) {
    return loadJsZip().then(function () {
      return file.arrayBuffer();
    }).then(function (buf) {
      return window.JSZip.loadAsync(buf).catch(function () {
        throw new Error(t('errOfficeZip', { name: file.name }));
      });
    });
  }

  function officeReadError(e, file) {
    var msg = (e && e.message) || t('errOfficeZip', { name: file.name });
    /* Persist the message on the material state: refreshFileList()
       rewrites the note line on every render, so a message kept only
       in the DOM would be wiped as soon as the list refreshes. It is
       cleared by the next successful upload (pushMaterial). */
    material.readError = msg;
    var note = document.getElementById('pdf-note');
    if (note) note.textContent = msg;
    throw new Error(msg);
  }

  function addDocxFile(file) {
    return loadOfficeZip(file).then(function (zip) {
      return extractDocxText(zip, file.name);
    }).then(function (text) {
      if (!text.trim()) throw new Error(t('errOfficeNoText', { name: file.name }));
      pushMaterial({ name: file.name, size: file.size, kind: 'docx', chars: text.length, pages: 0 }, text);
    }).catch(function (e) { officeReadError(e, file); });
  }

  function addPptxFile(file) {
    return loadOfficeZip(file).then(function (zip) {
      return extractPptxText(zip, file.name);
    }).then(function (out) {
      if (!out.text.trim()) throw new Error(t('errOfficeNoText', { name: file.name }));
      pushMaterial({ name: file.name, size: file.size, kind: 'pptx', chars: out.text.length, pages: out.slides }, out.text);
    }).catch(function (e) { officeReadError(e, file); });
  }

  /* Test hook (no UI): lets the headless smoke test call the pure
     XML extractors without driving the DOM. */
  window.__qfOffice = {
    extractDocxXml: function (xml) { return xmlParagraphText(xml, 'w:p', 'w:t'); },
    extractPptxXml: function (xml) { return xmlParagraphText(xml, 'a:p', 'a:t'); },
    loadJsZip: loadJsZip
  };

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
        /* A reply that parses as JSON must actually be the
           {"ok": true} asked for — a model returning some other
           JSON is not a working connection. A non-JSON reply
           (e.g. Claude, which has no JSON mode) still counts as
           connected: any reply means the key and model work. */
        var parsed = null, isJson = false;
        try { parsed = JSON.parse(extractJsonText(text)); isJson = true; } catch (e) {}
        if (isJson && !(parsed && parsed.ok === true))
          throw new Error(t('errTestBad'));
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
      showStatusBox(box, msg);
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
    /* Repair first: a True/False question that only carries an
       "explanation" gets it copied into "justification"; validate
       then rejects any tf question still missing one. */
    repairTfQuestions(data);
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

  /* One POST-JSON round trip shared by every provider (Phase 2
     hardening): the same timeout, the same HTTP-error surfacing,
     the same "the model replied but said nothing" guard. extract
     maps the provider's JSON envelope to the model's text. */
  function postProviderJson(url, headers, body, who, extract) {
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function (res) { return readProviderResponse(res, who); })
    .then(function (data) {
      var text = extract(data);
      if (!text) throw new Error(t('errEmptyReply', { who: who }));
      return text;
    });
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
      return postProviderJson(url,
        { 'Content-Type': 'application/json' },
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        },
        'Gemini',
        function (data) {
          return data && data.candidates && data.candidates[0] &&
            data.candidates[0].content && data.candidates[0].content.parts &&
            data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
        });
    }

    if (provider === 'openai' || provider === 'custom') {
      var base = (provider === 'custom' ? (byok.baseUrl || PROVIDERS.custom.defaultBaseUrl) : 'https://api.openai.com/v1')
        .replace(/\/+$/, '');
      var who = provider === 'custom' ? 'Custom provider' : 'OpenAI';
      return postProviderJson(base + '/v1/chat/completions',
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        {
          model: model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' }
        },
        who,
        function (data) {
          return data && data.choices && data.choices[0] && data.choices[0].message &&
            data.choices[0].message.content;
        });
    }

    // claude — always through the user's CORS proxy
    var proxy = (byok.proxyUrl || '').trim().replace(/\/+$/, '');
    return postProviderJson(proxy + '/v1/messages',
      {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      {
        model: model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      },
      'Claude',
      function (data) {
        return data && data.content && data.content[0] && data.content[0].text;
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
     Translated: question text, options, explanations, True/False
     justifications, essay rubrics,
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
     the translatable prose. Mixed banks follow the majority. Every
     translatable field counts (rubric, matching pairs, ordering
     items included) — an exam whose prose lives only in its pairs
     must still detect correctly. */
  function detectExamLang(questions) {
    var ar = 0, lat = 0;
    (questions || []).forEach(function (q) {
      var texts = [q.question, q.explanation, q.justification, q.rubric]
        .concat(q.options || [])
        .concat((q.pairs || []).reduce(function (acc, p) { return acc.concat([p.left, p.right]); }, []))
        .concat(q.items || []);
      texts.forEach(function (s) {
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
      add('q' + i + '.justification', q.justification);
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
      if (get('q' + i + '.justification') !== undefined) q.justification = get('q' + i + '.justification');
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
      /* Restore clears the whole translation state (original + bank
         included), so a later loadBank() cannot "restore" a stale
         original into a bank that was never translated. */
      trState.original = null;
      trState.translated = null; trState.lang = null; trState.sourceLang = null; trState.bank = null;
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

  /* settings defaults to the wizard's current settings; a fresh variant
     passes the settings stored with the exam instead, so the variant
     keeps the same count, types, difficulty and language. avoid is an
     optional list of question stems from an earlier version — the
     provider is told not to repeat them, and generation also dedupes
     against them afterwards, so a variant is a genuinely different
     set of questions, not the same ones reworded. */
  function buildPrompt(chunkText, nQuestions, chunkLabel, settings, avoid) {
    var s = settings || wiz;
    var types = [];
    if (s.types.mcq) types.push('multiple-choice questions with exactly 4 options');
    if (s.types.tf) types.push('True/False questions: a statement with exactly 2 options ("True" and "False") and a "justification" — a short explanation of why the statement is true or false, grounded in the material');
    if (s.types.essay) types.push('essay questions: a free-text question with a short grading rubric and a "maxScore" of 5');
    if (s.types.fill) types.push('fill-in-the-blank questions: a sentence with exactly one blank written as ____, plus an "answers" array of accepted answers');
    if (s.types.coding) types.push('coding questions in JavaScript ONLY: a programming task with "language" set to "JavaScript", "starterCode" (the code the student starts from), and "tests" (an array of objects with "input" — a JavaScript expression that calls the student\'s function, e.g. "sum(2, 3)" — and "expected" — the exact expected result as a string, e.g. "5"). Never use any other language.');
    if (s.types.matching) types.push('matching questions: two columns to connect, with "pairs" (an array of 3–5 objects, each with "left" — a term — and "right" — its correct partner, e.g. a definition). The left and right values must each be unique within the question.');
    if (s.types.ordering) types.push('ordering questions: a list of steps to put in order, with "items" (an array of 4–6 short strings in the CORRECT order, e.g. the steps of a process from first to last). Every item must be unique.');
    var typeText = types.join(' and ');
    var diffText = s.difficulty === 'Mixed'
      ? 'a mix of Easy, Medium and Hard questions'
      : s.difficulty + ' questions';
    var schema = 'Each question must have: "question" (string), "type" ("mcq", "tf", "essay", "fill", "coding", "matching" or "ordering"), ' +
      '"explanation" (string), "topic" (short string, e.g. a chapter or sub-topic), ' +
      '"difficulty" ("Easy", "Medium" or "Hard"). ' +
      'Multiple-choice and True/False questions ALSO need "options" (array of ' +
      (s.types.mcq && s.types.tf ? '4 strings for multiple-choice or 2 strings ("True","False") for True/False' :
        s.types.tf ? '2 strings: "True" and "False"' : '4 strings') +
      ') and "answer" (0-based index of the correct option). ' +
      'True/False questions ALSO need "justification" (a string explaining why the statement is true or false, ' +
      'grounded in the material — e.g. for the statement "A pointer holds the value of a variable" with answer ' +
      'False: "A pointer holds the ADDRESS of a variable, not its value."). ' +
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
    var avoidText = '';
    if (avoid && avoid.length) {
      avoidText = ' Do NOT repeat any of these questions from an earlier version of this exam — ' +
        'write different questions about the material instead, covering other facts, details and angles: ' +
        avoid.map(function (q, i) { return (i + 1) + '. "' + q + '"'; }).join(' ');
    }
    return 'You are an exam writer. Write ' + nQuestions + ' ' + typeText +
      ' in ' + s.language + ' based ONLY on the material below' +
      (chunkLabel ? ' (' + chunkLabel + ')' : '') + '. ' +
      'Difficulty: ' + diffText + '.' +
      (s.focus ? ' Focus notes from the teacher: ' + s.focus + '.' : '') +
      ' Every question must be answerable from the material, have exactly one correct answer, ' +
      'and include a short explanation of why the answer is correct.' +
      avoidText +
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
    /* From an exam's start screen the summary shown is the one stored
       with THAT exam — the wizard's in-progress summary (sumState)
       describes different material and must never leak into another
       exam's view. From the wizard the in-progress summary is the
       one being read. */
    var data = (sumReturn.kind === 'start' && quiz && quiz.summary)
      ? quiz.summary
      : (sumState.data || (quiz && quiz.summary));
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

  /* Dedupe, validate, save and announce one generated exam.
     Throws when there are no usable questions (validate) or when
     the library save itself fails (err.saveFailed) — the caller
     decides what to show. readyKey is 's4Ready' for a full exam,
     's4PartialReady' when a chunk failed and only part of it was
     saved, so the student keeps what worked. */
  function completeGeneration(allQuestions, fullText, readyKey) {
    // Dedupe by normalised question text, then shuffle.
    var seen = {};
    var deduped = allQuestions.filter(function (q) {
      var k = String(q.question || '').trim().toLowerCase();
      if (!k || seen[k]) return false;
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
      id: newId('gen'),
      title: title,
      subtitle: bank.subtitle,
      date: todayStr(),
      count: deduped.length,
      provider: PROVIDERS[byok.provider].label,
      model: effectiveModel(),
      bank: bank,
      /* Fresh variant (2026-11-22): keep the source material and the
         settings this exam was generated with, so a new variant can
         be made from the same material later. Material over the cap
         is not stored (see VARIANT_MATERIAL_MAX). */
      material: fullText.length <= VARIANT_MATERIAL_MAX ? fullText : '',
      /* Generate from a link (2026-11-22): where the questions came
         from, shown on the exam card in My exams. */
      sourceUrl: material.sourceUrl || '',
      gen: {
        count: wiz.count,
        difficulty: wiz.difficulty,
        language: wiz.language,
        focus: wiz.focus,
        types: JSON.parse(JSON.stringify(wiz.types))
      },
      variant: 1,
      baseTitle: title
    });
    if (!saveLibrary(lib)) {
      var err = new Error(t('errSaveFailed'));
      err.saveFailed = true;
      throw err;
    }
    genState.lastBank = bank;
    genState.progress = '';
    var prog = document.getElementById('gen-progress');
    if (prog) prog.textContent = '';
    var ok = document.getElementById('gen-success');
    if (ok) {
      showStatusBox(ok, t(readyKey, { n: deduped.length }));
      var take = document.createElement('button');
      take.className = 'btn btn-primary btn-big';
      take.style.marginTop = '10px';
      take.textContent = t('s4TakeNow');
      take.addEventListener('click', function () { loadBank(bank); });
      ok.appendChild(take);
    }
    var btn = document.getElementById('gen-btn');
    if (btn) btn.disabled = false;
    genState.busy = false;
  }

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
      completeGeneration(allQuestions, fullText, 's4Ready');
    }).catch(function (e) {
      genState.busy = false;
      genState.progress = '';
      if (prog) prog.textContent = '';
      if (btn) btn.disabled = false;
      /* The save itself failed: nothing was stored, so there is no
         partial exam to offer — say that plainly, do not retry a
         save that just failed. */
      if (e && e.saveFailed) { showGenError(e.message); return; }
      /* A later chunk failing used to throw away the questions the
         earlier chunks already produced. Save those as a partial
         exam instead, and still show the failure plainly — the
         student keeps what worked and can retry for the rest. */
      if (allQuestions.length) {
        try {
          completeGeneration(allQuestions, fullText, 's4PartialReady');
          showGenError(plainError(e));
          return;
        } catch (e2) {
          if (e2 && e2.saveFailed) { showGenError(e2.message); return; }
          /* Nothing usable to save (all duplicates, or nothing
             validated) — fall through to the plain error. */
        }
      }
      showGenError(plainError(e));
    });
  }

  /* ---------- fresh exam variant (Feature 3 of the new queue) ----------
     One tap in My exams generates a NEW exam from the same material
     with the same settings (count, types, difficulty, language, focus)
     but different questions, and saves it as a separate exam in the
     library. Two things keep the questions different: the provider is
     given the earlier version's question stems and told not to repeat
     them, and generation dedupes against those stems afterwards. If
     the provider still returns only repeats, nothing is saved and the
     student is told to try again — a variant is never an empty or
     identical exam. The material summary describes the material, not
     the questions, so it travels to the variant unchanged. Like
     generation it needs a key; with no key, or offline, a plain
     message is shown instead. */
  function showVariantError(errBox, msg) {
    /* The library re-renders on navigation, so a captured error box
       may be detached by the time generation fails — fall back to
       the library status box instead of writing into thin air. */
    if (errBox && !document.contains(errBox))
      errBox = document.getElementById('backup-status');
    if (errBox) { showStatusBox(errBox, msg); return; }
    /* Off the library view there is no #backup-status either: the
       error used to be silently dropped (the button just reset).
       A sticky toast is always in the DOM, so the failure is still
       seen - and the exam is simply not saved, as before. */
    showToast(msg, true);
  }

  /* Stored generation settings (entry.gen, or a backup file's gen)
     are untrusted input: a missing types object would crash
     buildPrompt, a non-numeric count would ask the provider for
     NaN questions. Clamp every field to a known-good shape, falling
     back to the wizard's current settings per field. */
  function sanitizeGenSettings(g) {
    var fallback = {
      count: wiz.count, difficulty: wiz.difficulty, language: wiz.language,
      focus: wiz.focus, types: JSON.parse(JSON.stringify(wiz.types))
    };
    if (!g || typeof g !== 'object') return fallback;
    var out = {
      count: (typeof g.count === 'number' && isFinite(g.count))
        ? Math.max(5, Math.min(50, Math.round(g.count))) : fallback.count,
      difficulty: ['Easy', 'Medium', 'Hard', 'Mixed'].indexOf(g.difficulty) !== -1
        ? g.difficulty : fallback.difficulty,
      language: ['English', 'Arabic'].indexOf(g.language) !== -1
        ? g.language : fallback.language,
      focus: (typeof g.focus === 'string') ? g.focus : fallback.focus,
      types: fallback.types
    };
    if (g.types && typeof g.types === 'object') {
      ['mcq', 'tf', 'essay', 'fill', 'coding', 'matching', 'ordering'].forEach(function (k) {
        if (typeof g.types[k] === 'boolean') out.types[k] = g.types[k];
      });
    }
    return out;
  }

  function generateVariant(entry, btn, errBox) {
    if (variantBusy) return;
    if (isOffline()) { showVariantError(errBox, t('offlineNeedNet')); return; }
    if (!byok.apiKey) { showVariantError(errBox, t('errNeedKey')); return; }
    var materialText = (entry.material || '').trim();
    if (!materialText) { showVariantError(errBox, t('errNoMaterial')); return; }
    /* Stored settings, or the wizard's current ones if an older entry
       somehow has material without settings — sanitized either way,
       so a corrupt stored gen can never crash the prompt build. */
    var settings = sanitizeGenSettings(entry.gen);
    if (errBox) errBox.classList.remove('show');
    variantBusy = true;
    if (btn) { btn.disabled = true; btn.textContent = t('variantGenerating'); }

    var chunks = splitChunks(materialText);
    var totalWanted = settings.count;
    var perChunk = chunks.map(function (c) {
      return Math.max(1, Math.round(totalWanted * c.length / materialText.length));
    });
    /* Stems of the earlier version, truncated so the prompt stays
       bounded even for a 50-question exam. */
    var avoid = (entry.bank.questions || []).map(function (q) {
      return String(q.question || '').trim().slice(0, 140);
    }).filter(function (s) { return s !== ''; });
    var prevTexts = {};
    (entry.bank.questions || []).forEach(function (q) {
      prevTexts[String(q.question || '').trim().toLowerCase()] = true;
    });
    /* A variant of a variant must not resurrect questions an earlier
       version already asked: the hard filter covers every saved
       version sharing this exam's base title, not just the immediate
       parent. (The prompt's avoid-list above stays parent-only, so
       the prompt stays bounded.) A shared title across unrelated
       exams can only over-filter, never leak a repeat. */
    var baseTitle0 = entry.baseTitle || entry.title;
    loadLibrary().forEach(function (e) {
      if (e.id === entry.id || !e.bank || !e.bank.questions) return;
      if ((e.baseTitle || e.title) !== baseTitle0) return;
      e.bank.questions.forEach(function (q) {
        prevTexts[String(q.question || '').trim().toLowerCase()] = true;
      });
    });
    var allQuestions = [];
    var chain = Promise.resolve();
    chunks.forEach(function (chunk, i) {
      chain = chain.then(function () {
        var label = chunks.length > 1 ? 'part ' + (i + 1) + ' of ' + chunks.length + ' of the material' : '';
        return callProvider(buildPrompt(chunk, perChunk[i], label, settings, avoid), perChunk[i], 'gen');
      }).then(function (raw) {
        var qs = parseQuestionsResponse(raw, chunks.length > 1 ? 'part ' + (i + 1) : '');
        allQuestions = allQuestions.concat(qs);
      });
    });

    chain.then(function () {
      // Dedupe within the new set AND against the earlier version.
      var seen = {};
      var deduped = allQuestions.filter(function (q) {
        var k = String(q.question || '').trim().toLowerCase();
        if (!k || seen[k] || prevTexts[k]) return false;
        seen[k] = true;
        return true;
      });
      if (!deduped.length) throw new Error(t('variantAllDup'));
      shuffle(deduped);
      var n = (entry.variant || 1) + 1;
      var baseTitle = entry.baseTitle || entry.title;
      var newTitle = t('variantTitle', { title: baseTitle, n: n });
      var bank = {
        title: newTitle,
        subtitle: t('genSub', {
          n: deduped.length,
          provider: PROVIDERS[byok.provider].label,
          model: effectiveModel(),
          difficulty: localizedDifficulty(settings.difficulty),
          language: localizedLanguage(settings.language)
        }),
        questions: deduped
      };
      if (entry.bank.summary) bank.summary = entry.bank.summary;
      validate(bank);
      var lib = loadLibrary();
      lib.unshift({
        id: newId('gen'),
        title: newTitle,
        subtitle: bank.subtitle,
        date: todayStr(),
        count: deduped.length,
        provider: PROVIDERS[byok.provider].label,
        model: effectiveModel(),
        bank: bank,
        material: entry.material,
        sourceUrl: entry.sourceUrl || '',
        gen: settings,
        variant: n,
        baseTitle: baseTitle
      });
      if (!saveLibrary(lib)) {
        variantBusy = false;
        if (btn) { btn.disabled = false; btn.textContent = t('variantBtn'); }
        showVariantError(errBox, t('errSaveFailed'));
        return;
      }
      variantBusy = false;
      /* Only re-render the library when the student is still looking
         at it — generating takes a while, and re-rendering here
         would yank them out of whatever view they moved to. The
         exam is saved either way and shows up when they return. */
      if (currentView === 'library') {
        renderLibrary();
        /* renderLibrary() rebuilds the header, so the status box must be
           looked up (and filled) after it, not before. */
        var okBox = document.getElementById('backup-status');
        showStatusBox(okBox, t('variantReady', { title: newTitle, n: deduped.length }));
      }
    }).catch(function (e) {
      variantBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = t('variantBtn'); }
      showVariantError(errBox, plainError(e));
    });
  }

  /* ---------- chat with the material (Feature 1 of the new queue, 2026-11-22) ----------
     A chat screen where the student asks questions about material and
     gets answers from their own provider (the same BYOK key as
     generation), grounded ONLY in the material text. Two ways in:
     - from an exam card in My exams (the material stored with the exam);
     - fresh, from the library header (upload files / paste text here).
     Grounding: the material is chunked like generation does
     (splitChunks, ~12,000 chars) and only the chunk(s) most relevant
     to the question are sent — picked by word overlap with the
     question. The provider is told to answer only from the material,
     to say so when the material does not contain the answer, and to
     quote short passages. The reply is JSON {"answer", "quotes"}; a
     reply that is not JSON is shown as plain text rather than dropped
     (Claude does not force JSON mode). No key, or offline: a plain
     message, nothing generated, never a fake answer. History is kept
     in memory and persisted per exam in localStorage (qf-chat),
     capped so one chat can never eat the quota. */
  var LS_CHAT = 'qf-chat';
  var CHAT_MAX_MESSAGES = 30;   // per chat, kept in storage
  var CHAT_MAX_CHUNKS = 2;      // most relevant chunks sent per question
  var chatState = null;         // {key, examId, examTitle, files, pasted, text, messages, busy, draft, truncated, readError}

  function loadChatStore() {
    var store = lsGetJSON(LS_CHAT, {});
    return store && typeof store === 'object' ? store : {};
  }

  function saveChatStore(store) {
    lsSetJSON(LS_CHAT, store);
  }

  function saveChatHistory() {
    if (!chatState) return;
    var store = loadChatStore();
    store[chatState.key] = { messages: chatState.messages.slice(-CHAT_MAX_MESSAGES) };
    saveChatStore(store);
  }

  function openChat(entry) {
    var key = entry ? entry.id : 'fresh';
    var stored = loadChatStore();
    var saved = stored[key];
    var text = entry ? (entry.material || '') : '';
    chatState = {
      key: key,
      examId: entry ? entry.id : null,
      examTitle: entry ? entry.title : '',
      files: [],
      pasted: '',
      text: text.length > VARIANT_MATERIAL_MAX ? text.slice(0, VARIANT_MATERIAL_MAX) : text,
      messages: saved && Array.isArray(saved.messages) ? saved.messages : [],
      busy: false,
      draft: '',
      truncated: text.length > VARIANT_MATERIAL_MAX,
      readError: ''
    };
    /* The exam's own material is the base text: files pasted or
       uploaded here EXTEND it (chatRebuildText), they never replace
       it — without this, adding one file silently dropped the whole
       exam material from the chat. */
    chatState.base = chatState.text;
    currentView = 'chat';
    document.getElementById('nav-create').classList.remove('active');
    document.getElementById('nav-library').classList.remove('active');
    document.getElementById('nav-stats').classList.remove('active');
    renderChat();
    window.scrollTo({ top: 0 });
  }

  /* Word tokens for relevance scoring: Latin letters/digits and
     Arabic letters, at least 2 characters. */
  function chatWordTokens(s) {
    return String(s || '').toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/g)
      .filter(function (w) { return w.length >= 2; });
  }

  /* The chunk(s) most relevant to the question, by distinct-word
     overlap. Ties keep the material's own order. Short material
     (one or two chunks) is sent whole — there is nothing to choose. */
  function pickChatChunks(materialText, question) {
    var chunks = splitChunks(materialText);
    if (chunks.length <= CHAT_MAX_CHUNKS) return chunks;
    var words = chatWordTokens(question);
    if (!words.length) return chunks.slice(0, CHAT_MAX_CHUNKS);
    var scored = chunks.map(function (c, i) {
      var low = c.toLowerCase();
      var seen = {};
      var score = 0;
      words.forEach(function (w) {
        if (!seen[w] && low.indexOf(w) !== -1) { seen[w] = true; score++; }
      });
      return { i: i, score: score };
    });
    scored.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    var top = scored.slice(0, CHAT_MAX_CHUNKS).map(function (s) { return s.i; })
      .sort(function (a, b) { return a - b; });
    return top.map(function (i) { return chunks[i]; });
  }

  function buildChatPrompt(question, chunks, history) {
    var hist = '';
    if (history && history.length) {
      hist = 'Earlier in this conversation:\n' + history.map(function (m) {
        var txt = String(m.text || '').slice(0, 300);
        return (m.role === 'user' ? 'Student: ' : 'Assistant: ') + txt;
      }).join('\n') + '\n\n';
    }
    return 'You are a study assistant. Answer the student\'s question using ONLY the material below. ' +
      'If the material does not contain the answer, say so clearly and do not invent anything. ' +
      'Answer in the same language as the question. ' +
      'Quote short passages from the material to support your answer where possible.\n\n' +
      'Reply with JSON ONLY — no markdown fences, no extra text. The JSON must be an object with ' +
      '"answer" (the answer as a string) and "quotes" (an array of short strings, each an exact quote ' +
      'from the material that supports the answer; an empty array if none apply).\n\n' +
      hist + 'QUESTION: ' + question + '\n\nMATERIAL:\n' + chunks.join('\n\n---\n\n');
  }

  /* The reply should be {"answer", "quotes"}. A reply that is not
     JSON at all (Claude does not force JSON mode) is shown as plain
     text rather than dropped; a JSON reply with no usable answer is
     a real failure, not something to guess at. */
  function parseChatResponse(raw) {
    var text = String(raw || '').trim();
    if (!text) throw new Error(t('errEmptyReply', { who: PROVIDERS[byok.provider].label }));
    try {
      var data = JSON.parse(extractJsonText(text));
      var ans = data && typeof data.answer === 'string' ? data.answer.trim() : '';
      if (!ans) throw new Error('__no-answer__');
      var quotes = Array.isArray(data.quotes) ? data.quotes
        .filter(function (q) { return typeof q === 'string' && q.trim(); })
        .map(function (q) { return q.trim(); }).slice(0, 4) : [];
      return { answer: ans, quotes: quotes };
    } catch (e) {
      if (e && e.message === '__no-answer__') throw new Error(t('chatBadReply'));
      return { answer: text, quotes: [] };
    }
  }

  /* ---------- chat material: fresh uploads in the chat screen ----------
     Reuses the same readers as the wizard (pdf.js lazily loaded for
     PDF, JSZip for Word/PowerPoint, FileReader for text) but keeps the
     text in the chat's own state — the wizard's material is untouched.
     JSON banks and spreadsheets are not material here: a bank has no
     prose to answer from, and a sheet's rows are questions, not text. */
  function extractPdfText(file) {
    return loadPdfJs().then(function () {
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
              pageTexts[pageNum - 1] = content.items.map(function (it) { return it.str; }).join(' ');
            });
          });
        })(p);
      }
      return chain.then(function () {
        return { text: pageTexts.join('\n\n'), pages: pdf.numPages };
      });
    });
  }

  function chatRebuildText() {
    if (!chatState) return;
    var parts = [];
    if (chatState.base) parts.push(chatState.base);
    chatState.files.forEach(function (f) { parts.push(f.text || ''); });
    if (chatState.pasted) parts.push(chatState.pasted);
    var joined = parts.join('\n\n');
    chatState.truncated = joined.length > VARIANT_MATERIAL_MAX;
    chatState.text = chatState.truncated ? joined.slice(0, VARIANT_MATERIAL_MAX) : joined;
  }

  function chatPushFile(meta, text) {
    if (!chatState) return;
    meta.text = text;
    meta.chars = text.length;
    chatState.files.push(meta);
    chatState.readError = '';
    chatRebuildText();
  }

  function chatAddOneFile(file) {
    var name = file.name || 'file';
    var lower = name.toLowerCase();
    /* JSON banks and spreadsheets are not material to chat about
       (a bank has no prose, a sheet's rows are questions) — say so
       instead of reading the raw file bytes as "material". */
    if (/\.(json|xlsx|xls)$/.test(lower)) {
      return Promise.reject(new Error(t('chatBadType', { name: name })));
    }
    if (lower.endsWith('.pdf')) {
      return extractPdfText(file).then(function (out) {
        if (!out.text.trim()) throw new Error(t('errOfficeNoText', { name: name }));
        chatPushFile({ name: name, size: file.size, kind: 'pdf', pages: out.pages }, out.text);
      }).catch(function (e) {
        throw new Error(t('errReadFileDetail', { name: name, detail: e.message }));
      });
    }
    if (lower.endsWith('.docx')) {
      return loadOfficeZip(file).then(function (zip) {
        return extractDocxText(zip, name);
      }).then(function (text) {
        if (!text.trim()) throw new Error(t('errOfficeNoText', { name: name }));
        chatPushFile({ name: name, size: file.size, kind: 'docx', pages: 0 }, text);
      }).catch(function (e) {
        throw new Error(t('errReadFileDetail', { name: name, detail: e.message }));
      });
    }
    if (lower.endsWith('.pptx')) {
      return loadOfficeZip(file).then(function (zip) {
        return extractPptxText(zip, name);
      }).then(function (out) {
        if (!out.text.trim()) throw new Error(t('errOfficeNoText', { name: name }));
        chatPushFile({ name: name, size: file.size, kind: 'pptx', pages: out.slides }, out.text);
      }).catch(function (e) {
        throw new Error(t('errReadFileDetail', { name: name, detail: e.message }));
      });
    }
    // .txt / .md / anything else readable as text
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        chatPushFile({ name: name, size: file.size, kind: 'text', pages: 0 }, text);
        /* Non-UTF-8 text reads with replacement characters — keep
           the text, but warn plainly (same warning as the wizard). */
        if (chatState && text.indexOf('\uFFFD') !== -1)
          chatState.readError = t('txtNonUtf8', { name: name });
        resolve();
      };
      reader.onerror = function () { reject(new Error(t('errReadFile', { name: name }))); };
      reader.readAsText(file);
    });
  }

  function chatAddFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length || !chatState) return;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return chatAddOneFile(file); });
    });
    chain.then(function () {
      chatRefreshMaterial();
      showChatStatus(t('chatFileAdded', { name: files[files.length - 1].name, n: (chatState.files[chatState.files.length - 1] || {}).chars || 0 }), true);
    }).catch(function (e) {
      if (chatState) chatState.readError = e.message;
      chatRefreshMaterial();
      showChatStatus(e.message, false);
    });
  }

  function chatRemoveFile(idx) {
    if (!chatState) return;
    chatState.files.splice(idx, 1);
    chatRebuildText();
    chatRefreshMaterial();
  }

  function chatRefreshMaterial() {
    if (!chatState) return;
    var list = document.getElementById('chat-file-list');
    var summary = document.getElementById('chat-material-summary');
    var src = document.getElementById('chat-source');
    if (src) {
      src.textContent = chatState.examId
        ? t('chatSourceExam', { title: chatState.examTitle })
        : t('chatSourceFresh');
    }
    if (list) {
      list.innerHTML = '';
      chatState.files.forEach(function (f, idx) {
        var row = el('div', 'file-row');
        row.appendChild(el('span', 'file-ic', f.kind === 'pdf' ? '📕' : (f.kind === 'docx' ? '📄' : (f.kind === 'pptx' ? '📽️' : '📝'))));
        var meta = el('div', 'file-meta');
        meta.appendChild(el('span', 'file-name', f.name));
        var sub = f.kind === 'pdf'
          ? fmtSize(f.size) + ' · ' + t('s1PagesLabel', { n: f.pages }) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() })
          : f.kind === 'pptx'
            ? fmtSize(f.size) + ' · ' + t('s1SlidesLabel', { n: f.pages }) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() })
            : fmtSize(f.size) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() });
        meta.appendChild(el('span', 'file-sub muted', sub));
        row.appendChild(meta);
        var rm = el('button', 'file-remove', '✕');
        rm.type = 'button';
        rm.title = t('chatRemoveFile');
        rm.setAttribute('aria-label', t('chatRemoveAria', { name: f.name }));
        rm.addEventListener('click', function () { chatRemoveFile(idx); });
        row.appendChild(rm);
        list.appendChild(row);
      });
    }
    if (summary) {
      var chars = (chatState.text || '').length;
      var parts = chatState.files.length
        ? t('chatMaterialChars', { n: chars.toLocaleString(), f: chatState.files.length })
        : t('chatMaterialCharsNoFiles', { n: chars.toLocaleString() });
      summary.textContent = chars > 0 ? parts : t('chatNoMaterial');
      if (chatState.truncated) {
        summary.textContent += ' ' + t('chatTooLong', { n: VARIANT_MATERIAL_MAX.toLocaleString() });
      }
      if (chatState.readError) {
        var err = el('span', null, ' ' + chatState.readError);
        summary.appendChild(err);
      }
    }
  }

  function showChatStatus(msg, ok) {
    var box = document.getElementById('chat-error');
    if (!box) return;
    box.className = ok ? 'gen-success show' : 'bank-error show';
    box.textContent = msg;
  }

  function showChatError(msg) {
    showChatStatus(msg, false);
  }

  function renderChatMessages() {
    if (!chatState) return;
    var box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = '';
    if (!chatState.messages.length) {
      box.appendChild(el('p', 'muted', t('chatEmpty')));
    }
    chatState.messages.forEach(function (m) {
      var wrap = el('div', 'chat-msg ' + (m.role === 'user' ? 'chat-user' : 'chat-assistant'));
      wrap.appendChild(el('span', 'chat-who', m.role === 'user' ? t('chatYou') : t('chatAssistant')));
      wrap.appendChild(el('p', null, m.text));
      if (m.role === 'assistant' && m.quotes && m.quotes.length) {
        wrap.appendChild(el('p', 'chat-quotes-label', t('chatQuotes')));
        m.quotes.forEach(function (q) {
          var bq = document.createElement('blockquote');
          bq.className = 'chat-quote';
          bq.textContent = q;
          wrap.appendChild(bq);
        });
      }
      box.appendChild(wrap);
    });
    if (chatState.busy) {
      var th = el('div', 'chat-msg chat-assistant');
      th.appendChild(el('span', 'chat-who', t('chatAssistant')));
      th.appendChild(el('p', 'chat-thinking', t('chatThinking')));
      box.appendChild(th);
    }
    box.scrollTop = box.scrollHeight;
  }

  function setChatBusy(on) {
    var input = document.getElementById('chat-input');
    var send = document.getElementById('chat-send');
    if (input) input.disabled = on;
    if (send) {
      send.disabled = on;
      send.textContent = on ? t('chatThinking') : t('chatSend');
    }
    renderChatMessages();
  }

  function askChat() {
    if (!chatState || chatState.busy) return;
    var input = document.getElementById('chat-input');
    var q = (input ? input.value : chatState.draft || '').trim();
    if (!q) return;
    var errBox = document.getElementById('chat-error');
    if (errBox) errBox.classList.remove('show');
    if (isOffline()) { showChatError(t('offlineNeedNet')); return; }
    if (!byok.apiKey) { showChatError(t('chatNoKey')); return; }
    var materialText = (chatState.text || '').trim();
    if (!materialText) { showChatError(t('chatNoMaterial')); return; }
    chatState.busy = true;
    chatState.messages.push({ role: 'user', text: q });
    chatState.draft = '';
    if (input) input.value = '';
    saveChatHistory();
    setChatBusy(true);
    /* History for follow-ups: the exchanges before this question,
       capped so the prompt stays bounded. */
    var history = chatState.messages.slice(-7, -1);
    var chunks = pickChatChunks(materialText, q);
    callProvider(buildChatPrompt(q, chunks, history), 1, 'chat').then(function (raw) {
      var res = parseChatResponse(raw);
      chatState.messages.push({ role: 'assistant', text: res.answer, quotes: res.quotes });
      chatState.busy = false;
      saveChatHistory();
      setChatBusy(false);
    }).catch(function (e) {
      chatState.busy = false;
      /* The question stays in the history — it was asked, and the
         student can re-send it after fixing the key or connection
         without losing what they asked. */
      setChatBusy(false);
      showChatError(plainError(e));
    });
  }

  function renderChat() {
    if (!chatState) return;
    app.innerHTML = '';
    var wrap = el('div');
    var card = el('section', 'card chat-card');
    card.appendChild(el('p', 'kicker', t('chatKicker')));
    card.appendChild(el('h2', null, t('chatTitle')));
    card.appendChild(el('p', 'hero-text', t('chatHero')));
    var src = el('p', 'muted');
    src.id = 'chat-source';
    card.appendChild(src);
    if (!byok.apiKey) {
      var noKey = el('p', 'bank-error show');
      noKey.id = 'chat-nokey';
      noKey.textContent = t('chatNoKey');
      card.appendChild(noKey);
    }

    /* Material: files uploaded here, plus paste. For an exam chat
       the exam's material is already the text; files added here
       extend it. */
    var matBox = el('div', 'chat-material');
    var list = el('div', 'file-list');
    list.id = 'chat-file-list';
    matBox.appendChild(list);
    var upLbl = el('label', 'file-label', t('chatUploadBtn'));
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.pdf,.docx,.pptx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown';
    picker.multiple = true;
    picker.addEventListener('change', function () {
      if (picker.files && picker.files.length) chatAddFiles(picker.files);
      picker.value = '';
    });
    upLbl.appendChild(picker);
    matBox.appendChild(upLbl);
    matBox.appendChild(el('p', 'field-hint', t('chatUploadHint')));
    var pasteLabel = el('label', 'field-label', t('chatPasteLabel'));
    pasteLabel.htmlFor = 'chat-paste';
    matBox.appendChild(pasteLabel);
    var ta = document.createElement('textarea');
    ta.id = 'chat-paste';
    ta.className = 'input textarea';
    ta.rows = 3;
    ta.placeholder = t('chatPastePh');
    matBox.appendChild(ta);
    var pasteRow = el('div', 'btnrow');
    var addPaste = el('button', 'btn btn-secondary btn-small', t('chatAddPaste'));
    addPaste.type = 'button';
    addPaste.addEventListener('click', function () {
      var v = ta.value.trim();
      if (!v) { showChatError(t('chatPasteEmpty')); return; }
      chatState.pasted = (chatState.pasted ? chatState.pasted + '\n\n' : '') + v;
      ta.value = '';
      chatRebuildText();
      chatRefreshMaterial();
      showChatStatus(t('chatPasteAdded', { n: v.length.toLocaleString() }), true);
    });
    pasteRow.appendChild(addPaste);
    matBox.appendChild(pasteRow);
    var summary = el('p', 'material-summary');
    summary.id = 'chat-material-summary';
    matBox.appendChild(summary);
    card.appendChild(matBox);

    var msgs = el('div', 'chat-messages');
    msgs.id = 'chat-messages';
    card.appendChild(msgs);

    var errBox = el('div', 'bank-error');
    errBox.id = 'chat-error';
    card.appendChild(errBox);

    var inputRow = el('div', 'chat-input-row');
    var input = document.createElement('input');
    input.type = 'text';
    input.id = 'chat-input';
    input.className = 'input';
    input.placeholder = t('chatInputPh');
    input.setAttribute('aria-label', t('chatInputPh'));
    input.value = chatState.draft || '';
    input.addEventListener('input', function () { chatState.draft = input.value; });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); askChat(); }
    });
    inputRow.appendChild(input);
    var send = el('button', 'btn btn-primary', t('chatSend'));
    send.id = 'chat-send';
    send.type = 'button';
    send.addEventListener('click', function () { askChat(); });
    inputRow.appendChild(send);
    card.appendChild(inputRow);

    var row = el('div', 'btnrow');
    var back = el('button', 'btn btn-secondary btn-big', t('chatBack'));
    back.id = 'chat-back-btn';
    back.addEventListener('click', function () { setView('library'); });
    row.appendChild(back);
    var clear = el('button', 'btn btn-secondary btn-big', t('chatClear'));
    clear.id = 'chat-clear-btn';
    clear.addEventListener('click', function () {
      if (!chatState) return;
      chatState.messages = [];
      saveChatHistory();
      renderChatMessages();
      showChatStatus(t('chatCleared'), true);
    });
    row.appendChild(clear);
    card.appendChild(row);

    wrap.appendChild(card);
    app.appendChild(wrap);
    chatRefreshMaterial();
    renderChatMessages();
    if (chatState.busy) setChatBusy(true);
  }

  /* Test/debug handle (like window.__qfSheet / __qfBackup): the pure
     chat pieces for the headless smoke test. */
  window.__qfChat = {
    openChat: openChat,
    pickChatChunks: pickChatChunks,
    parseChatResponse: parseChatResponse,
    buildChatPrompt: buildChatPrompt,
    state: function () { return chatState; }
  };

  /* ---------- past-exam analysis (Feature 2 of the new queue, 2026-11-22)
     Upload 2+ past exams, each labelled with a year. Each exam's topics
     are extracted with the student's own provider (same BYOK key as
     generation), then a second provider pass merges topics that are the
     same idea in different wording into one canonical topic. Frequency
     is plain counting on the merged result — never a local guess at
     topics. The focused-exam button hands the wizard the past exams as
     material and the top topics as focus notes, opening the settings
     step so the student can check count / difficulty / language before
     generating. No key, or offline: a plain message, nothing analysed,
     never a fake analysis. Adding or removing an exam after an
     analysis clears the result, so the table can never describe exams
     that are no longer there. */
  var PAST_TOPIC_MAX_CHARS = 12000; // one chunk per exam is enough to list its topics
  var PAST_TOP_FOCUS = 8;           // most top topics carried into the focus notes
  var pastState = null;             // {exams: [{name,size,kind,year,text,chars,pages}], busy, progress, error, result}

  function openPastAnalysis() {
    /* Keep already-uploaded exams when the student leaves and comes
       back — re-initialising here used to silently drop them. */
    if (!pastState) pastState = { exams: [], busy: false, progress: '', error: '', result: null };
    currentView = 'past';
    document.getElementById('nav-create').classList.remove('active');
    document.getElementById('nav-library').classList.remove('active');
    document.getElementById('nav-stats').classList.remove('active');
    renderPast();
    window.scrollTo({ top: 0 });
  }

  function pastPushFile(meta, text) {
    if (!pastState) return;
    meta.text = text;
    meta.chars = text.length;
    meta.year = '';
    pastState.exams.push(meta);
    pastState.error = '';
    pastState.result = null; // new file invalidates the old analysis
  }

  /* Same readers as the chat screen (worker 1): pdf.js lazily loaded
     for PDF, JSZip for Word, FileReader for text. PowerPoint is not
     offered here — a past exam is a PDF, a Word file or plain text. */
  function pastAddOneFile(file) {
    var name = file.name || 'file';
    var lower = name.toLowerCase();
    /* PowerPoint, spreadsheets and JSON banks are not past exams —
       reading their raw bytes as text would analyse garbage. */
    if (/\.(pptx|xlsx|xls|json)$/.test(lower)) {
      return Promise.reject(new Error(t('pastBadType', { name: name })));
    }
    if (lower.endsWith('.pdf')) {
      return extractPdfText(file).then(function (out) {
        if (!out.text.trim()) throw new Error(t('errOfficeNoText', { name: name }));
        pastPushFile({ name: name, size: file.size, kind: 'pdf', pages: out.pages }, out.text);
      }).catch(function (e) {
        throw new Error(t('errReadFileDetail', { name: name, detail: e.message }));
      });
    }
    if (lower.endsWith('.docx')) {
      return loadOfficeZip(file).then(function (zip) {
        return extractDocxText(zip, name);
      }).then(function (text) {
        if (!text.trim()) throw new Error(t('errOfficeNoText', { name: name }));
        pastPushFile({ name: name, size: file.size, kind: 'docx', pages: 0 }, text);
      }).catch(function (e) {
        throw new Error(t('errReadFileDetail', { name: name, detail: e.message }));
      });
    }
    // .txt / .md / anything else readable as text
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        pastPushFile({ name: name, size: file.size, kind: 'text', pages: 0 }, String(reader.result || ''));
        resolve();
      };
      reader.onerror = function () { reject(new Error(t('errReadFile', { name: name }))); };
      reader.readAsText(file);
    });
  }

  function pastAddFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length || !pastState) return;
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return pastAddOneFile(file); });
    });
    chain.then(function () {
      pastRefreshExams();
      showPastStatus(t('pastFileAdded', { name: files[files.length - 1].name, n: (pastState.exams[pastState.exams.length - 1] || {}).chars || 0 }), true);
    }).catch(function (e) {
      if (pastState) pastState.error = e.message;
      pastRefreshExams();
      showPastStatus(e.message, false);
    });
  }

  function pastRemoveExam(idx) {
    if (!pastState) return;
    pastState.exams.splice(idx, 1);
    pastState.result = null;
    pastRefreshExams();
  }

  function buildTopicPrompt(examText, label) {
    return 'You are a study assistant. List the main topics covered in this past exam' +
      (label ? ' (' + label + ')' : '') + '. ' +
      'Use short canonical topic names (2–6 words each), in the same language as the exam. ' +
      'List 3–12 topics — the big ideas the exam actually tests, not every small detail. ' +
      'Reply with JSON ONLY — no markdown fences, no extra text. The JSON must be an object with ' +
      '"topics" (an array of objects with "name" — the short topic name — and "description" — one short sentence saying what the topic covers).\n\nEXAM:\n' + examText;
  }

  function parseTopicResponse(raw) {
    var text = String(raw || '').trim();
    if (!text) throw new Error(t('errEmptyReply', { who: PROVIDERS[byok.provider].label }));
    var data;
    try { data = JSON.parse(extractJsonText(text)); }
    catch (e) { throw new Error(t('pastBadReply')); }
    var topics = Array.isArray(data && data.topics) ? data.topics : [];
    topics = topics.filter(function (tp) {
      return tp && typeof tp.name === 'string' && tp.name.trim();
    }).map(function (tp) {
      return { name: tp.name.trim(), description: typeof tp.description === 'string' ? tp.description.trim() : '' };
    });
    if (!topics.length) throw new Error(t('pastNoTopics'));
    return topics;
  }

  /* Second pass: merge topics that are the same idea in different
     wording into one canonical topic, keeping the exam numbers each
     merged topic appears in. */
  function buildMergePrompt(perExam) {
    var lines = [];
    perExam.forEach(function (ex, i) {
      lines.push('Exam ' + (i + 1) + (ex.year ? ' (' + ex.year + ')' : '') + ': ' +
        ex.topics.map(function (tp) {
          return tp.name + (tp.description ? ' — ' + tp.description : '');
        }).join(' | '));
    });
    return 'You are a study assistant. Below are the topic lists extracted from several past exams of the same course. ' +
      'Some topics are the same idea written in different words — merge those into ONE topic with the clearest name. ' +
      'Topics that are genuinely different stay separate. ' +
      'Reply with JSON ONLY — no markdown fences, no extra text. The JSON must be an object with "topics" (an array of objects with "name" — the merged topic name — "description" — one short sentence — and "exams" — the list of exam numbers (1-based) where this topic appears, e.g. [1, 3]).\n\n' + lines.join('\n');
  }

  function parseMergeResponse(raw, nExams) {
    var text = String(raw || '').trim();
    if (!text) throw new Error(t('errEmptyReply', { who: PROVIDERS[byok.provider].label }));
    var data;
    try { data = JSON.parse(extractJsonText(text)); }
    catch (e) { throw new Error(t('pastBadReply')); }
    var topics = Array.isArray(data && data.topics) ? data.topics : [];
    var out = [];
    topics.forEach(function (tp) {
      if (!tp || typeof tp.name !== 'string' || !tp.name.trim()) return;
      var exams = Array.isArray(tp.exams) ? tp.exams.filter(function (n) {
        return typeof n === 'number' && n >= 1 && n <= nExams;
      }) : [];
      if (!exams.length) return;
      out.push({
        name: tp.name.trim(),
        description: typeof tp.description === 'string' ? tp.description.trim() : '',
        exams: exams
      });
    });
    if (!out.length) throw new Error(t('pastNoTopics'));
    return out;
  }

  /* Pure merge used when the provider merge pass fails: same name
     (case-insensitive, trimmed) in different exams is one topic. It
     only joins identical names — it never guesses that two different
     wordings are the same idea, so a failed merge pass degrades to
     exact matching instead of a fake analysis. */
  function mergeTopicsLocal(perExam) {
    var byName = {};
    var order = [];
    perExam.forEach(function (ex, i) {
      ex.topics.forEach(function (tp) {
        var k = tp.name.trim().toLowerCase();
        if (!byName[k]) {
          byName[k] = { name: tp.name.trim(), description: tp.description || '', exams: [] };
          order.push(k);
        }
        if (byName[k].exams.indexOf(i + 1) === -1) byName[k].exams.push(i + 1);
      });
    });
    return order.map(function (k) { return byName[k]; });
  }

  /* Frequency is plain counting on the merged result: how many exams
     each topic appears in, and which years. Most-repeated first; ties
     break alphabetically so the order is stable. */
  function computeFrequency(merged, exams) {
    var n = exams.length;
    var rows = merged.map(function (tp) {
      var years = [];
      tp.exams.forEach(function (num) {
        var y = (exams[num - 1].year || '').trim();
        if (y && years.indexOf(y) === -1) years.push(y);
      });
      return {
        name: tp.name,
        description: tp.description || '',
        count: tp.exams.length,
        total: n,
        years: years
      };
    });
    rows.sort(function (a, b) {
      return b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    });
    return rows;
  }

  function analysePastExams() {
    if (!pastState || pastState.busy) return;
    var errBox = document.getElementById('past-error');
    if (errBox) errBox.classList.remove('show');
    if (isOffline()) { showPastStatus(t('offlineNeedNet'), false); return; }
    if (!byok.apiKey) { showPastStatus(t('pastNoKey'), false); return; }
    var exams = pastState.exams.filter(function (e) { return (e.text || '').trim(); });
    if (exams.length < 2) { showPastStatus(t('pastNeedTwo'), false); return; }
    pastState.busy = true;
    pastState.error = '';
    var prog = document.getElementById('past-progress');
    var btn = document.getElementById('past-analyse-btn');
    if (btn) btn.disabled = true;
    var perExam = [];
    var chain = Promise.resolve();
    exams.forEach(function (ex, i) {
      chain = chain.then(function () {
        pastState.progress = t('pastAnalysing', { i: i + 1, n: exams.length });
        if (prog) prog.textContent = pastState.progress;
        var label = ex.year ? ('year ' + ex.year) : ('exam ' + (i + 1));
        return callProvider(buildTopicPrompt(ex.text.slice(0, PAST_TOPIC_MAX_CHARS), label), 1, 'past');
      }).then(function (raw) {
        perExam.push({ year: ex.year || '', topics: parseTopicResponse(raw) });
      });
    });
    chain.then(function () {
      pastState.progress = t('pastMerging');
      if (prog) prog.textContent = pastState.progress;
      return callProvider(buildMergePrompt(perExam), 1, 'past')
        .then(function (raw) { return parseMergeResponse(raw, exams.length); })
        .catch(function () { return mergeTopicsLocal(perExam); });
    }).then(function (merged) {
      pastState.result = { rows: computeFrequency(merged, exams), examCount: exams.length };
      pastState.busy = false;
      pastState.progress = '';
      if (prog) prog.textContent = '';
      if (btn) btn.disabled = false;
      /* Only re-render when the student is still on the past-exam
         screen — an analysis takes a while, and re-rendering here
         would yank them out of whatever view they moved to. */
      if (currentView === 'past') renderPast();
      showPastStatus(t('pastAnalysedNote', { n: exams.length }), true);
    }).catch(function (e) {
      pastState.busy = false;
      pastState.progress = '';
      if (prog) prog.textContent = '';
      if (btn) btn.disabled = false;
      showPastStatus(plainError(e), false);
    });
  }

  /* Focused exam: the past exams become the wizard's material and the
     most-repeated topics become its focus notes, then the wizard opens
     on the settings step so the student checks count / difficulty /
     language before generating. Topics that appeared in at least 2
     exams lead; if every topic appeared only once, the top 5 by rank
     lead instead. */
  function pastGenerateFocused() {
    if (!pastState || !pastState.result) return;
    var rows = pastState.result.rows;
    var top = rows.filter(function (r) { return r.count >= 2; }).slice(0, PAST_TOP_FOCUS);
    if (!top.length) top = rows.slice(0, Math.min(5, rows.length));
    var focusLines = top.map(function (r, i) {
      /* Localised per-topic line: the focus notes go into the exam
         prompt, so an Arabic UI must not get English fragments
         ("appeared in X of Y past exams", "years: ...") baked in. */
      var line = t('pastFocusLine', { name: r.name, c: r.count, total: r.total });
      if (r.years.length) line = t('pastFocusLineYears', { line: line, y: r.years.join(', ') });
      if (r.description) line = t('pastFocusLineDesc', { line: line, d: r.description });
      return (i + 1) + '. ' + line;
    });
    var fullText = pastState.exams.map(function (e) { return e.text || ''; }).join('\n\n').trim();
    material.files = [];
    material.text = fullText.length <= VARIANT_MATERIAL_MAX ? fullText : fullText.slice(0, VARIANT_MATERIAL_MAX);
    material.pasted = '';
    material.pdfPages = 0;
    material.pptxSlides = 0;
    material.pdfFailed = false;
    material.readError = '';
    sumState.data = null; // the old summary describes other material
    wiz.title = t('pastGenTitle');
    wiz.focus = t('pastFocusNotes', { n: top.length }) + ' ' + focusLines.join(' ');
    wiz.step = 3;
    saveWizard();
    setView('create');
  }

  function showPastStatus(msg, ok) {
    var box = document.getElementById('past-error');
    if (!box) return;
    box.className = ok ? 'gen-success show' : 'bank-error show';
    box.textContent = msg;
  }

  function pastRefreshExams() {
    if (!pastState) return;
    var list = document.getElementById('past-file-list');
    var summary = document.getElementById('past-summary');
    if (list) {
      list.innerHTML = '';
      pastState.exams.forEach(function (f, idx) {
        var rowEl = el('div', 'file-row past-row');
        rowEl.appendChild(el('span', 'file-ic', f.kind === 'pdf' ? '📕' : (f.kind === 'docx' ? '📄' : '📝')));
        var meta = el('div', 'file-meta');
        meta.appendChild(el('span', 'file-name', f.name));
        meta.appendChild(el('span', 'file-sub muted', fmtSize(f.size) + ' · ' + t('s1CharsLabel', { n: f.chars.toLocaleString() })));
        rowEl.appendChild(meta);
        var year = document.createElement('input');
        year.type = 'text';
        year.className = 'input past-year';
        year.placeholder = t('pastYearPh');
        year.value = f.year || '';
        year.setAttribute('aria-label', t('pastYearAria', { name: f.name }));
        year.addEventListener('input', function () { f.year = year.value; });
        rowEl.appendChild(year);
        var rm = el('button', 'file-remove', '✕');
        rm.type = 'button';
        rm.title = t('pastRemoveFile');
        rm.setAttribute('aria-label', t('pastRemoveAria', { name: f.name }));
        rm.addEventListener('click', function () { pastRemoveExam(idx); });
        rowEl.appendChild(rm);
        list.appendChild(rowEl);
      });
    }
    if (summary) {
      summary.textContent = pastState.exams.length
        ? t('pastExamsLabel', { n: pastState.exams.length })
        : t('pastNoExams');
    }
    pastRenderResults();
  }

  function pastRenderResults() {
    var box = document.getElementById('past-results');
    if (!box || !pastState) return;
    box.innerHTML = '';
    var res = pastState.result;
    if (!res) return;
    box.appendChild(el('h3', 'past-res-title', t('pastResultsTitle')));
    box.appendChild(el('p', 'muted', t('pastResultsHero', { n: res.examCount })));
    var rank = el('ol', 'past-rank');
    res.rows.forEach(function (r) {
      var li = el('li', 'past-rank-row');
      li.appendChild(el('span', 'past-count', t('pastInExams', { c: r.count, n: r.total })));
      var body = el('div', 'past-rank-body');
      body.appendChild(el('span', 'past-topic', r.name));
      if (r.description) body.appendChild(el('span', 'past-desc muted', r.description));
      body.appendChild(el('span', 'past-years muted', r.years.length ? t('pastYears', { y: r.years.join(', ') }) : t('pastNoYear')));
      li.appendChild(body);
      rank.appendChild(li);
    });
    box.appendChild(rank);
    var genBtn = el('button', 'btn btn-primary btn-big', t('pastGenBtn'));
    genBtn.id = 'past-gen-btn';
    genBtn.type = 'button';
    genBtn.addEventListener('click', function () { pastGenerateFocused(); });
    box.appendChild(genBtn);
    box.appendChild(el('p', 'field-hint', t('pastGenNote')));
  }

  function renderPast() {
    if (!pastState) return;
    app.innerHTML = '';
    var wrap = el('div');
    var card = el('section', 'card past-card');
    card.appendChild(el('p', 'kicker', t('pastKicker')));
    card.appendChild(el('h2', null, t('pastTitle')));
    card.appendChild(el('p', 'hero-text', t('pastHero')));
    if (!byok.apiKey) {
      var noKey = el('p', 'bank-error show');
      noKey.id = 'past-nokey';
      noKey.textContent = t('pastNoKey');
      card.appendChild(noKey);
    }

    var list = el('div', 'file-list');
    list.id = 'past-file-list';
    card.appendChild(list);
    var upLbl = el('label', 'file-label', t('pastUploadBtn'));
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
    picker.multiple = true;
    picker.addEventListener('change', function () {
      if (picker.files && picker.files.length) pastAddFiles(picker.files);
      picker.value = '';
    });
    upLbl.appendChild(picker);
    card.appendChild(upLbl);
    card.appendChild(el('p', 'field-hint', t('pastUploadHint')));
    var summary = el('p', 'material-summary');
    summary.id = 'past-summary';
    card.appendChild(summary);

    var row = el('div', 'btnrow');
    var analyseBtn = el('button', 'btn btn-primary btn-big', t('pastAnalyseBtn'));
    analyseBtn.id = 'past-analyse-btn';
    analyseBtn.type = 'button';
    if (pastState.busy) analyseBtn.disabled = true;
    analyseBtn.addEventListener('click', function () { analysePastExams(); });
    row.appendChild(analyseBtn);
    card.appendChild(row);
    var prog = el('p', 'gen-progress');
    prog.id = 'past-progress';
    if (pastState.busy) prog.textContent = pastState.progress;
    card.appendChild(prog);
    var errBox = el('div', 'bank-error');
    errBox.id = 'past-error';
    card.appendChild(errBox);

    var resBox = el('div');
    resBox.id = 'past-results';
    card.appendChild(resBox);

    var brow = el('div', 'btnrow');
    var back = el('button', 'btn btn-secondary btn-big', t('pastBack'));
    back.id = 'past-back-btn';
    back.addEventListener('click', function () { setView('library'); });
    brow.appendChild(back);
    var clear = el('button', 'btn btn-secondary btn-big', t('pastClear'));
    clear.id = 'past-clear-btn';
    clear.addEventListener('click', function () {
      if (!pastState) return;
      pastState.exams = [];
      pastState.result = null;
      renderPast();
      showPastStatus(t('pastCleared'), true);
    });
    brow.appendChild(clear);
    card.appendChild(brow);

    wrap.appendChild(card);
    app.appendChild(wrap);
    pastRefreshExams();
  }

  /* Test/debug handle (like window.__qfChat): the pure past-exam
     pieces for the headless smoke test. */
  window.__qfPast = {
    openPastAnalysis: openPastAnalysis,
    buildTopicPrompt: buildTopicPrompt,
    parseTopicResponse: parseTopicResponse,
    buildMergePrompt: buildMergePrompt,
    parseMergeResponse: parseMergeResponse,
    mergeTopicsLocal: mergeTopicsLocal,
    computeFrequency: computeFrequency,
    state: function () { return pastState; }
  };

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
    /* Chat with the material (Feature 1, 2026-11-22): a fresh chat
       with no exam — the student uploads or pastes material here. */
    var chatFreshBtn = el('button', 'btn btn-secondary', t('chatBtnFresh'));
    chatFreshBtn.id = 'chat-fresh-btn';
    chatFreshBtn.addEventListener('click', function () { openChat(null); });
    row.appendChild(chatFreshBtn);
    /* Past-exam analysis (Feature 2, 2026-11-22): which topics repeat
       across years, then a focused exam on the most-repeated ones. */
    var pastBtn = el('button', 'btn btn-secondary', t('pastBtn'));
    pastBtn.id = 'past-btn';
    pastBtn.addEventListener('click', function () { openPastAnalysis(); });
    row.appendChild(pastBtn);
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
      /* Generate from a link (2026-11-22): show where the questions
         came from. The href is only used for http(s) URLs. */
      if (entry.sourceUrl && /^https?:\/\//i.test(entry.sourceUrl)) {
        var srcLine = el('p', 'muted lib-source');
        srcLine.appendChild(document.createTextNode(t('libSource') + ' '));
        var srcLink = document.createElement('a');
        srcLink.href = entry.sourceUrl;
        srcLink.target = '_blank';
        srcLink.rel = 'noopener';
        srcLink.title = entry.sourceUrl;
        srcLink.textContent = entry.sourceUrl.length > 60
          ? entry.sourceUrl.slice(0, 60) + '…'
          : entry.sourceUrl;
        srcLine.appendChild(srcLink);
        card.appendChild(srcLine);
      }
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
      /* Fresh variant (2026-11-22): only for exams that still carry
         their source material — generated exams do, imported / shared /
         demo ones do not. */
      var vErr = el('div', 'bank-error');
      if (entry.material && entry.material.trim()) {
        /* Chat with the material (Feature 1, 2026-11-22): only for
           exams that still carry their source material — generated
           exams do, imported / shared / demo ones do not. */
        var chatBtn = el('button', 'btn btn-secondary', t('chatBtn'));
        chatBtn.addEventListener('click', function () { openChat(entry); });
        r.appendChild(chatBtn);
        var varBtn = el('button', 'btn btn-secondary', t('variantBtn'));
        varBtn.addEventListener('click', function () { generateVariant(entry, varBtn, vErr); });
        r.appendChild(varBtn);
      }
      var del = el('button', 'btn btn-secondary', t('libDelete'));
      del.addEventListener('click', function () {
        if (!saveLibrary(loadLibrary().filter(function (x) { return x.id !== entry.id; }))) {
          showToast(t('errSaveFailed'), true);
          return;
        }
        renderLibrary();
      });
      r.appendChild(del);
      card.appendChild(r);
      card.appendChild(vErr);
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
        repairTfQuestions(data);
        validate(data);
        var lib = loadLibrary();
        lib.unshift({
          id: newId('imp'),
          title: data.title || file.name.replace(/\.json$/i, ''),
          subtitle: data.subtitle || t('libImportedBank', { n: data.questions.length }),
          date: todayStr(),
          count: data.questions.length,
          provider: 'import',
          model: '',
          bank: data
        });
        if (!saveLibrary(lib)) {
          var saveErr = new Error(t('errSaveFailed'));
          saveErr.saveFailed = true;
          throw saveErr;
        }
        renderLibrary();
        /* renderLibrary() rebuilds the header, so the status boxes
           must be looked up (and filled) after it, not before. A
           bank import used to give no confirmation at all. */
        var okBox = document.getElementById('backup-status');
        showStatusBox(okBox, t('libBankImported', { n: data.questions.length }));
      } catch (e) {
        if (errBox) {
          /* A storage failure is not a format problem — do not
             append the format hint to it. */
          showStatusBox(errBox, (e && e.saveFailed)
            ? e.message
            : t('libImportErr', { msg: e.message + t('libImportHint') }));
        }
      }
    };
    reader.onerror = function () { showImportReadError(); };
    reader.readAsText(file);
  }

  function exportBank(entry) {
    var blob = new Blob([JSON.stringify(entry.bank, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    /* A non-Latin title (e.g. Arabic) sanitizes to nothing but
       dashes — fall back to 'exam' instead of a '-.json' file. */
    var safe = (entry.title || 'exam').replace(/[^a-z0-9-_]+/gi, '-')
      .replace(/^-+|-+$/g, '').toLowerCase();
    a.download = (safe || 'exam') + '.json';
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
      showStatusBox(errBox, t('libBackupEmpty'));
      hideStatusBox(okBox);
      return null;
    }
    var data = buildBackup();
    window.__qfLastBackup = data;
    downloadJson(data, 'quizforge-library-' + todayStr() + '.json');
    hideStatusBox(errBox);
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
        /* A backup round-trip used to drop the material, the stored
           settings, the variant chain and the source URL — a
           restored exam could no longer make a variant or chat
           about its material. Keep them (type-checked, and the
           settings sanitized) so an export → import keeps the exam
           fully working. */
        fresh.push({
          id: id,
          title: (typeof entry.title === 'string' && entry.title)
            ? entry.title : t('libImportedBank', { n: entry.bank.questions.length }),
          subtitle: (typeof entry.subtitle === 'string')
            ? entry.subtitle : t('libImportedBank', { n: entry.bank.questions.length }),
          date: (typeof entry.date === 'string' && entry.date)
            ? entry.date : todayStr(),
          count: entry.bank.questions.length,
          provider: (typeof entry.provider === 'string' && entry.provider) ? entry.provider : 'import',
          model: (typeof entry.model === 'string') ? entry.model : '',
          bank: entry.bank,
          material: (typeof entry.material === 'string') ? entry.material : '',
          sourceUrl: (typeof entry.sourceUrl === 'string') ? entry.sourceUrl : '',
          gen: (entry.gen && typeof entry.gen === 'object') ? sanitizeGenSettings(entry.gen) : undefined,
          variant: (typeof entry.variant === 'number' && isFinite(entry.variant)) ? entry.variant : 1,
          baseTitle: (typeof entry.baseTitle === 'string' && entry.baseTitle) ? entry.baseTitle : undefined
        });
        added++;
      } catch (e) { invalid++; }
    });
    if (added === 0 && skipped === 0) throw new Error(t('libBackupNoValid'));
    if (added > 0 && !saveLibrary(fresh.concat(lib)))
      throw new Error(t('errSaveFailed'));
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
        hideStatusBox(errBox);
        showStatusBox(okBox, t('libBackupImported', { added: res.added, skipped: res.skipped }) +
          (res.invalid > 0 ? t('libBackupInvalidNote', { n: res.invalid }) : ''));
      } catch (e) {
        okBox = document.getElementById('backup-status');
        errBox = document.getElementById('import-error');
        hideStatusBox(okBox);
        showStatusBox(errBox, e.message);
      }
    };
    reader.onerror = function () { showImportReadError(); };
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
          mRight.appendChild(el('li', null, letterFor(idx) + ') ' + r));
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
          opts.appendChild(el('li', null, letterFor(idx) + ') ' + (qt === 'tf' ? tfDisplayText(optText) : optText)));
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
          (i + 1) + '. ' + letterFor(q.answer) + ') ' + (qt === 'tf' ? tfDisplayText(q.options[q.answer]) : q.options[q.answer])));
      }
      if (qt === 'tf' && tfJustification(q)) {
        row.appendChild(el('div', 'print-keywhy', t('tfJustification') + tfJustification(q)));
      } else if (q.explanation) {
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
          bubbles.appendChild(el('span', 'ans-bubble', letterFor(idx)));
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
            mRight.appendChild(el('li', null, letterFor(idx) + ') ' + r));
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

  /* ---------- cheat sheet from mistakes (2026-11-22) ----------
     One printable page covering EXACTLY the concepts behind the
     questions the student got wrong — nothing else. Two sources:
     - With a key: the provider condenses the missed questions
       (same BYOK callProvider flow as the material summary). The
       reply must come back with exactly one item per missed
       question, in the same order — anything else is rejected, so
       the sheet can never cover a concept the student did not miss.
     - Without a key: the sheet is built from the stored
       explanations of the missed questions, verbatim (question +
       correct answer + its explanation, trimmed to short lines).
       Nothing is invented and no fake AI summary is claimed.
     The sheet is stored on the attempt record (LS_STATS) and on the
     live run, so it can be reopened later from Stats without
     regenerating. It prints through the same hidden #print-sheet +
     window.print() approach as the exam, black-on-white in any mode. */
  var cheatState = { sheet: null, returnTo: 'results', busy: false, error: '' };
  var CHEAT_EXPL_MAX = 320;   // verbatim explanation cap, per missed question

  function cheatTrim(s, max) {
    var str = String(s || '').trim().replace(/\s+/g, ' ');
    if (str.length <= max) return str;
    return str.slice(0, max).replace(/\s+\S*$/, '').trim() + '…';
  }

  /* The missed questions of the current run, with the student's
     answer and the correct answer rendered the same way the results
     review renders them (shuffled option order, TF labels in the UI
     language, matching pairs / ordering / fill / essay / coding). */
  function cheatWrongEntries() {
    if (!run || !quiz || !Array.isArray(run.qIndexes)) return [];
    var entries = [];
    run.qIndexes.forEach(function (qi, pos) {
      var a = run.answers[pos];
      if (a && a.correct) return;
      var q = quiz.questions[qi];
      if (!q) return;
      var opts = run.optOrders[pos] || [];
      var qt = qType(q);
      var correctIdx = opts.findIndex(function (o) { return o.correct; });
      var yours = (a && a.picked !== null && a.picked !== undefined && opts[a.picked])
        ? opts[a.picked].text : null;
      if (qt === 'tf' && yours !== null) yours = tfDisplayText(yours);
      var correctText = '';
      if (qt === 'mcq' || qt === 'tf') {
        correctText = correctIdx >= 0 && opts[correctIdx]
          ? letterFor(correctIdx) + ') ' + tfDisplayText(opts[correctIdx].text) : '';
      } else if (qt === 'fill') {
        correctText = (q.answers || []).join(', ');
      } else if (qt === 'essay') {
        correctText = (q.rubric || (a && a.feedback) || '').trim();
      } else if (qt === 'matching') {
        correctText = (q.pairs || []).map(function (p) { return p.left + ' → ' + p.right; }).join(' · ');
      } else if (qt === 'ordering') {
        correctText = (q.items || []).map(function (s, i) { return (i + 1) + '. ' + s; }).join(' · ');
      } else if (qt === 'coding') {
        correctText = (q.tests || []).map(function (tc) { return tc.input + ' → ' + tc.expected; }).join(' · ');
      }
      entries.push({
        question: q.question || '',
        topic: (q.topic || 'General'),
        yourAnswer: yours !== null ? yours : ((a && a.text) ? a.text : null),
        correctAnswer: correctText,
        explanation: qt === 'tf' ? tfJustification(q) : (q.explanation || '')
      });
    });
    return entries;
  }

  /* No-key sheet: the concept heading is the question's topic (or
     the question itself when there is no useful topic), and the
     points are the correct answer plus the stored explanation,
     verbatim — trimmed, never rewritten. */
  function buildLocalCheatSheet(entries) {
    return {
      source: 'local',
      lang: wiz.language || 'English',
      generatedAt: Date.now(),
      title: quiz ? (quiz.title || t('quizDefaultTitle')) : t('quizDefaultTitle'),
      items: entries.map(function (e) {
        var points = [];
        if (e.correctAnswer) points.push(t('cheatCorrect') + e.correctAnswer);
        if (e.explanation) points.push(cheatTrim(e.explanation, CHEAT_EXPL_MAX));
        if (!points.length) points.push(cheatTrim(e.question, CHEAT_EXPL_MAX));
        return {
          concept: (e.topic && e.topic !== 'General') ? e.topic : cheatTrim(e.question, 80),
          points: points,
          question: e.question,
          yourAnswer: e.yourAnswer,
          correctAnswer: e.correctAnswer
        };
      })
    };
  }

  function buildCheatPrompt(entries, lang) {
    var lines = entries.map(function (e, i) {
      return (i + 1) + '. QUESTION: ' + e.question +
        '\n   STUDENT ANSWER: ' + (e.yourAnswer === null ? '(no answer)' : e.yourAnswer) +
        '\n   CORRECT ANSWER: ' + (e.correctAnswer || '(see explanation)') +
        '\n   EXPLANATION: ' + (e.explanation || '(none)');
    }).join('\n\n');
    return 'You are a study assistant. The student got exactly the ' +
      entries.length + ' question(s) below wrong. Build a tight one-page cheat sheet ' +
      'in ' + lang + ' covering ONLY the concepts behind THESE questions — nothing else, ' +
      'no extra topics, no general advice. Reply with JSON ONLY — no markdown ' +
      'fences, no extra text. The JSON must be an object with "items": an array of ' +
      'exactly ' + entries.length + ' objects, in the same order as the questions, ' +
      'each with "concept" (a short heading naming the concept) and "points" ' +
      '(an array of 1–3 short lines: the correct fact, formula or definition, ' +
      'each under 25 words). Base everything ONLY on the questions below — do not ' +
      'invent facts.\n\nMISSED QUESTIONS:\n' + lines;
  }

  function parseCheatResponse(raw, count) {
    var data;
    try { data = JSON.parse(extractJsonText(raw)); }
    catch (e) { throw new Error(t('errBadJson', { label: '' })); }
    var items = (data && Array.isArray(data.items)) ? data.items : [];
    if (items.length !== count) throw new Error(t('errBadJson', { label: '' }));
    var clean = items.map(function (it) {
      if (!it || typeof it.concept !== 'string' || !it.concept.trim()) throw new Error(t('errBadJson', { label: '' }));
      var pts = (Array.isArray(it.points) ? it.points : [])
        .filter(function (s) { return typeof s === 'string' && s.trim(); })
        .map(function (s) { return s.trim(); }).slice(0, 3);
      if (!pts.length) throw new Error(t('errBadJson', { label: '' }));
      return { concept: it.concept.trim(), points: pts };
    });
    return clean;
  }

  /* Store the sheet with the attempt so it can be reopened from
     Stats later without regenerating. */
  function saveCheatSheet(sheet) {
    if (!sheet) return;
    if (run) run.cheatSheet = sheet;
    cheatState.sheet = sheet;
    if (run && run.attemptId) {
      var list = loadStats();
      var found = false;
      list.forEach(function (a) {
        if (a && a.id === run.attemptId) { a.cheatSheet = sheet; found = true; }
      });
      if (found) saveStats(list);
    }
  }

  function generateCheatSheet() {
    if (cheatState.busy) return;
    if (run && run.cheatSheet) { showCheatSheet(run.cheatSheet, 'results'); return; }
    var entries = cheatWrongEntries();
    if (!entries.length) return;
    var status = document.getElementById('cheat-status');
    var btn = document.getElementById('cheat-sheet-btn');
    if (!byok.apiKey) {
      /* No key: verbatim sheet from the stored explanations. */
      var local = buildLocalCheatSheet(entries);
      saveCheatSheet(local);
      showCheatSheet(local, 'results');
      return;
    }
    if (isOffline()) {
      if (status) status.textContent = t('offlineNeedNet');
      showToast(t('offlineNeedNet'));
      return;
    }
    cheatState.busy = true;
    if (btn) btn.disabled = true;
    if (status) status.textContent = t('cheatGenerating');
    callProvider(buildCheatPrompt(entries, wiz.language || 'English'), 1, 'cheatsheet')
      .then(function (raw) {
        var items = parseCheatResponse(raw, entries.length);
        var sheet = {
          source: 'ai',
          lang: wiz.language || 'English',
          generatedAt: Date.now(),
          title: quiz ? (quiz.title || t('quizDefaultTitle')) : t('quizDefaultTitle'),
          items: items.map(function (it, i) {
            return {
              concept: it.concept,
              points: it.points,
              question: entries[i].question,
              yourAnswer: entries[i].yourAnswer,
              correctAnswer: entries[i].correctAnswer
            };
          })
        };
        cheatState.busy = false;
        saveCheatSheet(sheet);
        showCheatSheet(sheet, 'results');
      })
      .catch(function (e) {
        cheatState.busy = false;
        if (btn) btn.disabled = false;
        var detail = plainError ? plainError(e) : (e && e.message ? e.message : String(e));
        if (status) status.textContent = t('cheatFail', { detail: detail });
        showToast(t('cheatFail', { detail: detail }));
      });
  }

  /* The cheat sheet's own screen. `returnTo` is 'results' (from the
     results screen) or 'stats' (reopening a stored sheet). */
  function showCheatSheet(sheet, returnTo) {
    if (!sheet || !Array.isArray(sheet.items) || !sheet.items.length) {
      showToast(t('cheatNoSheet'));
      return;
    }
    cheatState.sheet = sheet;
    cheatState.returnTo = returnTo || 'results';
    currentView = 'cheatsheet';
    app.innerHTML = '';
    var card = el('section', 'card cheat-card');
    card.appendChild(el('p', 'kicker', t('cheatKicker')));
    card.appendChild(el('h2', null, t('cheatTitle')));
    card.appendChild(el('p', 'hero-text', t('cheatHint')));
    card.appendChild(el('p', 'field-hint',
      sheet.source === 'ai' ? t('cheatAiNote') : t('cheatLocalNote')));
    sheet.items.forEach(function (it, i) {
      var block = el('div', 'cheat-item');
      block.appendChild(el('h3', 'cheat-concept', (i + 1) + '. ' + it.concept));
      var ul = el('ul', 'cheat-points');
      (it.points || []).forEach(function (p) { ul.appendChild(el('li', null, p)); });
      block.appendChild(ul);
      if (it.yourAnswer !== null && it.yourAnswer !== undefined && it.yourAnswer !== '') {
        var corr = el('div', 'cheat-correction');
        corr.appendChild(document.createTextNode(t('cheatYourAnswer')));
        corr.appendChild(el('span', 'yours', String(it.yourAnswer)));
        if (it.correctAnswer) {
          corr.appendChild(document.createTextNode(' · ' + t('cheatCorrect')));
          corr.appendChild(el('span', 'right', String(it.correctAnswer)));
        }
        block.appendChild(corr);
      } else if (it.correctAnswer) {
        var corr2 = el('div', 'cheat-correction');
        corr2.appendChild(document.createTextNode(t('cheatCorrect')));
        corr2.appendChild(el('span', 'right', String(it.correctAnswer)));
        block.appendChild(corr2);
      }
      if (it.question) block.appendChild(el('p', 'cheat-q', t('cheatQuestion') + ': ' + it.question));
      card.appendChild(block);
    });
    var row = el('div', 'btnrow');
    var prt = el('button', 'btn btn-primary', t('cheatPrint'));
    prt.id = 'cheat-print-btn';
    prt.addEventListener('click', function () {
      buildCheatPrintSheet(sheet);
      window.print();
    });
    row.appendChild(prt);
    var back = el('button', 'btn btn-secondary',
      cheatState.returnTo === 'stats' ? t('cheatBackStats') : t('cheatBack'));
    back.id = 'cheat-back-btn';
    back.addEventListener('click', function () {
      if (cheatState.returnTo === 'stats') renderStats();
      else if (run && run.resultsShown) showResults();
      else showStart();
    });
    row.appendChild(back);
    card.appendChild(row);
    app.appendChild(card);
    window.scrollTo({ top: 0 });
  }

  /* Print version: the same hidden #print-sheet as the exam, so the
     sheet prints clean black-on-white on one page (compact type,
     no page break inside a concept). */
  function buildCheatPrintSheet(sheet) {
    var ps = document.getElementById('print-sheet');
    if (!ps) {
      ps = document.createElement('div');
      ps.id = 'print-sheet';
      document.body.appendChild(ps);
    }
    ps.innerHTML = '';
    var date = new Date().toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB');
    var head = el('div', 'print-head');
    head.appendChild(el('h1', null, t('cheatTitle')));
    if (sheet.title) head.appendChild(el('p', 'print-sub', sheet.title));
    head.appendChild(el('p', 'print-meta',
      t('printMeta', { date: date })));
    ps.appendChild(head);
    sheet.items.forEach(function (it, i) {
      var block = el('div', 'print-cheat');
      block.appendChild(el('div', 'print-qtext', (i + 1) + '. ' + it.concept));
      var ul = el('ul', 'print-cheat-points');
      (it.points || []).forEach(function (p) { ul.appendChild(el('li', null, p)); });
      block.appendChild(ul);
      if (it.yourAnswer !== null && it.yourAnswer !== undefined && it.yourAnswer !== '') {
        block.appendChild(el('div', 'print-keywhy',
          t('cheatYourAnswer') + String(it.yourAnswer) +
          (it.correctAnswer ? ' · ' + t('cheatCorrect') + String(it.correctAnswer) : '')));
      } else if (it.correctAnswer) {
        block.appendChild(el('div', 'print-keywhy', t('cheatCorrect') + String(it.correctAnswer)));
      }
      ps.appendChild(block);
    });
    return ps;
  }

  /* Test/debug handle (like window.__qfTf): the pure cheat-sheet
     helpers, for the headless smoke test. */
  window.__qfCheat = {
    wrongEntries: cheatWrongEntries,
    buildLocal: buildLocalCheatSheet,
    buildPrompt: buildCheatPrompt,
    parse: parseCheatResponse,
    generate: generateCheatSheet,
    show: showCheatSheet,
    printSheet: buildCheatPrintSheet,
    trim: cheatTrim
  };

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
      /* Cheat sheet from mistakes (2026-11-22): reopen a stored
         sheet without regenerating it. */
      if (a.cheatSheet && Array.isArray(a.cheatSheet.items) && a.cheatSheet.items.length) {
        var csBtn = el('button', 'btn btn-secondary cheat-stats-btn', t('cheatViewBtn'));
        csBtn.type = 'button';
        csBtn.addEventListener('click', (function (sheet) {
          return function () { showCheatSheet(sheet, 'stats'); };
        })(a.cheatSheet));
        item.appendChild(csBtn);
      }
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
    /* A corrupt stream rejects the write/close promises too — swallow
       those here so the failure only surfaces once, through the
       Response promise the caller already handles. Otherwise a bad
       share link also logs an unhandled-rejection pageerror. */
    writer.write(bytes).catch(function () {});
    writer.close().catch(function () {});
    return new Response(cs.readable).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  function inflateBytes(bytes) {
    var ds = new DecompressionStream('deflate');
    var writer = ds.writable.getWriter();
    writer.write(bytes).catch(function () {});
    writer.close().catch(function () {});
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
      id: newId('shr'),
      title: quiz.title || t('quizDefaultTitle'),
      subtitle: quiz.subtitle || t('libImportedBank', { n: quiz.questions.length }),
      date: todayStr(),
      count: quiz.questions.length,
      provider: 'shared',
      model: '',
      bank: quiz
    });
    if (!saveLibrary(lib)) {
      showToast(t('errSaveFailed'), true);
      return;
    }
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
      /* Mid-quiz: rebuild the question screen so the per-question
         chip appears or disappears at once. Turning it on starts a
         fresh countdown for the current question; drafts keep any
         typed answer. */
      if (run && !run.resultsShown) {
        if (pq.checked && run.perQLeftByPos) delete run.perQLeftByPos[run.current];
        renderQuestion();
      }
    });
    sec.addEventListener('change', function () {
      var v = parseInt(sec.value, 10);
      if (!isNaN(v)) {
        settings.perQSeconds = Math.max(5, Math.min(600, v));
        sec.value = String(settings.perQSeconds);
        saveSettings();
        updateSettingsSummary();
        /* Mid-quiz: the new value applies to the current question
           from now, so the chip never shows a stale limit. */
        if (run && !run.resultsShown && settings.perQTimer &&
          run.answers[run.current] === null) {
          run.perQLeft = settings.perQSeconds;
          var chip = document.getElementById('timer-perq');
          if (chip) chip.textContent = fmtTime(run.perQLeft);
        }
      }
    });

    /* Text-to-speech: auto-read toggle + reading speed. When the
       browser has no speechSynthesis, both controls hide and a
       plain note says so — the app never pretends reading works. */
    var arRow = document.getElementById('set-autoread-row');
    var rateRow = document.getElementById('set-rate-row');
    var ttsNote = document.getElementById('set-tts-note');
    if (!ttsSupported()) {
      if (arRow) arRow.hidden = true;
      if (rateRow) rateRow.hidden = true;
      if (ttsNote) ttsNote.hidden = false;
    } else {
      var ar = document.getElementById('set-autoread');
      ar.checked = settings.autoRead;
      ar.addEventListener('change', function () {
        settings.autoRead = ar.checked;
        saveSettings();
      });
      var rate = document.getElementById('set-rate');
      rate.value = String(settings.speechRate);
      rate.addEventListener('change', function () {
        var v = parseFloat(rate.value);
        settings.speechRate = TTS_RATES.indexOf(v) !== -1 ? v : 1;
        rate.value = String(settings.speechRate);
        saveSettings();
      });
    }
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
      /* Only the question on screen has a live elapsed time; every
         other unanswered question records 0s, not the current
         question's clock. */
      var secsFor = (pos === run.current) ? qSecs() : 0;
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
      if (run.oral && pos === run.current) {
        /* Oral mode: the transcript is the typed text for this
           question, whatever its type. */
        var ot = document.getElementById('oral-transcript');
        if (ot && ot.value.trim()) txt = ot.value.trim();
      }
      if ((qt === 'fill' || qt === 'essay' || qt === 'coding') && txt.trim()) {
        if (qt === 'fill') {
          run.answers[pos] = { text: txt, oral: !!run.oral, correct: gradeFill(q, txt), timedOut: true, secs: secsFor };
        } else if (qt === 'coding') {
          run.answers[pos] = {
            text: txt, oral: !!run.oral, correct: false, timedOut: true, secs: secsFor,
            codeScore: 0, codeTotal: (q.tests || []).length
          };
        } else {
          run.answers[pos] = { text: txt, oral: !!run.oral, correct: false, graded: false, grading: false, timedOut: true, secs: secsFor };
        }
      } else if (run.oral && (qt === 'mcq' || qt === 'tf') && txt.trim()) {
        var op = parseSpokenChoice(q, txt,
          (run.optOrders[pos] || []).map(function (o) { return o.text; }));
        run.answers[pos] = {
          text: txt, oral: true, picked: op,
          correct: op !== null ? run.optOrders[pos][op].correct : false,
          graded: op !== null, grading: false, timedOut: true, secs: secsFor,
          score: op !== null ? (run.optOrders[pos][op].correct ? 100 : 0) : 0,
          maxScore: 100, method: 'local',
          gradeError: op === null ? t('oralNoMatch') : undefined
        };
      } else if (qt === 'matching') {
        var picks = pos === run.current ? readMatchingDraft(pos)
          : ((run.matchDrafts[pos] || []).slice());
        var gm = gradeMatching(q, picks);
        run.answers[pos] = {
          picks: picks, correct: gm.correct, got: gm.got, total: gm.total,
          timedOut: true, secs: secsFor
        };
      } else if (qt === 'ordering') {
        var ord = ((run.orderDrafts[pos] || []).slice());
        var go = gradeOrdering(q, ord);
        run.answers[pos] = {
          order: ord, correct: go.correct, got: go.got, total: go.total,
          timedOut: true, secs: secsFor
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

  /* Start (or resume) the per-question countdown. `left` resumes a
     saved remainder — going back to a question, or a failed oral
     submit, must not hand the student a fresh full timer. Without
     it the question starts with the full per-question time. */
  function startPerQTimer(left) {
    if (perQTimerId !== null) clearInterval(perQTimerId);
    run.perQLeft = (typeof left === 'number' && left >= 0)
      ? Math.min(left, settings.perQSeconds) : settings.perQSeconds;
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
    /* An intentional exit (Exit button) is not a fullscreen escape. */
    if (run && run.strict) strictWarned = true;
    if (run && run.strict) exitFullscreen();
    stopTimers();
    stopSpeech();
    run = null;
    fc = null;
    strictMode = false;   // strict is per exam, off by default
    oralMode = false;     // oral is per exam, off by default
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
    var oralRow = el('label', 'set-row oral-row');
    var oralChk = document.createElement('input');
    oralChk.type = 'checkbox';
    oralChk.id = 'oral-toggle';
    oralChk.checked = false;
    oralChk.addEventListener('change', function () { oralMode = oralChk.checked; });
    oralRow.appendChild(oralChk);
    oralRow.appendChild(el('span', null, t('oralToggle')));
    startCard.appendChild(oralRow);
    var oralHint = el('p', 'hint oral-hint', t('oralHint'));
    oralHint.id = 'oral-hint';
    startCard.appendChild(oralHint);
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

  /* ---------- text-to-speech: read questions aloud ----------
     Web Speech API (window.speechSynthesis): on-device, no network,
     no API key, nothing sent anywhere. Voice language follows the
     exam's language (Arabic script -> ar-EG, otherwise en-US,
     detected per question); a matching voice is picked when one
     exists, otherwise the browser default speaks. One shared
     stopSpeech() is called from every path that moves on, so speech
     never keeps talking over the next screen. */
  var ttsSpeaking = false;   // is a QuizForge utterance playing?
  var ttsCurrentBtn = null;  // the speaker button in "speaking" state

  function ttsSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window &&
      !!window.speechSynthesis && typeof window.speechSynthesis.speak === 'function';
  }

  /* Voice language for one question. The bank stores no language
     field, so the exam's language is the script of the question
     itself (same detector as translation); when the text has no
     letters at all (numbers only), the UI language is the fallback. */
  function ttsLangFor(q) {
    var text = (q.question || '') + ' ' + ((q.options || []).join(' '));
    var hasAr = /[\u0600-\u06FF\u0750-\u077F]/.test(text);
    var hasLat = /[A-Za-z]/.test(text);
    if (hasAr && !hasLat) return 'ar-EG';
    if (hasLat && !hasAr) return 'en-US';
    if (hasAr && hasLat) return detectExamLang([q]) === 'ar' ? 'ar-EG' : 'en-US';
    return getLang() === 'ar' ? 'ar-EG' : 'en-US';
  }

  function ttsVoiceFor(lang) {
    if (!ttsSupported()) return null;
    try {
      var voices = window.speechSynthesis.getVoices() || [];
      var prefix = lang.split('-')[0];
      var i, v = null;
      for (i = 0; i < voices.length; i++) {
        if (voices[i].lang === lang) { v = voices[i]; break; }
      }
      if (!v) {
        for (i = 0; i < voices.length; i++) {
          if ((voices[i].lang || '').split('-')[0] === prefix) { v = voices[i]; break; }
        }
      }
      return v;
    } catch (e) { return null; }
  }

  /* Plain spoken text for one question, per type. MCQ / True-False
     read the options in their DISPLAY order (the shuffled order on
     screen) with their on-screen letters, so what you hear matches
     what you see. Matching reads the left items, then the right
     partners in their displayed order — never paired, so the answer
     is not given away. Ordering reads the items in their current
     on-screen order, for the same reason. Essay / fill-in read the
     question only; coding never reads code aloud. */
  function speakTextFor(q, display) {
    var qt = qType(q);
    var parts = [(q.question || '').trim()];
    if (qt === 'mcq' || qt === 'tf') {
      var texts = (display && display.opts) || (q.options || []);
      /* True/False labels are UI chrome: read them in the UI
         language, like the quiz screen shows them. */
      if (qt === 'tf') texts = texts.map(function (x) { return tfDisplayText(x); });
      texts.forEach(function (text, i) {
        parts.push(letterFor(i) + '. ' + text);
      });
    } else if (qt === 'matching') {
      (q.pairs || []).forEach(function (p) { parts.push(p.left); });
      var rights = (display && display.rights) ||
        (q.pairs || []).map(function (p) { return p.right; });
      rights.forEach(function (r) { parts.push(r); });
    } else if (qt === 'ordering') {
      var items = (display && display.items) || (q.items || []);
      items.forEach(function (s, i) { parts.push((i + 1) + '. ' + s); });
    }
    return parts.filter(function (s) { return s && String(s).trim(); }).join('. ');
  }

  /* Display order for the current quiz position, for speech: the
     shuffled option order (MCQ/TF), the shuffled right column
     (matching), or the current on-screen order (ordering). */
  function ttsDisplayFor(pos) {
    if (!run) return null;
    var q = quiz.questions[run.qIndexes[pos]];
    var qt = qType(q);
    if (qt === 'mcq' || qt === 'tf') {
      return { opts: (run.optOrders[pos] || []).map(function (o) { return o.text; }) };
    }
    if (qt === 'matching') {
      return { rights: (run.matchOrders[pos] || []).slice() };
    }
    if (qt === 'ordering') {
      var cur = run.answers[pos] ? run.answers[pos].order
        : ((run.orderDrafts[pos] || run.orderOrders[pos]) || []);
      return { items: (cur || []).slice() };
    }
    return null;
  }

  function setSpeakBtnState(btn, speaking) {
    if (!btn) return;
    btn.classList.toggle('speaking', speaking);
    btn.setAttribute('aria-pressed', speaking ? 'true' : 'false');
    btn.setAttribute('aria-label', speaking ? t('ttsStopAria') : t('ttsListenAria'));
    btn.textContent = speaking ? t('ttsStop') : t('ttsListen');
  }

  function stopSpeech() {
    if (ttsCurrentBtn) setSpeakBtnState(ttsCurrentBtn, false);
    ttsCurrentBtn = null;
    ttsSpeaking = false;
    if (!ttsSupported()) return;
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }

  /* Read one question aloud. Returns false when speech is
     unavailable or there is nothing to read. `btn` is the speaker
     button that started it (it becomes the Stop button while the
     utterance plays); pass null for auto-read without a button. */
  function speakQuestion(q, display, btn) {
    if (!ttsSupported() || !q) return false;
    var text = speakTextFor(q, display);
    if (!text) return false;
    stopSpeech();
    var lang = ttsLangFor(q);
    var u;
    try {
      u = new SpeechSynthesisUtterance(text);
    } catch (e) { return false; }
    u.lang = lang;
    u.rate = settings.speechRate || 1;
    var voice = ttsVoiceFor(lang);
    if (voice) u.voice = voice;
    ttsSpeaking = true;
    ttsCurrentBtn = btn || null;
    if (btn) setSpeakBtnState(btn, true);
    u.onend = function () {
      ttsSpeaking = false;
      if (btn) setSpeakBtnState(btn, false);
      if (ttsCurrentBtn === btn) ttsCurrentBtn = null;
    };
    u.onerror = function () {
      ttsSpeaking = false;
      if (btn) setSpeakBtnState(btn, false);
      if (ttsCurrentBtn === btn) ttsCurrentBtn = null;
    };
    try {
      window.speechSynthesis.speak(u);
    } catch (e) {
      ttsSpeaking = false;
      if (btn) setSpeakBtnState(btn, false);
      ttsCurrentBtn = null;
      return false;
    }
    return true;
  }

  /* One speaker button: "🔊 Listen" while idle, "⏹ Stop" while
     speaking. Clicking while speaking stops. Returns null when the
     browser has no speechSynthesis, so no button is ever shown that
     cannot work. */
  function makeSpeakButton(q, display) {
    if (!ttsSupported()) return null;
    var b = el('button', 'btn btn-secondary btn-small speak-btn', t('ttsListen'));
    b.type = 'button';
    b.setAttribute('aria-label', t('ttsListenAria'));
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      b.blur();
      if (ttsSpeaking && ttsCurrentBtn === b) { stopSpeech(); return; }
      speakQuestion(q, display, b);
    });
    return b;
  }

  /* Debug/test handle for text-to-speech. */
  window.__qfTts = {
    supported: ttsSupported,
    speaking: function () { return ttsSpeaking; },
    speakQuestion: speakQuestion,
    stop: stopSpeech,
    textFor: speakTextFor,
    langFor: ttsLangFor,
    state: function () {
      return {
        supported: ttsSupported(), speaking: ttsSpeaking,
        autoRead: settings.autoRead, rate: settings.speechRate
      };
    }
  };

  /* ---------- oral exam by voice (2026-11-22) ----------
     The question is read aloud with the existing TTS, the student
     answers by speaking, and the transcript is graded:
     - MCQ / True-False: the spoken letter, number or option text is
       matched locally first (no key needed, no API call).
     - Open answers (essay, fill-in, coding-as-spoken): the
       transcript goes to the provider through the same BYOK
       callProvider flow as essay grading, scored 0–100 with short
       feedback. With no key the answer is saved ungraded and the
       UI says so plainly — never a fake AI grade.
     - Matching / ordering cannot be answered in words, so in oral
       mode they fall back to the normal written UI with a note.
     Speech recognition is the browser Web Speech API
     (SpeechRecognition / webkitSpeechRecognition). Where it does
     not exist, the panel says so plainly and the student types
     instead — the transcript is never faked. The transcript is
     always editable by typing before submitting, and re-recording
     replaces it. */
  var oralRecog = null;      // active SpeechRecognition, if any
  var oralListening = false; // is the mic currently listening?
  var oralFinalText = '';    // final transcript accumulated this turn

  function srSupported() {
    return typeof window !== 'undefined' &&
      !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function srLangFor(q) { return ttsLangFor(q); }

  /* Stop any recognition in progress (navigation, submit, language
     switch, results). Never throws. */
  function stopOralRecognition() {
    oralListening = false;
    if (oralRecog) {
      var r = oralRecog;
      oralRecog = null;
      try { r.abort(); } catch (e) { try { r.stop(); } catch (e2) {} }
    }
    var btn = document.getElementById('oral-mic-btn');
    if (btn) {
      btn.classList.remove('listening');
      btn.textContent = t('oralMicStart');
      btn.setAttribute('aria-pressed', 'false');
    }
    var st = document.getElementById('oral-status');
    if (st) st.hidden = true;
  }

  function oralErrorText(errName) {
    if (errName === 'no-speech') return t('oralNoSpeech');
    if (errName === 'not-allowed' || errName === 'service-not-allowed')
      return t('oralMicDenied');
    return t('oralMicError', { detail: errName || 'unknown' });
  }

  /* Plain words for one spoken transcript. Returns the display
     index of the option it names, or null when it names none.
     Understands: the option letter (A–F, or Arabic أ ب ج د هـ و),
     the option number (any number up to the option count), ordinals
     (first/second…/twelfth, الأول/الثاني…/الثاني عشر),
     the words True/False (صح/خطأ، نعم/لا) for True/False, and the
     option text itself (spoken exactly, or containing it). Matching
     is against the DISPLAY order (run.optOrders), so it agrees with
     what the student sees and hears. */
  function normalizeSpoken(s) {
    return String(s == null ? '' : s).trim().toLowerCase()
      .replace(/ـ/g, '')
      .replace(/[.,;:!?؟،«»"''()\[\]]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function parseSpokenChoice(q, transcript, displayOpts) {
    var opts = displayOpts || (q.options || []);
    if (!opts.length) return null;
    var raw = normalizeSpoken(transcript);
    if (!raw) return null;
    var qt = qType(q);
    var i, norm;
    /* True/False words first: they are also option texts, but the
       word forms (yes/no, نعم/لا, صواب/غلط) only make sense here. */
    if (qt === 'tf') {
      var tfWords = [
        { words: ['true', 'yes', 'correct', 'right', 'صح', 'صواب', 'نعم', 'ايوه', 'أيوه'], val: 'true' },
        { words: ['false', 'no', 'wrong', 'incorrect', 'خطأ', 'غلط', 'لا', 'لأ'], val: 'false' }
      ];
      for (i = 0; i < tfWords.length; i++) {
        if (tfWords[i].words.indexOf(raw) !== -1 ||
          tfWords[i].words.some(function (w) { return raw === w; })) {
          for (var j = 0; j < opts.length; j++) {
            if (normalizeSpoken(opts[j]) === tfWords[i].val) return j;
          }
        }
      }
    }
    /* A bare letter or number: "B", "option B", "letter C", "2",
       "option 7", "12", "the second one", "the twelfth one",
       "الأول", "السابع", "ب". Letters only run A–F (the UI shows a
       number, not a letter, past F), but numbers and ordinals work
       up to the option count, so a 7+-option imported question can
       still be answered by voice. */
    var letters = ['a', 'b', 'c', 'd', 'e', 'f'];
    var arLetters = ['أ', 'ب', 'ج', 'د', 'ه', 'و'];
    var ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth',
      'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
      'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس',
      'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر',
      'الاول', 'التاني', 'التالت', 'الرابع', 'الخامس', 'السادس',
      'السابع', 'التامن', 'التاسع', 'العاشر', 'الحداشر', 'الاتناشر'];
    var m = raw.match(/(?:option|letter|choice|الخيار|الحرف|رقم)\s*([a-z]|\d+)/);
    var tok = m ? m[1] : raw;
    if (/^\d+$/.test(tok)) {
      var ni = parseInt(tok, 10);
      if (ni >= 1 && ni <= opts.length) return ni - 1;
    } else if (tok.length === 1) {
      var li = letters.indexOf(tok);
      if (li !== -1 && li < opts.length) return li;
      var ai = arLetters.indexOf(tok);
      if (ai !== -1 && ai < opts.length) return ai;
    }
    var oi = ordinals.indexOf(raw);
    if (oi !== -1) {
      var idx = oi % 12;
      if (idx < opts.length) return idx;
    }
    /* Ordinals / number words inside a sentence: "the second one",
       "answer number two", "الخيار التاني". Each word list is
       grouped in sixes, so the index is the position in its group. */
    var numGroups = [
      ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'],
      ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر'],
      ['الاول', 'التاني', 'التالت', 'الرابع', 'الخامس', 'السادس', 'السابع', 'التامن', 'التاسع', 'العاشر', 'الحداشر', 'الاتناشر'],
      ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'],
      ['واحد', 'اتنين', 'تلاتة', 'اربعة', 'خمسة', 'ستة', 'سبعة', 'تمانية', 'تسعة', 'عشرة', 'حداشر', 'اتناشر'],
      ['واحد', 'اثنين', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر']
    ];
    for (var g = 0; g < numGroups.length; g++) {
      for (var k = 0; k < numGroups[g].length; k++) {
        var w = numGroups[g][k];
        if (raw === w || raw.indexOf(w + ' ') !== -1 ||
          raw.indexOf(' ' + w) !== -1 || raw.indexOf(w) === 0) {
          if (k < opts.length) return k;
        }
      }
    }
    /* The option text itself, spoken exactly or as part of a
       sentence ("chlorophyll", "the answer is chlorophyll"). The
       shortest options (True/False) are already handled above, so
       a 2-letter minimum avoids matching "a" inside any word. */
    for (i = 0; i < opts.length; i++) {
      norm = normalizeSpoken(opts[i]);
      if (norm.length >= 2 && (raw === norm || raw.indexOf(norm) !== -1)) return i;
    }
    return null;
  }

  /* Correct-answer text for the AI grading prompt, per type. */
  function oralCorrectAnswer(q) {
    var qt = qType(q);
    if (qt === 'mcq') {
      var o = q.options || [];
      return (typeof q.answer === 'number' && o[q.answer] !== undefined)
        ? o[q.answer] : '';
    }
    if (qt === 'tf') {
      var oo = q.options || [];
      var t0 = (typeof q.answer === 'number' && oo[q.answer] !== undefined)
        ? oo[q.answer] : '';
      var just = tfJustification(q);
      return t0 + (just ? ' — ' + just : '');
    }
    if (qt === 'fill') return (q.answers || []).join(' / ');
    if (qt === 'essay') return 'Rubric: ' + (q.rubric || '');
    if (qt === 'coding') {
      return 'The spoken answer should describe code that passes these tests: ' +
        (q.tests || []).map(function (tc) {
          return String(tc.input) + ' => ' + String(tc.expected);
        }).join('; ');
    }
    return '';
  }

  /* Grade one spoken answer. Resolves {score 0–100, feedback,
     method 'local'|'ai', picked?}. MCQ/TF with a locally matched
     option never calls the provider. Open answers (and MCQ/TF the
     transcript did not match) need the provider and reject with
     '__NOKEY__' when no key is set — the caller saves the answer
     ungraded instead of inventing a score. */
  function gradeOral(q, transcript) {
    var qt = qType(q);
    if (qt === 'mcq' || qt === 'tf') {
      var displayOpts = null;
      if (run) {
        var pos = run.current;
        displayOpts = (run.optOrders[pos] || []).map(function (o) { return o.text; });
      }
      var picked = parseSpokenChoice(q, transcript, displayOpts);
      if (picked !== null) {
        var correctOpt = run ? run.optOrders[run.current][picked].correct
          : (picked === q.answer);
        var letter = letterFor(picked);
        return Promise.resolve({
          score: correctOpt ? 100 : 0, maxScore: 100,
          correct: !!correctOpt, method: 'local', picked: picked,
          feedback: correctOpt ? t('quizCorrect')
            /* No active run (or no correct flag found): the correct
               letter comes from the question's own answer — never
               from the picked option, which is the wrong one. */
            : t('quizNotQuite', { letter: letterFor((run ? run.optOrders[run.current] : []).findIndex(function (o) { return o.correct; })) || letterFor(q.answer) })
        });
      }
    }
    if (!byok.apiKey) return Promise.reject(new Error('__NOKEY__'));
    if (isOffline()) return Promise.reject(new Error(t('offlineNeedNet')));
    if (qt === 'fill') {
      /* Fill-in: an exact accepted answer scores locally first —
         no API call needed for a word the student said right. */
      if (gradeFill(q, transcript)) {
        return Promise.resolve({
          score: 100, maxScore: 100, correct: true, method: 'local',
          feedback: t('quizCorrect')
        });
      }
    }
    var prompt = 'You are a strict but fair exam grader. Grade the student\'s SPOKEN answer below ' +
      '(transcribed from speech, so allow for small transcription slips) against the correct answer. ' +
      'Reply with JSON ONLY — no markdown fences, no extra text. ' +
      'The JSON must be an object with "score" (a whole number from 0 to 100) and ' +
      '"feedback" (1–2 short sentences in ' + (wiz.language || 'English') +
      ' explaining the score).\n\n' +
      'QUESTION: ' + q.question + '\n' +
      'CORRECT ANSWER: ' + oralCorrectAnswer(q) + '\n' +
      'STUDENT SPOKEN ANSWER: ' + transcript;
    return callProvider(prompt, 1, 'grade').then(function (raw) {
      var data;
      try { data = JSON.parse(extractJsonText(raw)); }
      catch (e) { throw new Error(t('errBadJson', { label: '' })); }
      var score = Number(data && data.score);
      var fb = data && typeof data.feedback === 'string' ? data.feedback.trim() : '';
      if (isNaN(score) || !fb) throw new Error(t('errBadJson', { label: '' }));
      score = Math.max(0, Math.min(100, Math.round(score)));
      return { score: score, maxScore: 100, correct: score >= 60, method: 'ai', feedback: fb };
    });
  }

  /* Start (or stop) listening for the current question. The
     transcript lands in #oral-transcript as it arrives — final
     results are appended, interim results show live — and the
     student can edit or re-record before submitting. */
  function toggleOralListening(pos) {
    if (oralListening) { stopOralRecognition(); return; }
    if (!srSupported()) return;
    var q = quiz.questions[run.qIndexes[pos]];
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    var rec;
    try { rec = new Ctor(); } catch (e) { return; }
    rec.lang = srLangFor(q);
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    oralFinalText = '';
    var baseEl = document.getElementById('oral-transcript');
    var base = baseEl ? baseEl.value.trim() : '';
    oralRecog = rec;
    oralListening = true;
    var btn = document.getElementById('oral-mic-btn');
    if (btn) {
      btn.classList.add('listening');
      btn.textContent = t('oralMicStop');
      btn.setAttribute('aria-pressed', 'true');
    }
    var st = document.getElementById('oral-status');
    if (st) st.hidden = false;
    var errBox = document.getElementById('oral-error');
    if (errBox) errBox.hidden = true;
    rec.onresult = function (e) {
      var interim = '';
      var i;
      try {
        for (i = e.resultIndex || 0; i < e.results.length; i++) {
          var res = e.results[i];
          var txt = res && res[0] ? res[0].transcript : '';
          if (!txt) continue;
          if (res.isFinal) oralFinalText += (oralFinalText ? ' ' : '') + txt.trim();
          else interim += txt;
        }
      } catch (err) { /* a malformed result never breaks the panel */ }
      var ta = document.getElementById('oral-transcript');
      if (ta) {
        var shown = (base ? base + ' ' : '') + oralFinalText +
          (interim ? (oralFinalText || base ? ' ' : '') + interim : '');
        ta.value = shown.trim();
        if (!run.oralDrafts) run.oralDrafts = {};
        run.oralDrafts[pos] = ta.value;
      }
    };
    rec.onerror = function (e) {
      var name = e && e.error ? e.error : 'unknown';
      stopOralRecognition();
      var box = document.getElementById('oral-error');
      if (box) {
        box.textContent = oralErrorText(name);
        box.hidden = false;
      }
    };
    rec.onend = function () {
      if (oralRecog === rec) {
        oralListening = false;
        oralRecog = null;
        var b = document.getElementById('oral-mic-btn');
        if (b) {
          b.classList.remove('listening');
          b.textContent = t('oralMicStart');
          b.setAttribute('aria-pressed', 'false');
        }
        var s = document.getElementById('oral-status');
        if (s) s.hidden = true;
      }
    };
    try { rec.start(); } catch (e) { stopOralRecognition(); }
  }

  /* The oral answer panel: mic button, live status, error note,
     editable transcript, re-record and submit. When the browser
     has no SpeechRecognition the panel says so plainly and the
     textarea is still there — typing is the fallback, never a
     fake transcription. */
  function oralPanel(pos, q) {
    var wrap = el('div', 'oral-wrap');
    if (!srSupported()) {
      wrap.appendChild(el('div', 'oral-note', t('oralNoSupport')));
    }
    var micRow = el('div', 'oral-mic-row');
    var mic = el('button', 'btn btn-primary mic-btn', t('oralMicStart'));
    mic.type = 'button';
    mic.id = 'oral-mic-btn';
    mic.setAttribute('aria-pressed', 'false');
    if (!srSupported()) mic.disabled = true;
    mic.addEventListener('click', function () { mic.blur(); toggleOralListening(pos); });
    micRow.appendChild(mic);
    var re = el('button', 'btn btn-secondary btn-small', t('oralRerecord'));
    re.type = 'button';
    re.id = 'oral-rerecord-btn';
    re.addEventListener('click', function () {
      re.blur();
      stopOralRecognition();
      if (!run.oralDrafts) run.oralDrafts = {};
      run.oralDrafts[pos] = '';
      var ta = document.getElementById('oral-transcript');
      if (ta) { ta.value = ''; ta.focus(); }
      if (srSupported()) toggleOralListening(pos);
    });
    micRow.appendChild(re);
    wrap.appendChild(micRow);
    var status = el('div', 'oral-status', t('oralListening'));
    status.id = 'oral-status';
    status.hidden = true;
    wrap.appendChild(status);
    var errBox = el('div', 'oral-error');
    errBox.id = 'oral-error';
    errBox.hidden = true;
    wrap.appendChild(errBox);
    wrap.appendChild(el('label', 'field-hint oral-label', t('oralTranscript')));
    var ta2 = document.createElement('textarea');
    ta2.id = 'oral-transcript';
    ta2.className = 'input textarea oral-transcript';
    ta2.rows = 3;
    ta2.placeholder = t('oralTranscriptPh');
    ta2.setAttribute('aria-label', t('oralTranscriptPh'));
    ta2.value = (run.oralDrafts && run.oralDrafts[pos]) || '';
    ta2.addEventListener('input', function () {
      if (!run.oralDrafts) run.oralDrafts = {};
      run.oralDrafts[pos] = ta2.value;
    });
    wrap.appendChild(ta2);
    var sub = el('button', 'btn btn-primary', t('oralSubmit'));
    sub.type = 'button';
    sub.id = 'oral-submit-btn';
    sub.addEventListener('click', function () { sub.blur(); submitOral(pos); });
    wrap.appendChild(sub);
    return wrap;
  }

  /* Submit a spoken answer. MCQ/TF the transcript did not match
     locally and no key is set cannot be graded at all, so the
     student is told to say an option or edit the text instead of
     being marked wrong on a guess. Open answers with no key are
     saved ungraded (like an essay with no key). While AI grading
     runs the question shows a "checking…" state. */
  function submitOral(pos) {
    if (!run || run.answers[pos] !== null) return;
    stopOralRecognition();
    var q = quiz.questions[run.qIndexes[pos]];
    var qt = qType(q);
    var ta = document.getElementById('oral-transcript');
    var text = ta ? ta.value.trim() : ((run.oralDrafts && run.oralDrafts[pos]) || '').trim();
    if (!text) {
      showToast(t('oralEmpty'));
      if (ta) ta.focus();
      return;
    }
    var savedOralLeft = run.perQLeft;
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var secs = qSecs();
    if (!run.oralDrafts) run.oralDrafts = {};
    run.oralDrafts[pos] = text;
    /* MCQ/TF, no local match, no key: nothing honest can be said
       about the answer — send the student back to the transcript
       instead of inventing a verdict. */
    if ((qt === 'mcq' || qt === 'tf') && !byok.apiKey) {
      var displayOpts = (run.optOrders[pos] || []).map(function (o) { return o.text; });
      if (parseSpokenChoice(q, text, displayOpts) === null) {
        showToast(t('oralNoMatch'));
        if (ta) ta.focus();
        /* Back to the transcript with the time that was left, not a
           fresh full timer — and the elapsed time keeps counting
           from when the question was first shown. */
        if (perQTimerId === null && settings.perQTimer) startPerQTimer(savedOralLeft);
        if (!run.qShownAt) run.qShownAt = Date.now();
        return;
      }
    }
    run.qShownAt = null;
    run.answers[pos] = {
      text: text, oral: true, correct: null, graded: false, grading: true,
      timedOut: false, secs: secs
    };
    renderQuestion();
    gradeOral(q, text).then(function (res) {
      var a = run && run.answers[pos];
      /* A late grade never overwrites an answer the clock already
         closed (strict auto-submit) or results already shown. */
      if (!run || run.resultsShown || !a || a.text !== text || !a.grading) return;
      a.grading = false;
      a.graded = true;
      a.score = res.score;
      a.maxScore = res.maxScore;
      a.feedback = res.feedback;
      a.method = res.method;
      a.correct = res.correct;
      if (typeof res.picked === 'number') a.picked = res.picked;
      applyReviewResult(q, a.correct);
      renderQuestion();
      var nx = document.getElementById('next-btn');
      if (nx) nx.focus();
    }).catch(function (e) {
      var a = run && run.answers[pos];
      if (!run || run.resultsShown || !a || a.text !== text || !a.grading) return;
      a.grading = false;
      a.graded = false;
      a.correct = false;
      /* Ungraded, not wrong: the review streak is left alone. */
      applyReviewResult(q, null);
      a.gradeError = (e && e.message === '__NOKEY__')
        ? t('oralNoKey')
        : t('oralGradeFail', { detail: plainError(e) });
      renderQuestion();
      var nx2 = document.getElementById('next-btn');
      if (nx2) nx2.focus();
    });
  }

  /* Debug/test handle for the oral exam. */
  window.__qfOral = {
    supported: srSupported,
    listening: function () { return oralListening; },
    parseChoice: parseSpokenChoice,
    correctAnswer: oralCorrectAnswer,
    gradeOral: gradeOral,
    stop: stopOralRecognition,
    state: function () {
      return {
        supported: srSupported(), listening: oralListening,
        oralMode: oralMode, runOral: !!(run && run.oral)
      };
    }
  };

  /* ---------- quiz engine: run ---------- */

  function startQuiz(qIndexes, opts) {
    stopTimers();
    stopSpeech();
    var indexes;
    if (qIndexes) {
      indexes = qIndexes.slice();
    } else {
      indexes = quiz.questions.map(function (_, i) { return i; })
        .filter(function (i) {
          return selectedTopic === 'All' || (quiz.questions[i].topic || 'General') === selectedTopic;
        });
    }
    if (!indexes.length) return false;
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
      /* Oral mode never applies to review sessions; retry runs from
         the results screen keep the mode the attempt started in. */
      oral: oralMode && !(opts && opts.isReview),
      oralDrafts: {},    // oral: spoken/typed transcript per position
      strictTotal: 0,
      strictLeft: 0,
      isRetry: !!qIndexes,
      isReview: !!(opts && opts.isReview),
      reviewMastered: 0,
      reviewTotal: (opts && opts.isReview) ? indexes.length : 0,
      reviewBank: (opts && opts.isReview) ? quiz : null,
      codeDrafts: {},    // coding: typed code per position (survives re-renders)
      codeResults: {},   // coding: last runCodeTests() result per position
      freeDrafts: {},    // essay/fill: typed text per position (survives re-renders)
      perQLeftByPos: {}  // per-question seconds left per position (survives back/forward)
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
    /* Any re-render stops the current reading — a submit, a language
       switch, or moving to another question never talks over the
       new screen. Auto-read below speaks again only for a new
       position. */
    stopSpeech();
    stopOralRecognition();
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
    var speakBtn = makeSpeakButton(q, ttsDisplayFor(pos));
    if (speakBtn) {
      speakBtn.id = 'speak-btn';
      meta.appendChild(speakBtn);
    }
    if (run.oral) meta.appendChild(el('span', 'topic-tag oral-badge', t('oralBadge')));
    card.appendChild(meta);
    card.appendChild(el('h2', 'q-text', q.question));
    if (q.code) {
      var pre = el('pre', 'q-code');
      pre.textContent = q.code;
      card.appendChild(pre);
    }
    if (qt === 'mcq' || qt === 'tf') {
      if (run.oral && !state) {
        /* Oral mode: the options stay visible (and are read aloud),
           but they are not clickable — the answer comes by voice.
           The transcript panel below takes the spoken answer. */
        var olist = el('div', 'opts');
        run.optOrders[pos].forEach(function (opt, idx) {
          var row = el('div', 'opt opt-static');
          row.appendChild(el('span', 'letter', letterFor(idx)));
          var otxt = el('span', 'opt-text');
          otxt.textContent = qt === 'tf' ? tfDisplayText(opt.text) : opt.text;
          row.appendChild(otxt);
          olist.appendChild(row);
        });
        card.appendChild(olist);
        card.appendChild(oralPanel(pos, q));
      } else {
        var list = el('div', 'opts');
        run.optOrders[pos].forEach(function (opt, idx) {
          var btn = el('button', 'opt');
          btn.type = 'button';
          btn.appendChild(el('span', 'letter', letterFor(idx)));
          var txt = el('span', 'opt-text');
          /* True/False labels are UI chrome, not content: show them
             in the UI language (صح/خطأ in Arabic). */
          txt.textContent = qt === 'tf' ? tfDisplayText(opt.text) : opt.text;
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
        /* An oral answer's transcript, shown under the options once
           answered (the picked option is already highlighted above). */
        if (state && state.oral && state.text) {
          var heard = el('div', 'oral-heard');
          heard.appendChild(el('b', null, t('oralYourAnswer')));
          heard.appendChild(document.createTextNode(state.text));
          card.appendChild(heard);
        }
      }
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
      } else if (run.oral) {
        /* Oral mode: the student describes the code by voice; the
           transcript is graded by the provider against the tests. */
        card.appendChild(oralPanel(pos, q));
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
      if (run.oral && !state)
        matchWrap.appendChild(el('div', 'oral-note', t('oralNotForType')));
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
      if (run.oral && !state)
        orderWrap.appendChild(el('div', 'oral-note', t('oralNotForType')));
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
        freeWrap.appendChild(el('div', 'grading-note',
          t(state.oral ? 'oralGrading' : 'essayGrading')));
      } else if (!state && run.oral) {
        /* Oral mode: the spoken answer replaces the textarea. */
        freeWrap.appendChild(oralPanel(pos, q));
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
        input.value = (run.freeDrafts && run.freeDrafts[pos]) || '';
        input.addEventListener('input', function () {
          if (!run.freeDrafts) run.freeDrafts = {};
          run.freeDrafts[pos] = input.value;
        });
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
        if (state.oral) {
          /* Spoken code: no test run — the provider graded the
             spoken description, or it is ungraded with no key. */
          if (state.graded) {
            ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
              t('oralScore', { score: state.score })));
            ex.appendChild(el('b', null, t('oralFeedback')));
            ex.appendChild(document.createTextNode(state.feedback || ''));
          } else {
            ex.appendChild(el('div', 'verdict', t('essayNotGraded')));
            ex.appendChild(document.createTextNode(state.gradeError || t('oralNoKey')));
          }
        } else if (state.timedOut && !state.results) {
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
            state.oral ? t('oralScore', { score: state.score })
              : t('essayScore', { score: state.score, max: state.maxScore })));
          ex.appendChild(el('b', null, state.oral ? t('oralFeedback') : t('essayFeedback')));
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
      } else if (qt === 'tf') {
        /* True/False: the verdict, then the justification — the
           point of the type — in its own highlighted box, right
           after answering. */
        if (state.timedOut) {
          ex.appendChild(el('div', 'verdict timeout', t('quizTimeout', {
            letter: letterFor(run.optOrders[pos].findIndex(function (o) { return o.correct; }))
          })));
        } else {
          ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
            state.correct ? t('quizCorrect')
              : t('quizNotQuite', {
                letter: letterFor(run.optOrders[pos].findIndex(function (o) { return o.correct; }))
              })));
        }
        var just = tfJustification(q);
        if (just) {
          var jb = el('div', 'tf-just');
          jb.appendChild(el('b', null, t('tfJustification')));
          jb.appendChild(document.createTextNode(just));
          ex.appendChild(jb);
        }
      } else if (state.timedOut) {
        ex.appendChild(el('div', 'verdict timeout', t('quizTimeout', {
          letter: letterFor(run.optOrders[pos].findIndex(function (o) { return o.correct; }))
        })));
      } else {
        ex.appendChild(el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
          state.correct ? t('quizCorrect')
            : t('quizNotQuite', {
              letter: letterFor(run.optOrders[pos].findIndex(function (o) { return o.correct; }))
            })));
      }
      /* The generic explanation — skipped for True/False when the
         justification above already showed it (or its fallback),
         so the same reason is never printed twice. An oral
         MCQ/TF answer also shows its numeric score and the
         provider's feedback here (the verdict above is only
         right/wrong). */
      if ((qt === 'mcq' || qt === 'tf') && state.oral && state.graded) {
        var os = el('div', 'rex');
        os.appendChild(el('b', null, t('oralScore', { score: state.score }) + ' · '));
        os.appendChild(document.createTextNode(state.feedback || ''));
        ex.appendChild(os);
      }
      if (q.explanation && !(qt === 'tf' && tfJustification(q))) {
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
    if (!ttsSupported()) {
      app.appendChild(el('div', 'hint', t('ttsNoSupport')));
    }

    var navRow = el('div', 'btnrow quiz-nav-row');
    if (pos > 0 && !run.strict) {
      var prev = el('button', 'btn btn-secondary', t('quizPrev'));
      prev.id = 'prev-btn';
      prev.type = 'button';
      prev.disabled = !!(state && state.grading);
      prev.addEventListener('click', function () { prev.blur(); prevQuestion(); });
      navRow.appendChild(prev);
    }
    if (state && !state.grading) {
      var last = pos === run.qIndexes.length - 1;
      var next = el('button', 'btn btn-primary btn-big', last ? t('quizResultsBtn') : t('quizNext'));
      next.id = 'next-btn';
      next.addEventListener('click', function () { next.blur(); nextQuestion(); });
      navRow.appendChild(next);
    }
    var exit = el('button', 'btn btn-secondary', t('quizExit'));
    exit.id = 'exit-quiz-btn';
    exit.type = 'button';
    exit.addEventListener('click', function () { exit.blur(); exitQuiz(); });
    navRow.appendChild(exit);
    app.appendChild(navRow);
    if (!state) {
      if (run.strict) app.appendChild(el('div', 'hint', t('strictForwardHint')));
      if (run.oral) {
        app.appendChild(el('div', 'hint', t('oralSpeakHint')));
      } else if (qt === 'mcq' || qt === 'tf') {
        app.appendChild(el('div', 'hint', t('quizKeysHint', { n: Math.min(run.optOrders[pos].length, 6) })));
      } else {
        app.appendChild(el('div', 'hint', t(
          qt === 'essay' ? 'essayHint' : qt === 'fill' ? 'fillHint' :
          qt === 'matching' ? 'matchHint' : qt === 'ordering' ? 'orderHint' : 'codeHint')));
      }
    }

    if (!state && settings.perQTimer)
      startPerQTimer(run.perQLeftByPos ? run.perQLeftByPos[pos] : undefined);

    /* Auto-read: read the question aloud when it first appears —
       once per position, so a re-render (submit, language switch,
       moving an ordering item) does not read it again. In oral
       mode the question is always read aloud — that is the point
       of the mode — even when the auto-read setting is off. */
    if ((settings.autoRead || run.oral) && run.ttsAutoPos !== pos) {
      run.ttsAutoPos = pos;
      var autoBtn = document.getElementById('speak-btn');
      speakQuestion(q, ttsDisplayFor(pos), autoBtn || null);
    }
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
    var text = input ? input.value.trim()
      : ((run.freeDrafts && run.freeDrafts[pos]) || '').trim();
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
      applyReviewResult(q, correct);
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
      /* A late grade never overwrites an answer the clock already
         closed (strict auto-submit) or results already shown. */
      if (!run || run.resultsShown || !a || a.text !== text || !a.grading) return;
      a.grading = false;
      a.graded = true;
      a.score = res.score;
      a.maxScore = res.maxScore;
      a.feedback = res.feedback;
      a.correct = essayPass(res.score, res.maxScore);
      applyReviewResult(q, a.correct);
      renderQuestion();
      var nx = document.getElementById('next-btn');
      if (nx) nx.focus();
    }).catch(function (e) {
      var a = run && run.answers[pos];
      if (!run || run.resultsShown || !a || a.text !== text || !a.grading) return;
      a.grading = false;
      a.graded = false;
      a.correct = false;
      /* Ungraded, not wrong: the review streak is left alone. */
      applyReviewResult(q, null);
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
    applyReviewResult(q, g.correct);
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
    applyReviewResult(q, g.correct);
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
      /* A late test run never overwrites an answer the clock already
         closed (strict auto-submit) or results already shown. */
      if (!run || run.resultsShown) return;
      if (run.answers[pos] !== null && run.answers[pos].timedOut) return;
      var correct = result.total > 0 && result.passed === result.total && !result.timedOut;
      run.answers[pos] = {
        text: code, correct: correct, timedOut: !!result.timedOut,
        secs: secs, results: result,
        codeScore: result.passed, codeTotal: result.total
      };
      applyReviewResult(q, correct);
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
    applyReviewResult(quiz.questions[run.qIndexes[pos]], correct);
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
      else if (qt === 'coding') txt = ((run.codeDrafts && run.codeDrafts[run.current]) || '').trim();
      else txt = ((run.freeDrafts && run.freeDrafts[run.current]) || '').trim();
    }
    if (run.oral) {
      /* Oral mode: keep whatever was spoken or typed so far. A
         matched MCQ/TF option still scores; anything else is kept
         ungraded with the time-out noted — never graded after the
         clock, and never invented. */
      var ota = document.getElementById('oral-transcript');
      var otxt = ota ? ota.value.trim()
        : ((run.oralDrafts && run.oralDrafts[run.current]) || '').trim();
      if (otxt) {
        var oans;
        if (qt === 'mcq' || qt === 'tf') {
          var opicked = parseSpokenChoice(q, otxt,
            (run.optOrders[run.current] || []).map(function (o) { return o.text; }));
          oans = { text: otxt, oral: true, picked: opicked, correct: false,
            graded: false, grading: false, timedOut: true, secs: qSecs() };
          if (opicked !== null) {
            oans.correct = run.optOrders[run.current][opicked].correct;
            oans.graded = true;
            oans.score = oans.correct ? 100 : 0;
            oans.maxScore = 100;
            oans.method = 'local';
          } else {
            oans.gradeError = t('oralNoMatch');
          }
        } else if (qt === 'matching' || qt === 'ordering') {
          oans = null; /* written UI — fall through to the normal path */
        } else {
          oans = { text: otxt, oral: true, correct: false, graded: false,
            grading: false, timedOut: true, secs: qSecs(),
            gradeError: t('resTimeout') };
        }
        if (oans) {
          stopOralRecognition();
          run.answers[run.current] = oans;
          applyReviewResult(q, oans.correct);
          run.qShownAt = null;
          renderQuestion();
          var onx = document.getElementById('next-btn');
          if (onx) onx.focus();
          return;
        }
      }
    }
    if (qt === 'fill' && txt) {
      var fc = gradeFill(q, txt);
      run.answers[run.current] = { text: txt, correct: fc, timedOut: true, secs: qSecs() };
      applyReviewResult(q, fc);
    } else if (qt === 'matching') {
      /* Time ran out: keep whatever pairs were picked, unpicked
         items count as wrong. */
      var picks = readMatchingDraft(run.current);
      var gm = gradeMatching(q, picks);
      run.answers[run.current] = {
        picks: picks, correct: gm.correct, got: gm.got, total: gm.total,
        timedOut: true, secs: qSecs()
      };
      applyReviewResult(q, gm.correct);
    } else if (qt === 'ordering') {
      /* Time ran out: keep the order as it stands. */
      var ord = ((run.orderDrafts[run.current] || []).slice());
      var go = gradeOrdering(q, ord);
      run.answers[run.current] = {
        order: ord, correct: go.correct, got: go.got, total: go.total,
        timedOut: true, secs: qSecs()
      };
      applyReviewResult(q, go.correct);
    } else if (qt === 'coding') {
      /* Time ran out: keep the typed code, mark it wrong for this
         attempt, do not run the tests (time is up). */
      run.answers[run.current] = {
        text: txt, correct: false, timedOut: true, secs: qSecs(),
        codeScore: 0, codeTotal: (q.tests || []).length
      };
      applyReviewResult(q, false);
    } else if (qt === 'essay' && txt) {
      /* Time ran out with text typed: keep the text, mark it wrong
         for this attempt, do not grade it (time is up). */
      run.answers[run.current] = {
        text: txt, correct: false, graded: false, grading: false,
        timedOut: true, secs: qSecs()
      };
      applyReviewResult(q, false);
    } else {
      run.answers[run.current] = { picked: null, correct: false, timedOut: true, secs: qSecs() };
      applyReviewResult(q, false);
    }
    run.qShownAt = null;
    renderQuestion();
    var next = document.getElementById('next-btn');
    if (next) next.focus();
  }

  function nextQuestion() {
    /* The Next button hides while an answer is grading, but the
       keyboard could still advance: never leave a grading answer
       behind — its callback would re-render the wrong question. */
    if (run.answers[run.current] && run.answers[run.current].grading) return;
    stopSpeech();
    stopOralRecognition();
    savePerQLeft();
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    if (run.current < run.qIndexes.length - 1) {
      run.current++;
      renderQuestion();
    } else {
      showResults();
    }
  }

  /* Remember how much per-question time is left on the current
     question, so coming back to it resumes instead of resetting. */
  function savePerQLeft() {
    if (run && settings.perQTimer && run.answers[run.current] === null) {
      if (!run.perQLeftByPos) run.perQLeftByPos = {};
      run.perQLeftByPos[run.current] = run.perQLeft;
    }
  }

  /* Go back one question (never in strict mode, never while the
     current answer is still grading). Answered questions show their
     explanation again; an unanswered one resumes with the time it
     had left. */
  function prevQuestion() {
    if (!run || run.strict || run.current <= 0) return;
    if (run.answers[run.current] && run.answers[run.current].grading) return;
    stopSpeech();
    stopOralRecognition();
    savePerQLeft();
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    run.current--;
    renderQuestion();
  }

  /* Leave the quiz mid-attempt, with a confirm: the attempt and its
     answers are discarded and the exam start screen returns. */
  function exitQuiz() {
    if (!run) return;
    if (!window.confirm(t('quizExitConfirm'))) return;
    stopTimers();
    stopSpeech();
    stopOralRecognition();
    showStart();
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
    stopSpeech();
    stopOralRecognition();
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
      run.attemptId = 'a' + Date.now().toString(36);
      recordAttempt({
      id: run.attemptId,
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
      var resSpeak = makeSpeakButton(q, ttsDisplayFor(pos));
      if (resSpeak) {
        resSpeak.id = 'speak-btn-' + pos;
        item.appendChild(resSpeak);
      }
      if (q.code) {
        var pre = el('pre', 'q-code');
        pre.textContent = q.code;
        item.appendChild(pre);
      }
      var yours = (a && a.picked !== null && a.picked !== undefined) ? opts[a.picked].text : null;
      /* True/False labels are UI chrome: show them in the UI
         language (صح/خطأ in Arabic), like the quiz itself does. */
      if (qt === 'tf' && yours !== null) yours = tfDisplayText(yours);
      var correctText = (correctIdx >= 0 && opts[correctIdx]) ? opts[correctIdx].text : '';
      if (qt === 'tf') correctText = tfDisplayText(correctText);
      /* Letter + text of the correct option; with no correct option
         found (a corrupt bank) the label is just the text, never
         "undefined) ...". letterFor handles 7+ options (it falls
         back to the 1-based number). */
      var correctLabel = correctIdx >= 0 ? letterFor(correctIdx) + ') ' + correctText : correctText;
      var line = el('div', 'ra');
      if (a && a.oral) {
        /* Spoken answer: the transcript is the answer, plus the
           oral score/feedback (or the plain no-grade note). For
           MCQ/TF the correct option is shown when it was missed. */
        line.appendChild(document.createTextNode(t('oralYourAnswer')));
        line.appendChild(el('span', 'yours' + ((a && a.correct) ? ' ok' : ''),
          (a && a.text) ? a.text : t('resNoAnswer')));
        item.appendChild(line);
        if (a.graded) {
          var ofb = el('div', 'rex');
          ofb.appendChild(el('b', null, t('oralScore', { score: a.score }) + ' · '));
          ofb.appendChild(document.createTextNode(a.feedback || ''));
          item.appendChild(ofb);
        } else if (!a.timedOut) {
          var ong = el('div', 'rex');
          ong.appendChild(document.createTextNode(a.gradeError || t('oralNoKey')));
          item.appendChild(ong);
        }
        if ((qt === 'mcq' || qt === 'tf') && !(a && a.correct)) {
          var oc = el('div', 'ra');
          oc.appendChild(document.createTextNode(t('resCorrectIs')));
          oc.appendChild(el('span', 'right', correctLabel));
          item.appendChild(oc);
        }
      } else if (qt === 'essay') {
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
        line.appendChild(el('span', 'right', correctLabel));
        item.appendChild(line);
      } else {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours', '✗ ' + (yours !== null ? yours : t('resNoAnswer'))));
        line.appendChild(document.createTextNode(t('resCorrectIs')));
        line.appendChild(el('span', 'right', correctLabel));
        item.appendChild(line);
      }
      /* True/False justification, prominently — the point of the
         type. Shown for right and wrong answers alike; the generic
         explanation is skipped when the justification is shown, so
         the same reason is never printed twice. */
      if (qt === 'tf' && tfJustification(q)) {
        var tj = el('div', 'rex tf-just');
        tj.appendChild(el('b', null, t('tfJustification')));
        tj.appendChild(document.createTextNode(tfJustification(q)));
        item.appendChild(tj);
      } else if (q.explanation) {
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
    /* Cheat sheet from mistakes (2026-11-22): one button when there
       is anything to put on the sheet; with a perfect score there is
       nothing to show, so no section at all. */
    if (wrongIndexes.length > 0) {
      var cheatSec = el('section', 'card cheat-sec');
      cheatSec.appendChild(el('h2', 'cheat-sec-title', t('cheatTitle')));
      cheatSec.appendChild(el('p', 'muted', t('cheatHint')));
      var cheatBtn = el('button', 'btn btn-primary', t('cheatBtn', { n: wrongIndexes.length }));
      cheatBtn.id = 'cheat-sheet-btn';
      cheatBtn.type = 'button';
      cheatBtn.addEventListener('click', function () { generateCheatSheet(); });
      cheatSec.appendChild(cheatBtn);
      var cheatStatus = el('p', 'gen-progress cheat-status');
      cheatStatus.id = 'cheat-status';
      cheatSec.appendChild(cheatStatus);
      card.appendChild(cheatSec);
    }
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
    stopSpeech();
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
    /* In oral mode the number keys must not pick a written answer —
       the answer comes by voice. */
    if (!state && !run.oral && /^[1-6]$/.test(e.key)) {
      var idx = parseInt(e.key, 10) - 1;
      if (idx < run.optOrders[run.current].length) {
        e.preventDefault();
        onPick(run.current, idx);
      }
    } else if (state && e.key === 'Enter') {
      e.preventDefault();
      nextQuestion();
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      /* ← → move between questions (RTL-aware, like flashcards).
         Forward needs an answered question; back never runs in
         strict mode — prevQuestion enforces both, plus the grading
         guard. */
      var rtl = document.documentElement.dir === 'rtl';
      var forward = (e.key === 'ArrowRight') !== rtl;
      e.preventDefault();
      if (forward) { if (state && !state.grading) nextQuestion(); }
      else prevQuestion();
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
