# New 50-receipt baseline review

Benchmark date: 2026-10-27  
Photo set: `/Users/somua/Downloads/real_us_receipt_photos_50`  
Pipeline: current code after the prior agent's fixes  
Method: all 50 photos were run once before any receipt-specific tuning. No fixes were made during this benchmark.

## Scoring

Only purchased lines representing things that get used up were scored. Taxes, tips, service charges, payment rows, modifiers, and durable goods were excluded from the denominator.

A line was correct only when its first-view product name was sensible for the purchased item and its quantity and line price matched the photo. A receipt counted as no-edit only when the draft contained all relevant lines correctly, contained no junk or duplicate lines requiring removal, and had no metadata fallback requiring correction.

| Measure | All 50 photos | Strict unseen subset |
|---|---:|---:|
| Correct consumable lines | 180 / 272 (66.2%) | 149 / 232 (64.2%) |
| Receipts needing no edits | 4 / 50 (8.0%) | 4 / 48 (8.3%) |

Receipts 32 and 35 are exact repeats from the earlier 19-photo set, so the 48-photo column is the more honest generalization score. The four no-edit receipts were 05, 08, 21, and 39.

## Issues found in the new set

### 1. Plain leading quantities are not parsed

The parser generally understands `2 x ITEM`, but restaurant formats such as `3 Pupusa Queso`, `4 SODA DRINK`, or `20 Mixed Meat Lunch` remain part of the name while quantity stays at 1.

Examples: 10, 16, 18, 22, 23, 30, 40, 45, 46, and 49. Receipt 45 also treats `12pc` in `1 Reg 12pc Falafel` as 12 purchased units instead of one order containing 12 pieces.

### 2. Prepared dishes are reduced to one ingredient

The grocery catalog overmatches words inside restaurant dish names. This produces plausible-looking but incorrect products.

Examples include:

- `Pulled Pork Sand` → Pork Chops (01)
- `Nutella Coconut Pancakes` → Pancake Mix and `Cheddar Grits` → Cheese (02)
- `Chicken Marsala` → Chicken (03)
- `Root Beer` → Beer (04)
- `Chicken Tikka Masala` → Chicken and `Thai Fried Rice` → Rice (07)
- `Milk Shake` → Milk (14)
- `Garlic Naan` → Garlic (17)
- `Apple French Toast` → Apples (44)
- `Onion Naan` → Onions (50)

This is the largest name-quality problem in the restaurant-heavy set.

### 3. Summary, tax, payment, and footer rows become products

Non-products are still emitted as selected lines, often at large prices.

Examples:

- Receipt ID/date row at $36.86 (01)
- Resort tax and service charge (03)
- Service charges (07 and 28)
- `Amount` (11 and 34)
- `Taxable` or `Taxes` (22 and 42)
- `FOOD` (31)
- Card `AID` row (36)
- `TXTL`, `TOTL`, and `CHNG` (43)

### 4. Zero-price modifiers and instructions become products

Rows such as `Reg`, `Med`, `Vegetables`, `No Beverage`, and kitchen instructions appear as standalone purchase lines.

Examples: 01, 07, 09, 14, 24, and 37.

### 5. Row association still shifts names and prices

Several clear photos produce prices on the wrong row or replace the actual item with a nearby header/payment label.

- UMIX: `Description` receives the first price and `PARIS` receives the second; `LE CLASSIQUE` is lost (13).
- Pokeatery: the card `AID` row receives the Poke Box price; Poke Box is lost (36).
- Grotto: nearly every price is shifted to a neighboring label (37).
- Villa D'Este: `Table 3 Guests 2` receives Coffee's $3.50; Coffee becomes unpriced (47).
- Hedleys is a payment slip with no item lines, but `AMOUNT $41.45` becomes a product (34).

### 6. Duplicate representations are not collapsed

Breadfish Cafe prints Chinese and English descriptions for the same four dishes. The draft contains both representations plus a fake Amount line, doubling the receipt value (11).

### 7. Quantity/detail rows attach to the wrong product

Costco's following-line deal quantities are sometimes assigned to the item above instead of the item whose total appears below. Receipt 15 assigns berry quantities to the wrong berry rows; receipt 32 assigns `3 @ 4.29` to salsa rather than the eggs total.

### 8. Discounts and comps make subtotal warnings misleading

The line total uses pre-discount item prices while the receipt subtotal may be post-discount. This creates warnings even when the item lines are otherwise present.

Examples: Costco discounts (20 and 35), the complimentary item on Zoca (46), and the discounted BBQ chips at Hammocks (48).

### 9. Store and date extraction remains unreliable

Store fallbacks select headings such as `The`, `Pasta`, `Dine In`, `Exclut`, or a table header instead of the merchant (02, 04, 14, 17, and 30). Several receipts fall back to today's date despite a visible printed date, including 31, 43, and 49. Others truly have no visible transaction date.

These errors were not included in the line-accuracy percentage, but they prevent a receipt from qualifying as no-edit and can affect idempotency.

### 10. Unknown durable goods remain selected

The line score intentionally excludes durable goods, but the review still requires edits when obvious toys, slippers, cars, snorkel gear, or similar goods start selected.

Examples: 20, 26, and 29.

## Important edge cases

- Receipt 33 contains only totals, tax, and gratuity—no itemized purchase lines. Skipping it is reasonable, although the user would need a different photo to ingest the purchase.
- Receipt 34 is a credit-card payment slip rather than an itemized receipt and should not produce a product.
- Several receipts contain restaurant modifiers or included sides with no separate price. These should not become independent purchases unless the product model deliberately supports modifiers.

