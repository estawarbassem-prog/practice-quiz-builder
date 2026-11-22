# QuizForge — Turn any material into exams

[![License: MIT](https://img.shields.io/badge/License-MIT-1668E8.svg)](LICENSE)
![No dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)
![No build step](https://img.shields.io/badge/build-none-brightgreen)
![Bring your own key](https://img.shields.io/badge/API_key-bring_your_own-1668E8)

Upload PDFs, past exams, slides or notes, add **your own** AI key, and get a ready-to-take exam in seconds. Any subject, any person. No account, no server, no build step — a static site that runs entirely in your browser. The built-in demo bank (16 verified C pointers / linked-list questions) plays with no key at all.

## Screenshots

### Create an exam

| Upload material | Your AI key | Exam settings |
|---|---|---|
| ![Upload material](docs/screenshots/upload.png) | ![Your AI key](docs/screenshots/key.png) | ![Exam settings](docs/screenshots/settings.png) |

| Generate | Material summary | From a link | In the library |
|---|---|---|---|
| ![Generate the exam](docs/screenshots/wizard-step4.png) | ![Material summary](docs/screenshots/summary.png) | ![Generate from a link](docs/screenshots/url-en.png) | ![Source link on the library card](docs/screenshots/url-library.png) |

### Take the exam

| Start screen | A question | Essay + fill-in | Coding |
|---|---|---|---|
| ![Exam start screen](docs/screenshots/start.png) | ![A question](docs/screenshots/question.png) | ![Essay and fill-in questions](docs/screenshots/essay.png) | ![Coding question](docs/screenshots/coding.png) |

| Matching + ordering | True/False | Strict mode | Oral exam |
|---|---|---|---|
| ![Matching and ordering questions](docs/screenshots/matching.png) | ![True/False with justification](docs/screenshots/tf-en.png) | ![Strict exam mode](docs/screenshots/strict.png) | ![Oral exam by voice](docs/screenshots/oral-en.png) |

### Learn from it

| Results | Smart review | Stats | Flashcards |
|---|---|---|---|
| ![Results](docs/screenshots/results.png) | ![Smart review of mistakes](docs/screenshots/review.png) | ![Stats dashboard](docs/screenshots/stats.png) | ![Flashcards](docs/screenshots/flashcards.png) |

| Cheat sheet | Chat with the material | Past-exam analysis |
|---|---|---|
| ![Cheat sheet from mistakes](docs/screenshots/cheat-en.png) | ![Chat with the material](docs/screenshots/chat-en.png) | ![Past-exam analysis](docs/screenshots/past-en.png) |

### Share, print & reuse

| Share via link | Translate the exam | Library backup |
|---|---|---|
| ![Share via link](docs/screenshots/share.png) | ![Translate the exam](docs/screenshots/translate.png) | ![Library backup](docs/screenshots/backup.png) |

| My exams | Offline bar | Dark mode |
|---|---|---|
| ![My exams library](docs/screenshots/library.png) | ![Offline bar](docs/screenshots/offline.png) | ![Dark mode](docs/screenshots/dark.png) |

### The full interface in Arabic

| Start (Arabic) | Quiz (Arabic) | Results (Arabic) |
|---|---|---|
| ![Start in Arabic](docs/screenshots/ar-start.png) | ![Quiz in Arabic](docs/screenshots/ar-quiz.png) | ![Results in Arabic](docs/screenshots/ar-results.png) |

| True/False (Arabic) | Chat (Arabic) | Cheat sheet (Arabic) |
|---|---|---|
| ![True/False in Arabic](docs/screenshots/tf-ar.png) | ![Chat in Arabic](docs/screenshots/chat-ar.png) | ![Cheat sheet in Arabic](docs/screenshots/cheat-ar.png) |

| Oral exam (Arabic) | Past exams (Arabic) | From a link (Arabic) |
|---|---|---|
| ![Oral exam in Arabic](docs/screenshots/oral-ar.png) | ![Past-exam analysis in Arabic](docs/screenshots/past-ar.png) | ![Generate from a link in Arabic](docs/screenshots/url-ar.png) |

### On your phone (390px)

| Start | Upload | A question | Results |
|---|---|---|---|
| ![Mobile start](docs/screenshots/mobile-start.png) | ![Mobile upload](docs/screenshots/mobile-upload.png) | ![Mobile question](docs/screenshots/mobile-question.png) | ![Mobile results](docs/screenshots/mobile-results.png) |

## Features

**Generate**
- Any material in: PDF, Word, PowerPoint, text, JSON bank, pasted text — or a link.
- Your key, your credits: Gemini, OpenAI, Claude, or any OpenAI-compatible endpoint. The key stays on your device.
- Exam settings: 5–50 questions, 7 question types, difficulty, language, focus notes, per-question timer.
- Material summary: key points + definitions before you generate.
- Past-exam analysis: topics ranked by how often they repeat across years — generate from the most-repeated.
- Fresh variant: a genuinely different exam from the same material, one tap.

**Take the exam**
- One question at a time, shuffle, instant feedback with explanations, best score, dark mode, keyboard shortcuts.
- 7 question types: multiple-choice, true/false with justification, essay, fill-in, coding (JavaScript only), matching, ordering.
- Honest grading: AI-graded essays against a rubric (never an invented grade); fill-ins checked locally.
- Coding: runnable JS editor with tests, sandboxed, 3-second timeout.
- Strict mode: fullscreen, whole-exam countdown, forward-only.
- Oral exam: answer by voice — spoken letters, numbers and ordinals matched locally.
- Read aloud (TTS): device speech, no network, no key.

**Learn from it**
- Smart review: missed questions return until you get them right twice in a row.
- Cheat sheet: one page built from your mistakes, stored with the attempt.
- Stats: per-topic accuracy, last 8 attempts, newest 50 kept.
- Flashcards: built from any exam's questions, no provider calls.
- Chat with the material: answers grounded in your material, with short quotes.

**Share, print & reuse**
- Share via link: the whole exam packed into the URL — no server.
- Print / PDF: exam + answer key, clean black-on-white.
- Answer sheet: a printable bubble sheet for the exam room.
- Translate: the whole exam EN ⇄ AR, original kept untouched.
- Sheets / Excel import: CSV/XLSX rows become questions.
- Library backup: export/import the whole library as one JSON file.
- Arabic UI: full RTL interface, one toggle in the header.
- Offline (PWA): works with no connection once opened; installable.

## How it works

1. **Upload material** — PDF, Word, PowerPoint, text, a JSON bank, pasted text, or a link.
2. **Your AI key** — pick a provider, paste your key, pick a model, press **Test connection**.
3. **Exam settings** — questions, types, difficulty, language, focus notes.
4. **Generate** — questions are generated per chunk, merged, de-duplicated and shuffled, then saved to **My exams**.

## Providers

| Provider | Default model |
|---|---|
| Google Gemini | `gemini-3.5-flash-lite` |
| OpenAI (ChatGPT) | `gpt-4o-mini` |
| Anthropic Claude | `claude-sonnet-5-5` |
| Custom (OpenAI-compatible) | `gpt-4o-mini` |

Model IDs are editable — if a provider retires one, type the new ID. Claude needs a CORS proxy (its API blocks direct browser calls); Gemini, OpenAI and custom endpoints work directly.

## Privacy

Your key never leaves your browser except to the provider you choose. Stored only on your machine, never shown in full — only the last 4 characters. No account, no analytics, no server.

## Run it / Deploy

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Or press **Take the demo exam** in **My exams** — no key needed.

Free on GitHub Pages: push this folder to a public repo → **Settings → Pages** → **Deploy from a branch**, branch `main`, folder `/ (root)`.

## Question-bank format

Generated and imported exams use one JSON format — see [docs/question-bank-format.md](docs/question-bank-format.md) for the full spec with examples.

## Project structure

```
index.html            — app shell
app.js                — wizard, providers, generation, library, quiz engine
i18n.js               — English + Arabic strings (600+ keys)
style.css             — styling: beige identity, dark mode, responsive
questions.json        — demo bank (16 C pointers / linked-list questions)
sw.js                 — service worker (quizforge-v4)
docs/screenshots/     — real screenshots of the app
CHANGELOG.md          — what changed in each update
LICENSE               — MIT
```

## Contributing

Pull requests welcome. New questions should match the sample bank's bar: every answer checked, four options for MCQ, a `topic`, and a real explanation. See [CHANGELOG.md](CHANGELOG.md) for the history.

## License

MIT — see [LICENSE](LICENSE).

---

<div dir="rtl" lang="ar">

## العربية

**QuizForge** يحوّل أي مادة دراسية إلى امتحان: ارفع ملفات PDF أو امتحانات سابقة أو شرائح أو ملخصات، ضع **مفتاح الـ API الخاص بك**، واحصل على اختبار جاهز في ثوانٍ. بلا حساب، بلا خادم. الواجهة عربية بالكامل بمفتاح واحد في الرأس، والامتحان نفسه يمكن توليده أو ترجمته بالعربية. الصور أعلاه توضح كل شاشة وكل اختيار.

</div>
