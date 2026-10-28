# Ingestion architecture

How purchases get into the app, from a receipt photo or an email to a stored purchase event that the inventory and prediction systems can use.

## The idea in one paragraph

Every way of getting purchases in (receipt, email, manual entry, a future retailer API) does the same thing: it produces a **purchase batch** in one standard format and submits it through one **front door**. Anything that reads or interprets raw input lives in a **producer**. Anything that decides *when* to run a producer and *what to do with the result* is a **trigger**. The **receiver** in the inventory module stores the batch. Producers never store anything, and the receiver never knows where a batch came from.

```
TRIGGER                      PRODUCER                    FRONT DOOR          RECEIVER
UI action ─ extract ─▶ runner ─▶ Extractor ─▶ Draft ─(user reviews)─▶ submitBatch ─▶ ingestPurchaseBatch ─▶ DB
email cron ─▶ syncInbox ─▶ runner ─▶ Extractor ─▶ Draft ─(automatic)──▶ submitBatch ─┘
outside service ─────────────────────────────────────────────────────▶ submitBatch ─┘
```

## Terms

| Term | Meaning |
|---|---|
| **Batch** | One receipt or order: one store, one date, one or more lines. The standard format. |
| **Draft** | A batch a producer has built but nobody has stored yet, plus any warnings. |
| **Producer** (`Extractor`) | Turns one kind of raw input into a draft. One per ingestion method. |
| **Trigger** | Starts a producer: a UI action, a scheduled inbox poll, an HTTP call. |
| **Front door** (`submitBatch`) | Validates a batch and passes it to the receiver. The only way into storage. |
| **Receiver** (`ingestPurchaseBatch`) | Matches each line to a product and stores it. Lives in the inventory module. |
| **Idempotency key** | An ID the sender picks for a submission, so a retry can never store it twice. |

## Step by step

### 1. The contract

[src/core/purchase-batch.ts](../src/core/purchase-batch.ts) defines the batch and its result types. It is pure: no database, no Next.js.

A batch (`PurchaseBatchSchema`):

| Field | Notes |
|---|---|
| `source` | Free-form lowercase label: `receipt`, `email`, `manual`, `agent`, or any new one. A new source needs no receiver change. |
| `idempotencyKey` | Required. Stable for one submission (an image hash, an email message-id or order number, or a UUID made when a form opens). Must identify that exact content. |
| `store`, `purchasedAt`, `currency` | One store and date per batch. Future dates are rejected (one day of slack for time zones). Currency defaults to `USD`. |
| `rawRef` | The sender's own pointer to the raw receipt or email. Stored, never interpreted. |
| `orderId` | For `agent` purchases: the replenishment order they came from. |
| `items` | 1 to 200 lines. |

A line (`PurchaseLineSchema`): `productName`, optional `productId` (wins over the name), optional `brand` and `category` (used only when the line creates a product), `quantity` (total units: 2 packs of 12 is 24), `unit`, optional `priceCents`.

The same file defines what comes back: `LineResult` (`created`, `duplicate` or `rejected` per line) and `IngestResult` (overall status `processed`, `duplicate` or `rejected`). It also defines `ProductSummary` and `PurchaseSummary`, the read-only views senders use.

### 2. A producer is an `Extractor`

[src/modules/ingestion/types.ts](../src/modules/ingestion/types.ts) defines the interface:

- `source`: the label put on every batch it makes.
- `input`: a schema validating what a trigger passes in (a photo, an email).
- `extract(input, ctx)`: returns either a `draft` (a batch plus warnings) or `skipped` with a reason. `ctx` carries the user, their existing products, and the current time.

Producers today:

- [receipt/extractor.ts](../src/modules/ingestion/receipt/extractor.ts): input is an image `File`. **Built**, see [Receipts](#receipts).
- [email/extractor.ts](../src/modules/ingestion/email/extractor.ts): input is an `EmailMessage`. **Stub:** always returns `skipped` until the extraction approach is decided.

A draft can carry two optional extras for the review screen: `lines` (how the input worded each line, and how it was matched to a product) and `sourceText` (the raw text the producer read). If a producer can't do its job because something it depends on is down or not set up, it throws an `ExtractionError` whose message is safe to show the user. [registry.ts](../src/modules/ingestion/registry.ts) maps `source` to its producer; [index.ts](../src/modules/ingestion/index.ts) builds the registry.

### 3. Running a producer

`createExtractionRunner` in [run.ts](../src/modules/ingestion/run.ts), in order:

1. Look up the producer by `source` (otherwise `unknown-source`).
2. Validate the raw input with the producer's schema (otherwise `invalid-input` plus the issues).
3. Load the user's products.
4. Call `extract`.
5. If it returned a draft, load stored purchases near its date and add duplicate warnings.

**Nothing is stored at this point.**

### 4. Duplicate warnings

`detectPossibleDuplicates` in [duplicates.ts](../src/modules/ingestion/duplicates.ts) flags a line when a stored purchase has the same product, the same store, the same day and the same quantity. It is a warning, never a block: whether it really is a duplicate is for the user to say. Lines are matched to a product by `productId`, else by name. Stored purchases with the same idempotency key are ignored, since the receiver already handles retries.

### 5. The front door

`createSubmit` in [submit.ts](../src/modules/ingestion/submit.ts) validates any input against `PurchaseBatchSchema`. Invalid input returns the issues and stops. Valid input goes to the receiver.

### 6. The receiver

`ingestPurchaseBatch` in [src/modules/inventory/ingest.ts](../src/modules/inventory/ingest.ts):

1. Loads the user's products into lookup maps.
2. For each line, `resolveProduct` picks a product: the `productId` if given (it must belong to the user), else a name match ignoring case and spacing, else a **new product**. Creating is safe when two requests race, because of the unique index on user and normalized name.
3. Checks the unit against the product's (singular and plural count as equal). A mismatch **rejects that line only**.
4. Inserts the accepted lines in one batch. A unique index on user, `idempotencyKey` and line number decides, so a line stored by an earlier attempt comes back as `duplicate` instead of being stored twice.
5. Returns a result per line and an overall status.

The same file exports `listProductSummaries` and `listPurchasesNear`, the two reads producers and the runner use.

### 7. The wiring

[index.ts](../src/modules/ingestion/index.ts) is the **only** file in the ingestion module that touches real database code. It builds `submitBatch`, `extractPurchases` and `syncEmailInbox`. Every other file takes its dependencies as parameters, which is why the tests need no database. Triggers import from here.

## Triggers

### UI actions (user-driven)

[src/app/ingest/actions.ts](../src/app/ingest/actions.ts) has two generic Server Actions that work for every user-driven source:

- `extractAction(source, formData)`: runs steps 2 to 4 and returns the draft for the user to review.
- `submitAction(batch)`: runs steps 5 and 6 once the user confirms, then refreshes the dashboard.

Neither knows anything about a particular source. `extractAction` turns an `ExtractionError` into `{ ok: false, error: "failed", message }`. `submitAction` also takes an optional list of how each line was worded, and remembers those wordings as product aliases (see [Receipts](#receipts)). The browser must never call `/api/ingest` directly, because that endpoint needs a secret key.

Today the only UI using them is the **+** button on the dashboard ([add-purchases/](../src/app/dashboard/add-purchases/)), which only shows the menu of sources and the finished screen. Each source's own screens are a *flow* ([flow-kit.tsx](../src/app/ingest/flow-kit.tsx)); the receipt one is in [ingest/receipt/](../src/app/ingest/receipt/)..

### HTTP endpoints (outside services)

| Endpoint | Purpose |
|---|---|
| `POST /api/ingest` ([route](../src/app/api/ingest/route.ts)) | Submit a batch. `201` if anything was stored, `200` if everything was already stored, `422` if nothing was storable, `400` for an invalid batch. |
| `GET /api/products` ([route](../src/app/api/products/route.ts)) | The user's products, so a sender can match its lines and send `productId`. |
| `POST /api/ingest/email/sync` ([route](../src/app/api/ingest/email/sync/route.ts)) | The email trigger. `?since=<ISO date>` overrides the default window of the last two days. |

All three need `Authorization: Bearer $INGEST_API_KEY` ([api-access.ts](../src/lib/api-access.ts)). With no key set they are open in development only; in production they return `503` until a key is configured.

### Email (polling)

Email has no way to push, so it is polled. `syncInbox` in [email/sync.ts](../src/modules/ingestion/email/sync.ts):

1. Reads messages since a time from an `InboxProvider` ([email/types.ts](../src/modules/ingestion/email/types.ts)).
2. For each message, runs the email producer, then submits any draft with **no human review**.
3. Reports each message as `stored`, `duplicate`, `rejected`, `skipped` or `failed`. Warnings are reported, not blocking. One failing message never stops the others.

Today the inbox is [a simulated, in-memory one](../src/modules/ingestion/email/inbox/simulated.ts) and it is empty. Re-reading mail is safe because the idempotency key makes a repeat a `duplicate`.

## Receipts

The user taps **+** on the dashboard and picks Receipt (Email is listed as coming soon). They take a photo or upload one, see a **preview**, and press **Add**. Only then is the photo sent. They then check what we read and confirm.

```
browser: preview ─▶ Add ─▶ shrink photo ─▶ extractAction ─▶ OCR ─▶ rows ─▶ parse ─▶ identify ─▶ match ─▶ Draft ─▶ review ─▶ submitAction
```

| Step | File | What it does |
|---|---|---|
| Shrink | [prepare-image.ts](../src/app/ingest/receipt/prepare-image.ts) | Resizes the photo to at most 2400px on its longest side and re-encodes it as JPEG under 3 MB, upright. Server Actions accept 4 MB (set in [next.config.ts](../next.config.ts)). |
| OCR | [ocr/google-vision.ts](../src/modules/ingestion/receipt/ocr/google-vision.ts) | Google Cloud Vision `DOCUMENT_TEXT_DETECTION`. Returns each word with its position. Behind the `OcrEngine` interface in [ocr/types.ts](../src/modules/ingestion/receipt/ocr/types.ts), so another engine is one new file and one line in `index.ts`. |
| Rows | [layout.ts](../src/modules/ingestion/receipt/layout.ts) | Straightens a tilted photo, then rebuilds printed rows from word positions, so a name and its far-away price land on one row. Each name's own slope is carried across to the price column, so a curled receipt (names sloping, prices level) still pairs them right. |
| Parse | [parse.ts](../src/modules/ingestion/receipt/parse.ts) | Plain pattern matching: store, date, subtotal and total, and the lines above the last subtotal or total. Strips item codes, tax flags and pack sizes (`12CT` and `4-5 COUNT` multiply the quantity), handles `2 @ 3.49` and weighed items, skips discounts and non-products. A line whose price couldn't be read is kept if the dictionary knows the item. |
| Identify | [catalog.ts](../src/modules/ingestion/receipt/catalog.ts) | The starter dictionary: about 160 everyday US items with their receipt abbreviations, about 100 brands (store brands like GV and KS included), and things that don't get used up (furniture, electronics, clothing...). Turns `GV WHL MLK GL` into the item **Milk**, brand **Great Value**. A brand that only makes one thing implies the item (Charmin means Toilet Paper). |
| Match | [match.ts](../src/modules/ingestion/receipt/match.ts) | Ties a line to one of the user's products: the receipt's wording, then a learned alias, then the dictionary's item name, then the one product whose name holds that item ("Paper Towels" in "Bounty Paper Towels"), then a similar name only when one product clearly stands out. Otherwise the line is a new product, named for the item. |
| Draft | [extractor.ts](../src/modules/ingestion/receipt/extractor.ts) | Builds the batch (item name, brand, and for a new product the dictionary's category and unit) and the warnings (missing date, items add up to less than the subtotal, weight vs count). Marks lines that should start unticked: things that don't get used up, and wordings the user left out before. |
| Review | [receipt-review.tsx](../src/app/ingest/receipt/receipt-review.tsx) | One compact row per line: name, product tag (tap to change), brand, quantity. Unit, price and brand are edited in the row's expander. Nothing is stored until they confirm. |

**Idempotency key.** A hash of the store, date and total, not of the photo. A second photo of the same receipt then gets the same key and is stored once. When no total can be read it falls back to a hash of the photo's bytes.

**Products are items, brands are per purchase.** A product is the thing the user restocks ("Milk"); the brand bought is stored on each purchase (`purchase_events.brand`), and a brand seen for the first time is added to the product's brand list. Two milk lines in different brands are two rows on one product.

**What gets left out.** Lines start unticked when the dictionary says they don't get used up, or when the user left the same wording out of an earlier receipt (`ignored_wordings`). Unknown items start ticked. Keeping a wording that was left out before forgets it.

**Aliases.** On confirm, the way the receipt worded each stored line (`GV WHL MLK GL`) is saved in `product_aliases` ([schema](../src/db/schema.ts), [aliases.ts](../src/modules/inventory/aliases.ts)) against the product it landed on, including a product that line just created. The next receipt with that wording matches with no help. Choosing a different product for a line moves the alias to it.

**Setup.** Needs `GOOGLE_VISION_API_KEY` in `.env.local`: a Google Cloud API key, restricted to the Cloud Vision API, on a project with billing attached (the first 1,000 receipts a month are free). Without a key the dialog says so.

## Adding a new ingestion method

**Inside this app** (a new producer):

1. Create `src/modules/ingestion/<name>/extractor.ts` implementing `Extractor`: a `source` label, an `input` schema, and an `extract` that returns a draft whose batch has a stable `idempotencyKey`.
2. Add it to the list in [registry.ts](../src/modules/ingestion/registry.ts).
3. If a user triggers it, the UI uses the existing `extractAction` and `submitAction` with the new `source`. If it runs on a schedule, write a small trigger like the email sync.
4. Add tests next to it. Use fakes for the runner's dependencies (see [run.test.ts](../src/modules/ingestion/run.test.ts)).

**From an outside service**: no code changes. Fetch `GET /api/products`, build a batch, `POST /api/ingest`.

## Testing

- `npm test` runs the offline suite (fast, no network). Producers, the runner, submit, duplicates and the email sync are all tested with fakes.
- `npm run receipt -- <photo> [--rows]` runs a receipt photo through the real pipeline (real Vision call, read-only) and prints the draft. See [AGENTS.md](../AGENTS.md#testing-receipts).
- `npm run samples [-- --replay]` compares the drafts the app kept (when `SAMPLES_DIR` is set, local testing only) with what the user saved. See [AGENTS.md](../AGENTS.md#test-samples-real-use-becomes-a-test-set).
- `npm run test:db` runs [ingest.db.test.ts](../src/modules/inventory/ingest.db.test.ts) against the real database in `.env.local`, using throwaway users it deletes afterwards. Retry safety and product races depend on database constraints, so they can only be proven there.

## Status

**Built and tested:** the contract, the runner, duplicate warnings, the front door, the receiver (product matching, unit checks, retries, races), the email sync loop, the simulated inbox, the HTTP routes, the UI actions, and receipts end to end (OCR, parsing, matching, aliases, the + dialog).

**Tried on real receipts:** Whole Foods and Walmart photos have been run through real Vision and the pipeline (`npm run receipt -- <photo>`), and each fix has a regression test. The dialog renders but has not been clicked through in a browser.

**Open, deliberately:**

- How an email becomes a draft (telling order confirmations from shipping notices, the idempotency key, which senders to trust).
- A real inbox provider (Gmail), where its connection and the sync cursor are stored, and the scheduling.
- A separate secret for the cron trigger (it reuses `INGEST_API_KEY` today).
- Pages beyond the dashboard's + dialog.

## Known limits

- A retry needs the **same** idempotency key. A sender that makes a new key for a retry creates a duplicate.
- The key must identify the exact content. Reusing it for a different batch makes lines that share a line number look like duplicates.
- Unit comparison only tolerates case and a trailing plural. `ct` against `rolls` is rejected, so senders normalize units.
- Everything is stored for a single demo user until real accounts exist.
- Receipts: the parser reads English-style layouts (name left, price right, a subtotal or total below the items). Two-column or heavily wrapped receipts, and ones with no readable subtotal, will need the review step.
- Receipts: a pack size like `12CT` multiplies the quantity, whatever the product's unit is. A `6PK` of cans stored against a product counted in bottles shows 6; the user can fix it in review.
- Receipts: the dictionary matches whole words, so OCR misreads ("FOOG" for "FOOD") and rare abbreviations fall through to the receipt's wording, and a short abbreviation can mislead ("CHS" reads as cheese). Each fix the user makes is remembered as an alias.
- Receipts: two different receipts from the same store on the same day with the same total share a key, so the second is reported as already saved.
- A draft travels to the browser and back, so its `purchasedAt` has to be a string, not a `Date`.
