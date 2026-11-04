/**
 * The money in an order, in cents. Zinc buys the item from the store (paid from our Zinc wallet) and
 * charges $1 on top; we charge the user's PayPal for all of it plus our own fee. We can't know the
 * exact tax and shipping until Zinc has bought it, so the user is charged a ceiling up front and the
 * unused part is refunded once the real total is known.
 */

/** Zinc's fee on every order that is placed. */
export const ZINC_FEE_CENTS = 100;

/** Our service fee: a share of the store price, with a minimum so a small order still covers PayPal's cut. */
export const SERVICE_FEE_SHARE = 0.07;
export const SERVICE_FEE_MIN_CENTS = 125;

/** The fee in words, for the screens that explain it before there is a price to work it out from. */
export const SERVICE_FEE_TERMS = `${Math.round(SERVICE_FEE_SHARE * 100)}% of the store price, at least $${(SERVICE_FEE_MIN_CENTS / 100).toFixed(2)}`;

/**
 * What we charge for doing the buying, on top of Zinc's fee. This is the only place the amount is
 * decided, so changing it changes it everywhere it is charged and shown. It scales because PayPal's
 * cut does: a flat fee lost money on larger orders. An order keeps the fees it started with (`orders.fees_cents`).
 */
export function serviceFeeCents(itemsCents: number): number {
  return Math.max(SERVICE_FEE_MIN_CENTS, Math.round(itemsCents * SERVICE_FEE_SHARE));
}

/** All the fees on an order: Zinc's and ours. */
export function orderFeesCents(itemsCents: number): number {
  return ZINC_FEE_CENTS + serviceFeeCents(itemsCents);
}

/** What fees orders made before the fee was stored on each order carried. */
export const LEGACY_FEES_CENTS = 250;

/** How much more than the items' price Zinc may spend, to cover tax and shipping (sandbox orders came to about 24% more). */
export const TAX_AND_SHIPPING_ALLOWANCE = 0.3;

/** Days an order is assumed to take to arrive when Zinc gives no date. */
export const DEFAULT_DELIVERY_DAYS = 5;

/**
 * The most Zinc may spend on the order (its `max_price`), given what the items cost. With a limit on
 * the whole order (auto-buy within the user's price range) there is less room for tax and shipping,
 * so the store's total can never push the order past what the user allowed. The order then fails and
 * is refunded rather than going over.
 */
export function zincCeilingCents(itemsCents: number, wholeOrderLimitCents: number | null = null): number {
  const usual = Math.ceil(itemsCents * (1 + TAX_AND_SHIPPING_ALLOWANCE));
  return wholeOrderLimitCents === null ? usual : Math.min(usual, wholeOrderLimitCents - orderFeesCents(itemsCents));
}

/** The least an order of these items can cost: the items and the fees, before any tax or shipping. */
export function leastOrderCostCents(itemsCents: number): number {
  return itemsCents + orderFeesCents(itemsCents);
}

/** What should have gone back to the user by now: everything if the order didn't happen, the unused part if it did. */
export function refundShouldBeCents(order: { status: string; chargedCents: number | null; totalCents: number | null }): number {
  if (order.chargedCents === null || order.status === "processing") return 0;
  if (order.status === "failed" || order.status === "cancelled") return order.chargedCents;
  return refundDueCents(order.chargedCents, order.totalCents ?? order.chargedCents);
}

/** What PayPal is charged when the order starts. */
export function upfrontChargeCents(ceilingCents: number, feesCents: number): number {
  return ceilingCents + feesCents;
}

/** What the order really cost, from the total Zinc paid the store. */
export function finalCostCents(zincTotalCents: number, feesCents: number): number {
  return zincTotalCents + feesCents;
}

/** Everything the screens say about what an order costs, from one place. */
export interface PriceBreakdown {
  itemsCents: number;
  /** Zinc's fee, called the ordering fee on screen. */
  orderingFeeCents: number;
  serviceFeeCents: number;
  feesCents: number;
  /** The least it can cost: items and fees, before tax and shipping. */
  leastCents: number;
  /** What is held on PayPal up front; what isn't used comes back. */
  heldCents: number;
}

export function priceBreakdown(itemsCents: number, wholeOrderLimitCents: number | null = null): PriceBreakdown {
  const feesCents = orderFeesCents(itemsCents);
  return {
    itemsCents,
    orderingFeeCents: ZINC_FEE_CENTS,
    serviceFeeCents: serviceFeeCents(itemsCents),
    feesCents,
    leastCents: itemsCents + feesCents,
    heldCents: upfrontChargeCents(zincCeilingCents(itemsCents, wholeOrderLimitCents), feesCents),
  };
}

/** What goes back to the user once the real cost is known (never negative). */
export function refundDueCents(chargedCents: number, finalCostCents: number): number {
  return Math.max(0, chargedCents - finalCostCents);
}

/** 1234 -> "12.34", the form PayPal takes amounts in. */
export function centsToDecimal(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/** The start of the calendar month (UTC) `now` falls in, for the monthly spending cap. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
