# Changelog

All notable changes to QuizForge, newest first.
The tool is improved in small daily batches — one focused set of features
per day, each verified before it ships.

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
