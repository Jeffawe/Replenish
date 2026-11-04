import { DEFAULT_DELIVERY_DAYS, finalCostCents, LEGACY_FEES_CENTS, monthStart, orderFeesCents, refundShouldBeCents, upfrontChargeCents, zincCeilingCents } from "@/core/order-money";
import type { OrderRow, Product } from "@/db/schema";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { moveAgentPurchase, recordAgentPurchase, removeAgentPurchase } from "@/modules/inventory/agent-purchase";
import type { Suggestion } from "@/modules/restock";
import type { PlatformLimits } from "@/core/user-settings";
import { getDeliveryAddress, platformLimits } from "@/modules/settings";
import { FulfilmentError, type Fulfilment, type ZincOrderState } from "./fulfilment";
import { PaymentError, type Payments } from "./payments";
import { getOrder, getPaypalAccount, getUserOrder, insertOrder, listOrdersToSettle, markPaypalBroken, spentByEveryoneSince, TRACKING_EVERY_MS, updateOrder, updateOrderIf } from "./repo";
import type { OrderListing, OrderSource, Tracking } from "./types";

/**
 * Buying a suggested listing. The steps, each saved before the next so a crash can pick up where it
 * stopped (nothing is charged or bought twice; every call carries the order's id as its reference):
 *
 *   1. Check everything is in place, then store the order as "processing".
 *   2. Charge the user's saved PayPal for the most the order could cost: the ceiling for the store
 *      (item, tax, shipping) plus Zinc's fee and ours. If PayPal says no, the order fails; nothing is bought.
 *      No answer isn't a no: it is asked again with the same reference, and nothing is bought meanwhile.
 *   3. Ask Zinc to buy it. If Zinc won't take the order, refund everything and fail.
 *   4. Zinc finishes in seconds to minutes. If it bought the item: refund what the ceiling didn't use,
 *      record the purchase (the product is on its way), and tell PayPal the tracking number.
 *      If it couldn't: refund everything and fail, saying why.
 *   5. While the parcel is out, follow it: the stock counts from the day it is delivered.
 *
 * `advanceOrder` runs whatever steps are left for one order; `settleOrders` does it for every unfinished
 * order (the cron job, and the Orders page while it is open).
 */

export interface OrderDeps {
  payments: Payments;
  fulfilment: Fulfilment;
  now?: () => Date;
  /** For tests. Otherwise the owner's limits from the environment. */
  limits?: PlatformLimits;
}

/** An order Zinc is still working on after this long is cancelled and refunded, if Zinc will cancel it. A step that can't get through at all stops here too. */
export const STUCK_AFTER_MS = 3 * 60 * 60 * 1000;

/**
 * However things stand, the user's money isn't held longer than this. It is longer than STUCK_AFTER_MS
 * because Zinc may really be buying it: past this the refund goes out even if Zinc hasn't answered,
 * and if it does buy the item after all, that cost is ours rather than the user's.
 */
export const GIVE_UP_AFTER_MS = 24 * 60 * 60 * 1000;

/** A parcel running late stops pushing the stock's date forward this long after the order: it's probably lost, and the estimate shouldn't wait for ever. */
const LATE_PARCEL_LIMIT_MS = 21 * 24 * 60 * 60 * 1000;

const clock = (deps: OrderDeps) => (deps.now ?? (() => new Date()))();

export type RefusalReason = "not-found" | "no-paypal" | "reconnect-paypal" | "no-address" | "already-ordering" | "unsafe" | "over-limit" | "budget-reached";

export type PlaceOutcome =
  | { status: "started"; orderId: string }
  | { status: "refused"; reason: RefusalReason; message: string };

const refuse = (reason: RefusalReason, message: string): PlaceOutcome => ({ status: "refused", reason, message });

/**
 * Whether it is safe to spend: pretend money must only meet pretend money. A live PayPal charge for a
 * sandbox Zinc order would take real money for nothing; a sandbox PayPal charge for a live Zinc order
 * would spend our real Zinc balance for nothing.
 */
export function spendingMismatch(payments: Pick<Payments, "environment">, fulfilment: Pick<Fulfilment, "sandbox">, sample: boolean): string | null {
  const live = payments.environment === "live";
  if (live && sample) return "That listing is sample data, so it can't be bought with real money.";
  if (live && fulfilment.sandbox) return "PayPal is live but Zinc is in test mode, so nothing would be bought.";
  if (!live && !fulfilment.sandbox) return "Zinc is live but PayPal is in test mode, so this order wouldn't be paid for.";
  return null;
}

