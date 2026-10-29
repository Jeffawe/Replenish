# Questions

The app asks short, optional questions about products so its estimates get better: whether to track a product a receipt created, how much is left, how long one lasts, how much is usually left when restocking, and a second look at a stock count that looked like a typo. Answers go into the same places the estimate already reads, so `src/core/predict.ts` knows nothing about questions.

## The boundary

| Door | Who uses it | What it gives |
|---|---|---|
| [`index.ts`](index.ts) (server) | `src/app/questions/` (server actions and the loader) | `getQuestions`, `answerQuestion`, `undoAnswer`, `snoozeQuestion`, `summarize` |
| [`client.ts`](client.ts) (browser) | the question cards | the `Question`, `Answer` and `Undo` shapes only |

ESLint fails if code outside this folder imports anything deeper. Only `index.ts` touches the database, through inventory (`inventory/checks.ts` and `inventory/service.ts`).

## How it works

Questions are **never stored**. Each time, [`rules.ts`](rules.ts) looks at every product's facts (its estimate, its answers, when it was last counted) and picks the ones worth asking. A question disappears the moment the data answers it, and products we know well get none. The only things stored are the answers themselves and "Not now" (`question_snoozes`).

| File | Job |
|---|---|
| [`types.ts`](types.ts) | `ProductFacts`, `Question`, `Answer`, `Change` |
| [`config.ts`](config.ts) | Every number: confidence bars, how recent a count must be, snooze length, the answer choices, the check-in size and frequency |
| [`kinds.ts`](kinds.ts) | One entry per kind of question: when it applies, how it is asked, whether it is important, and what each answer changes |
| [`rules.ts`](rules.ts) | Picks and ranks the questions; turns an answer into a `Change` |
| [`index.ts`](index.ts) | Loads the facts, writes the change, offers an undo, double-checks a surprising number |

An answer the user gets wrong is expected. A typed stock count far above normal gets an "are you sure?" (`src/core/plausibility.ts`), every answer can be undone, and the estimate itself treats a count far from its guess as disputed (less trusted, and asked about again).

## Adding a kind of question

Add an entry to `KINDS` in `kinds.ts` (and its name to `QuestionKind` and the action's `Kind` list), with a test in `rules.test.ts`.
