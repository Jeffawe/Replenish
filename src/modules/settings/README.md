# Settings

What a user can tune: how auto-buy behaves, and when a product counts as low. The page is `/settings` (tabs **Auto-buy** and **Estimates**) in `src/app/settings/`.

## The boundary

| Door | Who uses it | What it gives |
|---|---|---|
| [`index.ts`](index.ts) (server) | `src/app/settings/` actions and pages, `inventory/service.ts` | `getUserSettings`, `saveAutobuySettings`, `saveEstimateSettings`, `setProductAutobuy`, the form schemas |
| [`client.ts`](client.ts) (browser) | the settings forms | the `UserSettings` shape and the confidence floor |

The rules and defaults are plain functions in `src/core/user-settings.ts` (the 80% floor, the default settings, which price range applies to a product). Only `repo.ts` touches the database.

## What is stored, and where

- **`user_settings`**: one row per user, created the first time they change something. No row means all defaults. Minimum confidence, price range (cents, per item), monthly cap, lead days, low-stock threshold.
- **`products`**: `autobuy_enabled` (default **off**), the product's own price range, and `bought_from` (+ `bought_from_by_user`).

## Decided with the user

- **No master switch.** Auto-buy is a per-product switch, off for every product until the user turns it on. Finding a low product online happens either way: switch on and the purchase fits the limits, we buy it; otherwise we ask the user. So every limit below means "fall back to asking", never "do nothing".
- **The 80% confidence floor** (`MIN_AUTOBUY_CONFIDENCE`) can be raised, never lowered. It's enforced in the form schema (`types.ts`) and again when reading (`clampConfidence`). Confidence is the score from `predict.ts`, not a probability.
- **Only a confirmed product** (`confirmed_at` set) can have auto-buy on. The Edit dialog, the settings list and `setProductAutobuy` all enforce it. Whatever buys later must check it again, because a product can be unconfirmed after the fact.
- **Price range**: the user's range (either side may be blank) applies unless a product sets its own, which replaces it whole (`priceRangeFor`), so the two are never mixed into an impossible range.
- **The switch is in two places** (the product's Edit dialog and the Auto-buy tab's list) but it is one stored value.
- **Where it was bought**: filled from the store of the product's latest purchase (`rememberStore` in `inventory/ingest.ts`; an older receipt scanned late doesn't change it) until the user types their own in Edit, which receipts then leave alone. Clearing it hands it back to receipts.
- **Low-stock threshold**: the Estimates tab's value is what `predict()` already took as `userLowStockThresholdDays`; `getInventory` now passes it. A product's own threshold still wins.

## Not built yet

The price range is read by the finder (`src/modules/restock`) to flag listings outside it; nothing reads the confidence or monthly cap yet. They are saved for the step after the low-stock check (see AGENTS.md), which will buy or ask. The lead days and the low-stock threshold are read by that check: a product needs attention within whichever is longer. Saving either form refreshes `next_check_at` for all the user's products.

## Delivery address

`getDeliveryAddress` / `saveDeliveryAddress` and `DeliveryAddressSchema` (in `types.ts`): where orders are delivered, kept on `user_settings` (all fields, or none: `getDeliveryAddress` is null until it is complete). US addresses only; the phone is kept as ten digits. The form is on Settings > Payment & delivery (`src/app/settings/payment/`), next to connecting PayPal, which belongs to the orders module (docs/orders.md). The schema ignores fields it doesn't know, because a submitted form carries hidden ones of Next's own.

**Preferred stores** (`preferred_stores`, a ranked list, Settings > Auto-buy): listings at these stores rank first, in the user's order, and with any listed, auto-buy asks before buying anywhere else. Food is only searched at Walmart and Amazon whatever the list says, because those are the stores Zinc can order from. The price range covers the whole order, with tax, shipping and fees.

**Our limits** (`platformLimitsFrom`, `AUTOBUY_MAX_ORDER`, `AUTOBUY_MAX_MONTH`; defaults $50 and $200): the most auto-buy may spend for a user. Their own limits can only be lower. `skip_buy_confirm` is "Don't show me this again" on Buy for me.

`BUY_NOW_MAX_ORDER` (default $150) caps one Buy for me order. `PLANNED_USERS` (default 100) × `AUTOBUY_MAX_MONTH` is the month's budget across all users. See docs/orders.md.