/**
 * Starts buying a suggestion for the user. Everything that can be checked is checked now, from fresh
 * data (the suggestion is a snapshot: the product, address and PayPal may have changed since). Returns
 * as soon as the order has been charged and sent to Zinc; the result shows up on the Orders page.
 */
export async function placeOrder(
  input: {
    userId: string;
    suggestion: Suggestion;
    source: OrderSource;
    decision?: string | null;
    /** Which of the suggestion's listings, and how many packs, when the user chose. Otherwise its best listing as it stands. */
    choice?: { listing: Suggestion["pick"]; packs: number };
    /** The most the whole order may cost, fees included: auto-buy keeps to the user's price range. */
    wholeOrderLimitCents?: number | null;
  },
  deps: OrderDeps,
): Promise<PlaceOutcome> {
  const { userId, suggestion, source, decision = null, choice, wholeOrderLimitCents = null } = input;
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, suggestion.productId), eq(products.userId, userId), isNull(products.archivedAt)));
  if (!product) return refuse("not-found", "That product isn't being tracked any more.");

  const account = await getPaypalAccount(userId);
  if (!account?.vaultId) return refuse("no-paypal", "Connect your PayPal first so we can pay for it.");
  if (account.status === "reconnect") return refuse("reconnect-paypal", "PayPal needs you to connect your account again.");
  if (!(await getDeliveryAddress(userId))) return refuse("no-address", "Add your delivery address first so we know where to send it.");

  const pick = choice?.listing ?? suggestion.pick;
  const packs = choice?.packs ?? pick.packs;
  const unsafe = spendingMismatch(deps.payments, deps.fulfilment, pick.sample);
  if (unsafe) return refuse("unsafe", unsafe);

  const itemsCents = pick.priceCents * packs;
  const ceilingCents = zincCeilingCents(itemsCents, wholeOrderLimitCents);
  const feesCents = orderFeesCents(itemsCents);

  // Every order comes through here, so this is where the wallet is protected. All users' orders count.
  const budget = (deps.limits ?? platformLimits()).allUsersMonthCents;
  const committed = await spentByEveryoneSince(monthStart(clock(deps)));
  if (committed + upfrontChargeCents(ceilingCents, feesCents) > budget) {
    console.error(`The month's budget for all users is reached: $${(committed / 100).toFixed(2)} of $${(budget / 100).toFixed(2)}. Raise PLANNED_USERS to allow more.`);
    return refuse("budget-reached", "We've reached our ordering limit for this month, so we can't place this order right now. It resets on the 1st.");
  }
  const listing: OrderListing = {
    title: pick.title,
    domain: pick.domain,
    url: pick.url,
    brand: pick.brands[0] ?? null,
    priceCents: pick.priceCents,
    packSize: pick.packSize,
    sample: pick.sample,
  };
  const order = await insertOrder({
    userId,
    productId: product.id,
    productName: product.name,
    source,
    decision,
    listing,
    packs,
    ceilingCents,
    feesCents,
    paymentStatus: "none",
  });
  if (order === "already-ordering") return refuse("already-ordering", `We're already ordering ${product.name} for you.`);

  await advanceOrder(order.id, deps);
  return { status: "started", orderId: order.id };
}

const failureFor = (error: PaymentError): string =>
  error.kind === "reconnect" ? "PayPal needs you to connect your account again. You weren't charged." : "PayPal couldn't take the payment. You weren't charged.";

/** Takes the order out of "processing", unless something else (the user cancelling, another run) already has. */
async function failOrder(order: OrderRow, reason: string, patch: Partial<OrderRow> = {}): Promise<OrderRow> {
  return (await updateOrderIf(order.id, "processing", { status: "failed", failureReason: reason, seenAt: null, ...patch })) ?? (await getOrder(order.id)) ?? order;
}

const ageOf = (order: OrderRow, deps: OrderDeps) => clock(deps).getTime() - order.createdAt.getTime();

