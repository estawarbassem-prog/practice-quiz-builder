# Changelog

All notable changes to QuizForge, newest first.
The tool is improved in small daily batches — one focused set of features
per day, each verified before it ships.

## 2026-11-24 — Repo checks + auto-deploy to GitHub Pages

- **`tests/check.mjs` — dependency-free repo checks** (`node tests/check.mjs`).
  They validate `questions.json` against the same per-type rules the app's
  `validate()` enforces (MCQ answer range, true/false justification, essay
  rubric, fill-in blanks, matching uniqueness, ordering duplicates, coding
  tests), verify English/Arabic string parity in `i18n.js` — keys AND
  `{placeholder}` tokens — and confirm every file referenced by
  `index.html`, the README, the PWA manifest and the service worker's
  cache list actually exists. No npm install, no build step.
- **GitHub Actions Pages workflow** (`.github/workflows/pages.yml`):
  every push to `main` runs the checks and deploys to GitHub Pages only
  when they pass, so a broken bank or a missing screenshot can never ship.
  One-time setup: repo Settings → Pages → Source: "GitHub Actions".
- **README**: project structure and contributing notes updated; the stale
  service-worker version label is gone so it can't drift again.

## 2026-11-23 — Exam built from your mistakes only (Feature 5 of the new queue)

- **"🎯 Exam from my mistakes ({n})" on the Stats screen and in the
  My exams header** — one tap builds a real exam in the library from
  every question still sitting in the smart-review queue, across ALL
  exams (the demo bank included). No provider call, no API key: the
  questions already exist, they are just collected. The button only
  shows when there are mistakes to build from, with the count.
- **One mistakes exam at a time** — building again replaces the old
  one, so the library never fills up with stale copies. Questions
  are deduped by content, so the same question in two exams appears
  once. Queue entries for exams that were deleted are skipped, and
  pruned when an exam is built.
- **Mastering flows back to the exam the question came from** — a
  correct answer inside the mistakes exam counts toward the source
  exam's 2-in-a-row streak, and the results screen says plainly how
  many questions just left the mistakes queue for good
  ("✓ Mastered 1 question(s)…"). A wrong answer resets the streak,
  like a review session. Ungraded answers (essay/oral with no key)
  never touch a streak, and a results-screen re-render can never
  count the same answers twice.
- **Mastery is global across copies** — the same question in two
  exams shares one queue entry by content: mastering it in one exam
  clears it from the other too, so the next mistakes exam never
  re-asks a question the student already proved they know. (Found
  by the smoke test: the first build only cleared the copy in the
  exam it came from, and a stale copy came back.)
- The mistakes exam is a normal exam otherwise: topics, strict mode,
  oral mode, print, answer sheet, flashcards, share link, and the
  review button all work on it; its card in My exams is tagged
  "Built from your mistakes". 7 new i18n keys (English + Arabic);
  works in both languages and in dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test — 36 checks passed
  (i18n parity 616 EN == 616 AR, Stats + library buttons with the
  deduped count of 3, build + rebuild replacing instead of
  duplicating, orphan pruning, full 3-question run 2/3 with the
  mastered line, source-queue updates verified per question,
  re-render guard after a language switch, empty state with a plain
  message and no buttons, Arabic UI and RTL, 390px with no
  overflow, zero console errors). Screenshots:
  docs/screenshots/stats-en.png, mistakes-en.png, mistakes-ar.png.
  No provider call was made — the feature is fully local. Service
  worker cache bumped v4 → v5 for the changed app shell.

## 2026-11-22 — Repo styling: banner + topics

- **Banner added at the top of the README** (`docs/banner.png`,
  beige #F3EFE6 with the QuizForge wordmark, tagline and a sample
  question card — same identity as the app). Repo topics set on
  GitHub for discoverability. No text added — README stays at the
  simplified length.

## 2026-11-22 — README simplified

- **README cut from 359 lines to 174: screenshots do the talking now.**
  Every feature is one short line instead of 2–4 weighty paragraphs;
  the question-bank format (with all JSON examples) moved to
  `docs/question-bank-format.md`, linked from the README in one line;
  the Arabic section is a short paragraph instead of a full mirror.
  All 41 screenshots stay in place, unchanged.

## 2026-11-22 — Phase 3: project description + screenshots

- **README rewritten: 359 lines (was 656), concise but substantive.**
  Every one of the 25 features gets 2–4 weighty lines — what it does
  and why it matters — grouped under Generate / Take the exam / Learn
  from it / Share, print & reuse. Stale claims fixed: service-worker
  cache `quizforge-v1` → `v4`, demo bank "10 verified questions" →
  16 questions (10 MCQ, 3 true/false, 1 matching, 1 ordering,
  1 coding). Model defaults re-checked against app.js and kept as-is.
- **Full Arabic section added** — a condensed mirror of the English
  README in Egyptian-friendly Arabic, wrapped in
  `<div dir="rtl" lang="ar">` for correct RTL rendering on GitHub.
