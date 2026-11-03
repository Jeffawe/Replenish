# Restock

The full explanation (flow, pick rules, the report, decisions, limits) is in [docs/restock.md](../../../docs/restock.md); this is the short guide to the module.

Finds the products that are running low and looks each one up online. Two parts, in order:

1. **The low-stock check** (`check.ts`): which products need attention now.
2. **The finder** (`find.ts`, `channel3.ts`): for each low product, the best listing to buy.

Two decisions follow them. **Ask** (built): `ask.ts` stores what was found as a *suggestion* (`suggestions.ts`, table `restock_suggestions`) and the dashboard section in `src/app/restock/` shows it at the next login, with a link, two other options, "Buy for me" and "Not now". **Buy** (not built): `buy.ts` is the stub both auto-buy and "Buy for me" will go through. Nothing in this module buys.

Doors: `index.ts` (server) and `client.ts` (browser: the `Suggestion` type and the labels for concerns).

## The check

Each tracked product has `products.next_check_at` (rules in `src/core/next-check.ts`): the moment it first comes within `max(low-stock threshold, the user's lead days)` of running out. `runLowStockCheck` loads only the products whose date has come, recalculates their full estimates (confidence changes with time, so no stored number is trusted), returns the low ones and moves forward the date of any that aren't low yet. Low products stay listed until something handles them.

`next_check_at` itself is kept current by `refreshNextCheck` in `src/modules/inventory/next-check.ts`. That file stays in inventory because inventory's save paths call it, and this module imports inventory, so moving it here would be an import cycle. The check reads the estimates and writes the dates through `evaluateProducts` and `saveNextCheckDates` from there, so the estimate and the date are worked out in one place. `sweepNextChecks` recalculates every date (the safety net, and the first fill after a deploy).

`GET /api/low-stock/check` (`src/app/api/low-stock/check/route.ts`) is the cron entry. It runs the check only; it doesn't search yet.

## The finder

`findOnline(low, search, settings)` searches for `"<newest brand> <name>"` and picks a listing. It never throws: a failed search is a `Finding` with `status: "error"`, so one bad lookup can't stop the rest.

- **Search** is behind the `ProductSearch` interface, routed by the product's category (`search.ts`): **food and drink go to Zinc** (`zinc.ts`, `ZINC_API_KEY`, Walmart and Amazon, $0.01 a search; the free sandbox key returns invented listings marked `sample`), **everything else to Channel3**. `channel3.ts` is the household one (`POST https://api.trychannel3.com/v1/search`, `x-api-key` from `CHANNEL3_API_KEY`, in-stock US results, 20 per search, one retry on 429). A product comes back with one offer per store, so the user's usual store is found in the same call and there is no store filter. `mock-search.ts` invents listings for running without a key.
- **Picking** is `pickOffers` in `src/core/pick-offer.ts`, rules only. Dropped: out of stock, used or refurbished, not USD, no price, in the wrong department (the listing's top category must suit the product's own category), or not the same kind of thing (every word of the product's name must be in the title). Ranked: inside the price range, pack size that fits the usual purchase, a brand the product has been bought in, the user's `bought_from` store, then lowest price per unit.
- **Nothing is removed for being too dear or the wrong size.** Every limit means "ask the user", so those listings are kept, ranked last and given a concern: `outside-price-range`, `size-unknown`, `size-differs`, `other-brand`, `other-store`. The next step decides what each concern means (for example, auto-buy needs none).
- **The price range is checked against the whole order** (packs × pack price), using the user's range or the product's own (`priceRangeFor`).
- **Pack size** is read from the title ("12 Mega Rolls", "Pack of 6", "24ct") or from the product's own unit. How many packs to order is `ceil(usual purchase / pack size)`. A title with no count gives `size-unknown` and one pack.

## What a run returns: `RestockReport`

`runRestock(search)` is the check followed by the finder, and returns a **`RestockReport`** (`report.ts`): plain, JSON-safe data, which is what the next step (deciding to buy or ask) receives.

```
RestockReport { checkedAt, checked, moreDue, items: RestockItem[], skipped[], errors[] }
RestockItem   { userId, productId, name, brand, unit, boughtFrom, confirmed, autobuyEnabled,
                usualQuantity, estimate { daysUntilRunOut, estimatedRemaining, confidence, rateSource },
                query, listings, ...RestockOutcome }
RestockOutcome = { status: "found", pick: RestockListing, alternatives: RestockListing[] }
               | { status: "none", reason: "no-results" | "no-usable-listing" }
               | { status: "error", message }
RestockListing { title, brands, domain, url, imageUrl, channel3Id, currency, priceCents,
                 packSize, packs, totalCents, withinRange, concerns[] }
```

One `RestockItem` per low product that was searched. The report has no database rows, so the next step re-reads the product and the user's settings by id before it spends anything (a product can change between the search and the buy).

`findForLowProducts` searches at most `SEARCH_LIMIT` (50) per run because each search costs a credit and low products are listed again every run until something handles them. The rest come back as `skipped`.

```bash
npm run restock                       # low products now, each looked up on Channel3
npm run restock -- --mock             # same, with invented listings (no key, no credits)
npm run restock -- --json             # print the RestockReport as JSON
npm run restock -- --save             # also store suggestions (what the scheduled job does)
npm run zinc:key                      # add a free Zinc sandbox key to .env.local
npm run restock -- --user <user id> --limit 5
```

The same report comes from the cron route: `GET /api/low-stock/check?find=1` (add `&mock=1` for invented listings; refused in production), with `Authorization: Bearer <CRON_SECRET>`.

## Known limits

- **Groceries are not in Channel3** (checked live), so food goes to Zinc. Zinc's real food results are untested (the sandbox returns invented samples) and it can't target a local store, so perishables should be ask-only. See docs/restock.md.
- **"Same kind of thing" is word matching**, so "Milk" also accepts "Milk Chocolate Bar" (the brand and size rules usually push it down). Better matching is a dictionary job, not a bigger word list here.
- **Only found listings are stored**, and reused for 24 hours; see "Part 3" in docs/restock.md. Auto-buy and "Buy for me" are not built (`buy.ts` is the stub).
- **Whether the store can be bought from automatically** is the buying step's question; the finder only reports the store's domain.