/** Charges PayPal if that hasn't happened; returns the order as it is afterwards. */
async function charge(order: OrderRow, product: Pick<Product, "name">, deps: OrderDeps): Promise<OrderRow> {
  if (order.paypalCaptureId) return order;
  const account = await getPaypalAccount(order.userId);
  if (!account?.vaultId || account.status === "reconnect") return failOrder(order, "PayPal needs you to connect your account again. You weren't charged.");
  const amount = upfrontChargeCents(order.ceilingCents, order.feesCents ?? LEGACY_FEES_CENTS);
  try {
    const paid = await deps.payments.charge({ vaultId: account.vaultId, amountCents: amount, description: `Replenish: ${product.name}`, reference: order.id });
    return updateOrder(order.id, { paypalOrderId: paid.paypalOrderId, paypalCaptureId: paid.captureId, paymentStatus: "charged", chargedCents: amount });
  } catch (error) {
    if (!(error instanceof PaymentError)) throw error;
    if (error.kind === "unavailable") {
      // No answer isn't a no: PayPal may have taken the money. Ask again with the same request id
      // (it can't charge twice, and gives back the first answer) and say nothing we don't know.
      if (ageOf(order, deps) <= STUCK_AFTER_MS) return order;
      console.error("PayPal never confirmed a charge", order.id);
      return failOrder(order, "We couldn't get an answer from PayPal, so we stopped this order and bought nothing.", { paymentStatus: "unknown" });
    }
    if (error.kind === "reconnect") await markPaypalBroken(order.userId);
    return failOrder(order, failureFor(error));
  }
}

/** Sends the order to Zinc if that hasn't happened. Nothing goes to Zinc until PayPal has confirmed the money. */
async function submit(order: OrderRow, deps: OrderDeps): Promise<OrderRow> {
  if (order.zincOrderId || !order.paypalCaptureId) return order;
  const address = await getDeliveryAddress(order.userId);
  const listing = order.listing as OrderListing;
  if (!address) return failOrder(order, "We don't have your delivery address, so we cancelled the order.");
  try {
    const placed = await deps.fulfilment.place({ url: listing.url, quantity: order.packs, address, maxPriceCents: order.ceilingCents, reference: order.id });
    const saved = await updateOrder(order.id, { zincOrderId: placed.zincOrderId });
    // The user cancelled while Zinc was answering.
    if (saved.status === "cancelled") await deps.fulfilment.cancel(placed.zincOrderId);
    return saved;
  } catch (error) {
    if (!(error instanceof FulfilmentError)) throw error;
    // Zinc being unreachable might pass: leave the order to be tried again, for a while. Anything else is final.
    if (error.kind === "unavailable") return ageOf(order, deps) > STUCK_AFTER_MS ? failOrder(order, "We couldn't reach the store's ordering service, so we stopped the order.") : order;
    return failOrder(order, `${error.kind === "insufficient-funds" ? "We couldn't place the order right now" : error.message}.`);
  }
}

/** The item was bought: record what it cost, when it should arrive, and that it is on its way. */
async function markPlaced(order: OrderRow, state: Extract<ZincOrderState, { state: "placed" }>, deps: OrderDeps): Promise<OrderRow> {
  const arrivesAt = state.estimatedDelivery ?? new Date(clock(deps).getTime() + DEFAULT_DELIVERY_DAYS * 24 * 60 * 60 * 1000);
  const tracking: Tracking[] = state.tracking.map((entry) => ({ ...entry, sentToPaypal: false }));
  const placed = await updateOrderIf(order.id, "processing", {
    status: "placed",
    totalCents: finalCostCents(state.totalCents, order.feesCents ?? LEGACY_FEES_CENTS),
    merchantOrderId: state.merchantOrderId,
    arrivesAt,
    tracking,
    trackingCheckedAt: clock(deps),
    seenAt: null,
  });
  return placed ?? (await getOrder(order.id)) ?? order;
}

/**
 * Records a placed order as a purchase, so estimates count it when it arrives. It is safe to repeat,
 * and repeated until it works: an order nobody recorded looks like a product still running low, and would be bought again.
 */
async function recordPurchase(order: OrderRow, product: Pick<Product, "id" | "unit" | "normalPurchaseQty" | "brand"> | undefined, deps: OrderDeps): Promise<OrderRow> {
  if (order.status !== "placed" || order.purchaseRecordedAt || !product || !order.arrivesAt) return order;
  const listing = order.listing as OrderListing;
  try {
    await recordAgentPurchase(order.userId, {
      orderId: order.id,
      productId: product.id,
      // When the pack size isn't known each pack is counted as one usual purchase.
      quantity: (listing.packSize ?? product.normalPurchaseQty) * order.packs,
      unit: product.unit,
      priceCents: order.totalCents ?? 0,
      brand: listing.brand ?? product.brand,
      store: listing.domain,
      arrivesAt: order.arrivesAt,
    });
    return await updateOrder(order.id, { purchaseRecordedAt: clock(deps) });
  } catch (error) {
    console.error("Could not record the purchase for an order; it is tried again next time", order.id, error);
    return order;
  }
}

