# Changelog

All notable changes to QuizForge, newest first.
The tool is improved in small daily batches — one focused set of features
per day, each verified before it ships.

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
