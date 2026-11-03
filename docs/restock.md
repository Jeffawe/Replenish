# Restock: finding what is running low, and where to buy it

The first half of auto-buy. It answers two questions and nothing more:

1. **Which products need attention now?** (the low-stock check)
2. **For each one, what is the best listing to buy online?** (the finder)

It **buys nothing.** Its output, a `RestockReport`, feeds two decisions: **ask the user** (built: part 3 below) and **auto-buy** (not built; [buy.ts](../src/modules/restock/buy.ts) is where it plugs in). The code is in `src/modules/restock/` (module guide: [README](../src/modules/restock/README.md)); the pick rules are pure functions in [pick-offer.ts](../src/core/pick-offer.ts).

```
purchases, counts, answers, settings change
        │  refreshNextCheck (inventory)
        ▼
products.next_check_at ──▶ runLowStockCheck ──▶ low products + full estimates
                                                        │
                                                        ▼
                        search Channel3 ──▶ candidates ──▶ pickOffers ──▶ RestockReport
                                                                              │
                                  ┌───────────────────────────────────────────┴──────────┐
                                  ▼                                                      ▼
                  1. ASK: store a suggestion, show it on the            2. AUTO-BUY (not built): product has
                     dashboard at the next login; "Buy for me"             auto-buy on, or the user pressed
                     and "Not now"; links to the store                     "Buy for me" ──▶ startPurchase()
```

## Part 1: the low-stock check

Estimates are never stored; they are worked out from purchase history whenever they are read (`predict()` in `src/core/predict.ts`). Recalculating every product for every user on a schedule would be wasteful, so each product stores one date instead.

- **`products.next_check_at`** is the moment the product first comes within `max(low-stock threshold, the user's lead days)` of running out (rules in [next-check.ts](../src/core/next-check.ts)). If an order is on its way, the date is the arrival if that comes first, because the order adds stock.
- With no new input the run-out date doesn't move, so the date is worked out **when an input changes**, never on a read. `refreshNextCheck` ([inventory/next-check.ts](../src/modules/inventory/next-check.ts)) is called at the end of every write path that changes an estimate: a purchase saved, approved or rejected; a stock count recorded or undone; a product edited, merged, confirmed, hidden or restored; a usage answer; the settings forms. **A new write path that changes any of those must call it too.** It can't fail the save it follows.
- **`runLowStockCheck`** loads only the products whose date has come, recalculates their full estimates (confidence changes with time, so nothing stored is trusted), returns the low ones, and moves forward the date of any that turned out not to be low yet. It handles at most 500 products a run (`moreDue` says there are more).
- **Low products stay listed** on every run until something handles them. "Handled" doesn't exist yet; it is the next step's decisions table.
- **`sweepNextChecks`** recalculates every date for everyone. It is the safety net for a write path that forgot to refresh, and the first fill after a deploy.
- The check agrees with the dashboard's "Running low" because both use the same "judged days" ([`judgedDaysUntilRunOut`](../src/core/predict.ts)).

`refreshNextCheck` stays in the inventory module and the check lives in restock, because inventory's save paths call `refreshNextCheck` and restock imports inventory; moving it would be an import cycle. Restock reads estimates and writes dates through `evaluateProducts` and `saveNextCheckDates`, exported from the same inventory file.

## Part 2: the finder

For each low product, `findOnline`:

1. **Builds the search text** from the product: its newest brand and its name, `"Charmin Toilet Paper"` (`searchQueryFor`). Products can have several brands (`Charmin, Quilted Northern`); the last one is the most recent.
2. **Searches online** and gets listings back: food and drink on **Zinc**, everything else on **Channel3** (see below).
3. **Picks** with `pickOffers`: drops what can't be the product, ranks the rest.
4. Returns a **`Finding`**: found (with the pick and up to 2 alternatives), none (and why), or error. It never throws, so one failed lookup can't stop the others.

### Two search services, routed by category

Neither service has everything, so each product goes to the one that does ([search.ts](../src/modules/restock/search.ts)): products whose category is **Groceries or Beverages go to Zinc; everything else goes to Channel3.** (Channel3 has no food in it; checked on the live API.) A missing key fails only the products that need it, with a message naming the key, so a missing Zinc key doesn't stop household goods from being found. Both implement the same `ProductSearch` interface, so a third service can be added without touching the picking.

