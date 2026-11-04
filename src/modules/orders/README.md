# Orders

Paying with the user's PayPal, buying through Zinc, refunds, and shipment tracking. The full explanation (flow, money, auto-buy rules, safety, what's verified) is in [docs/orders.md](../../../docs/orders.md); this is the short guide to the module.

## The boundary

| Door | Who uses it | What it gives |
|---|---|---|
| [`index.ts`](index.ts) (server) | server actions, pages, cron routes, scripts | `buyNow`, `placeOrder`, `settleOrders`, `runAutoBuy`, `listOrders`, `paymentSetup`, `startPaypalSetup` / `finishPaypalSetup` / `disconnectPaypal`, `orderDepsFromEnv`, `checkPaypalCredentials` |
| [`client.ts`](client.ts) (browser) | the Orders page and banners | the `OrderView` shape and its parts |

## Files

| File | Job |
|---|---|
| `pipeline.ts` | `placeOrder`, `advanceOrder`, `settleOrders`: the steps, each saved before the next, safe to repeat |
| `auto.ts` | `considerAutoBuy` (the rules, from fresh data) and `runAutoBuy` (the whole scheduled job) |
| `preview.ts` | `previewAutoBuy`: what auto-buy would have done this week (replays history, spends and searches nothing) |
| `service.ts` | What the screens call: `buyNow`, `cancelOrder`, `ordersOnTheWay`, the orders list, connecting PayPal, setup status |
| `payments.ts` / `paypal.ts` | The `Payments` interface, a `FakePayments`, and the real PayPal client (vault, charge, refund, tracking) |
| `fulfilment.ts` / `fake-fulfilment.ts` | The `Fulfilment` interface, the Zinc client, and a scriptable fake |
| `repo.ts` | The only file that touches the database; `toView` makes an order into plain data |
| `types.ts` | The listing, tracking and order shapes (the first two are read back through schemas) |
| `deps.ts` | PayPal and Zinc from the environment (`PAYPAL_FAKE=1` for development) |

Pure rules are in `src/core/`: `order-money.ts` (ceiling, fees, refunds) and `auto-buy.ts` (when auto-buy may buy, and why not in words).

## Rules worth knowing before changing anything

- **Every step is saved before the next, and every outside call carries the order id as its reference.** That is what makes a crash or a retry safe. Keep it that way.
- **One processing order per product** is a database index, not just a check.
- **No answer from PayPal isn't a no.** Only a definite refusal may say "you weren't charged"; anything unclear is asked again with the same request id.
- **Status changes go through `updateOrderIf`**, so two runs (or a cancel) can't overwrite each other.
- **Money never goes out without a way back**: the user is charged the ceiling, and whatever isn't used is refunded; a failure refunds everything. A refund PayPal refuses is retried at the next settle.
- **Pretend money must meet pretend money** (`spendingMismatch`).
- Re-read the product, settings, address and PayPal before spending: a suggestion is a snapshot.
- Nothing outside this module reaches into its files; the lint rule enforces the two doors.
