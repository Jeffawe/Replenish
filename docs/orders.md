# Orders: paying with PayPal and buying through Zinc

What happens after the app has found a listing for a low product ([restock.md](restock.md)): the user's PayPal is charged, Zinc buys the item from the store, the unused part of the charge is refunded, and the user can follow the parcel. It runs in two ways that share one pipeline:

- **Buy for me**: the user presses the button on a suggestion.
- **Auto-buy**: the scheduled job buys a suggestion for a product that has auto-buy on, when every limit allows it. Otherwise the suggestion stays on the dashboard for the user.

The code is `src/modules/orders/` (guide: [its README](../src/modules/orders/README.md)); the screens are `src/app/orders/`, `src/app/settings/payment/` and the buttons in `src/app/restock/`.

```
suggestion ──▶ checks ──▶ order "processing" ──▶ charge PayPal (ceiling + fees) ──▶ Zinc places the order
                                                      │ declined: failed, nothing charged           │ refused: refund all, failed
                                                                                                    ▼
                                    Zinc bought it: refund the unused part ◀── Zinc finishes (seconds to minutes)
                                    record the purchase (on its way), send tracking to PayPal         │ couldn't buy: refund all, failed
                                    order "placed" ✓                                                  ▼ order "failed" ✗
```

## Money

Zinc buys from the store with our Zinc wallet; PayPal pays us. The user pays for all of it, plus our fee ([order-money.ts](../src/core/order-money.ts)):

| | |
|---|---|
| **Ceiling** | The most Zinc may spend on the item, tax and shipping (its `max_price`): the listing's price × packs, plus 30% (`TAX_AND_SHIPPING_ALLOWANCE`; the sandbox orders came to about 24% more). |
| **Charged up front** | Ceiling + Zinc's $1 fee + our service fee, on the user's PayPal. The service fee is **7% of the store price, at least $1.25**, decided in one place (`serviceFeeCents`). It scales because PayPal's cut does: a flat $1.50 lost money from about $25 up. An order keeps the fees it started with (`orders.fees_cents`). A subscription that eases these fees is an idea for later. |
| **Final cost** | What the store really charged (Zinc reports it) + the two fees. |
| **Refunded** | Charged − final cost, as a partial refund once Zinc has bought it; the whole charge if the order fails. |

**Why charge first and refund, not authorize and capture.** PayPal documents charging a saved PayPal without the user there as an immediate capture. An authorize-only charge on a saved PayPal isn't documented, so it isn't used. The cost is that the user sees a charge, then a refund when something fails. Moving to authorize-then-void later changes only `charge`/`refundOwed` in [pipeline.ts](../src/modules/orders/pipeline.ts).

## The pipeline ([pipeline.ts](../src/modules/orders/pipeline.ts))

`placeOrder` checks everything from fresh data, stores the order, and runs `advanceOrder`. Every step is saved before the next, and every outside call carries the order's id as its reference (PayPal's `PayPal-Request-Id`, Zinc's `idempotency_key`), so a crash or a retry can never charge or buy twice:

1. **Checks**: the product is the user's and not hidden; PayPal is connected and still works; there is a delivery address; PayPal and Zinc are in matching modes (below). A refusal says what's missing.
2. **Order stored** as `processing`. The database allows **one processing order per product** (a unique index), so a double click, or auto-buy racing a click, can't order twice.
3. **Charge PayPal** (`paymentStatus: charged`). Declined → the order fails, nothing was charged, nothing was bought. "PayPal lost the permission" marks the account `reconnect`.
   **No answer isn't a no.** A timeout, a 5xx, or a pending or unclear capture may mean PayPal took the money, so the order stays processing and asks again with the same request id (it can't charge twice), and nothing is bought meanwhile. After 3 hours with no answer it fails with `paymentStatus: unknown`, which tells the user to report a charge rather than saying they weren't charged. The charge asks for `Prefer: return=representation` because PayPal's default answer leaves out the capture.
4. **Zinc places the order**. If Zinc is unreachable it is retried at the next settle (the charge isn't repeated), for up to 3 hours, then refunded. If Zinc refuses it (address, link, our wallet) → full refund, failed.
5. **Zinc finishes**: bought → the refund of the unused part, the purchase recorded, the order `placed`; couldn't buy → full refund, `failed` with the reason (out of stock, price went up, can't deliver, ...). An order stuck for 3 hours is cancelled at Zinc and refunded. If Zinc won't cancel it (it may really be buying it) or isn't answering, we wait, and **24 hours is the limit** (`GIVE_UP_AFTER_MS`): the user is refunded even so, and if Zinc buys it after all, that cost is ours. Status changes are guarded (`updateOrderIf`), so two runs or a cancel can't overwrite each other.
6. **After it's placed**: every 3 hours (`TRACKING_EVERY_MS`), for 30 days, tracking is updated from Zinc and each number is added to the PayPal payment once. **Delivered** moves the stock's date to that day; a parcel **running late** keeps moving it forward (up to 21 days), so the estimate doesn't count stock still on a truck. If the **store cancels** after placing, the order fails, is refunded in full, and stops counting as stock.