### Channel3

A product search across stores ([docs](https://channel3.ai/docs)). The client is [channel3.ts](../src/modules/restock/channel3.ts), behind a small interface so a fake or another service can replace it:

```ts
interface ProductSearch { search(query: string): Promise<Candidate[]> }
```

- `POST https://api.trychannel3.com/v1/search`, key in the `x-api-key` header, from `CHANNEL3_API_KEY`. Asks for in-stock, US, USD results, 20 per search.
- A product comes back with **one offer per store** (`url`, `domain`, `price`, `availability`, `condition`). So the user's usual store is found in the same search; there is **no store filter**.
- One search is **one credit**. The pricing page says 1,000 credits a month are free and more cost $0.007 each; rate limits are 10 searches a second and 10,000 a day on the default plan.
- On a 429 it waits (the `Retry-After` header, 5 seconds by default) and tries once more. Errors become a `SearchError` with a message that is safe to show and never contains the key.
- Products and offers are parsed one at a time; one it can't read is skipped, not fatal. A response that isn't a list of products at all is an error.
- A **mock** ([mock-search.ts](../src/modules/restock/mock-search.ts)) invents three listings for any query, labelled "(mock listing)". It is for trying the flow without a key and for a demo if the service is down. Never show its listings as real.

### Zinc

Zinc's cross-retailer search ([zinc.ts](../src/modules/restock/zinc.ts)), used for food and drink. `GET https://api.zinc.com/search?q=...&limit=20&retailer=walmart&retailer=amazon` with `Authorization: Bearer <ZINC_API_KEY>`. Only Walmart and Amazon are searched because those are the stores Zinc lists as orderable; the search service itself also covers Target, Costco and others, which Zinc may not be able to order from.

- **Cost.** A search is $0.01 from the Zinc wallet. The free **sandbox key** (`zn_test_...`, `npm run zinc:key` adds one to `.env.local`) costs nothing but returns **invented listings** ("Sample Folgers coffee — Globex Model A", random prices and stores).
- **Sample data is marked.** A key starting `zn_test_` makes every listing `sample: true` (so does the mock search). It travels with the pick into the report (`RestockListing.sample`), and `npm run restock` prints it. **Never show a sample listing to a user as a real offer.**
- Each result has `url` (usable straight in a Zinc order), `retailer`, `title`, `brand`, `price` (already in cents), and `available`. There is no category (so no department screen), no condition and no pack count beyond the title.
- **No zip code or store parameter**, so perishables (milk, eggs) are unreliable even with a live key. The plan is for perishables to be ask-only.
- Errors become a `SearchError` (401 key refused, 402 wallet empty, 429 too fast) with no key in the message. A search whose `status` isn't `completed` is an error.

### How the pick is made

Rules only, no AI call (decided with the user). In order:

**Dropped**, because it can't be the product: not in stock; used or refurbished (a missing condition is accepted); not in USD; no price; **in the wrong department**; or not the same kind of thing: **every word of the product's name must be in the title**, in any order, plural or not (`Toilet Paper` is in `Charmin Ultra Soft Toilet Paper, 12 Mega Rolls`).

**Ranked**, best first (each rule only breaks ties left by the ones above it):

| # | Rule | Why |
|---|---|---|
| 1 | The whole order is inside the price range that applies | Every limit means "ask the user", so out-of-range is ranked last, not dropped |
| 2 | The pack size fits the usual purchase | Without this the cheapest single roll, or a 48-roll bulk pack, would win |
| 3 | A brand the product has been bought in | The user buys *this* thing again |
| 4 | The user's usual store (`bought_from`) | A preference, not a requirement |
| 5 | Lowest price per unit | Then lowest pack price, then the link, so the same input always gives the same answer |

**Department.** Channel3 gives every product a category from Google's product taxonomy. The top of it (the "department", like `Home & Garden`) is checked against the product's own category: Groceries and Beverages must be `Food, Beverages & Tobacco`; Household can be `Home & Garden`, `Hardware`, `Electronics` (batteries) or `Office Supplies`; Personal Care and Health are `Health & Beauty`; Pet is `Animals & Pet Supplies`; Baby is `Baby & Toddler` or `Health & Beauty` (table in [pick-offer.ts](../src/core/pick-offer.ts)). A category we don't list, or a listing with no category, isn't checked. This exists because a search for "Milk" returns cleansing milk, milk cartons and a perfume called Milk.

**Pack size and quantity.** The count is read from the title: `12 Mega Rolls`, `Pack of 6`, `24ct`, `6-Pack`, or a number before the product's own unit (`2 Gallons`). Other sizes (`128 fl oz`) are not counts. The number of packs to order is `ceil(usual purchase / pack size)`. A pack **fits** if the total units are between the usual amount and 1.5 times it. A title with no count has an unknown size: one pack, and a concern.

**Price range.** The user's range from Settings, or the product's own if it sets either bound (the two are never mixed; `priceRangeFor`). It is checked against the **whole order** (packs × pack price), not one pack.

**Usual store.** `bought_from` is free text (`Walmart Supercenter #1234`) and a listing has a domain (`walmart.com`); they match when one contains the other once punctuation, `www.` and `.com` are removed.

### Concerns

Nothing is removed for being dear or the wrong size. Instead a pick carries **concerns**, the reasons to ask the user rather than buy. The next step decides what each one means; the finder only reports them.

| Concern | Means |
|---|---|
| `outside-price-range` | The whole order is outside the user's (or the product's) range |
| `size-unknown` | The title doesn't say how many units a pack holds, so how many to order is a guess |
| `size-differs` | The pack is much bigger or smaller than the usual purchase |
| `other-brand` | Not a brand the product has been bought in (only when a brand is known) |
| `other-store` | Not the store the product is usually bought from (only when one is known) |

An empty list means nothing about the pick is questionable.

### A worked example

*Toilet Paper*, bought as Charmin at Walmart, usually 12 rolls. The search for `Charmin Toilet Paper` returns:

| Listing | Price |
|---|---|
| Charmin Toilet Paper 12 Rolls at target.com | $14.00 |
| Charmin Toilet Paper 12 Rolls at walmart.com | $15.00 |
| Cheap Toilet Paper 12 Rolls at target.com | $6.00 |
| Charmin Toilet Paper 48 Rolls at target.com | $40.00 |

Walmart wins: all four are in range; three fit the size (the 48-pack doesn't); of those, the two Charmin ones beat the generic brand; and the Walmart one is the usual store, so it beats the cheaper Target listing. Its concerns: none. The Target Charmin is first alternative with `other-store`.

## Part 3: asking the user (the first decision)

When the scheduled job finds a low product with a listing, the user is told at their next login. This is `runRestockAndAsk` ([ask.ts](../src/modules/restock/ask.ts)); `runRestock` is the same without storing anything.

**What the user sees** (top of the dashboard, [src/app/restock/](../src/app/restock/)):

> **You're running low on Toilet Paper.** We checked on 2026-11-03 and found:
> **Charmin Essentials Toilet Paper 6 Mega Rolls** (a link) · walgreens.com · $4.99 × 2 packs = $9.98 · 6 per pack · *tags for any concerns*
> [Open at walgreens.com] [Buy for me] [Not now]
> ▸ 2 other options (each a link with store, price and tags)

- The link opens the store's page in a new tab. Only `http(s)` links are ever rendered, because the link comes from a search service.
- **Tags** say plainly what's questionable: "Over your price limit", "Pack size not stated", "Different pack size than usual", "Different brand", "Not your usual store". A sample listing says **"Sample listing (testing data)"**.
- **Not now** hides it until the product has stock again.
- **Buy for me** is the second decision's entry. For now it only answers "Buying for you isn't set up yet."
- Nothing shows when there is nothing to say. Products that were searched and found nothing, or where the search failed, show nothing (the dashboard's normal "Running low" card still does).

**What is stored** (`restock_suggestions`, one row per product): the search's result (best listing, up to two others, the query), when it was searched, and a status, `open` or `dismissed`. The result is read back through a schema because it comes from outside; a row that doesn't parse is skipped.

**When a suggestion is shown, replaced and removed:**

| | |
|---|---|
| **Shown** | status `open`, the product isn't hidden, and its check date has come (it still needs attention). So after the user restocks, it disappears by itself, before any job runs. |
| **Searched again** | only when it has no suggestion, or its open suggestion is 24 hours old (`REFRESH_AFTER_MS`), so prices stay recent and a low product isn't searched on every run. A dismissed one is never searched again. |
| **Replaced** | by the new search's best listing, on a refresh. A search that finds nothing removes the open suggestion (the listing may be gone); a failed search keeps it. |
| **Removed** | when its product no longer needs attention (restocked, hidden). This also ends a dismissal, so the next time the product runs low the user is asked again. |

**The first decision never buys.** "Buy for me" calls `startPurchase(userId, suggestion)` in [buy.ts](../src/modules/restock/buy.ts), which is a stub. The action reads the suggestion back from the database by id; nothing the browser sends (a link, a price) decides what is bought.

## What a run returns: `RestockReport`

`runRestock(search)` runs the check and then the finder, and returns plain, JSON-safe data with no database rows ([report.ts](../src/modules/restock/report.ts)).

```
RestockReport
  checkedAt, checked, moreDue
  items: RestockItem[]            one per low product that was searched
  skipped[]                       low products not searched (the 50-search limit); they stay low
  errors[]                        accounts the check could not read

RestockItem
  userId, productId, name, brand, unit, boughtFrom
  confirmed, autobuyEnabled, usualQuantity
  estimate { daysUntilRunOut, estimatedRemaining, confidence, rateSource }
  query, listings                 what was searched, how many listings came back
  + one of
      { status: "found", pick, alternatives[] }
      { status: "none", reason: "no-results" | "no-usable-listing" }
      { status: "error", message }

RestockListing                    the pick, and each alternative
  title, brands, domain, url, imageUrl, channel3Id, currency,
  priceCents, packSize, packs, totalCents, withinRange, concerns[], sample
```

Trimmed output for one product:

```json
{
  "name": "Toilet Paper", "unit": "rolls", "boughtFrom": "Walmart",
  "confirmed": true, "autobuyEnabled": false, "usualQuantity": 12,
  "estimate": { "daysUntilRunOut": 5.8, "estimatedRemaining": 3, "confidence": 0.62, "rateSource": "history" },
  "query": "Charmin Toilet Paper", "listings": 4, "status": "found",
  "pick": {
    "title": "Charmin Toilet Paper 12 Rolls", "domain": "walmart.com", "url": "https://…",
    "priceCents": 1500, "packSize": 12, "packs": 1, "totalCents": 1500,
    "withinRange": true, "concerns": []
  },
  "alternatives": [ { "domain": "target.com", "priceCents": 1400, "concerns": ["other-store"] } ]
}
```

(`none` with `no-results` means the search found nothing; `no-usable-listing` means it found listings but none in stock, new and the same kind of thing. The difference tells whether the service doesn't carry the product or the rules rejected everything.)

## Running it

```bash
npm run low                          # just the check: which products are low (no search, no credits)
npm run low -- --sweep               # first recalculate every product's check date
npm run restock                      # check + search each low product (household on Channel3, food on Zinc)
npm run restock -- --mock            # same with invented listings; needs no key
npm run zinc:key                     # adds a free Zinc sandbox key to .env.local (once)
npm run restock -- --json            # print the RestockReport as JSON
npm run restock -- --save            # also store what it finds, so the dashboard asks the user (what the scheduled job does)
npm run restock -- --user <id> --limit 5
```

Over HTTP, `GET /api/low-stock/check` with `Authorization: Bearer <CRON_SECRET>`: the plain check by default; `?sweep=1` recalculates all dates first; `?find=1` also searches and returns the `RestockReport` (stores nothing); **`?ask=1` is the real scheduled job**: the check, the searches, and the suggestions stored for the dashboard (returns the report plus `saved`, `cleared`, `forgotten`, `alreadyAsked`). `&mock=1` uses invented listings and is refused in production. It isn't scheduled yet (no `vercel.json`).

Environment: `CHANNEL3_API_KEY` (household goods), `ZINC_API_KEY` (food; `npm run zinc:key` adds a free sandbox key), `CRON_SECRET` (the route). Running it only reads the database.

## Decided with the user

- **The check and the finder have their own module**, `src/modules/restock/`, with one server door (`@/modules/restock`) and no client door; ESLint enforces it like the other modules.
- **Picking is rules only.** No AI call. (Google Vision is the app's existing ML; whether that satisfies the hackathon's AI requirement is for the organizers to say.)
- **Finding happens whether or not auto-buy is on.** Auto-buy only decides buy versus ask, and every limit falls back to asking.
- **The hand-off is a plain-data report**, not database rows, so the next step can be built and tested on its own.
- **Asking comes first and buys nothing.** The user sees the best listing with a link, up to two other options, "Buy for me" and "Not now". Auto-buy and "Buy for me" are the same second decision.

## Known limits

- **Groceries are not in Channel3.** Checked on the live API, even with a Walmart-only filter: household goods work well (Toilet Paper, Laundry Detergent and AA batteries all came back right), but milk, coffee and cereal returned only milk bottles, coffee makers and cereal dispensers. With the department screen those searches report `no-usable-listing`, which is why food goes to Zinc.
- **Zinc's food results have only been seen as sandbox samples.** Whether its real search returns Folgers or Cheerios at Walmart and Amazon is likely but untested; it needs a funded wallet ($15 minimum top-up). Milk and eggs need a local store, which Zinc's search can't target, so treat perishables as ask-only.
- **The client has run against the live API** (key accepted, response parsed with no changes). Channel3 sends more fields than the client reads; it only needs the ones in `channel3.ts`.
- **"Same kind of thing" is word matching.** `Milk` also accepts `Milk Chocolate Bar` (the brand and size rules usually push it down). Better matching is a dictionary job, not a longer word list here.
- **Pack sizes are read from titles**, which don't always state them. A multi-pack written as `6 Mega Rolls = 24 Regular Rolls` is read as 6.
- **A found listing is stored for 24 hours of reuse; a run searches at most 50 products.** A product that is low but whose search found nothing is searched again on every run, since nothing is stored for it.
- **Which stores can be bought from automatically** isn't known to the finder beyond Zinc's list (it searches only Walmart and Amazon for food). The report gives the store's domain; whether the buying service can order from it is the next step's question.

## What the next step must do with this

- **Re-read the product and the user's settings by id** before spending anything. The report is a snapshot: a product can be edited, hidden, or have its auto-buy switched off between the search and the buy.
- **Decide what each concern means.** At minimum, auto-buy needs: a confirmed product, auto-buy on, confidence at or above the user's floor (80% or more), `withinRange`, no `size-unknown` or `size-differs`, and the monthly cap not exceeded. Anything else means asking the user.
- **Record what it did** so a retry can't buy twice (an idempotency key per product and low-stock cycle). The suggestions table covers asking only; it does not record purchases.
- **Treat `sample` listings as never real:** refuse them with a live payment, and never show them as real offers.

## Where things are

| What | Where |
|---|---|
| Check dates and the low rule | [src/core/next-check.ts](../src/core/next-check.ts), [inventory/next-check.ts](../src/modules/inventory/next-check.ts) |
| The check and sweep | [restock/check.ts](../src/modules/restock/check.ts) |
| Pick rules (pure) | [src/core/pick-offer.ts](../src/core/pick-offer.ts) + `pick-offer.test.ts` |
| Channel3 client | [restock/channel3.ts](../src/modules/restock/channel3.ts) + `channel3.test.ts` |
| Finder | [restock/find.ts](../src/modules/restock/find.ts) |
| The report | [restock/report.ts](../src/modules/restock/report.ts), [restock/run.ts](../src/modules/restock/run.ts) |
| Zinc client, routing | [restock/zinc.ts](../src/modules/restock/zinc.ts), [restock/search.ts](../src/modules/restock/search.ts), [restock/search-types.ts](../src/modules/restock/search-types.ts) + tests |
| Suggestions (storage, run, buy seam) | [restock/suggestions.ts](../src/modules/restock/suggestions.ts), [restock/ask.ts](../src/modules/restock/ask.ts), [restock/buy.ts](../src/modules/restock/buy.ts) + `suggestions.db.test.ts` |
| Dashboard section | [src/app/restock/](../src/app/restock/) (`restock-suggestions.tsx`, `suggestion-card.tsx`, `actions.ts`) |
| Mock search | [restock/mock-search.ts](../src/modules/restock/mock-search.ts) |
| Scripts, route | `scripts/low-products.ts`, `scripts/restock.ts`, `src/app/api/low-stock/check/route.ts` |
| Database tests | `restock/check.db.test.ts`, `restock/restock.db.test.ts` (`npm run test:db`) |