## Fix pass

The baseline above remains unchanged. After the baseline was recorded, the following fixes were implemented and the same 50 photos were rerun from the saved OCR results. The verification rerun made **0 new Vision calls** and read all 50 OCR results from cache.

### Fixed

- Plain leading restaurant quantities now parse (`3 Pupusa Queso`, `4 SODA DRINK`, `20 Mixed Meat Lunch`). A plain order count takes precedence over an internal piece count, so `1 Reg 12pc Falafel` is one order rather than 12 inventory units. Plain counts are limited to two digits to avoid treating long numeric item codes as quantities.
- Prepared dishes are kept as dishes when the catalog only recognizes an ingredient. Verified examples include Pulled Pork Sandwich, Chicken Marsala, Chicken Lollipop, Thai Fried Rice, Chicken Tikka Masala, Onion Bhajia, Garlic Naan, Apple French Toast, Shrimp Entree, Lobster Roll, grilled cheese, garlic fries, and Onion Naan. Root Beer now maps to Soda rather than Beer.
- Summary and payment filtering now covers FOOD/BEVERAGE, taxable/tax rows, amount, AID, order/table/description headers, service and resort charges, and abbreviated footer rows such as TXTL/TOTL/CHNG.
- Zero-price restaurant modifiers such as Reg, Med, No Beverage, Vegetables, and kitchen timing instructions are discarded, including when the zero is rebuilt on a separate row.
- Price-before-name association now handles UMIX's numeric detail rows. `PARIS` receives $5.25 and `LE CLASSIQUE` receives $4.95 instead of assigning prices to the Description header.
- Ignoring AID/table headers lets a following standalone price attach to the real product. This restores Poke Box on receipt 36 and Coffee on receipt 47.
- Compact dates such as `Aug08 19`, `Feb23 19`, and `MAR.19'17` now parse. Receipts 31, 43, and 49 receive their printed dates.
- Additional obvious durable goods—figures, Cutie Car, slippers, snorkel gear, and grill covers—start unticked when their wording is recognized.
- Regression coverage was added for the parser, extractor, and catalog behavior above.

### Verified improvements in the 50-photo rerun

- 07 no longer emits Med or Vegetables and keeps the prepared dishes intact.
- 09 and 14 no longer emit the zero-price beverage rows; Milk Shake remains a distinct dish.
- 10, 22, 23, 30, 40, 45, and 49 now expose the printed leading quantities.
- 13 now produces exactly Paris and Le Classique with their correct prices.
- 31 no longer emits FOOD and now uses 2019-08-08.
- 34 is now skipped instead of turning the payment amount into a product.
- 36 produces Poke Box at $13.50 instead of an AID product.
- 43 drops TXTL/TOTL/CHNG and uses 2017-03-19.
- 44 drops the server/date header and keeps Apple French Toast intact.
- 47 restores Coffee at $3.50 instead of a table-header product.
- 50 keeps Onion Naan intact instead of reducing it to Onions.

The post-fix output was intentionally not folded into the untouched baseline score above. The reviewing agent should independently rescore the final drafts against the photos rather than accepting a score produced by the same pass that tuned the rules.

## Remaining issues for review

- Receipt 37 (Grotto) still has a systematic column/row shift. Fixing it safely needs a layout-level word-position fixture; text-only reassignment would risk moving valid prices on other receipts.
- Receipt 11 still contains bilingual duplicate representations. Automatically deciding that adjacent languages describe the same product is not safe from row text alone.
- Costco following-line quantity/detail association is still wrong on receipts 15 and 32.
- Discounts and complimentary items still make gross item totals disagree with post-discount subtotals on receipts 20, 35, 46, and 48.
- Merchant fallback remains weak for split logos such as The Place 2 Be and Bella Pasta, and genuinely absent dates still fall back to today with a warning.
- OCR can confuse a leading `1` with `7` (receipt 02). The parser reports what OCR supplied; globally rewriting `7` to `1` would corrupt legitimate quantities.
- Some durable wording is truncated by OCR (`WOMEN SLIPPE`, `YOUTH SNORKE`), so the full-word durable rules cannot always recognize it.

## Verification commands

- `npx vitest run src/modules/ingestion/receipt/parse.test.ts src/modules/ingestion/receipt/extractor.test.ts src/modules/ingestion/receipt/catalog.test.ts`
- `npx tsx --env-file=.env.local scripts/try-receipt.ts /Users/somua/Downloads/real_us_receipt_photos_50/*.jpg`


## Follow-up pass (independent review)

A second reviewer re-ran all 50 from the cache (0 Vision calls) and found the set is about 80% restaurants, which this app can't restock, so the 8% no-edit figure mostly scores restaurant parsing. Hand-written word lists (`MODIFIER_ONLY`, "apps out first", "spcy fry") were removed in favour of general rules:

- Restaurant checks are detected (server/table/guests/tip rows, or a restaurant word in an unpriced header row) and start fully unticked. 38 of the 41 restaurant receipts across both sets are caught and none of the shop receipts (Costco, Walmart, Trader Joe's, WinCo, Whole Foods) are. Missed: Umix, Surati Farsan Mart, Hammocks.
- `$0.00` lines are dropped, including a zero printed above the name (receipt 01).
- Costco discount rows are summed, so receipts 05, 20 and 35 no longer warn. 07 and 13 still do, correctly.
- Costco item numbers (`E 9462`, `6884`) are stripped for Costco only.
- `PREPARED_DISH` in `extractor.ts` is still a word list; it now only matters for shop receipts.