`settleOrders` runs the steps still left, and only looks at orders with something to do: in progress, owed a refund (however old: a refund is never given up on), a purchase not yet recorded, or a parcel due a check. It is called by the cron job, and by the Orders page every 3 seconds while anything is processing. A refund PayPal refused is retried at the next settle and can't be sent twice.

**When it's placed** the order is recorded as a purchase for the product, dated for when it should arrive (Zinc's estimate, else 5 days), using `purchase_events.order_id` ([agent-purchase.ts](../src/modules/inventory/agent-purchase.ts)). Estimates leave a purchase out until its date, so the product stays "low" until it arrives, but **it is not suggested or bought again** while an order is processing or on its way (suggestions, the search and auto-buy all skip it). Recording is retried until it works (`purchase_recorded_at`), and until then the order counts as on its way however old it is, because an unrecorded order would look like a product still low.

**Auto-buy mustn't learn from itself.** An order we placed arrives early by design, so a gap ending in one says when we ordered, not how fast the product is used. Learning from it would make each order earlier than the last, which is how a simulated 28-day product reached 64 packs instead of 26 over two years. So those gaps are left out of the rate (`excluded: "agent-purchase"`), and on arrival the order is added to what we estimated was left instead of assuming zero. A stock count is still exact evidence. **With no human input at all** (only auto-buy, no counts, no own purchases) the evidence ages out: after about 8 months confidence falls below 80% and auto-buy goes back to asking, and one stock count restores it. This is deliberate: we shouldn't spend money indefinitely on a rate nothing has confirmed.

## Buy for me and auto-buy

**Buy for me** opens a step on the card to choose how many packs, showing what will be held on PayPal; each other listing has **Buy this one**. It ignores auto-buy's limits (the user asked, and can see the tags). It needs PayPal and an address; if one is missing the button says which, with a link to Settings. When it starts, the user lands on the Orders page, where it shows **Processing**. The listing is read from the database by suggestion id; nothing the browser sends decides what is bought.

**Before anything is spent** the user sees the cost. Every listing on the suggestion card says "+ $2.50 in fees, plus tax and shipping". **Buy for me** opens a confirmation (how many, each fee, what is held on PayPal) with "Don't show me this again" (`user_settings.skip_buy_confirm`, turned back on in Settings > Payment & delivery). A listing with anything unusual (a concern, or a sample) always asks. Switching auto-buy on, in Settings or the Edit dialog, always shows `AutoBuyConsent` first: when it buys, what it costs, the limits. All amounts come from `priceBreakdown`.

**Our limits exist because orders are paid from our Zinc wallet first.** Users can set lower ones, never higher: a higher value is refused when saved, and held to ours when spending if the owner lowers them later. **Buy for me has its own cap** (`BUY_NOW_MAX_ORDER`, default $150 for one order, fees included): the confirmation won't go past it, and the server refuses it anyway. **All users together have a monthly budget** of `PLANNED_USERS` × `AUTOBUY_MAX_MONTH` (100 × $200 = **$20,000** by default), checked in `placeOrder`, so it covers auto-buy and Buy for me. Once reached, nothing is ordered until the 1st: Buy for me says so, auto-buy leaves the suggestion with the reason, and the server logs an error. Raise `PLANNED_USERS` as the app grows; `npm run orders` shows spent against the budget. It is a check before each order, so orders placed at the same moment can pass it by a few orders. It isn't the wallet's balance: an empty wallet still fails orders safely, with a full refund.

**Auto-buy** ([auto.ts](../src/modules/orders/auto.ts), rules in [auto-buy.ts](../src/core/auto-buy.ts)) buys a suggestion only when all of these hold, checked now (the suggestion is a snapshot from when the search ran):