/** Gives back what is owed: everything when the order didn't happen, the unused part of the ceiling when it was placed. */
async function refundOwed(order: OrderRow, deps: OrderDeps): Promise<OrderRow> {
  if (!order.paypalCaptureId) return order;
  const owed = refundShouldBeCents(order);
  const remaining = owed - order.refundedCents;
  if (remaining <= 0) return order;
  try {
    await deps.payments.refund({
      captureId: order.paypalCaptureId,
      amountCents: remaining,
      reference: `${order.id}-${owed}`,
      note: order.status === "placed" ? "The unused part of your Replenish order." : "Your Replenish order didn't go ahead, so this is a full refund.",
    });
    return updateOrder(order.id, { refundedCents: owed, paymentStatus: owed >= order.chargedCents! ? "refunded" : "part-refunded" });
  } catch (error) {
    // PayPal is down or refused: it is retried the next time orders are settled, however long that takes.
    console.error("Could not refund an order", order.id, error instanceof Error ? error.message : error);
    return order;
  }
}

/** Gives PayPal the tracking numbers it hasn't been given. A failure is retried later and never touches the order. */
async function sendTracking(order: OrderRow, deps: OrderDeps): Promise<OrderRow> {
  const tracking = (order.tracking as Tracking[]) ?? [];
  if (!order.paypalOrderId || !order.paypalCaptureId || tracking.every((entry) => entry.sentToPaypal)) return order;
  let changed = false;
  const updated: Tracking[] = [];
  for (const entry of tracking) {
    if (entry.sentToPaypal) {
      updated.push(entry);
      continue;
    }
    try {
      await deps.payments.addTracking({ paypalOrderId: order.paypalOrderId, captureId: order.paypalCaptureId, trackingNumber: entry.number, carrier: entry.carrier });
      updated.push({ ...entry, sentToPaypal: true });
      changed = true;
    } catch (error) {
      console.error("Could not send tracking to PayPal", order.id, error instanceof Error ? error.message : error);
      updated.push(entry);
    }
  }
  return changed ? updateOrder(order.id, { tracking: updated }) : order;
}

const allDelivered = (tracking: Tracking[]) => tracking.length > 0 && tracking.every((entry) => entry.status === "delivered");

/**
 * The date stock from this order counts from, given what the carrier says now. Delivered: today, if
 * we were still expecting it. Running late: tomorrow, so the estimate doesn't count a parcel still on
 * a truck. Null when the date stands.
 */
function arrivalFromTracking(order: OrderRow, tracking: Tracking[], now: Date): Date | null {
  if (!order.arrivesAt) return null;
  if (allDelivered(tracking)) return order.arrivesAt > now ? now : null;
  const late = tracking.length > 0 && order.arrivesAt <= now && now.getTime() - order.createdAt.getTime() < LATE_PARCEL_LIMIT_MS;
  return late ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : null;
}

/**
 * Every few hours while the parcel is out: brings tracking up to date from Zinc (keeping what PayPal
 * has been told), moves the stock's date to when it really arrives, and catches a store cancelling
 * after the order was placed, which refunds the user and stops the order counting as stock.
 */
async function refreshTracking(order: OrderRow, deps: OrderDeps): Promise<OrderRow> {
  const current = (order.tracking as Tracking[]) ?? [];
  const now = clock(deps);
  const due = !order.trackingCheckedAt || now.getTime() - order.trackingCheckedAt.getTime() >= TRACKING_EVERY_MS;
  if (!due || !order.zincOrderId || allDelivered(current)) return order;
  const stamped = await updateOrder(order.id, { trackingCheckedAt: now });
  try {
    const state = await deps.fulfilment.check(order.zincOrderId);
    if (state.state === "failed") {
      const cancelled = await updateOrderIf(order.id, "placed", { status: "failed", failureReason: `The store cancelled this order after it was placed: ${state.reason}.`, arrivesAt: null, seenAt: null });
      if (cancelled?.productId) await removeAgentPurchase(cancelled.userId, cancelled.id, cancelled.productId);
      return cancelled ?? stamped;
    }
    if (state.state !== "placed") return stamped;
    const sent = new Map(current.map((entry) => [entry.id, entry.sentToPaypal]));
    const merged: Tracking[] = state.tracking.map((entry) => ({ ...entry, sentToPaypal: sent.get(entry.id) ?? false }));
    const arrival = arrivalFromTracking(stamped, merged, now);
    if (arrival && stamped.productId) await moveAgentPurchase(stamped.userId, stamped.id, stamped.productId, arrival);
    if (!arrival && JSON.stringify(merged) === JSON.stringify(current)) return stamped;
    return await updateOrder(order.id, { tracking: merged, ...(arrival ? { arrivesAt: arrival } : {}) });
  } catch (error) {
    if (!(error instanceof FulfilmentError)) console.error("Could not update tracking", order.id, error);
    return stamped;
  }
}

