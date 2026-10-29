# Ingestion

Turns something (a receipt photo, an email) into a **purchase batch** and hands it to inventory to store. Start here; the full design is in [docs/ingestion.md](../../../docs/ingestion.md).

## The boundary

Everything about reading input lives in this folder. The rest of the app touches it in exactly three ways, all through two doors:

| Door | Who uses it | What it gives |
|---|---|---|
| [`index.ts`](index.ts) (server) | server actions, API routes | `extractPurchases`, `addPhotoToReceiptDraft`, `submitBatch`, `learnFromReview`, `recordConfirmedSample`, `syncEmailInbox` |
| [`client.ts`](client.ts) (browser) | the review screen | the `Draft` shapes and `toDisplayName`; nothing that touches the server |

ESLint fails the build if code outside this folder imports anything deeper (dev scripts in `scripts/` are exempt). Going the other way, this folder reaches out only to:

- `src/core/purchase-batch.ts` and `src/core/product-name.ts`: the shared batch format and one string helper;
- `src/lib/format.ts`: price formatting;
- inventory's database functions, **only in `index.ts`** (the one place that wires this folder to the real database).

Inventory never imports this folder.

## Map

| File | Job |
|---|---|
| [`index.ts`](index.ts) | Wires the pieces to the database; the server door |
| [`client.ts`](client.ts) | The browser door |
| [`types.ts`](types.ts) | `Extractor`, `Draft`, `Warning`: what a producer is and returns |
| [`registry.ts`](registry.ts) | Finds a producer by its `source` name |
| [`run.ts`](run.ts) | Validates input, runs the producer, adds duplicate warnings. Stores nothing |
| [`submit.ts`](submit.ts) | The front door to storage: validates a batch and passes it to inventory |
| [`duplicates.ts`](duplicates.ts) | Spots a draft that looks like something already stored |
| [`aliases.ts`](aliases.ts) | What to remember after a reviewed batch is saved (wordings, left-out lines) |
| [`draft-schema.ts`](draft-schema.ts) | Checks a draft the browser sends back (to add a second photo to it) |
| [`receipt/`](receipt/) | The receipt producer: OCR, rows, parse, dictionary, matching, draft, test samples |
| [`email/`](email/) | The email producer and inbox sync (designed, simulated inbox only) |

Inside `receipt/`, in the order a photo goes through them: `ocr/` (Google Vision), `layout.ts`, `parse.ts`, `catalog.ts`, `match.ts`, `extractor.ts`. `merge.ts` adds a second photo's draft to the first, and `totals.ts` holds the receipt key and the adding-up check they share. `samples.ts` and `sample-review.ts` are the local test-sample store and its comparison.

## Adding a way of ingesting

Write an `Extractor` (see `types.ts`), register it in `index.ts`. Nothing outside this folder changes unless it needs its own trigger.
