# Question-bank format

Generated and imported exams use the same JSON format.

```json
{
  "title": "My Quiz",
  "subtitle": "A short line shown under the title",
  "questions": [
    {
      "question": "What is 2 + 2?",
      "code": "optional code snippet shown above the options",
      "topic": "Arithmetic",
      "difficulty": "Easy",
      "options": ["3", "4", "5", "6"],
      "answer": 1,
      "explanation": "2 + 2 is 4. A short reason is more useful than just the letter."
    }
  ]
}
```

Rules: `options` needs at least 2 entries (4 for multiple choice, 2 — `"True"` / `"False"` — for True/False), and `answer` is the **0-based** index of the correct option (so `1` means the second option). `code`, `topic`, `difficulty` and `explanation` are optional — but `explanation` is the part that actually teaches, and `topic` powers the topic cards. Questions with no `"type"` are treated as multiple choice (or True/False when they have exactly 2 options), so older banks keep working unchanged.

## Essay and fill-in

Set `"type"` on the question:

```json
{
  "question": "Explain in two or three sentences why photosynthesis matters for life on Earth.",
  "type": "essay",
  "rubric": "Mentions that photosynthesis produces oxygen and glucose; links both to life on Earth.",
  "maxScore": 5,
  "topic": "Photosynthesis",
  "difficulty": "Medium",
  "explanation": "Photosynthesis is the base of nearly every food chain and the source of the oxygen we breathe."
},
{
  "question": "Photosynthesis takes place in the ____ of the plant cell.",
  "type": "fill",
  "answers": ["chloroplast", "chloroplasts"],
  "topic": "Photosynthesis",
  "difficulty": "Easy",
  "explanation": "Chloroplasts hold the chlorophyll that captures light energy."
}
```

Rules: an essay needs a `"rubric"` (short grading text) and takes an optional `"maxScore"` (1–100, default 5); it is graded by the AI and counts as correct at 60% of its max. A fill-in-the-blank needs an `"answers"` array with at least one accepted answer and exactly one blank written as `____` in the question text; it is checked locally, case-insensitively. Neither shape has `"options"` or `"answer"`.

## Coding (JavaScript only)

```json
{
  "question": "Write a function sum(a, b) that returns the sum of its two numbers.",
  "type": "coding",
  "language": "JavaScript",
  "starterCode": "function sum(a, b) {\n  // write your code here\n}",
  "tests": [
    { "input": "sum(2, 3)", "expected": "5" },
    { "input": "sum(-1, 1)", "expected": "0" }
  ],
  "topic": "Functions",
  "difficulty": "Easy",
  "explanation": "The function must return a + b for any two numbers."
}
```

Rules: `"language"` must be `"JavaScript"` (any other language is rejected — it cannot run in the browser). `"starterCode"` is the code the student starts from, and `"tests"` is an array of 1 or more tests, each with `"input"` — a JavaScript expression that calls the student's function — and `"expected"` — the exact result as a string. The student's code runs in a Web Worker against those tests (3-second timeout); a question counts as correct only when every test passes.

## Matching and ordering

A matching question has `"type": "matching"` and a `"pairs"` array of 2 or more objects, each with `"left"` and `"right"` (the right value is the correct partner for that left value); every left and right value must be unique. An ordering question has `"type": "ordering"` and an `"items"` array of 2 or more unique strings in the **correct** order. Neither shape has `"options"` or `"answer"`.

```json
{
  "question": "Match each pointer term with its correct meaning.",
  "type": "matching",
  "pairs": [
    { "left": "int *p", "right": "A pointer that holds the address of an int" },
    { "left": "&x", "right": "The address of x" },
    { "left": "*p", "right": "The value stored at the address p points to" }
  ],
  "topic": "Pointers",
  "difficulty": "Easy",
  "explanation": "The * in a declaration makes p a pointer, & takes an address, and * follows the pointer to its value."
}
```