| Rule | Otherwise the suggestion stays, and says |
|---|---|
| Auto-buy is on for the product | "Auto-buy is off for this product" |
| The user has confirmed they track it | "You haven't confirmed you track this product" |
| Confidence ≥ the user's minimum (never below 80%) | "We're only 62% sure it's running out, and your minimum is 80%" |
| The whole order, **fees included**, is in the price range that applies (user's, or the product's own). Zinc's `max_price` is lowered to fit, so tax and shipping can't take it over: the order fails and is refunded instead | "Over your price limit" |
| The whole order is under **our most for one order** (default $50, `AUTOBUY_MAX_ORDER`), and Zinc's `max_price` is lowered to fit | "It's over the $50.00 most auto-buy can spend on one order" |
| No auto-bought order for this product failed, and no order was cancelled, in the last 7 days (`AUTO_RETRY_AFTER_DAYS`), so a failure can't charge and refund on every run | "Our last try at buying this didn't go through, so it's waiting for you" |
| The listing has no concerns (known pack size, usual brand, a store the user asked for). Price and store are worked out again from today's settings, so raising a limit or changing stores applies at once | the concern's label |
| This order wouldn't take the month over the user's cap, or **our most for a month** (default $200, `AUTOBUY_MAX_MONTH`). All the user's orders count, Buy for me included | "It would go over your $50.00 limit for the month" / "...the $200.00 auto-buy can spend in a month" |
| PayPal is connected and there's a delivery address | "Connect your PayPal first so we can pay for it." |

An auto-bought order records why in words ("Auto-buy: 85% sure it was running out (your minimum is 80%) and $8.00 for the items is inside your limits."), shown on the Orders page. **If PayPal isn't set up, auto-buy just asks**, and the dashboard says "Auto-buy needs one more step" with a link until the user connects PayPal and adds an address. What was waiting is bought the next time the job runs.

## What auto-buy would have done (dry run)

Settings > Auto-buy starts with **"What auto-buy would have done this week"** (`preview.ts`, `previewAutoBuy`): each product's history is replayed day by day over the past 7 days, using only what was known that day, then the same rules (`factsFor`, `autoBuyBlockers`) are applied as if its switch were on. Each row says it would have bought, would have asked (and why), or would have searched (no stored listing yet). It costs no credits: nothing is searched or stored. PayPal and the address are left out on purpose, since it is for before they are set up.

## Safety

- **Pretend money meets pretend money** (`spendingMismatch`): a live PayPal charge is refused for sandbox Zinc (it would charge for nothing) and for sample listings; sandbox PayPal is refused for live Zinc (it would spend our real Zinc balance for nothing).
- Sample listings (from the Zinc sandbox or the mock search) are marked everywhere they're shown.
- Server actions start with `requireUser()`; every query is scoped to the user.
- **Sign-in is limited**: 8 wrong passwords for an email in 15 minutes locks it for the rest of the window (`auth/attempts.ts`; the email is stored hashed; a session already signed in is unaffected). **Changing a saved delivery address needs the password**, since it decides where things we charge for go.
- We store PayPal's reference to the saved account (`paypal_accounts.vault_id`), never card or PayPal login details. It only works with our PayPal credentials.
- `PAYPAL_FAKE=1` pretends to be PayPal for trying the app without credentials; it is ignored in production.

## What the user sees

- **The delivery address is required** (everything but the apartment line; marked with a red `*`). Zinc can't place an order without it, and `placeOrder` refuses without it. **Prefill from PayPal:** the PayPal setup asks for `shipping_preference: GET_FROM_FILE`, so the saved account can carry the user's PayPal shipping address (name, address, phone only if the merchant account allows it). `addressFromPaypal` (US only) maps it, it is kept in `paypal_accounts.suggested_address`, and the form is filled with it for the user to check and press Save. It is a suggestion only: nothing ships to it until saved. Not yet seen from a real sandbox buyer (the spec lists the field; a run will show whether PayPal returns it).
- **Auto-buy can't be switched on until PayPal is connected and an address is saved** (`autoBuySetupProblem`): the Settings switches are disabled with a link to set up, and the Edit dialog and the settings action refuse with the reason. Switching it off, and saving a product already on, always work.
- **Settings > Payment & delivery**: Connect PayPal (a plain form post to `/settings/payment/paypal/start`, a real navigation to PayPal and back through `.../paypal/return`), Disconnect, the delivery address, and a "Test mode" note when PayPal is the sandbox.
- **Dashboard product card:** a sky-blue "Ordering now" or "Ordered, arriving Nov 8" pill linking to Orders, while the product still says it's running low.
- **Orders** (`/orders`, linked from the dashboard): every order with its status (**Processing**, **✓ Order placed**, **✗ Failed** with the reason, **Cancelled**), the listing, what was charged and refunded, the expected arrival, and shipment tracking (carrier, number, status, "Track package"). Each order says **why** it was bought: an **Auto-buy** tag with the reason in words (`orders.decision`), or **You asked** (`orders.source` is `auto` or `buy-now`). It is **paged** (10 a page, newest first) with a **month filter** (`?month=2026-11&page=2`; months are UTC; the filter shows once orders span two months). **It refreshes itself:** every 3 s while something is processing (that also settles it), otherwise a cheap read every 20 s and when the tab regains focus, so an auto-buy made by the scheduled job while the page is open appears without a reload. Orders the user hasn't seen get a **New** tag, a count badge on the dashboard's Orders icon, and the dashboard banner ("Auto-buy bought Toilet Paper for $14.48"); looking at them on the Orders page marks them seen.
- **Dashboard banner**: orders that finished while the user was away, as ✓ or ✗ lines with "Got it"; orders watched finishing on the Orders page aren't repeated.
- Tracking only shows once the store ships it; it is refreshed whenever orders settle.