- **41 screenshots in docs/screenshots/**, organized by feature in the
  README with one-line captions: every main screen and option —
  wizard steps, settings (all 7 question types), library, quiz,
  results + review, flashcards, stats, chat, past-exam analysis, oral
  exam, cheat sheet, strict mode, translation, backup, share link,
  offline bar, dark mode, and mobile 390px. 14 new shots captured
  with headless Chrome (mock provider only); 13 older shots re-shot
  because the UI had moved on (demo bank 10 → 16 questions, new
  buttons on the start screen and library). Screenshots are PNGs:
  they live in the repo folder locally and are uploaded to GitHub via
  the web UI (the push connector cannot carry binaries).
- No code behaviour changed in this phase.

## 2026-11-22 — Phase 2: harden + organize all features

- **A full hardening pass over every feature, in five parts, with no
  feature removed and no visible behaviour changed except where a bug
  was fixed.** Each part was verified in headless Chrome against a
  local mock provider only (never a live provider, never a real key),
  in English + Arabic, dark mode, and at 390px, with zero console
  errors.
- **Core / generation + library (28 checks)** — a chunk that fails
  mid-generation no longer throws away the earlier chunks: the
  questions that did arrive are saved as a partial exam and the
  failure is still shown plainly. Every caller now checks the
  true/false result of saveLibrary(), so a storage failure is
  reported instead of silently pretending the save worked. The
  connection test now validates the reply: a JSON reply must actually
  be the `{"ok": true}` asked for — any other JSON is rejected — while
  a plain-text reply still counts as connected. A scanned / no-text
  PDF and a non-UTF-8 text file both show a plain error or warning
  instead of adding garbled or empty material. Stored generation
  settings are sanitized (count clamped 5–50, difficulty/language
  from the known lists, types per-field) so a corrupt stored `gen`
  can never crash the prompt build. A backup export → import now
  keeps the material, the stored settings, the variant chain
  (variant number + base title) and the source URL, so a restored
  exam can still make a variant and chat about its material. Shared
  helpers added: lsGetJSON / lsSetJSON, loadScriptOnce,
  postProviderJson.
- **Quiz engine + smart review (24 checks)** — Previous button and
  RTL-correct arrow keys; an Exit button with a confirm guard so a
  mid-quiz exit never silently throws the attempt away; the
  per-question countdown resumes with its remaining time after a
  language switch; essay/fill drafts survive moving back and forth;
  Enter is blocked while grading; async grading has race guards so a
  late reply cannot overwrite a newer answer; smart review uses one
  shared applyReviewResult helper; flashcards restore their original
  order when shuffle is turned off and answer to arrow keys.
- **Sharing / export / offline (37 checks)** — the summary screen
  now always shows the summary of the exam actually being started,
  never the wizard's leftover one. The 7+-option "undefined" bug is
  fixed with one shared letterFor() helper (letters A–F, then the
  1-based number). Corrupt share links are rejected with a plain
  message instead of loading a broken exam. Translation restores the
  original exam cleanly and no longer leaves stale state behind.
  Language detection now counts rubric, matching pairs and ordering
  items, not just question text. Service worker cache bumped v1 → v2.
- **Newer features: chat, past-exam analysis, oral exam, variant
  (44 checks)** — the 7+-option letters bug is fixed everywhere it
  appeared (quiz, results, review, flashcards, read-aloud, oral
  exam), not just in print. Chat no longer silently drops the exam's
  own material when a file is added — uploads extend it. Past-exam
  analysis no longer writes hardcoded English focus lines and no
  longer drops its state when the screen is reopened. Oral grading
  no longer falls back to a wrong letter. Variant dedupe now covers
  every saved version sharing the exam's base title, so a variant of
  a variant cannot resurrect an earlier version's questions.
  A variant finishing while the student is on another view no longer
  yanks them back to the library. Five i18n keys added — parity is
  now 609 English == 609 Arabic. Service worker cache bumped v2 → v3.
- **Organization (this pass)** — the file's existing section comments
  are now joined by a table of contents at the top of app.js, so the
  ~9,000-line file can be navigated at a glance. Clearly-repeated
  code is deduped into shared helpers with identical behaviour:
  showStatusBox / hideStatusBox for the status lines
  (#backup-status, #import-error, #gen-success), one
  showImportReadError for both file imports, todayStr() for the
  library date stamp, newId(prefix) for entry ids. i18n.js was
  verified key by key: 609 keys in English and 609 in Arabic, no
  missing keys, no dead keys (every key is used — including the
  `keyLabel.*` keys reached through the provider name and the keys
  used through lookup maps and `data-i18n-title` attributes). Service
  worker cache bumped v3 → v4 for the changed shell.
- **One bug left over from the variant work, fixed here** — when a
  variant generation failed while the student was off the library
  view, the error fell back to #backup-status, which only exists on
  the library, so the failure was silently dropped (the button just
  reset). It now falls back to a sticky toast that is always in the
  DOM, so the failure is always seen; nothing is saved wrongly.
  Verified by a dedicated check (variant fails off-library → toast
  shown, library unchanged; variant succeeds on-library → status
  line shown, no toast).
- Verified with a headless-Chrome full regression — 120 checks
  passed, 0 failed: rebuilt core suite 15/15 (generation incl.
  partial-chunk failure, library/backup round-trip, i18n parity,
  connection test, blank PDF, non-UTF8, settings sanitization),
  quiz engine + review 24/24, sharing/export/offline 37/37, newer
  features 44/44. A real provider call was NOT verified — all tests
  used a local mock endpoint only.

## 2026-11-22 — Cheat sheet from mistakes (ورقة غش من الأخطاء)

- **"📄 Cheat sheet from your mistakes" on the results screen** — shown
  only when the attempt has at least one wrong answer (with the count of
  missed questions); a perfect score shows no button and no section at
  all. Each entry covers exactly one missed concept: a heading, 1–3
  short lines with the correct fact / formula / definition, and the
  student's mistake corrected (your answer vs the right answer).
- **With an API key: condensed by the provider** — the missed questions
  (question + your answer + correct answer + explanation) go through
  the same BYOK callProvider flow as the material summary, in the
  exam's language. The reply must come back with exactly one item per
  missed question, in the same order — any other shape is rejected, so
  the sheet can never cover a concept the student did not miss.
- **Without a key: built verbatim from the stored explanations** — the
  correct answer plus the question's own explanation, trimmed to short
  lines, never rewritten and never presented as an AI summary; the
  sheet says so plainly.
- **Stored with the attempt and revisitable** — the sheet is saved on
  the stats attempt record (`qf-stats`) and on the live run, so it
  opens again from the results screen or from a "📄 Cheat sheet" button
  next to the attempt on the Stats screen, without regenerating (no
  extra provider call). Works for every question type (MCQ, True/False
  with justification, fill-in, essay rubric, matching, ordering,
  coding tests).
- **Printable on one page** — a print button rebuilds the hidden
  #print-sheet with the cheat sheet and calls window.print(), reusing
  the existing print CSS (black-on-white even in dark mode, compact
  type, no page break inside a concept).
- 17 new i18n keys (English + Arabic); works in both languages and in
  dark mode, at 1280px and 390px, RTL-safe.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 34 checks passed (results button with wrong count, exact
  missed-concept coverage with nothing else, your-vs-correct
  corrections, one provider call, stored sheet reopened from results
  and from Stats with no new call, no-key verbatim sheet with zero
  provider calls, wrong-count reply rejected, perfect score shows
  nothing, Arabic RTL button + sheet, dark mode at 390px with no
  overflow, real print-to-PDF of the sheet — exactly 1 page, zero
  console errors). Screenshots: docs/screenshots/cheat-en.png,
  docs/screenshots/cheat-ar.png. A real provider call was NOT verified
  — the test used a local mock endpoint only.

## 2026-11-22 — Oral exam by voice (امتحان شفوي بالصوت)

- **"🎙️ Oral exam" toggle on the quiz start screen** — next to the
  strict-mode toggle; the question is read aloud (existing TTS, exam
  language) and answered by speaking. Review sessions never run oral.
  In oral mode the question is always read aloud when it appears,
  even when the auto-read setting is off; the number keys no longer
  pick a written answer, and recognition stops on submit, navigation,
  language switch and results.
- **Answer by voice** — a mic button (pulsing red while listening)
  uses the browser SpeechRecognition API (webkitSpeechRecognition
  where available) in the exam's language (ar-EG / en-US). The live
  transcript appears as it is spoken (final + interim results) and
  stays editable by typing before submitting; "Record again" clears
  it and starts a fresh recording. If the browser has no speech
  recognition, the panel says so plainly, the mic button is disabled,
  and typing is the fallback — the transcript is never faked.
  Recognition errors are plain words: no speech heard, microphone
  denied, or a generic failure with the error name.
- **Local matching, no key needed** — a spoken letter (A–F, or Arabic
  أ ب ج د هـ و), number (1–6), ordinal ("the second one", "الخيار
  التاني"), or the option text itself is matched against the displayed
  (shuffled) options, so saying the right option scores correctly
  with no API call. True/False understands True/False, صح/خطأ،
  نعم/لا, and yes/no. Fill-in exact accepted answers also score
  locally. A transcript that matches no option and no key is set is
  not submitted — the student is told to say an option or edit the
  text instead of being marked wrong on a guess.
- **AI evaluation for open answers** — essay, fill-in (non-exact),
  coding-as-spoken, and unmatched MCQ/TF transcripts go to the
  provider through the same BYOK callProvider flow as essay grading
  (score 0–100 + short feedback, transcription slips allowed for).
  With no key the spoken answer is saved ungraded with a clear
  message that AI evaluation needs a key — never a fake AI grade.
  Matching / ordering cannot be answered in words, so in oral mode
  they show a note and fall back to the normal written UI.
- **Score + feedback everywhere** — per question after answering
  (transcript, oral 0–100 score, feedback) and in the results review,
  alongside the correct answer when it was missed. Per-question and
  strict-mode timeouts keep a spoken/typed transcript instead of
  dropping it, graded locally where possible.
- 27 new i18n keys (English + Arabic); works in both languages and
  in dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 43 checks passed (spoken-choice parsing units, mic
  listening state + transcript from a stubbed SpeechRecognition,
  auto-read of the question in oral mode, MCQ/TF/fill local matching
  with zero provider calls, essay AI grading 85/100 via the mock,
  re-record replacing the transcript, matching fallback note, no-key
  path with the plain message and unmatched-transcript toast,
  unsupported-browser message with typing fallback, mic-denied
  error, Arabic RTL, dark mode, 390px with no overflow, zero console
  errors). Real-microphone speech recognition in a real browser was
  NOT verified — the test stubbed SpeechRecognition, as headless
  Chrome has no microphone. Screenshots: docs/screenshots/oral-en.png,
  docs/screenshots/oral-ar.png.

## 2026-11-22 — Generate questions from a link (توليد أسئلة من لينك)

- **"Or generate questions from a link" on step 1 of the wizard** —
  paste a link to an article, a Wikipedia page or a documentation
  page and hit Fetch: the page text becomes exam material and flows
  into the existing generation pipeline unchanged (chunking,
  settings, provider, save to My exams with the material stored, so
  fresh variants and chat-with-material work from it too).
- **Reading a page** — the fetch runs client-side with `fetch()`;
  HTML is parsed with `DOMParser` (which never runs scripts) and
  the readable text is kept (headings, paragraphs, list items,
  preferring `<article>` / `<main>` when the page marks them) while
  scripts, styles, navigation, headers, footers and forms are
  dropped. Plain-text pages are used as-is. Links are dropped to
  their text, so there are no relative URLs left to resolve; the
  stored source URL itself is always absolute (a missing scheme is
  completed with `https://`, anything that is not http(s) or
  contains a space is rejected with a plain message).
- **CORS failure is never silent** — many sites block cross-origin
  fetches, so a failed fetch shows a clear message explaining the
  page could not be fetched directly (the site probably blocks it)
  and offers the paste fallback right there: a textarea for the
  article text, which then becomes the material with the link still
  recorded as the source. A page that loads but has no readable text
  says so instead of showing the blocked message.
- **Public reader service is opt-in only** — a labelled checkbox
  ("If the direct fetch is blocked, try a public reader service
  (r.jina.ai)") may route the URL through r.jina.ai when the direct
  fetch fails; it is never used silently, and the success message
  says the text came through the reader service.
- **Very long pages are capped** at the same 200,000-character
  material cap used elsewhere, with a plain note ("only the first
  200,000 were kept"). The source URL is stored with the saved exam
  (`sourceUrl`) and shown on its card in My exams as a link, and it
  travels to fresh variants.
- 20 new i18n keys (English + Arabic); works in both languages and
  in dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 57 checks passed (URL validation and text extraction
  units, fetching a local CORS article end to end into a generated
  exam, source URL stored and shown on the library card, variant
  keeping the source, CORS-blocked URL with the clear message and a
  working paste fallback, invalid URL, empty page, plain-text fetch,
  200,000-char cap with a note, removing the link file, the real
  reader service against https://example.com via r.jina.ai, Arabic
  RTL, dark mode, 390px with no overflow, zero console errors
  besides the browser's own CORS diagnostics for the deliberately
  blocked fetches). Screenshots: docs/screenshots/url-en.png,
  docs/screenshots/url-ar.png, docs/screenshots/url-library.png.

## 2026-11-22 — True/false questions with justification (صح/خطأ مع التعليل)

- **A new question type: True/False with a justification (تعليل)** —
  the provider may now write True/False questions: a statement, the
  correct answer, and a **justification** — a short explanation of
  why the statement is true or false, grounded in the material.
  The justification is a required field: the generation prompt asks
  for it with a schema and an example, and a question that arrives
  without one is repaired from its "explanation" when it has one,
  or rejected (the whole generation fails with a clear message,
  like an essay without a rubric). Imported JSON banks and
  spreadsheet rows are repaired the same way, so older True/False
  questions with an explanation still import.
- **In the quiz, True/False shows as two choices** — True / False
  in English, صح / خطأ in Arabic (the labels are UI chrome, so they
  follow the UI language while the statement stays in the exam's
  language). Right after answering, the justification appears in
  its own highlighted blue box under the verdict, and it is shown
  just as prominently in the results review for right and wrong
  answers alike — the generic "Why:" explanation is never printed
  twice next to it.
- **Demo bank: 3 new True/False questions** (pointers / linked
  list, verified against the existing demo facts): p++ on an int*
  does not move one byte, head insertion is O(1), and delete does
  not reset a pointer to nullptr — each with its justification, so
  the type works end to end without an API key.
- **Everywhere else the type travels, it holds up** — the
  justification is on the flashcard back, in the print answer key
  (with صح/خطأ labels), in the per-topic stats (type-agnostic, a
  True/False attempt records like any other), and it is collected
  and applied by one-tap exam translation; sharing a bank carries
  it along as part of the exam JSON. TTS reads the True/False
  labels in the UI language too.
- 4 new i18n keys (English + Arabic); works in both languages and
  in dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 52 checks passed (generation with justifications in
  the prompt and in the saved exam, repair from "explanation",
  rejection of a tf question with no reason at all, provider-500
  and offline-free paths, quiz with صح/خطأ labels, justification
  right after answering and in review, 50% scoring, stats
  recording, flashcard backs, print answer key, share payload
  round-trip, translation of the justification, demo tf questions
  end to end without a key, Arabic RTL, dark mode, 390px with no
  overflow, zero console errors). Screenshots: docs/screenshots/
  tf-en.png, tf-ar.png.

## 2026-11-22 — Chat with the material (Feature 1 of the new queue)

- **"💬 Ask about this material" on every exam card in My exams** —
  for exams that still carry their source material, one tap opens a
  chat screen where the student asks questions about that material
  and gets answers from their own provider (the same BYOK key as
  exam generation). The button only appears where the material
  exists: generated exams have it, imported, shared and demo exams
  do not. A **"💬 Chat with material"** button in the library header
  opens a fresh chat with no exam — upload files or paste text there.
- **Answers are grounded, never invented** — the material is chunked
  like generation does (~12,000 characters) and only the chunk(s)
  most relevant to the question are sent, picked by word overlap
  with the question (works for English and Arabic words). The
  provider is told to answer ONLY from the material, to say so
  clearly when the material does not contain the answer, and to
  quote short passages; answers are shown with their quotes under a
  "From the material:" label. The reply is JSON {"answer",
  "quotes"}; a reply that is not JSON at all is shown as plain text
  rather than dropped (Claude does not force JSON mode), while a
  JSON reply with no usable answer shows a plain error instead of a
  guessed answer. Follow-up questions keep the earlier exchanges as
  context (last 3, truncated), so "and where does it happen?" works.
- **Fresh material in the chat screen itself** — upload PDF (pdf.js,
  lazily loaded), Word (.docx) or PowerPoint (.pptx) (JSZip, lazily
  loaded) or text files, or paste text; the same readers as the
  wizard, but kept in the chat's own state so the wizard's material
  is untouched. Files can be removed again, and the material line
  always shows the character count. Very long material is capped at
  200,000 characters (the same cap as material stored with an exam),
  with a plain note when the cap cuts it.
- **Honest failure paths** — with no API key set, a clear banner on
  the chat screen says so and sending shows the same message, and
  nothing is generated; offline, or a provider error, shows a plain
  message and the question stays in the history so it can be
  re-sent. While an answer is coming, a "Thinking…" bubble shows
  and the input and Send button are disabled.
- **History is kept per exam** — messages are saved in localStorage
  (qf-chat, last 30 per chat) and survive a reload; "Clear chat"
  wipes one chat's history. Switching the UI language mid-chat
  re-renders the screen with the history intact.
- 33 new i18n keys (English + Arabic); works in both languages and
  in dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 44 checks passed (chat button only on exams with
  material, opening from an exam card, grounded answer with a
  verbatim quote from the material, grounding instruction in the
  provider prompt, follow-up exchange, history persists across
  reload, clear chat, chunk relevance — a beta question sends the
  beta chunk and drops the gamma chunk — no-key banner and no
  provider call, offline and provider-500 paths, non-JSON reply
  shown as plain text, fresh chat with .txt / pasted / .docx / PDF
  uploads grounding answers, file removal, Arabic UI and RTL with a
  grounded answer, dark mode, 390px with no overflow, zero console
  errors).

## 2026-11-22 — Past-exam analysis (Feature 2 of the new queue)

- **"📈 Past-exam analysis" in My exams and on the Create exam tab**
  — a dedicated screen where the student adds 2+ past exams (PDF,
  Word .docx or text .txt / .md — the same readers as the chat
  screen) and labels each one with its year in a free-text field
  next to the file. Files can be removed again; adding or removing
  an exam after an analysis clears the old result, so the table can
  never describe exams that are no longer there.
- **Two provider passes, same BYOK key as generation** — first, each
  exam's topics are extracted from the exam text (one ~12,000-char
  chunk per exam, JSON {"topics": [{"name", "description"}]}), then a
  second pass merges topics that are the same idea in different
  wording into one canonical topic and records which exams each
  merged topic appears in. Frequency is plain counting on the merged
  result — never a local guess at topics.
- **Result: a ranked list, most-repeated first** — each row shows the
  topic, a short description, how many exams it appeared in (e.g.
  "3 of 4 exams") and the years it appeared in; ties sort
  alphabetically so the order is stable.
- **"⚡ Generate an exam focused on the most-repeated topics"** —
  hands the wizard the past exams as material and the top topics
  (those in at least 2 exams, up to 8 — or the top 5 if every topic
  appeared only once) as focus notes, and opens the exam settings
  step so the student checks count / difficulty / language before
  generating. The old material summary is cleared with the material,
  so a summary can never describe the wrong exams.
- **Honest failure paths** — with no API key set, a clear banner on
  the screen says so and analysing shows the same message and calls
  nothing; fewer than 2 exams with text is refused with a plain
  message and no provider call; a provider error or an unreadable
  reply shows a plain error and no results. If the merge pass
  itself fails, the analysis falls back to exact-name merging
  (identical names only — never a guess that two wordings are the
  same idea) instead of failing the whole analysis.
- 34 new i18n keys (English + Arabic); works in both languages and
  in dark mode, at 1280px and 390px. Screenshots:
  docs/screenshots/past-en.png and past-ar.png.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 48 checks passed (entry buttons in the library header
  and on wizard step 1, uploading PDF + .txt + .docx with year
  fields, 4 extraction calls + 1 merge call, ranking correctness —
  a topic in all 4 exams ranks above one in a single exam, with
  alphabetical tie-breaking — provider merge joining "Genetic
  Inheritance" into "Genetics" across years, focused-exam button
  opening the settings step with the material and focus notes set
  and the exam generating and saving, fewer-than-2 guard with no
  provider call, file removal, provider-500 and non-JSON reply
  errors, merge-failure fallback to exact-name merging, language
  switch mid-screen keeping the results, no-key banner and no
  provider call, Arabic UI and RTL with Arabic count chips, dark
  mode, 390px with no overflow, zero console errors apart from the
  two "Failed to load resource" lines the intentional mock 500s
  cause).

## 2026-11-22 — One-tap fresh exam variant (Feature 3 of the new queue)

- **"🔄 New variant" button on every exam card in My exams** — for
  exams that still carry their source material, one tap generates a
  NEW exam from the same material with the same settings (question
  count, types, difficulty, language, focus notes) but different
  questions, and saves it as a separate exam in the library
  ("Title (variant 2)", then 3, 4… — a variant of a variant keeps
  counting up from the same base title). The button only appears
  where the material exists: generated exams have it, imported,
  shared and demo exams do not.
- **The questions are genuinely different, not the same ones
  reworded** — two layers: the provider is given the earlier
  version's question stems and told not to repeat them (covering
  other facts, details and angles instead), and generation dedupes
  the new set against those stems afterwards. If the provider still
  returns only repeats, nothing is saved and the student is told to
  try again — a variant is never an empty or identical exam.
- **Material and settings now travel with each generated exam** —
  generation stores the full source text and a snapshot of the
  settings it used, so a variant needs no re-upload and no
  re-typing. Material over 200,000 characters is not stored (the
  variant button simply does not appear for that exam), so one exam
  can never eat the whole localStorage quota. The material summary
  describes the material, not the questions, so it travels to the
  variant unchanged; backups carry the material and settings too,
  so a variant still works after a library restore.
- **Honest failure paths** — offline, or with no API key set, the
  button shows a plain message and generates nothing; a provider
  error is shown in plain words and the button is re-enabled.
  While a variant generates, its button is disabled ("Generating
  variant…") and only one variant runs at a time.
- 5 new i18n keys (English + Arabic); works in both languages and in
  dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against a local mock
  provider — 40 checks passed (variant button only on exams with
  material, variant 2 + variant 3 titles and numbering, new questions
  differ from the parent, avoid-list in the provider prompt, material
  + settings + summary travel to the variant, full variant quiz run
  2/2, all-repeat provider refused with a plain message and nothing
  saved, provider 500 and offline and no-key paths, wizard
  generation stores material + settings, Arabic UI and RTL with a
  "(نسخة 2)" title, dark mode, 390px with no overflow, zero console
  errors).

## 2026-11-22 — Upload Word (.docx) and PowerPoint (.pptx) as material

- **Word and PowerPoint join the dropzone** — step 1 now accepts
  `.docx` and `.pptx` files (picker + drag-and-drop, alongside PDF,
  text and JSON banks). Multiple files still merge into one material,
  and the file list shows each file with its size, character count —
  and the slide count for presentations ("Slides: 3") — in the
  material summary too.
- **What is read, honestly** — both formats are ZIP archives of XML,
  so the reader is JSZip 3.10.1 from cdnjs, loaded lazily only when
  the first Word or PowerPoint file is added (same pattern as pdf.js
  and SheetJS). Word gives the document body — paragraphs and tables,
  in order, with tracked deleted text skipped; PowerPoint gives the
  text of every slide, in slide-number order (slide 10 after slide 2,
  not after slide 1). Images are not read (no OCR), and neither are
  speaker notes or Word headers/footers.
- **Clear errors, nothing half-added** — a file that is not a real
  Word/PowerPoint file, a presentation with no slides, or a file with
  no readable text shows a plain message and adds nothing; if the
  JSZip CDN cannot be reached, the message says to check the
  connection or paste the text instead. A failed upload never wipes
  or replaces the material already there.
- **Two small fixes folded in** — switching the UI language on step 1
  used to show an empty file list even though the material was still
  there (the list refreshed while the new card was still detached);
  the wizard now refreshes the list once attached, so uploaded files
  survive a language switch. And a failed Office upload's message
  used to be wiped by the next list refresh; it is now kept on the
  material state until the next successful upload, like the PDF
  failure note.
- 7 new i18n keys (English + Arabic); works in both languages and in
  dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against real .docx /
  .pptx files and a local mock provider — 61 checks passed (55 in
  the main run + 6 in the no-CDN run): lazy JSZip load, split runs
  joined, table text and Arabic lines extracted, tracked-deleted
  text excluded, slide order 1 → 2 → 10, corrupt / empty / no-slides
  files refused with a clear message and nothing added, file removal
  and re-add, Arabic UI (RTL, "شرائح: 3"), full generation from the
  uploaded material with the docx + pptx text in the provider prompt
  in the right order, generated exam taken end to end (2/2, 100%),
  saved to the library, dark mode, 390px with no overflow, CDN
  blocked → clear connection message and no file added, zero console
  errors. (This VM's headless browser has no direct internet, so the
  JSZip CDN request was fulfilled by the harness with the exact
  cdnjs 3.10.1 bytes; the app still loads it through a `<script>`
  tag exactly as in production.)

## 2026-11-21 — Read questions aloud (text-to-speech)

- **🔊 Listen button on every question** — the quiz screen, each
  flashcard front, and every row of the results review all have a
  speaker button that reads the question aloud with the Web Speech
  API (`window.speechSynthesis`): on-device, no network, no API key.
  While it speaks the button becomes a ⏹ Stop button. Multiple
  choice and True/False questions are read with their on-screen
  letters (A, B, C…) in the shuffled order shown; matching reads the
  left items then the right partners in their displayed order, and
  ordering reads the items in their current on-screen order — never
  paired or in the correct order, so the answer is never given away.
  Essay and fill-in questions read the question text only; coding
  questions never read code aloud.
- **Auto-read + reading speed in Settings** — an "auto-read" toggle
  (off by default) reads each new question automatically as it
  appears, and a speed selector (Slow / Normal / Fast: 0.8× / 1× /
  1.25×) sets the pace. Both are saved on the device and survive a
  reload.
- **Voice follows the exam's language** — Arabic-script questions
  are read with an `ar-EG` voice, English ones with `en-US`; a
  matching voice is picked when the browser has one, otherwise the
  browser default speaks. When the question has no letters at all
  (numbers only), the UI language is the fallback.
- **Speech always stops when you move on** — next question, submit,
  leaving the quiz, starting a review session, switching the UI
  language mid-quiz, or changing view all stop the current reading
  through one shared `stopSpeech()`.
- **Honest no-support path** — when the browser has no
  `speechSynthesis`, no speaker button is shown anywhere and the
  settings panel says so plainly instead of pretending it works.
- 10 new i18n keys (English + Arabic); works in both languages and in
  dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test against a fake
  `speechSynthesis` — 83 checks passed (72 in the supported run +
  11 in the no-support run): speaker button speaks the right text
  with lettered options, stop cancels, auto-read fires on question
  render and stops on navigation, settings persist across reload,
  rate setting honoured, no-support path hides buttons and shows
  the plain note, flashcard + results-review buttons, Arabic voice
  selection (`ar-EG`) and matching/ordering/coding spoken-text
  shapes, plus a full demo quiz run, flashcards, dark mode, Arabic
  UI, 390px, zero console errors.

## 2026-11-20 — Whole-library backup (Feature 16 of 15)

- **Export library** — a "💾 Export library (.json)" button in My exams
  downloads one JSON file with every saved exam (questions, and the
  material summary when an exam has one), plus a version marker
  (`quizforgeBackup: true, version: 1`) and the export date
  (`quizforge-library-YYYY-MM-DD.json`).
- **Import library** — a "📥 Import library (.json)" button uploads such
  a file, validates every exam with the existing bank validation, and
  merges it into the library: exams already present (same id) are
  skipped, the rest are added, then a clear message reports how many
  were added and how many were already there (plus how many invalid
  exams in the file were left out, if any).
- **Safe import** — a corrupt file, a non-backup JSON, or a file with
  zero valid exams shows a clear error and changes nothing; the
  existing library is only written once the new exams are known good,
  so a failed import can never wipe it.
- 8 new i18n keys (English + Arabic); works in both languages and in
  dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test — 67 checks passed
  (export / restore / duplicate-skip / corrupt-file safety, plus a
  full quiz run and the earlier features, in English and Arabic, at
  1280px and 390px, zero console errors).

## 2026-11-20 — Printable answer sheet (Feature 15 of 15)

- **Paper bubble sheet** — a "📝 Print answer sheet" button on the exam
  start screen, the demo card and every exam card in My exams builds a
  print view for a paper exam: exam title, blank Name / Date / Class
  fields, then one row per question — one bubble (○, lettered A–F) per
  answer option for multiple-choice and True/False questions, and lined
  write-in space for essay (4 lines), fill-in (1 line), coding
  (starter code + 4 lines), matching (left items with blanks, right
  partners lettered) and ordering (items to number). Reuses the
  existing hidden `#print-sheet` + `window.print()` approach, so it
  prints clean black-on-white even in dark mode, rows never split
  across pages, and it works in Arabic (RTL).
- 7 new i18n keys (English + Arabic); works in both languages and in
  dark mode, at 1280px and 390px.
- Verified with a headless-Chrome smoke test — 52 checks passed
  (45 in the main run + 7 follow-up checks confirming share-link
  decode and smart review after a quiz run).

## 2026-11-20 — Offline mode (PWA) (Feature 14 of 15)

- **Installable app** — a web app manifest (`manifest.json`, name
  QuizForge, beige `#F3EFE6` background / blue `#1668E8` theme, SVG
  icon) linked from the page, plus an **Install app** button in the
  header that appears only when the browser offers installation
  (`beforeinstallprompt`). The icon is SVG because the repo cannot
  take binary PNGs — Chrome accepts it for the manifest, though the
  install prompt's icon requirements vary by browser.
- **Service worker (`sw.js`)** — caches the whole app shell on
  install (index, app.js, i18n.js, style.css, questions.json,
  manifest, icon) so the app loads from cache with no connection.
  Versioned cache name (`quizforge-v1`): the new worker deletes
  older `quizforge-*` caches on activate. Same-origin GETs only —
  provider APIs and CDNs are never cached. Navigation falls back to
  the cached page when offline; shell assets are cache-first.
  Registration is best-effort and never crashes the app (skipped
  on `file://` or insecure contexts).
- **Honest offline UI** — a small bar under the header appears
  whenever the browser is offline, and every network feature says
  so plainly instead of failing silently: AI generation, summary,
  translation, essay grading and the connection test all show a
  clear "you are offline" message. Everything local — demo bank,
  saved exams, quiz, review, stats, flashcards, strict mode,
  print, share-link decode — keeps working offline. PDF and
  spreadsheet readers already reported CDN failure; they keep
  that behaviour.
- 4 new i18n keys (English + Arabic); works in both languages and
  in dark mode, at 1280px and 390px.
- Verified with a 45-check headless-Chrome smoke test — 45/45 passed
  (manifest loads with the right name/theme, service worker registers
  and caches all 8 shell files, app reloads from cache with the
  server stopped and the browser offline, offline bar shows live and
  in Arabic, demo quiz runs offline, seeded exam with cached summary
  + strict-mode run + offline essay grading with no invented grade,
  results, stats, smart review, flashcards, print, share link opening
  offline, translation / connection-test / generation all refuse
  offline with a clear message, Arabic RTL, 390px with no overflow,
  dark mode persisted across an offline reload, zero console errors).
  Old-cache cleanup is verified by code inspection (it runs when a
  new worker version activates, not on a plain reload).

## 2026-11-20 — Import from Google Sheets / Excel (Feature 13 of 15)

- **Spreadsheet import on step 1 of the wizard** — paste CSV text
  or upload a `.csv` / `.xlsx` file (also via the dropzone); each row
  becomes one question and the bank lands in My exams like a JSON
  import, with no AI key needed. One documented column format:
  `type | question | options | correct | explanation | topic`,
  shown in the UI with example rows. Supported row types are `mcq`
  (options separated by `;`, correct as a letter, a 1-based number
  or the exact option text), `tf` (`True` / `False`) and `fill`
  (`____` in the question, accepted answers in `correct`).
  `explanation` and `topic` are optional, and a sheet with one
  option per column is read the same way.
- **Honest per-row reporting** — the first row is detected and
  skipped as a header; every row is checked with the same `validate()`
  the JSON import uses, and bad rows are listed by row number with a
  plain reason (unknown type, too few options, correct answer not
  among the options, …). A file with zero valid rows shows a clear
  error and imports nothing. A proper quoted-field CSV parser
  handles commas and quotes inside cells, and tab-separated paste
  works too.
- **SheetJS loads lazily** — the `.xlsx` reader loads from cdnjs only
  when the first `.xlsx` file is added, the same pattern as pdf.js.
  If the CDN cannot be reached, a clear message is shown and CSV
  paste / `.csv` upload keep working. 26 new i18n keys (English +
  Arabic); works in both languages and in dark mode, at 1280px and
  390px.
- Verified with a 50-check headless-Chrome smoke test against a
  local mock provider — 50/50 passed (CSV paste with header + bad
  row, quoted fields, empty and all-bad files, real `.xlsx` upload
  including the expanded one-option-per-column layout, CDN-failure
  path, imported exam end to end, print, share link opening the
  exam, flashcards, strict mode, demo bank, mock generation, summary
  and translation, review session, stats, Arabic UI import, dark
  mode, 390px, zero console errors).
- One real bug found and fixed during verification: SheetJS pads
  every row to the sheet's widest row, which made normal 6-column
  rows look like expanded rows — trailing empty cells are now
  trimmed before the layout is decided.

## 2026-11-20 — One-tap exam translation (Feature 12 of 15)

- **"Translate exam" button on the start screen and the results
  screen** — one tap translates the whole exam's content between
  English and Arabic (direction detected from the exam itself),
  using the user's own AI provider and the same key as exam
  generation. Pressing it again switches back to the original,
  which is kept untouched and restored exactly.
- **What translates, and what never does** — question text, options,
  explanations, essay rubrics, matching pairs and ordering items are
  translated; code snippets, coding starter code, test inputs /
  expected outputs, fill-in accepted answers, topics and the exam
  title / subtitle are never sent to the provider. The answer key
  never moves (options keep their order), so grading is identical
  in either language, and a translated exam runs end to end —
  quiz, results, review, stats, print, share link and flashcards.
- **Atomic, and honest on failure** — the strings go to the
  provider in small batches; if any batch fails, or any translation
  comes back missing, nothing is applied and the original stays
  intact. With no key set, or if the provider fails, the student
  gets a clear message — no fake or half-translated exam.
- **Independent of the UI language** — translating the exam never
  changes the UI language and switching the UI language never
  re-translates the exam. 11 new i18n keys (English + Arabic);
  works in both languages and in dark mode, at 1280px and 390px.
  Small fix folded in: re-rendering the results screen (after a
  translation toggle or a UI-language switch) no longer records
  the attempt in stats a second time.
- Verified with a 46-check headless-Chrome smoke test against a
  local mock provider — 46/46 passed (no-key path with no fake
  translation, EN→AR translation with code / starter code / test
  values / numeric options unchanged, exact restore on toggle,
  full translated quiz end to end with results, review, stats
  recorded once, print, share link opening the translated exam,
  and flashcards, partial failure on the 2nd batch and a 500
  provider both leaving the original intact, essay rubric
  translated with fill-in answers unchanged on an extended bank,
  Arabic RTL run at 390px with no overflow, zero console errors
  in all runs).

## 2026-11-20 — Matching + ordering question types (Feature 11 of 15)

- **Two new question types in Step 3** — **Matching** (two columns to
  connect, `"pairs"` of `"left"`/`"right"`) and **Ordering** (a list of
  steps to put in order, `"items"` in the correct order). The
  generation prompt teaches the model both JSON shapes, and the
  validator rejects bad shapes (fewer than 2 pairs/items, empty or
  repeated values, unknown type) with a plain message.
- **In the quiz** — matching renders each left item with a dropdown of
  the shuffled right partners; ordering renders the items with ↑ / ↓
  buttons to move them (no drag-and-drop). The right column is
  shuffled when shuffle is on, otherwise rotated by one — never left
  in pairs order, where every partner would sit next to its own item.
- **Grading by fraction, shown honestly** — matching counts correct
  pairs, ordering counts items in the correct position ("2 of 3 pairs
  correct" / "2 of 3 in the right place"). A question counts as fully
  correct only when every pair matches / the whole order is right;
  partial credit is never rounded up to a pass. Timeouts keep whatever
  was picked / the order as it stands, graded the same way.
- **Results, review, stats, print, flashcards** — the results review
  shows your pairs / order next to the correct ones; a wrong (or
  partly right) matching/ordering question joins the smart-review
  queue and retry-wrong-only; it counts in the stats dashboard;
  flashcards show the correct pairs / order on the back; the print
  sheet lists matching left items numbered with right partners
  lettered (student writes a letter per number) and ordering steps to
  number, with both answers in the key. Strict mode, share links and
  the material summary all work with the new types.
- **Demo bank gains one matching and one ordering question** — pointer
  terms → meanings, and the steps to insert at a linked-list head —
  so the feature works with no API key. 27 new i18n keys (English +
  Arabic); works in both languages and in dark mode, at 1280px and
  390px.
- Verified with a 42-check headless-Chrome smoke test against a
  local mock provider — 42/42 passed (mock generation with a matching
  and an ordering question, full marks 5/5, partial matching 2/3 and
  partial ordering 1/3 with the correct partner/order shown, wrong
  matching/ordering questions in the smart-review queue and mastered
  after two review passes, flashcards show the correct pairs, print
  sheet with pairs + steps, share link opens the exam, strict mode
  auto-submits at zero, stats recorded, Arabic RTL run 13/13 on the
  demo bank, mobile 390px with no horizontal overflow, zero console
  errors in all runs).

## 2026-11-20 — Coding questions with a runnable code editor (Feature 10 of 15)

- **New "coding" question type (JavaScript only)** — Step 3 offers a
  "Coding" checkbox; the generator is told to write JavaScript tasks
  with `"language": "JavaScript"`, `"starterCode"`, and `"tests"` (each
  with `"input"`, a JS expression calling the student's function, and
  `"expected"`, the exact result as a string). Any other language is
  rejected on import/generation — the app never claims a language runs
  when it does not.
- **Runnable editor in the quiz** — a monospace editor prefilled with
  the starter code, a "Run tests" button (check without submitting)
  and a "Submit code" button. Each test shows pass/fail with input,
  expected, and actual output (or the error). Grading is by the
  fraction of tests passed; a question counts as correct only when
  every test passes.
- **Sandboxed execution with a timeout** — student code runs in a Web
  Worker (no DOM, no access to the page or QuizForge's own state) and
  is killed after 3 seconds, so an infinite loop reports a timeout
  instead of hanging the page. If Workers cannot start, the same
  runner falls back to the main thread and the app warns the student.
- **Results, review, stats, print, flashcards** — the results review
  shows the student's code, per-test results, and test score; a failed
  coding question joins the smart-review queue; it counts in the stats
  dashboard; flashcards show its tests on the back; the printout shows
  the starter code and tests, with the tests in the answer key.
- **Demo bank gains one coding question** — "Write sum(a, b)" with 3
  tests, so the feature works with no API key. 27 new i18n keys
  (English + Arabic); works in both languages and in dark mode, at
  1280px and 390px.
- Verified with a 38-check headless-Chrome smoke test against a
  local mock provider — 38/38 passed (mock generation with a coding
  question, correct code 2/2 tests and 3/3 full marks, wrong code 0/2
  and 2/3, infinite loop killed by the 3-second timeout with the page
  still responsive, failed coding question in the smart-review queue,
  stats recorded, flashcards show the tests, print sheet with starter
  code + tests, share link opens the exam, strict mode starts, summary
  still works, Arabic RTL run 11/11 on the demo bank, mobile 390px
  with no horizontal overflow, zero console errors in all runs).

## 2026-11-20 — Material summary (Feature 9 of 15)

- **"Summarize material" on step 1** — after uploading or pasting
  material, one button asks your AI provider (the same key as exam
  generation) for the material's key points plus definitions of its
  important terms, and shows them on their own summary screen before
  the exam is generated. Continue from there goes to exam settings.
- **Same chunking as exam generation** — long material is summarized
  in 12,000-character chunks (verified: a ~15,500-character material
  made 2 provider calls) and repeated points and terms are merged
  (up to 12 key points, 20 definitions).
- **Saved with the exam** — the summary is stored on the generated
  bank in the library, and the exam start screen shows a "View
  summary" button only when a summary exists, so it can be re-read
  later. It is stripped from share links so shared URLs stay under
  the size limit.
- **No key, no fake summary** — with no API key set, or if the
  provider call fails, a clear message is shown and nothing is
  saved. Changing the material after summarizing drops the summary,
  so it can never describe material it was not made from.
- **23 new i18n keys** (English + Arabic) for every new string; works
  in both languages (including a language switch on the summary
  screen) and in dark mode, at 1280px and 390px.
- Verified with a 17-check headless-Chrome smoke test against a
  local mock provider — 17/17 passed (button disabled with no
  material, no-key message with no invented content, key points +
  definitions render, continue to settings, step-4 summary row,
  summary stored with the exam and re-readable from the start
  screen, full 4-question quiz run with essay + fill-in AI grading,
  print, share link, smart review, stats, flashcards and strict
  mode auto-submit all still working, both languages, mobile width,
  zero console errors).

## 2026-11-20 — Strict exam mode (Feature 8 of 15)

- **Strict exam mode toggle on the exam start screen** — off by
  default, per exam. When on, the exam runs under real exam rules:
  full screen is requested (if the browser denies it the mode still
  applies), one fixed countdown runs for the whole exam, and
  navigation is forward-only — no back button, no question list to
  jump back to, no way to revisit a previous question.
- **Fixed total countdown** — the total is the per-question time from
  Settings multiplied by the number of questions (60 seconds per
  question when the per-question timer is off, so 10:00 for the demo
  bank). It replaces the elapsed timer with a countdown chip that
  turns red in the last minute. At zero the exam auto-submits with
  whatever is answered; unanswered questions count as wrong, and
  typed-but-unsubmitted text on the current question is kept (like a
  per-question timeout) instead of being thrown away.
- **Humane fullscreen rule** — leaving full screen mid-exam shows
  one clear warning and never auto-fails; the exam continues. Leaving
  the exam (or reaching results) exits full screen.
- **Results say so** — the results screen notes the exam was taken
  in strict mode, and the attempt is marked `strict: true` in the
  stats history (`qf-stats`). Re-taking from the results screen
  starts a normal run unless strict is re-enabled; review sessions
  are never strict.
- **Works for every question type** — MCQ, essay and fill-in all play
  under strict rules (an essay still being graded at zero is marked
  wrong, never given an invented grade), and the normal quiz flow is
  untouched.
- **9 new i18n keys** (English + Arabic) for every new string; works
  in both languages (including a language switch) and in dark mode,
  at 1280px and 390px.
- Verified with a 38-check headless-Chrome smoke test — 38/38 passed
  (toggle default, countdown ticks and auto-submits at zero, forward-only
  navigation, fullscreen requested and mode survives denial, one
  fullscreen-exit warning only, results note + strict stats flag,
  mixed MCQ+essay+fill-in bank auto-submits 0/3, normal quiz run 8/10
  with print, share link, smart review, stats and flashcards all
  still working, both languages, mobile width, zero console errors).

## 2026-11-20 — Flashcards for quick revision (Feature 7 of 15)

- **Flashcards mode for any exam** — a **🃏 Flashcards** button on every
  exam card in My exams, the exam start screen, and the results screen
  (including the demo bank — no API key needed). Each card shows the
  question on the front; flipping reveals the correct answer and
  explanation on the back. Essay questions show the rubric and max
  score on the back; fill-in questions show the accepted answers.
  Cards are built from the exam's own questions — no provider calls.
- **Navigation** — Previous/Next buttons, a "Card 3 of 10" counter,
  a Shuffle toggle (reshuffles the deck and restarts at card 1), and
  keyboard support: arrow keys move (they follow the page direction,
  so ← moves forward in Arabic RTL), Space or Enter flips. Tapping or
  clicking the card flips it. The flip is a CSS 3D rotateY, so it
  works identically in LTR and RTL.
- **18 new i18n keys** (English + Arabic) for every new string; works
  in both languages (including a language switch mid-deck, which keeps
  your place) and in dark mode, at 1280px and 390px.
- Verified with a 46-check headless-Chrome smoke test — 46/46 passed
  (flip content matches the bank, shuffle covers the full deck, essay
  + fill-in backs, keyboard in both directions, no key set, dark mode,
  both languages, mobile width, zero console errors) — plus a full
  quiz run (8/10), print sheet, share link, smart review and stats
  all still working.

## 2026-11-20 — Essay + fill-in-the-blank with AI grading (Feature 6 of 15)

- **Two new question types in Step 3** — **Essay** (free text, graded
  by the AI against a short rubric, max score 5 by default) and
  **Fill in the blank** (one sentence with a `____` blank, checked
  locally against a list of accepted answers, case-insensitive,
  trimmed). The generation prompt teaches the model both JSON shapes
  (essay: `rubric` + `maxScore`, no options; fill: `answers` array,
  no options), and the validator rejects bad shapes with a plain
  message (missing rubric, missing answers, blank without `____`,
  unknown type, bad maxScore).
- **Mixed exams** — MCQ, True/False, essay and fill-in play together
  in one exam. Essays render a textarea, fill-ins a text input
  (Enter submits); both submit with a button. Fill-in grading is
  local and immediate; essay grading makes one extra provider call
  with the question + rubric + student answer and returns a score
  out of the max plus 1–2 sentences of feedback, shown with a clear
  "Grading your answer…" state while it runs. With no key set, or if
  grading fails, the app says so plainly and shows the rubric
  instead of inventing a grade. An essay counts as correct at 60%
  of its max score.
- **Results, review, retry, stats and print all handle the new
  types** — the results screen shows the student's essay/fill-in
  answers, the essay score + grader feedback, or the rubric when
  ungraded (with a "Not graded" chip); wrong fill-ins and
  not-passed essays join the smart-review queue and retry-wrong-only
  (essays are re-graded on each retry); stats count them like any
  other question; the print sheet gives essays blank writing lines
  with the rubric and max score in the key, and fill-ins their
  accepted answers in the key.
- **32 new i18n keys** (English + Arabic) for every new string;
  works in both languages (including RTL) and in dark mode. The
  demo bank is unchanged (still 10 MCQ), so older banks and the
  earlier features keep working untouched.

## 2026-11-20 — Stats dashboard (Feature 5 of 15)

- **Attempt history** — every completed quiz attempt is recorded in
  localStorage (`qf-stats`): exam title, date, score, and per-question
  results with topic and time spent per question (measured from when
  the question is shown until the answer is picked). Only the newest
  **50 attempts** are kept, so storage never grows without limit.
  Review sessions are not recorded.
- **📊 Stats tab** in the main navigation (plus a "📊 View stats"
  button on the results screen) — overall totals (exams taken,
  questions answered, average score, average time per question),
  per-topic accuracy bars with correct/total, % and average time,
  strongest / needs-work topics called out, and the last 8 attempts
  with date, exam, and score.
- **Robust by design** — a friendly empty state with no attempts yet,
  and corrupt or older-shaped stored data is filtered out safely
  (falls back to empty) instead of breaking the dashboard. A
  "Clear history" button (with confirmation) wipes the history.
- **21 new i18n keys** (English + Arabic) for every stats string; the
  dashboard works in both languages (including RTL) and in dark mode.

## 2026-11-20 — Smart review of mistakes (Feature 4 of 15)

- **Persistent review queue** — after any quiz, the questions answered
  wrong go into a review queue saved in localStorage, keyed per exam
  (a hash of the whole bank) and per question (a hash of the question
  text + options), so different exams never mix and the queue survives
  reloads. Retrying wrong answers re-adds any still-wrong ones.
- **Spaced repetition** — a question leaves the queue only after
  **2 consecutive correct answers** in review sessions; a wrong answer
  (or a per-question timeout) resets its streak to zero. The streak
  ("1 of 2 correct in a row") is shown as a chip on every review
  question and again under the explanation after each answer, with a
  clear "Mastered" line when the question drops out.
- **"🧠 Review mistakes" entry points** — on the results screen, the
  exam start screen, and every exam card in My exams (including the
  demo bank), shown only while that exam has queued questions, with
  the count in the label. A finished review session reports how many
  were mastered and how many are left, with "Keep reviewing" to run
  another pass and a "Clear review queue" option.
- **Reviewing is side-effect free** — it never changes the exam library
  or the best score, and review sessions run in bank order (no shuffle)
  so the streaks stay easy to follow.
- **21 new i18n keys** (English + Arabic) for every review string.

## 2026-11-20 — Share via link (Feature 3 of 15)

- **"🔗 Share via link" button** on every exam card in My exams
  (including the demo bank), on the exam start screen, and on the
  results screen — builds a shareable URL and copies it to the
  clipboard, with a "Link copied" toast confirmation. If the clipboard
  is unavailable, the link is shown in a text field to copy by hand.
- **Exam in the URL hash** — the whole exam is encoded as
  `#exam=<payload>` (compact JSON, deflate-compressed when the browser
  supports it, plain base64url otherwise), so no server is needed and
  the link works from static hosting. Opening the link loads the exam
  straight into the quiz engine with a "shared exam" note — even with
  empty localStorage, no files and no key — and the recipient can save
  it to My exams.
- **Too-large guard** — links over ~8 KB are refused with a clear
  warning showing the size (and a pointer to Export JSON) instead of
  a broken link. A damaged or incomplete share link shows a friendly
  error instead of a blank page.
- **11 new i18n keys** (English + Arabic) for every share string.

## 2026-11-20 — Print / PDF export (Feature 2 of 15)

- **"🖨 Print exam" button** on the exam start screen, the results
  screen, and every exam card in My exams (including the demo bank) —
  prints the current exam via the browser's print dialog, so it can
  also be saved as a PDF.
- **Print sheet** — all questions with their options (A–F), followed
  by an answer key on the last page with the correct answer and the
  "Why" explanation for each question.
- **Print stylesheet** (`@media print`) — hides the app chrome
  (header, nav, buttons, toggles), forces black-on-white even in dark
  mode, keeps each question from splitting across pages where
  possible, and starts the answer key on a fresh page.
- **RTL printing** — the sheet follows the page direction, so Arabic
  printouts lay out right-to-left; code blocks stay left-to-right.
- **6 new i18n keys** (English + Arabic) for every print string.

## 2026-11-20 — Arabic UI, part 2 (complete)

- **Full Arabic coverage** — every remaining screen now goes through
  `t()`: wizard steps 3–4 (settings, generate + summary), the exam
  library, the quiz start screen, the quiz run (counter, verdicts,
  progress), the results + review, and all error messages (provider
  errors, bad AI replies, file/PDF errors, bank validation).
- **Language switch mid-quiz** — switching language during a run
  re-renders the question screen from the attempt state; the
  per-question countdown is preserved, not reset.
- **Dictionary grew to ~200 keys** — new keys for the generate summary,
  generated-bank subtitles, validation errors, timeouts and empty
  replies. Stored values (difficulty, exam language) stay English
  internally and are only localised for display.
- **RTL polish** — kickers no longer letter-spaced or uppercased in
  Arabic (letter-spacing breaks Arabic joining); progress bar, step
  indicator, timers and buttons verified to flip correctly at 1280px
  and 390px.

## 2026-11-20 — Arabic UI, part 1

- **Language toggle (🌐 عربي / English)** in the header, saved on the
  device. Arabic switches the whole interface to RTL (`dir="rtl"`,
  logical CSS properties, code blocks kept LTR).
- **New `i18n.js`** — one 173-key dictionary (English + Arabic) with a
  `t()` helper, token replacement (`{name}`) and English fallback, so a
  missing translation never breaks the UI. The dictionary already
  covers steps 3–4, the library, the quiz and the results; part 1
  converts the header, the settings panel and wizard steps 1–2.
- Static chrome (brand, nav, footer, settings panel) translates via
  `data-i18n` attributes; the dark-mode label translates too.

## 2026-11-20 — Fix: Gemini default model

- **Gemini default is now `gemini-3.5-flash-lite`** — Google retires
  `gemini-2.5-flash` on 2026-12-01 and serves it only to projects that
  already used it, so a brand-new API key cannot call the old default.
  Requests to the old model would have auto-rerouted from Dec 1, but
  the new-key block hits first, so the default had to move now.

## 2026-11-20 — Radical rebuild: AI exam generator (QuizForge)

- **New name, new vision: QuizForge** — "Turn any material into
  exams". The tool is no longer CS-only: any person, any subject can
  upload their material, bring their own API key, and get an exam.
  The GitHub repo name/slug is unchanged.
- **4-step wizard (Create exam)** — 1) Upload material: drag-and-drop
  + file picker for PDF / text / `.json` banks, plus paste-text; files
  merge into one material with name/size, total characters and PDF page
  count. 2) Your AI key (BYO). 3) Exam settings. 4) Generate.
- **PDF reading** — pdf.js 3.11.174 from cdnjs, loaded lazily only when
  a PDF is added. Plain text extraction, no OCR. If the CDN cannot be
  reached, a clear message tells the user to paste the text instead and
  the rest of the app keeps working offline.
- **Bring your own key** — Gemini, OpenAI, Claude, and Custom
  (OpenAI-compatible) providers. The key lives only in the user's own
  localStorage, is never logged, and is shown masked (last 4 chars
  only). "Test connection" sends one tiny request and reports success
  or the provider's exact error in plain words.
- **Model IDs verified 2026-11-20** — Gemini `gemini-2.5-flash`
  (GA, stable); OpenAI `gpt-4o-mini` (works until its January 2027
  retirement); Claude `claude-sonnet-5-5` — `claude-sonnet-4-5` is
  retired by Anthropic on 2026-11-30, so it is deliberately NOT the
  default. Every model field is editable.
- **Claude CORS note** — Claude's API blocks direct browser calls, so
  a CORS-proxy URL field is offered and the app explains plainly that
  a proxy is needed before any call is made.
- **Exam settings** — title/subject, 5–50 questions, MCQ (4 options)
  and True/False (2 options), difficulty Easy/Medium/Hard/Mixed,
  language English/Arabic, focus notes, per-question timer toggle.
- **Generation** — strict JSON-only prompt in the app's question
  schema, markdown fences stripped, strict validation with a plain
  error + Retry button on bad JSON. Long material splits into
  ~12,000-character chunks on paragraph boundaries, generates
  proportionally per chunk in sequence ("Generating part 2 of 3…"),
  then merges, dedupes by question text and shuffles. API errors
  (bad key, quota, timeout, network) are shown in plain words.
- **My exams library** — generated exams saved in localStorage with
  title, date, count, provider/model; Take / Export JSON / Delete,
  plus Import JSON with the same validator. The built-in sample bank
  stays as a "Try the demo — no key needed" card.
- **Code split** — the JavaScript moved out of `index.html` into
  `app.js` (still no build step). The quiz engine is unchanged in
  behaviour and now takes any bank object; it also shows a question's
  difficulty tag when present.
- **Verified with a 37-check headless-Chrome smoke test** — demo bank
  with no key, PDF upload + text extraction (1-page photosynthesis
  PDF), end-to-end generation against a local mock provider (Custom +
  Gemini shapes), full quiz run + results, 401 and malformed-JSON
  error paths, chunking (30k chars → 3 parts → 9 questions), True/False
  generation, library save/re-open, invalid import, Claude-without-proxy
  message, dark mode, mobile 390px no-overflow — 37/37 passed.
- **New screenshots** — real screenshots of the new flow
  (`upload.png`, `key.png`, `settings.png`, `library.png`,
  `mobile-upload.png`). The older quiz-screen screenshots remain in
  `docs/screenshots/` but are no longer referenced in the README.

## 2026-11-20 — GUI redesign: polished app interface + styled repo

- **New interface, same beige identity** — the app now looks like a real
  product in Bassem's style: beige #F3EFE6 background, white cards with
  dark borders and hard offset shadows, blue #1668E8 accent. Styling moved
  to a separate `style.css`; still zero dependencies.
- **App header** — logo mark, quiz title, a Settings button and the
  dark-mode toggle, always visible.
- **Start screen as a dashboard** — stat chips (questions, topics, best
  score), topic cards you tap to start that topic right away, a big Start
  button, and a "How it works" strip.
- **Settings live in the header** — shuffle and the per-question countdown
  moved into a dropdown panel (openable from the header or the start
  screen), with a live summary line on the start screen.
- **Quiz screen** — one top bar with the counter, progress bar and timers;
  code blocks in a beige panel; answer options as large tappable cards
  with hover, selected, correct and wrong states.
- **Results screen** — score ring with percentage, time taken, best-score
  line, and a per-question review with ✓/✗/⏰ status chips.
- **Dark mode redesigned** — a dark version of the same beige/blue
  identity, readable contrast, choice still remembered.
- **Micro-interactions** — cards and buttons lift on hover and press in on
  click; visible keyboard focus outlines; respects reduced-motion settings.
- **Responsive** — verified clean at 1280px desktop and 390px phone
  widths, no horizontal overflow.
- **Repo styling** — badges, screenshots, and a project-structure section
  in the README; real screenshots under `docs/screenshots/`.
- Verified with a 33-check headless-Chrome smoke test (start, quiz,
  results, retry-wrong, dark mode, custom banks, per-question timeout,
  mobile) — 33/33 passed.

## 2026-11-20 — Day 1: timer, shuffle, review, topics, dark mode, custom banks

- **Timer** — total elapsed timer on every attempt, plus an optional
  per-question countdown (off by default, 5–600 seconds configurable).
  A timed-out question is marked wrong and the correct answer is shown.
- **Shuffle** — new toggle (on by default) shuffles both the question order
  and the answer options; the correct answer is carried along with its
  option, so shuffling can never break the answer key.
- **Results screen** — score, percentage, and finish time, plus a full
  per-question review (your answer vs the correct answer, with the
  explanation). New **Retry wrong answers only** mode re-quizzes just the
  missed questions; retry runs don't overwrite the best score.
- **Explanations verified** — all 10 sample explanations re-checked: the
  seven code-output ones by compiling and running the snippets with g++,
  the rest by inspection (two are undefined behaviour by definition).
- **Topic filter** — every question now has a `topic` (Pointers / Linked
  List) and the start screen has filter chips with per-topic counts.
- **Progress bar + question counter** — "Question 3 of 10" and an
  answered/score progress bar on every question.
- **Best score** — saved in localStorage per question bank and shown on the
  start screen and the results screen.
- **Dark mode** — header toggle, persisted in localStorage.
- **Keyboard shortcuts** — keys `1`–`4` pick an answer, `Enter` moves next.
- **Custom question banks** — load any `.json` file in the same format from
  the start screen; invalid files show a clear error, and the sample bank
  can be restored with one click.
- **Flow change** — the quiz is now one question at a time (was: all
  questions on one long page), which is what makes the per-question timer
  and the counter meaningful.

## 2026-11-19 — Initial release

- Dependency-free interactive quiz: one `index.html` + `questions.json`.
- 10 verified multiple-choice questions on C pointers and linked lists
  (CS.212 Data Structures), each with an explanation.
- Instant right/wrong feedback, final score card, "Try again" and
  "Shuffle & try again" buttons.
- README with the question-bank JSON format and GitHub Pages deploy steps.
- MIT license.
