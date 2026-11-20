# Changelog

All notable changes to Practice Quiz Builder, newest first.
The tool is improved in small daily batches — one focused set of features
per day, each verified before it ships.

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
