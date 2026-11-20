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

  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var CHUNK_CHARS = 12000;

  var settings = loadSettings();   // { shuffle, perQTimer, perQSeconds }
  var selectedTopic = 'All';
  var topics = [];
  var run = null;                  // current attempt, see startQuiz()
  var totalTimerId = null;
  var perQTimerId = null;
  var currentView = 'create';      // 'create' | 'library' | 'quiz'

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
      if (!Array.isArray(q.options) || q.options.length < 2)
        throw new Error(t('valOptions', { n: n }));
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.options.length)
        throw new Error(t('valAnswerRange', { n: n }));
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
    var d = { step: 1, title: '', count: 10, types: { mcq: true, tf: false },
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
    stopTimers();
    run = null;
    document.getElementById('nav-create').classList.toggle('active', v === 'create');
    document.getElementById('nav-library').classList.toggle('active', v === 'library');
    if (v === 'create') renderWizard();
    else if (v === 'library') renderLibrary();
    window.scrollTo({ top: 0 });
  }

  /* Phase 2 i18n: re-render the current view after a language switch
     (called by setLang in i18n.js). During a quiz run the attempt state
     is preserved: renderQuestion() rebuilds the screen from `run`, and
     the per-question countdown is restored so the switch does not reset
     the timer. */
  window.__qfRerender = function () {
    if (currentView === 'create') renderWizard();
    else if (currentView === 'library') renderLibrary();
    else if (currentView === 'quiz') {
      if (run) {
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
      } else showStart();
    }
  };

  function wireNav() {
    document.getElementById('nav-create').addEventListener('click', function () { setView('create'); });
    document.getElementById('nav-library').addEventListener('click', function () { setView('library'); });
  }

  /* ---------- wizard ---------- */

  function materialChars() {
    return material.text.length + material.pasted.length;
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
    picker.accept = '.pdf,.txt,.md,.json,application/pdf,text/plain,text/markdown,application/json';
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
      refreshFileList();
    });
    card.appendChild(ta);

    var summary = el('p', 'material-summary');
    summary.id = 'material-summary';
    card.appendChild(summary);

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
  }

  function removeMaterialFile(idx) {
    var f = material.files[idx];
    if (!f) return;
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
      if (!wiz.types.mcq && !wiz.types.tf) { wiz.types.tf = true; tf.checked = true; }
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
      if (!wiz.types.tf && !wiz.types.mcq) { wiz.types.mcq = true; mcq.checked = true; }
      saveWizard();
    });
    tfLbl.appendChild(tf);
    tfLbl.appendChild(el('span', null, t('s3Tf')));
    typesRow.appendChild(tfLbl);
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

    var genBtn = el('button', 'btn btn-primary btn-big', t('s4Generate'));
    genBtn.id = 'gen-btn';
    genBtn.addEventListener('click', function () { generateExam(); });
    var btnRow = el('div', 'btnrow');
    btnRow.appendChild(genBtn);
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
    var typeText = types.join(' and ');
    var diffText = wiz.difficulty === 'Mixed'
      ? 'a mix of Easy, Medium and Hard questions'
      : wiz.difficulty + ' questions';
    return 'You are an exam writer. Write ' + nQuestions + ' ' + typeText +
      ' in ' + wiz.language + ' based ONLY on the material below' +
      (chunkLabel ? ' (' + chunkLabel + ')' : '') + '. ' +
      'Difficulty: ' + diffText + '.' +
      (wiz.focus ? ' Focus notes from the teacher: ' + wiz.focus + '.' : '') +
      ' Every question must be answerable from the material, have exactly one correct answer, ' +
      'and include a short explanation of why the answer is correct.' +
      '\n\nReply with JSON ONLY — no markdown fences, no extra text. The JSON must be an object with a "questions" array. ' +
      'Each question must have: "question" (string), "options" (array of ' +
      (wiz.types.mcq && wiz.types.tf ? '4 strings for multiple-choice or 2 strings ("True","False") for True/False' :
        wiz.types.tf ? '2 strings: "True" and "False"' : '4 strings') +
      '), "answer" (0-based index of the correct option), "explanation" (string), ' +
      '"topic" (short string, e.g. a chapter or sub-topic), "difficulty" ("Easy", "Medium" or "Hard"). ' +
      'Optionally "code" (a short code snippet string) only if the question is about code.' +
      '\n\nMATERIAL:\n' + chunkText;
  }

  function generateExam() {
    if (genState.busy) return;
    clearGenError();
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
    head.appendChild(row);
    var impErr = el('div', 'bank-error');
    impErr.id = 'import-error';
    head.appendChild(impErr);
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
        (entry.provider && entry.provider !== 'import' ? ' · ' + entry.provider + (entry.model ? ' (' + entry.model + ')' : '') : ' · ' + t('libImported'))));
      var r = el('div', 'btnrow');
      var take = el('button', 'btn btn-primary', t('libTake'));
      take.addEventListener('click', function () { loadBank(entry.bank); });
      r.appendChild(take);
      var exp = el('button', 'btn btn-secondary', t('libExport'));
      exp.addEventListener('click', function () { exportBank(entry); });
      r.appendChild(exp);
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

  function loadBank(bank) {
    quiz = bank;
    selectedTopic = 'All';
    setView('quiz');
    showStart();
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
    stopTimers();
    run = null;
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
    var row = el('div', 'btnrow');
    var start = el('button', 'btn btn-primary btn-big', t('quizStart'));
    start.id = 'start-quiz-btn';
    start.addEventListener('click', function () { startQuiz(); });
    row.appendChild(start);
    startCard.appendChild(row);

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

  function startQuiz(qIndexes) {
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
    if (settings.shuffle) indexes = shuffle(indexes);

    var optOrders = indexes.map(function (qi) {
      var q = quiz.questions[qi];
      var opts = q.options.map(function (text, idx) {
        return { text: text, correct: idx === q.answer };
      });
      return settings.shuffle ? shuffle(opts) : opts;
    });

    run = {
      qIndexes: indexes,
      optOrders: optOrders,
      answers: indexes.map(function () { return null; }),
      current: 0,
      startedAt: Date.now(),
      perQLeft: settings.perQSeconds,
      isRetry: !!qIndexes
    };
    renderQuestion();
    startTotalTimer();
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

  function renderQuestion() {
    var pos = run.current;
    var qi = run.qIndexes[pos];
    var q = quiz.questions[qi];
    var state = run.answers[pos];
    app.innerHTML = '';

    var top = el('div', 'card quiz-top');
    var row1 = el('div', 'top-row');
    row1.appendChild(el('span', 'counter', t('quizCounter', { pos: pos + 1, total: run.qIndexes.length })));
    var timers = el('span', 'timers');
    var totalChip = el('span', 'tchip');
    totalChip.innerHTML = icon('clock', 15);
    var tt = el('span');
    tt.id = 'timer-total';
    tt.textContent = '00:00';
    totalChip.appendChild(tt);
    timers.appendChild(totalChip);
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
    card.appendChild(meta);
    card.appendChild(el('h2', 'q-text', q.question));
    if (q.code) {
      var pre = el('pre', 'q-code');
      pre.textContent = q.code;
      card.appendChild(pre);
    }
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

    if (q.explanation && state) {
      var ex = el('div', 'explain show');
      var verdict;
      if (state.timedOut) {
        verdict = el('div', 'verdict timeout', t('quizTimeout', {
          letter: LETTERS[run.optOrders[pos].findIndex(function (o) { return o.correct; })]
        }));
      } else {
        verdict = el('div', 'verdict ' + (state.correct ? 'ok' : 'no'),
          state.correct ? t('quizCorrect')
            : t('quizNotQuite', {
              letter: LETTERS[run.optOrders[pos].findIndex(function (o) { return o.correct; })]
            }));
      }
      ex.appendChild(verdict);
      ex.appendChild(el('b', null, t('quizWhy')));
      ex.appendChild(document.createTextNode(q.explanation));
      card.appendChild(ex);
    }
    app.appendChild(card);

    if (state) {
      var row = el('div', 'btnrow');
      var last = pos === run.qIndexes.length - 1;
      var next = el('button', 'btn btn-primary btn-big', last ? t('quizResultsBtn') : t('quizNext'));
      next.id = 'next-btn';
      next.addEventListener('click', function () { next.blur(); nextQuestion(); });
      row.appendChild(next);
      app.appendChild(row);
    } else {
      app.appendChild(el('div', 'hint', t('quizKeysHint', { n: Math.min(run.optOrders[pos].length, 6) })));
    }

    if (!state && settings.perQTimer) startPerQTimer();
  }

  function onPick(pos, displayIdx) {
    if (run.answers[pos] !== null) return;
    if (perQTimerId !== null) { clearInterval(perQTimerId); perQTimerId = null; }
    var correct = run.optOrders[pos][displayIdx].correct;
    run.answers[pos] = { picked: displayIdx, correct: correct, timedOut: false };
    renderQuestion();
    var next = document.getElementById('next-btn');
    if (next) next.focus();
  }

  function onTimeout() {
    if (!run || run.answers[run.current] !== null) return;
    run.answers[run.current] = { picked: null, correct: false, timedOut: true };
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
    var total = run.qIndexes.length;
    var score = run.answers.filter(function (a) { return a && a.correct; }).length;
    var pct = total ? Math.round(score / total * 100) : 0;
    if (!run.isRetry) saveBest(score, total, pct);

    app.innerHTML = '';
    var card = el('section', 'card results-card');
    card.appendChild(el('p', 'kicker', t('resKicker')));
    card.appendChild(el('h2', null, t('resTitle')));

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
      var item = el('div', 'review-item');
      var status = el('span', 'status-chip ' + ((a && a.correct) ? 'ok' : 'no'),
        a && a.correct ? t('resCorrect') : (a && a.timedOut ? t('resTimeout') : t('resWrong')));
      item.appendChild(status);
      item.appendChild(el('div', 'rq', (pos + 1) + '. ' + q.question));
      if (q.code) {
        var pre = el('pre', 'q-code');
        pre.textContent = q.code;
        item.appendChild(pre);
      }
      var yours = a && a.picked !== null ? opts[a.picked].text : null;
      var line = el('div', 'ra');
      if (a && a.correct) {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours ok', '✓ ' + yours));
      } else if (a && a.timedOut) {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours', t('resNoAnswerTimeout')));
        line.appendChild(document.createTextNode(t('resCorrectIs')));
        line.appendChild(el('span', 'right', LETTERS[correctIdx] + ') ' + opts[correctIdx].text));
      } else {
        line.appendChild(document.createTextNode(t('resYourAnswer')));
        line.appendChild(el('span', 'yours', '✗ ' + (yours !== null ? yours : t('resNoAnswer'))));
        line.appendChild(document.createTextNode(t('resCorrectIs')));
        line.appendChild(el('span', 'right', LETTERS[correctIdx] + ') ' + opts[correctIdx].text));
      }
      item.appendChild(line);
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
    }
    var again = el('button', 'btn btn-secondary', t('resAgain'));
    again.addEventListener('click', function () { startQuiz(); });
    row.appendChild(again);
    var home = el('button', 'btn btn-secondary', t('resBackTopics'));
    home.addEventListener('click', function () { showStart(); });
    row.appendChild(home);
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
      setView('create');
    })
    .catch(showLoadError);
})();
