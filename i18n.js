/* QuizForge i18n — user-visible strings, English + Arabic.
   Loaded BEFORE app.js. Phase 1 converts the header/nav, settings
   panel and wizard steps 1-2; the dictionary already covers steps 3-4,
   the library, the quiz and the results, so Phase 2 only swaps call
   sites. Keys use {name} tokens, replaced by t(key, {name: value}). */
(function () {
  'use strict';

  var LS_LANG = 'qf-lang';

  var STRINGS = {
    en: {
      /* --- header / nav / chrome --- */
      brandTag: 'Turn any material into exams',
      settings: 'Settings',
      settingsTitle: 'Settings',
      dark: 'Dark',
      light: 'Light',
      darkTitle: 'Toggle dark mode',
      langTitle: 'Switch to Arabic',
      navCreate: '✦ Create exam',
      navLibrary: '▤ My exams',
      foot: 'QuizForge — upload any material, bring your own AI key, get an exam. Your key never leaves your browser except to the provider you choose.',
      setTitle: 'Settings',
      setShuffle: 'Shuffle questions and answer options',
      setPerQ: 'Per-question countdown',
      setSeconds: 'Seconds per question:',
      setNote: 'Settings are saved on this device and apply to the next question you start.',
      on: 'On',
      off: 'Off',
      /* --- wizard --- */
      step1: 'Upload material',
      step2: 'Your AI key',
      step3: 'Exam settings',
      step4: 'Generate',
      kicker1: 'Step 1 of 4 · Upload material',
      kicker2: 'Step 2 of 4 · Your AI key',
      kicker3: 'Step 3 of 4 · Exam settings',
      kicker4: 'Step 4 of 4 · Generate',
      back: '← Back',
      continue: 'Continue →',
      toKey: 'Continue to your AI key →',
      toSettings: 'Continue to exam settings →',
      toGenerate: 'Continue to generate →',
      /* --- step 1: upload material --- */
      s1Title: 'What should the exam cover?',
      s1Hero: 'Upload your PDFs, past exams, summaries — any subject, any material. Or paste the text below. Everything stays in your browser until you generate.',
      s1DzBig: '📄 Drop files here, or <span class="dz-link">browse</span>',
      s1DzSmall: 'PDF, text (.txt / .md), or a question bank (.json) — multiple files are merged into one material.',
      s1DzAria: 'Upload material files',
      s1PasteLabel: 'Or paste text directly',
      s1PastePh: 'Paste your summary, lecture notes, or chapter text here…',
      s1FilesLabel: 'Files: {n}',
      s1PagesLabel: 'PDF pages: {n}',
      s1CharsLabel: 'characters: {n}',
      s1CharsTotal: 'Total characters: {n}',
      s1Ready: 'Material ready: {parts}.',
      s1NoMaterial: 'No material yet — add a file or paste some text to continue.',
      s1PdfFail: 'PDF reading needs an internet connection the first time (pdf.js loads from a CDN). It could not be loaded — paste the text instead, or check your connection and try again. Everything else still works offline.',
      s1BankSaved: 'question bank — saved to My exams',
      s1RemoveFile: 'Remove this file',
      s1RemoveAria: 'Remove {name}',
      /* --- step 2: your AI key --- */
      s2Title: 'Bring your own AI key',
      s2Hero: 'QuizForge has no server and no account — you use your own API key and spend your own credits. Pick a provider, paste your key, and test it.',
      s2Privacy: '🔒 Your key never leaves your browser except to the provider you choose. It is stored only on this device (localStorage). It is never logged or shown in full.',
      s2KeyPh: 'Paste your {label} key here',
      s2KeySaved: 'Saved on this device as {masked} — only the last 4 characters are ever shown.',
      s2GetKey: 'Get one: {url}',
      s2GetKeyDash: 'Get a key from your provider’s dashboard.',
      s2ModelLabel: 'Model (editable)',
      s2ModelHint: 'Default: {model}. Model IDs change often — if your provider retires one, type the new ID here.',
      s2BaseLabel: 'Base URL',
      s2BaseHint: 'OpenAI-compatible endpoint, without a trailing slash. Default: {url}.',
      s2ProxyLabel: 'CORS proxy URL (required for Claude)',
      s2ProxyHint: 'Claude’s API blocks direct calls from a browser page, so a CORS proxy is needed to reach it. The proxy must forward the request to https://api.anthropic.com and pass the x-api-key header through. Without a proxy, generation with Claude cannot run from this page.',
      s2Test: 'Test connection',
      s2Forget: 'Forget my key',
      s2Warn: 'Add your API key above to continue — or go back and use the demo bank in My exams, which needs no key.',
      s2TestNeedKey: 'Paste your API key first.',
      s2Testing: 'Testing…',
      s2Connected: '✓ Connected — {label} ({model}) answered.',
      'keyLabel.gemini': 'Gemini API key',
      'keyLabel.openai': 'OpenAI API key',
      'keyLabel.claude': 'Anthropic API key',
      'keyLabel.custom': 'API key',
      /* --- step 3: exam settings (Phase 2 call sites) --- */
      s3Title: 'How should the exam look?',
      s3TitleLabel: 'Exam title / subject',
      s3TitlePh: 'e.g. Biology — Photosynthesis',
      s3CountLabel: 'Number of questions (5–50)',
      s3TypesLabel: 'Question types',
      s3Mcq: 'Multiple choice (4 options)',
      s3Tf: 'True / False (2 options)',
      s3Diff: 'Difficulty',
      diffEasy: 'Easy',
      diffMedium: 'Medium',
      diffHard: 'Hard',
      diffMixed: 'Mixed',
      s3Lang: 'Language',
      langOptEnglish: 'English',
      langOptArabic: 'Arabic',
      s3FocusLabel: 'Focus notes (optional)',
      s3FocusPh: 'e.g. Focus on chapter 3, skip proofs, include the light-dependent reactions…',
      s3FocusHint: 'Anything the exam should emphasise or skip.',
      s3PerQ: 'Per-question countdown during the exam (uses the seconds from Settings)',
      /* --- step 4: generate (Phase 2 call sites) --- */
      s4Title: 'Ready to generate your exam?',
      s4Material: 'Material:',
      s4Provider: 'Provider:',
      s4Exam: 'Exam:',
      s4Untitled: '(untitled)',
      s4QuestionsLabel: 'questions',
      s4Generate: '⚡ Generate my exam',
      s4Retry: '↻ Retry generation',
      s4Generating: 'Generating part {i} of {n}…',
      s4TakeNow: 'Take the exam now →',
      errKey: 'Your API key was rejected by the provider. Check the key (Step 2) and try again — make sure you copied the whole key with no extra spaces.',
      errQuota: 'The provider refused the request: out of credits or quota. Check your billing / usage on the provider’s site, then try again.',
      errRate: 'The provider rate-limited the request (too many requests). Wait a minute and try again.',
      errModel: 'The model "{model}" was not found by the provider. It may have been retired — try a newer model ID in Step 2.',
      errNetwork: 'Could not reach the provider. Check your internet connection — and for Claude, make sure a CORS proxy is set (Step 2).',
      errNoKey: 'No API key saved. Add one in Step 2.',
      errNoMaterial: 'Add some material first (Step 1) — upload a file or paste text.',
      errNeedKey: 'Add your API key first (Step 2).',
      errClaudeProxy: 'Add a CORS proxy URL in Step 2 (it must forward to https://api.anthropic.com and pass the x-api-key header), or switch to Gemini or OpenAI.',
      /* --- library (Phase 2 call sites) --- */
      libKicker: 'My exams',
      libTitle: 'Your saved exams',
      libHero: 'Exams you generated or imported live here, on this device only. Take one, export it as JSON to share, or delete it.',
      libCreate: '✦ Create a new exam',
      libImport: '📂 Import exam (.json)',
      libDemoKicker: 'Try the demo — no key needed',
      libDemoTitle: 'Sample exam',
      libDemoTake: 'Take the demo exam →',
      libEmpty: 'No exams saved yet. Generate your first one from the Create exam tab — upload any material, add your AI key, and go.',
      libTake: 'Take →',
      libExport: 'Export JSON',
      libDelete: 'Delete',
      libImportErr: 'Could not import that file: {msg}',
      libReadErr: 'Could not read that file. Try picking the .json file again.',
      qCount: '{n} questions',
      /* --- quiz start (Phase 2 call sites) --- */
      quizHero: 'Answer one question at a time — every answer comes with a clear explanation.',
      quizBack: '← Back to My exams',
      quizNoAttempts: 'No attempts yet',
      quizBest: '🏆 Best: {score}/{total} ({pct}%)',
      quizTopicsLabel: 'topics: {n}',
      quizAllTopics: 'All topics',
      quizStartTopic: 'Start →',
      quizStart: 'Start quiz →',
      quizChangeSettings: 'Change settings',
      quizShortcuts: 'Shortcuts during the quiz: keys 1–4 pick an answer, Enter moves to the next question.',
      quizHowTitle: 'How it works',
      quizHow1T: 'Pick a topic',
      quizHow1: 'Choose All topics or one topic card — or generate a new exam from any material.',
      quizHow2T: 'Answer & learn',
      quizHow2: 'Get instant feedback with a “Why” explanation after every answer.',
      quizHow3T: 'Review & retry',
      quizHow3: 'See your full review at the end and re-try only the ones you missed.',
      quizDefaultSub: 'Practice exam',
      quizDefaultTitle: 'Practice Quiz',
      sumShuffle: 'Shuffle: ',
      sumPerQ: 'Per-question timer: ',
      /* --- quiz run (Phase 2 call sites) --- */
      quizCounter: 'Question {pos} of {total}',
      quizAnswered: 'Answered {done} / {total} · Score {score}',
      quizWhy: 'Why: ',
      quizCorrect: '✓ Correct!',
      quizNotQuite: '✗ Not quite — the answer is {letter}.',
      quizTimeout: '⏰ Time ran out — the answer is {letter}.',
      quizNext: 'Next question →',
      quizResultsBtn: 'See my results ✓',
      scoreExcellent: 'Excellent — exam ready. 🎉',
      scoreSolid: 'Solid. Re-read the explanations for the ones you missed.',
      scoreGetting: 'Getting there — the explanations are the real lesson, read them twice.',
      scoreKeep: 'Keep practicing — work through the explanations, then try again.',
      /* --- results (Phase 2 call sites) --- */
      resKicker: 'Results',
      resTitle: 'Your score',
      resReview: 'Review',
      resCorrect: '✓ Correct',
      resWrong: '✗ Wrong',
      resTimeout: '⏰ Time out',
      resYourAnswer: 'Your answer: ',
      resNoAnswer: 'No answer',
      resNoAnswerTimeout: '⏰ No answer — time ran out',
      resCorrectIs: '  ·  Correct: ',
      resBest: '🏆 Best score on this quiz: {score}/{total} ({pct}%)',
      resRetryWrong: '↻ Retry wrong answers only ({n})',
      resAgain: 'Try again (all)',
      resBackTopics: 'Back to topics',
      /* --- load error --- */
      loadErrTitle: 'Could not load questions.json.',
      loadErrBody: 'Browsers block loading local files when you open index.html directly (file://). Run a tiny local server from this folder instead:',
      loadErrCmd: 'python3 -m http.server 8000',
      loadErrOpen: 'then open http://localhost:8000 in your browser.',
      loadErrDetails: 'Details: ',
      /* --- Phase 2 additions --- */
      s4Chars: 'characters',
      s4PdfPages: 'PDF pages',
      typeMcqShort: 'Multiple choice',
      typeTfShort: 'True/False',
      genSub: '{n} questions · generated with {provider} ({model}) · {difficulty} · {language}',
      genDefaultTitle: 'Generated exam',
      s4Ready: '✓ Your exam is ready: {n} questions. It was saved to My exams.',
      libImported: 'imported',
      libImportedBank: '{n} questions — imported bank',
      libImportHint: ' Check the format in the README (questions array, options, and a 0-based "answer" index).',
      sumPerQOn: 'On ({n}s)',
      quizKeysHint: 'Keys: 1–{n} to answer · Enter for next',
      ringAria: 'Score {score} out of {total}',
      resFinished: 'Finished in {time} · {n} questions.',
      errTimeout: 'The request timed out. Check your connection and try again.',
      errTimeoutLong: 'The request timed out after 2 minutes.',
      errEmptyReply: '{who} returned an empty reply. Press Retry.',
      errBadJson: 'The AI replied with text that is not valid JSON{label}. Nothing was saved. Press Retry — it usually works on the second try.',
      errBadFormat: 'The AI’s reply did not match the question format{label}: {detail} Nothing was saved. Press Retry.',
      errReadFile: 'Could not read {name}. Try again.',
      errReadFileDetail: 'Could not read {name}: {detail}',
      errPdfJsInit: 'pdf.js loaded but did not initialise.',
      errPdfJsLoad: 'Could not load the PDF reader (pdf.js) — check your internet connection and try again, or paste the text instead.',
      valNoQuestions: 'The file must have a non-empty "questions" array.',
      valNoQText: 'Question {n} is missing its "question" text.',
      valOptions: 'Question {n} needs at least 2 options.',
      valAnswerRange: 'Question {n} has an "answer" index out of range.',
      valTopic: 'Question {n} has a "topic" that is not text.',
      valExplanation: 'Question {n} has an "explanation" that is not text.',
      valCode: 'Question {n} has a "code" snippet that is not text.',
      valDifficulty: 'Question {n} has a "difficulty" that is not text.'
    },
    ar: {
      /* --- header / nav / chrome --- */
      brandTag: 'حوّل أي مادة إلى امتحانات',
      settings: 'الإعدادات',
      settingsTitle: 'الإعدادات',
      dark: 'داكن',
      light: 'فاتح',
      darkTitle: 'تبديل الوضع الداكن',
      langTitle: 'التبديل إلى الإنجليزية',
      navCreate: '✦ إنشاء امتحان',
      navLibrary: '▤ امتحاناتي',
      foot: 'QuizForge — ارفع أي مادة، وأحضر مفتاح AI الخاص بك، واحصل على امتحان. مفتاحك لا يغادر متصفحك أبدًا إلا إلى المزود الذي تختاره.',
      setTitle: 'الإعدادات',
      setShuffle: 'خلط الأسئلة وخيارات الإجابة',
      setPerQ: 'عدّاد تنازلي لكل سؤال',
      setSeconds: 'الثواني لكل سؤال:',
      setNote: 'تُحفظ الإعدادات على هذا الجهاز وتُطبق على الأسئلة التالية التي تبدأها.',
      on: 'مفعّل',
      off: 'متوقف',
      /* --- wizard --- */
      step1: 'رفع المادة',
      step2: 'مفتاح AI الخاص بك',
      step3: 'إعدادات الامتحان',
      step4: 'التوليد',
      kicker1: 'الخطوة 1 من 4 · رفع المادة',
      kicker2: 'الخطوة 2 من 4 · مفتاح AI الخاص بك',
      kicker3: 'الخطوة 3 من 4 · إعدادات الامتحان',
      kicker4: 'الخطوة 4 من 4 · التوليد',
      back: 'رجوع →',
      continue: 'متابعة ←',
      toKey: 'متابعة إلى مفتاح AI ←',
      toSettings: 'متابعة إلى إعدادات الامتحان ←',
      toGenerate: 'متابعة إلى التوليد ←',
      /* --- step 1: upload material --- */
      s1Title: 'ما الذي يجب أن يغطيه الامتحان؟',
      s1Hero: 'ارفع ملفات PDF أو امتحانات سابقة أو ملخصات — أي مادة وأي محتوى. أو الصق النص أدناه. يبقى كل شيء في متصفحك حتى تولّد الامتحان.',
      s1DzBig: '📄 أسقط الملفات هنا، أو <span class="dz-link">تصفح</span>',
      s1DzSmall: 'ملفات PDF أو نص (.txt / .md) أو بنك أسئلة (.json) — تُدمج الملفات المتعددة في مادة واحدة.',
      s1DzAria: 'رفع ملفات المادة',
      s1PasteLabel: 'أو الصق النص مباشرة',
      s1PastePh: 'الصق ملخصك أو ملاحظات المحاضرة أو نص الفصل هنا…',
      s1FilesLabel: 'الملفات: {n}',
      s1PagesLabel: 'صفحات PDF: {n}',
      s1CharsLabel: 'الأحرف: {n}',
      s1CharsTotal: 'إجمالي الأحرف: {n}',
      s1Ready: 'المادة جاهزة: {parts}.',
      s1NoMaterial: 'لا توجد مادة بعد — أضف ملفًا أو الصق نصًا للمتابعة.',
      s1PdfFail: 'قراءة ملفات PDF تحتاج إلى اتصال بالإنترنت في المرة الأولى (تُحمَّل مكتبة pdf.js من CDN). تعذّر تحميلها — الصق النص بدلًا من ذلك، أو تحقق من اتصالك وحاول مرة أخرى. كل شيء آخر ما زال يعمل دون اتصال.',
      s1BankSaved: 'بنك أسئلة — تم حفظه في امتحاناتي',
      s1RemoveFile: 'إزالة هذا الملف',
      s1RemoveAria: 'إزالة {name}',
      /* --- step 2: your AI key --- */
      s2Title: 'أحضر مفتاح AI الخاص بك',
      s2Hero: 'لا يوجد لدى QuizForge خادم أو حساب — أنت تستخدم مفتاح API الخاص بك وتنفق رصيدك الخاص. اختر مزودًا، والصق مفتاحك، واختبره.',
      s2Privacy: '🔒 مفتاحك لا يغادر متصفحك أبدًا إلا إلى المزود الذي تختاره. يُخزَّن على هذا الجهاز فقط (localStorage)، ولا يُسجَّل أو يُعرض كاملًا أبدًا.',
      s2KeyPh: 'الصق مفتاح {label} هنا',
      s2KeySaved: 'محفوظ على هذا الجهاز كـ {masked} — تُعرض آخر 4 أحرف فقط.',
      s2GetKey: 'احصل على واحد: {url}',
      s2GetKeyDash: 'احصل على مفتاح من لوحة تحكم مزودك.',
      s2ModelLabel: 'النموذج (قابل للتعديل)',
      s2ModelHint: 'الافتراضي: {model}. تتغير معرّفات النماذج كثيرًا — إذا أوقف مزودك نموذجًا، اكتب المعرّف الجديد هنا.',
      s2BaseLabel: 'رابط الأساس',
      s2BaseHint: 'نقطة نهاية متوافقة مع OpenAI، دون شرطة مائلة في النهاية. الافتراضي: {url}.',
      s2ProxyLabel: 'رابط وكيل CORS (مطلوب لـ Claude)',
      s2ProxyHint: 'واجهة Claude البرمجية تمنع الاتصالات المباشرة من صفحات المتصفح، لذا يلزم وكيل CORS للوصول إليها. يجب أن يوجّه الوكيل الطلب إلى https://api.anthropic.com وأن يمرّر ترويسة x-api-key. بدون وكيل، لا يمكن تشغيل التوليد باستخدام Claude من هذه الصفحة.',
      s2Test: 'اختبار الاتصال',
      s2Forget: 'نسيان مفتاحي',
      s2Warn: 'أضف مفتاح API أعلاه للمتابعة — أو عُد واستخدم بنك الأسئلة التجريبي في امتحاناتي، فهو لا يحتاج إلى مفتاح.',
      s2TestNeedKey: 'الصق مفتاح API أولًا.',
      s2Testing: 'جارٍ الاختبار…',
      s2Connected: '✓ تم الاتصال — أجاب {label} ({model}).',
      'keyLabel.gemini': 'مفتاح Gemini API',
      'keyLabel.openai': 'مفتاح OpenAI API',
      'keyLabel.claude': 'مفتاح Anthropic API',
      'keyLabel.custom': 'مفتاح API',
      /* --- step 3: exam settings (Phase 2 call sites) --- */
      s3Title: 'كيف يجب أن يبدو الامتحان؟',
      s3TitleLabel: 'عنوان الامتحان / المادة',
      s3TitlePh: 'مثال: أحياء — التمثيل الضوئي',
      s3CountLabel: 'عدد الأسئلة (5–50)',
      s3TypesLabel: 'أنواع الأسئلة',
      s3Mcq: 'اختيار من متعدد (4 خيارات)',
      s3Tf: 'صح / خطأ (خياران)',
      s3Diff: 'الصعوبة',
      diffEasy: 'سهل',
      diffMedium: 'متوسط',
      diffHard: 'صعب',
      diffMixed: 'مختلط',
      s3Lang: 'اللغة',
      langOptEnglish: 'الإنجليزية',
      langOptArabic: 'العربية',
      s3FocusLabel: 'ملاحظات التركيز (اختياري)',
      s3FocusPh: 'مثال: ركّز على الفصل الثالث، وتجاوز البراهين، وضمّن التفاعلات المعتمدة على الضوء…',
      s3FocusHint: 'أي شيء يجب أن يركز عليه الامتحان أو يتجاوزه.',
      s3PerQ: 'عدّاد تنازلي لكل سؤال أثناء الامتحان (يستخدم الثواني من الإعدادات)',
      /* --- step 4: generate (Phase 2 call sites) --- */
      s4Title: 'هل أنت جاهز لتوليد امتحانك؟',
      s4Material: 'المادة:',
      s4Provider: 'المزود:',
      s4Exam: 'الامتحان:',
      s4Untitled: '(بدون عنوان)',
      s4QuestionsLabel: 'الأسئلة',
      s4Generate: '⚡ ولّد امتحاني',
      s4Retry: '↻ إعادة التوليد',
      s4Generating: 'جارٍ توليد الجزء {i} من {n}…',
      s4TakeNow: 'ابدأ الامتحان الآن ←',
      errKey: 'رفض المزود مفتاح API الخاص بك. تحقق من المفتاح (الخطوة 2) وحاول مرة أخرى — تأكد من نسخ المفتاح كاملًا دون مسافات إضافية.',
      errQuota: 'رفض المزود الطلب: نفد الرصيد أو الحصة. تحقق من الفوترة / الاستخدام على موقع المزود، ثم حاول مرة أخرى.',
      errRate: 'قيّد المزود الطلب (طلبات كثيرة جدًا). انتظر دقيقة وحاول مرة أخرى.',
      errModel: 'لم يعثر المزود على النموذج "{model}". قد يكون قد أُوقف — جرّب معرّف نموذج أحدث في الخطوة 2.',
      errNetwork: 'تعذّر الوصول إلى المزود. تحقق من اتصالك بالإنترنت — وبالنسبة إلى Claude، تأكد من تعيين وكيل CORS (الخطوة 2).',
      errNoKey: 'لم يُحفظ أي مفتاح API. أضف واحدًا في الخطوة 2.',
      errNoMaterial: 'أضف بعض المادة أولًا (الخطوة 1) — ارفع ملفًا أو الصق نصًا.',
      errNeedKey: 'أضف مفتاح API أولًا (الخطوة 2).',
      errClaudeProxy: 'أضف رابط وكيل CORS في الخطوة 2 (يجب أن يوجّه إلى https://api.anthropic.com وأن يمرّر ترويسة x-api-key)، أو بدّل إلى Gemini أو OpenAI.',
      /* --- library (Phase 2 call sites) --- */
      libKicker: 'امتحاناتي',
      libTitle: 'امتحاناتك المحفوظة',
      libHero: 'الامتحانات التي ولّدتها أو استوردتها تعيش هنا، على هذا الجهاز فقط. خذ واحدًا، أو صدّره كملف JSON للمشاركة، أو احذفه.',
      libCreate: '✦ إنشاء امتحان جديد',
      libImport: '📂 استيراد امتحان (.json)',
      libDemoKicker: 'جرّب النسخة التجريبية — لا حاجة إلى مفتاح',
      libDemoTitle: 'امتحان تجريبي',
      libDemoTake: 'ابدأ الامتحان التجريبي ←',
      libEmpty: 'لا توجد امتحانات محفوظة بعد. ولّد أول امتحان من تبويب إنشاء امتحان — ارفع مادة، وأضف مفتاح AI، وانطلق.',
      libTake: 'ابدأ ←',
      libExport: 'تصدير JSON',
      libDelete: 'حذف',
      libImportErr: 'تعذّر استيراد هذا الملف: {msg}',
      libReadErr: 'تعذّر قراءة هذا الملف. حاول اختيار ملف .json مرة أخرى.',
      qCount: 'عدد الأسئلة: {n}',
      /* --- quiz start (Phase 2 call sites) --- */
      quizHero: 'أجب عن سؤال واحد في كل مرة — كل إجابة تأتي مع شرح واضح.',
      quizBack: '→ عودة إلى امتحاناتي',
      quizNoAttempts: 'لا محاولات بعد',
      quizBest: '🏆 الأفضل: {score}/{total} ({pct}٪)',
      quizTopicsLabel: 'المواضيع: {n}',
      quizAllTopics: 'كل المواضيع',
      quizStartTopic: 'ابدأ ←',
      quizStart: 'ابدأ الاختبار ←',
      quizChangeSettings: 'تغيير الإعدادات',
      quizShortcuts: 'اختصارات أثناء الاختبار: المفاتيح 1–4 لاختيار إجابة، وEnter للانتقال إلى السؤال التالي.',
      quizHowTitle: 'كيف يعمل',
      quizHow1T: 'اختر موضوعًا',
      quizHow1: 'اختر كل المواضيع أو بطاقة موضوع واحدة — أو ولّد امتحانًا جديدًا من أي مادة.',
      quizHow2T: 'أجب وتعلّم',
      quizHow2: 'احصل على ملاحظات فورية مع شرح "لماذا" بعد كل إجابة.',
      quizHow3T: 'راجع وأعد',
      quizHow3: 'شاهد مراجعتك الكاملة في النهاية وأعد فقط الأسئلة التي أخطأت فيها.',
      quizDefaultSub: 'امتحان تدريبي',
      quizDefaultTitle: 'اختبار تدريبي',
      sumShuffle: 'الخلط: ',
      sumPerQ: 'مؤقت كل سؤال: ',
      /* --- quiz run (Phase 2 call sites) --- */
      quizCounter: 'السؤال {pos} من {total}',
      quizAnswered: 'أُجيب {done} / {total} · النتيجة {score}',
      quizWhy: 'لماذا: ',
      quizCorrect: '✓ صحيح!',
      quizNotQuite: '✗ ليس تمامًا — الإجابة هي {letter}.',
      quizTimeout: '⏰ انتهى الوقت — الإجابة هي {letter}.',
      quizNext: 'السؤال التالي ←',
      quizResultsBtn: 'عرض نتائجي ✓',
      scoreExcellent: 'ممتاز — أنت جاهز للامتحان. 🎉',
      scoreSolid: 'جيد. أعد قراءة شروحات الأسئلة التي أخطأت فيها.',
      scoreGetting: 'تقترب — الشروحات هي الدرس الحقيقي، اقرأها مرتين.',
      scoreKeep: 'واصل التدريب — راجع الشروحات، ثم حاول مرة أخرى.',
      /* --- results (Phase 2 call sites) --- */
      resKicker: 'النتائج',
      resTitle: 'نتيجتك',
      resReview: 'المراجعة',
      resCorrect: '✓ صحيح',
      resWrong: '✗ خطأ',
      resTimeout: '⏰ انتهى الوقت',
      resYourAnswer: 'إجابتك: ',
      resNoAnswer: 'لا إجابة',
      resNoAnswerTimeout: '⏰ لا إجابة — انتهى الوقت',
      resCorrectIs: '  ·  الصحيحة: ',
      resBest: '🏆 أفضل نتيجة في هذا الاختبار: {score}/{total} ({pct}٪)',
      resRetryWrong: '↻ إعادة الأسئلة الخاطئة فقط ({n})',
      resAgain: 'إعادة المحاولة (الكل)',
      resBackTopics: 'عودة إلى المواضيع',
      /* --- load error --- */
      loadErrTitle: 'تعذّر تحميل questions.json.',
      loadErrBody: 'المتصفحات تمنع تحميل الملفات المحلية عند فتح index.html مباشرة (file://). شغّل خادمًا محليًا صغيرًا من هذا المجلد بدلًا من ذلك:',
      loadErrCmd: 'python3 -m http.server 8000',
      loadErrOpen: 'ثم افتح http://localhost:8000 في متصفحك.',
      loadErrDetails: 'التفاصيل: ',
      /* --- Phase 2 additions --- */
      s4Chars: 'حرفًا',
      s4PdfPages: 'صفحات PDF',
      typeMcqShort: 'اختيار من متعدد',
      typeTfShort: 'صح/خطأ',
      genSub: '{n} أسئلة · تم توليدها باستخدام {provider} ({model}) · {difficulty} · {language}',
      genDefaultTitle: 'امتحان مولَّد',
      s4Ready: '✓ امتحانك جاهز: {n} أسئلة. تم حفظه في امتحاناتي.',
      libImported: 'مستورد',
      libImportedBank: '{n} أسئلة — بنك مستورد',
      libImportHint: ' تحقق من الصيغة في README (مصفوفة أسئلة، وخيارات، وفهرس "answer" يبدأ من 0).',
      sumPerQOn: 'مفعّل ({n} ث)',
      quizKeysHint: 'المفاتيح: 1–{n} للإجابة · Enter للانتقال إلى التالي',
      ringAria: 'النتيجة {score} من {total}',
      resFinished: 'انتهيت في {time} · {n} أسئلة.',
      errTimeout: 'انتهت مهلة الطلب. تحقق من اتصالك وحاول مرة أخرى.',
      errTimeoutLong: 'انتهت مهلة الطلب بعد دقيقتين.',
      errEmptyReply: 'أعاد {who} ردًا فارغًا. اضغط إعادة المحاولة.',
      errBadJson: 'ردّ الذكاء الاصطناعي بنص ليس JSON صالحًا{label}. لم يُحفظ شيء. اضغط إعادة المحاولة — عادةً ما تنجح في المحاولة الثانية.',
      errBadFormat: 'لم يطابق ردّ الذكاء الاصطناعي صيغة الأسئلة{label}: {detail} لم يُحفظ شيء. اضغط إعادة المحاولة.',
      errReadFile: 'تعذّر قراءة {name}. حاول مرة أخرى.',
      errReadFileDetail: 'تعذّر قراءة {name}: {detail}',
      errPdfJsInit: 'تم تحميل pdf.js لكنه لم يبدأ.',
      errPdfJsLoad: 'تعذّر تحميل قارئ PDF ‏(pdf.js) — تحقق من اتصالك بالإنترنت وحاول مرة أخرى، أو الصق النص بدلًا من ذلك.',
      valNoQuestions: 'يجب أن يحتوي الملف على مصفوفة "questions" غير فارغة.',
      valNoQText: 'السؤال {n} يفتقد نص "question".',
      valOptions: 'السؤال {n} يحتاج إلى خيارين على الأقل.',
      valAnswerRange: 'السؤال {n} يحتوي على فهرس "answer" خارج النطاق.',
      valTopic: 'السؤال {n} يحتوي على "topic" ليس نصًا.',
      valExplanation: 'السؤال {n} يحتوي على "explanation" ليس نصًا.',
      valCode: 'السؤال {n} يحتوي على مقتطف "code" ليس نصًا.',
      valDifficulty: 'السؤال {n} يحتوي على "difficulty" ليس نصًا.'
    }
  };

  function getLang() {
    try {
      var l = localStorage.getItem(LS_LANG);
      if (l === 'ar' || l === 'en') return l;
    } catch (e) {}
    return 'en';
  }

  /* t('key') or t('key', {name: value}) — falls back to English, then to
     the key itself, so a missing translation never breaks the UI. */
  function t(key, params) {
    var lang = getLang();
    var s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || key;
    if (params) {
      Object.keys(params).forEach(function (k) {
        s = s.split('{' + k + '}').join(String(params[k]));
      });
    }
    return s;
  }

  /* Apply translations to the static chrome in index.html. Elements marked
     data-i18n get their text, data-i18n-title their title attribute. */
  function applyStaticStrings() {
    document.querySelectorAll('[data-i18n]').forEach(function (n) {
      n.textContent = t(n.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (n) {
      n.setAttribute('title', t(n.getAttribute('data-i18n-title')));
    });
    var lbl = document.getElementById('lang-label');
    if (lbl) lbl.textContent = getLang() === 'ar' ? 'English' : 'عربي';
    var lt = document.getElementById('lang-toggle');
    if (lt) lt.setAttribute('title', getLang() === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
  }

  function setLang(lang) {
    if (lang !== 'ar' && lang !== 'en') lang = 'en';
    try { localStorage.setItem(LS_LANG, lang); } catch (e) {}
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    applyStaticStrings();
    /* The dark-mode label is set by applyDark() in app.js, not by
       data-i18n — re-apply it here so it follows the language too. */
    var dl = document.getElementById('dark-label');
    if (dl) dl.textContent = document.body.classList.contains('dark') ? t('light') : t('dark');
    /* Re-render the current view (create/library/quiz) so every screen
       picks up the new language. During a quiz run the attempt state is
       preserved — __qfRerender keeps the per-question countdown. */
    if (window.__qfRerender) { try { window.__qfRerender(); } catch (e) {} }
  }

  window.STRINGS = STRINGS;
  window.t = t;
  window.getLang = getLang;
  window.setLang = setLang;
  window.applyStaticStrings = applyStaticStrings;

  /* Wire the header toggle and apply the saved language to the static
     chrome right away (this script runs before app.js, DOM is ready). */
  var toggle = document.getElementById('lang-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      setLang(getLang() === 'ar' ? 'en' : 'ar');
    });
  }
  var initialLang = getLang();
  document.documentElement.lang = initialLang;
  document.documentElement.dir = initialLang === 'ar' ? 'rtl' : 'ltr';
  applyStaticStrings();
})();