## Configuration

| Variable | |
|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | From the PayPal developer dashboard. The ID is public; keep the secret out of git. |
| `PAYPAL_ENV` | `sandbox` (default) or `live`. Must match the app's mode. |
| `PAYPAL_STORED_CREDENTIAL` | `1` adds PayPal's "stored credential" fields to charges, if PayPal asks for them. |
| `ZINC_API_KEY` | `zn_test_...` is the free sandbox (`npm run zinc:key`); a live key needs a funded wallet. |
| `CRON_SECRET` | Guards the cron routes. |
| `AUTOBUY_MAX_ORDER`, `AUTOBUY_MAX_MONTH` | The most auto-buy may spend per user, in dollars (defaults 50 and 200). Users can set lower limits, never higher. |
| `BUY_NOW_MAX_ORDER` | The most one Buy for me order may cost, in dollars, fees included (default 150). |
| `PLANNED_USERS` | How many users the month's budget for everyone is planned for (default 100). The budget is this × `AUTOBUY_MAX_MONTH`. |
| `APP_URL` | Optional: the public address, for the link PayPal returns the user to (otherwise taken from the request). |

```bash
npm run paypal:check                 # does PayPal accept the client ID and secret? (charges nothing)
npm run orders                       # the latest orders
npm run orders -- --settle           # first move unfinished orders along (asks Zinc, refunds what's owed)
```

Cron: `GET /api/low-stock/check?auto=1` is the whole job (settle, check, suggest, auto-buy; `&mock=1` for invented listings, refused in production) and `GET /api/orders/settle` only settles. Both take `Authorization: Bearer <CRON_SECRET>`. A schedule of every few minutes suits `settle`; the full job can run less often.

## What is verified

- **Tested** with fakes against the real database: the happy path, each failure and its refund, a Zinc outage after the charge, stuck orders, a refund PayPal refuses, double orders, other users' suggestions, the auto-buy rules, connecting and disconnecting PayPal.
- **Run in a real browser** (with a pretend PayPal and Zinc's real sandbox): no PayPal → connect → address → Buy for me → Processing → ✓ placed with a partial refund and tracking; auto-buy of one product succeeding and one failing ("out of stock") with a full refund; the ✓/✗ banner and the Orders page, in light and dark.
- **Zinc's sandbox** shapes were checked against the real API (order result, price breakdown, tracking, each failure type).
- **NOT yet run against PayPal itself.** The PayPal client follows PayPal's documentation and is tested with a fake `fetch`. The first real run needs the secret in `.env.local` (`npm run paypal:check`), then the Connect button with a sandbox buyer account. Likely first surprises: the exact fields PayPal wants on a saved-account charge (try `PAYPAL_STORED_CREDENTIAL=1`), and what PayPal puts on the return URL (we don't depend on it). PayPal's errors are logged with their `debug_id`.

## Known limits and what's next

- **Channel3 links must be solved before going live.** A Channel3 listing's `url` is a `buy.trychannel3.com` page that forwards with a script. Zinc's sandbox accepts it, but live Zinc works out the store from the link, so expect `unsupported_retailer`. See docs/restock.md.
- **Perishables** (milk, eggs) can't be ordered through Zinc reliably; they should stay ask-only (not enforced yet).
- **No webhooks yet.** PayPal's and Zinc's webhooks would replace polling; settling every few minutes does the job for now.
- **Cancelling only works while Zinc still has the order queued** (Zinc's rule: `POST /orders/{id}/cancel` returns `order_not_cancellable` after that). **Cancel order** shows on a processing order and says when it is too late; a placed order says it can be returned to the store. There is no return flow in the app.
- **No email or push** to the user (left out for now): the dashboard and Orders page are how they find out.
- **Authorize-then-void** instead of charge-then-refund, once PayPal's support for it on a saved account is confirmed.