/**
 * What to do about an order Zinc has but hasn't finished. Past STUCK_AFTER_MS it is cancelled if Zinc
 * will; if it won't (it may really be buying it) or isn't answering, we wait, up to GIVE_UP_AFTER_MS.
 */
async function stopIfStuck(order: OrderRow, answered: boolean, deps: OrderDeps): Promise<OrderRow> {
  const age = ageOf(order, deps);
  if (age <= STUCK_AFTER_MS) return order;
  const cancelled = answered ? await deps.fulfilment.cancel(order.zincOrderId!) : false;
  if (cancelled) return failOrder(order, "The store took too long, so we stopped the order.");
  if (age <= GIVE_UP_AFTER_MS) return order;
  console.error("Giving up on an order Zinc hasn't finished; check it at Zinc", order.id);
  return failOrder(order, "The store didn't finish this order in time, so we stopped waiting.");
}

/** Runs whatever is left to do for one order. Safe to call again and again. */
export async function advanceOrder(orderId: string, deps: OrderDeps): Promise<void> {
  let order = await getOrder(orderId);
  if (!order) return;
  const [product] = order.productId ? await db.select().from(products).where(eq(products.id, order.productId)) : [];

  if (order.status === "processing") {
    order = await charge(order, { name: product?.name ?? order.productName }, deps);
    if (order.status === "processing") order = await submit(order, deps);
    if (order.status === "processing" && order.zincOrderId) {
      let state: ZincOrderState | null = null;
      try {
        state = await deps.fulfilment.check(order.zincOrderId);
      } catch (error) {
        // Zinc not answering is not the order failing: it is checked again next time.
        if (!(error instanceof FulfilmentError)) throw error;
      }
      if (state?.state === "placed") order = await markPlaced(order, state, deps);
      else if (state?.state === "failed") order = await failOrder(order, `${state.reason}.`);
      else order = await stopIfStuck(order, state !== null, deps);
    }
  }

  if (order.status !== "processing") {
    order = await refundOwed(order, deps);
    if (order.status === "placed") {
      order = await recordPurchase(order, product, deps);
      order = await refreshTracking(order, deps);
      // The store may just have cancelled it.
      if (order.status === "placed") await sendTracking(order, deps);
      else await refundOwed(order, deps);
    }
  }
}

export type CancelOutcome = "cancelled" | "too-late" | "not-found";

/**
 * The user changed their mind. An order can be stopped until Zinc starts buying it (Zinc only cancels
 * one still queued); after that it can only be returned to the store. Refunds in full.
 */
export async function cancelOrder(userId: string, orderId: string, deps: OrderDeps): Promise<CancelOutcome> {
  const order = await getUserOrder(userId, orderId);
  if (!order || order.status === "failed" || order.status === "cancelled") return "not-found";
  if (order.status === "placed") return "too-late";
  if (order.zincOrderId && !(await deps.fulfilment.cancel(order.zincOrderId))) return "too-late";
  const stopped = await updateOrderIf(order.id, "processing", { status: "cancelled", failureReason: "You cancelled this order.", seenAt: clock(deps) });
  // It finished in the moment between looking and stopping it.
  if (!stopped) return "too-late";
  await refundOwed(stopped, deps);
  return "cancelled";
}

/** Moves along every order with something left to do: in progress, owed a refund, a purchase to record, or a parcel due a check. */
export async function settleOrders(deps: OrderDeps, options: { userId?: string } = {}): Promise<{ checked: number }> {
  const rows = await listOrdersToSettle(clock(deps), options.userId);
  for (const row of rows) {
    try {
      await advanceOrder(row.id, deps);
    } catch (error) {
      console.error("Could not settle order", row.id, error);
    }
  }
  return { checked: rows.length };
}
