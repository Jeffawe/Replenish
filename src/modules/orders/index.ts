/**
 * The server door to orders: paying with the user's PayPal, buying through Zinc, refunds, and
 * shipment tracking. Server actions, pages and the cron routes import from here; browser code
 * imports from ./client. Start with ./README.md.
 */
export { considerAutoBuy, runAutoBuy } from "./auto";
export type { AutoBuyOutcome, AutoBuyReport } from "./auto";
export { orderDepsFromEnv, paymentsConfigured, paymentsFromEnv } from "./deps";
export { FulfilmentError } from "./fulfilment";
export { PaymentError } from "./payments";
export { checkPaypalCredentials } from "./paypal";
export { advanceOrder, placeOrder, settleOrders, spendingMismatch } from "./pipeline";
export type { CancelOutcome, OrderDeps, PlaceOutcome, RefusalReason } from "./pipeline";
export {
  autoBuyNeedsSetup,
  autoBuyTerms,
  autoBuySetupProblem,
  buyNow,
  cancelOrder,
  ordersOnTheWay,
  disconnectPaypal,
  finishPaypalSetup,
  listOrders,
  listOrdersPage,
  markOrderResultsSeen,
  monthlyBudget,
  paymentSetup,
  refreshOrders,
  startPaypalSetup,
  unseenOrderResults,
} from "./service";
export type { PaymentSetup } from "./service";
export { previewAutoBuy } from "./preview";
export type { AutoBuyPreview, PreviewRow } from "./preview";
export { parseOrdersQuery } from "./query";
export { MOST_PACKS } from "./types";
export type { SuggestedAddress } from "./payments";
