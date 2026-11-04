// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
// PayPal and Zinc are fakes; nothing leaves the machine.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { monthStart, orderFeesCents, upfrontChargeCents, zincCeilingCents } from "@/core/order-money";
import { DEFAULT_PLATFORM_LIMITS, type PlatformLimits } from "@/core/user-settings";
import { db } from "@/db/client";
import { orders, products, purchaseEvents, restockSuggestions } from "@/db/schema";
import { mergeProducts } from "@/modules/inventory/service";
import { listSuggestions } from "@/modules/restock";
import { FulfilmentError } from "./fulfilment";
import { placedAt } from "./fake-fulfilment";
import { PaymentError } from "./payments";
import { advanceOrder, cancelOrder, GIVE_UP_AFTER_MS, placeOrder, settleOrders, spendingMismatch, STUCK_AFTER_MS } from "./pipeline";
import { considerAutoBuy } from "./auto";
import { getOrder, listOrdersToSettle, markPaypalBroken, spentByEveryoneSince, toView, TRACKING_EVERY_MS } from "./repo";
import { buyNow, listOrders, unseenOrderResults, markOrderResultsSeen } from "./service";
import { confirmProduct, scene, throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

// A $10 pack, one pack: the ceiling is 30% more, and PayPal is charged that plus Zinc's fee and ours.
const CEILING = zincCeilingCents(1000);
const CHARGE = upfrontChargeCents(CEILING, orderFeesCents(1000));

async function started(s: Awaited<ReturnType<typeof scene>>) {
  const result = await buyNow(s.userId, s.suggestion.id, s.deps);
  if (result.status !== "started") throw new Error(`expected the order to start, got ${result.reason}`);
  return (await getOrder(result.orderId))!;
}

describe("buying a suggestion", () => {
  it("charges PayPal for the ceiling, sends the order to Zinc, and waits for the result", async () => {
    const s = await scene(newUser);
    const order = await started(s);

    expect(order).toMatchObject({ status: "processing", paymentStatus: "charged", chargedCents: CHARGE, ceilingCents: CEILING, source: "buy-now", productName: "Toilet Paper" });
    expect(s.payments.charges).toEqual([expect.objectContaining({ vaultId: "vault-1", amountCents: CHARGE, reference: order.id })]);
    expect(s.fulfilment.placed).toEqual([
      expect.objectContaining({ url: "https://www.walmart.com/ip/charmin-12", quantity: 1, maxPriceCents: CEILING, reference: order.id, address: expect.objectContaining({ line1: "1 Main St", state: "TX" }) }),
    ]);
  });

  it("when Zinc has bought it: refunds the unused part, records the purchase, and shows it on the way", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = placedAt(1200); // the store charged $12.00 in all

    await advanceOrder(order.id, s.deps);
    const done = (await getOrder(order.id))!;

    const cost = 1200 + orderFeesCents(1000);
    expect(done).toMatchObject({ status: "placed", totalCents: cost, paymentStatus: "part-refunded", refundedCents: CHARGE - cost, merchantOrderId: "W-1001", seenAt: null });
    expect(s.payments.refunds).toEqual([expect.objectContaining({ amountCents: CHARGE - cost })]);
    expect(done.arrivesAt!.getTime()).toBeGreaterThan(Date.now() + 3 * 24 * 60 * 60 * 1000);

    // The purchase is on its way, counted for when it arrives, and the product isn't suggested again.
    const [purchase] = await db.select().from(purchaseEvents).where(eq(purchaseEvents.orderId, order.id));
    expect(purchase).toMatchObject({ source: "agent", status: "approved", quantity: 12, unit: "rolls", store: "walmart.com" });
    expect(purchase!.purchasedAt.getTime()).toBe(done.arrivesAt!.getTime());
    expect(await listSuggestions(s.userId)).toEqual([]);
  });

  it("gives PayPal the tracking number, once, and keeps it for the user to see", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = placedAt(1200);
    await advanceOrder(order.id, s.deps);
    await advanceOrder(order.id, s.deps);

    expect(s.payments.tracking).toEqual([{ paypalOrderId: `fake-order-${order.id}`, trackingNumber: "9400100000000000", carrier: "USPS" }]);
    const [view] = await listOrders(s.userId);
    expect(view!.tracking).toEqual([expect.objectContaining({ carrier: "USPS", number: "9400100000000000", url: "https://track.test/9400", sentToPaypal: true })]);
  });

  it("when Zinc can't buy it: refunds everything, fails with the reason, and records no purchase", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = { state: "failed", reason: "It's out of stock" };

    await advanceOrder(order.id, s.deps);
    const done = (await getOrder(order.id))!;

    expect(done).toMatchObject({ status: "failed", paymentStatus: "refunded", refundedCents: CHARGE, failureReason: "It's out of stock.", seenAt: null });
    expect(s.payments.refunds).toEqual([expect.objectContaining({ amountCents: CHARGE })]);
    expect(await db.select().from(purchaseEvents).where(eq(purchaseEvents.orderId, order.id))).toEqual([]);
    // The product is still low, so it is suggested again.
    expect(await listSuggestions(s.userId)).toHaveLength(1);
  });

  it("refunds everything when Zinc won't even take the order", async () => {
    const s = await scene(newUser);
    s.fulfilment.failNextPlace = new FulfilmentError("invalid-address", "The delivery address wasn't accepted");
    const order = await started(s);
    expect(order).toMatchObject({ status: "failed", paymentStatus: "refunded", refundedCents: CHARGE });
    expect(order.failureReason).toBe("The delivery address wasn't accepted.");
  });

  it("doesn't buy anything when PayPal says no, and says nothing was charged", async () => {
    const s = await scene(newUser);
    s.payments.failNextCharge = new PaymentError("declined", "no");
    const order = await started(s);
    expect(order).toMatchObject({ status: "failed", paymentStatus: "none", failureReason: "PayPal couldn't take the payment. You weren't charged." });
    expect(s.fulfilment.placed).toEqual([]);
    expect(s.payments.refunds).toEqual([]);
  });

  it("asks the user to connect PayPal again when PayPal has lost the permission", async () => {
    const s = await scene(newUser);
    s.payments.failNextCharge = new PaymentError("reconnect", "gone");
    const order = await started(s);
    expect(order.failureReason).toContain("connect your account again");
    const next = await buyNow(s.userId, s.suggestion.id, s.deps);
    expect(next).toMatchObject({ status: "refused", reason: "reconnect-paypal" });
  });
});

describe("what stops an order before anything happens", () => {
  it("needs PayPal connected and a delivery address", async () => {
    const noPaypal = await scene(newUser, { paypal: false });
    expect(await buyNow(noPaypal.userId, noPaypal.suggestion.id, noPaypal.deps)).toMatchObject({ status: "refused", reason: "no-paypal" });
    const noAddress = await scene(newUser, { address: false });
    expect(await buyNow(noAddress.userId, noAddress.suggestion.id, noAddress.deps)).toMatchObject({ status: "refused", reason: "no-address" });
    expect(noPaypal.payments.charges).toEqual([]);
    expect(await listOrders(noPaypal.userId)).toEqual([]);
  });

  it("won't order the same product twice at once", async () => {
    const s = await scene(newUser);
    await started(s);
    // The suggestion is hidden while the order is in progress, so even an old button press finds nothing.
    expect(await buyNow(s.userId, s.suggestion.id, s.deps)).toMatchObject({ status: "refused", reason: "not-found" });
    // And even racing past that, the database allows one order in progress per product.
    const again = await placeOrder({ userId: s.userId, suggestion: s.suggestion, source: "buy-now" }, s.deps);
    expect(again).toMatchObject({ status: "refused", reason: "already-ordering" });
    expect(s.payments.charges).toHaveLength(1);
  });

  it("only buys for the user who owns the suggestion", async () => {
    const s = await scene(newUser);
    const other = await scene(newUser);
    expect(await buyNow(other.userId, s.suggestion.id, other.deps)).toMatchObject({ status: "refused", reason: "not-found" });
    expect(s.payments.charges).toEqual([]);
  });

  it("won't mix pretend and real money", () => {
    const sandboxZinc = { sandbox: true };
    const liveZinc = { sandbox: false };
    expect(spendingMismatch({ environment: "sandbox" }, sandboxZinc, true)).toBeNull();
    expect(spendingMismatch({ environment: "live" }, liveZinc, false)).toBeNull();
    expect(spendingMismatch({ environment: "live" }, liveZinc, true)).toContain("sample data");
    expect(spendingMismatch({ environment: "live" }, sandboxZinc, false)).toContain("test mode");
    expect(spendingMismatch({ environment: "sandbox" }, liveZinc, false)).toContain("test mode");
  });

  it("refuses to buy real things with pretend PayPal money", async () => {
    const s = await scene(newUser);
    const live = { ...s.deps, fulfilment: Object.assign(Object.create(Object.getPrototypeOf(s.fulfilment)), s.fulfilment, { sandbox: false }) };
    expect(await buyNow(s.userId, s.suggestion.id, live)).toMatchObject({ status: "refused", reason: "unsafe" });
    expect(s.payments.charges).toEqual([]);
  });
});

describe("recovering and settling", () => {
  it("picks up where it stopped: a Zinc outage after the charge is retried without charging again", async () => {
    const s = await scene(newUser);
    s.fulfilment.failNextPlace = new FulfilmentError("unavailable", "Zinc is not answering");
    const order = await started(s);
    expect(order).toMatchObject({ status: "processing", paymentStatus: "charged", zincOrderId: null });

    s.fulfilment.result = placedAt(1000);
    await settleOrders(s.deps, { userId: s.userId });
    expect((await getOrder(order.id))!).toMatchObject({ status: "placed", paymentStatus: "part-refunded" });
    expect(s.payments.charges).toHaveLength(1);
    expect(s.fulfilment.placed).toHaveLength(1);
  });

  it("keeps waiting while Zinc is still working or not answering", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    await settleOrders(s.deps, { userId: s.userId });
    expect((await getOrder(order.id))!.status).toBe("processing");
    s.fulfilment.checkFails = true;
    await settleOrders(s.deps, { userId: s.userId });
    expect((await getOrder(order.id))!.status).toBe("processing");
  });

  it("cancels and refunds an order that has been stuck for hours", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    const later = { ...s.deps, now: () => new Date(Date.now() + STUCK_AFTER_MS + 60_000) };
    await advanceOrder(order.id, later);
    expect(s.fulfilment.cancelled).toEqual(["fake-zinc-1"]);
    expect((await getOrder(order.id))!).toMatchObject({ status: "failed", paymentStatus: "refunded" });
  });

  it("tries a refund PayPal refused again next time, and never refunds twice", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = { state: "failed", reason: "It's out of stock" };
    s.payments.failNextRefund = true;
    await advanceOrder(order.id, s.deps);
    expect((await getOrder(order.id))!).toMatchObject({ status: "failed", refundedCents: 0, paymentStatus: "charged" });

    await settleOrders(s.deps, { userId: s.userId });
    expect((await getOrder(order.id))!).toMatchObject({ refundedCents: CHARGE, paymentStatus: "refunded" });
    await settleOrders(s.deps, { userId: s.userId });
    expect(s.payments.refunds).toHaveLength(1);
  });

  it("settles only the user's own orders when asked to", async () => {
    const a = await scene(newUser);
    const b = await scene(newUser);
    const orderA = await started(a);
    const orderB = await started(b);
    a.fulfilment.result = placedAt(1000);
    b.fulfilment.result = placedAt(1000);
    await settleOrders(a.deps, { userId: a.userId });
    expect((await getOrder(orderA.id))!.status).toBe("placed");
    expect((await getOrder(orderB.id))!.status).toBe("processing");
  });
});

describe("when PayPal doesn't give a clear answer", () => {
  it("doesn't say they weren't charged, buys nothing, and asks again without charging twice", async () => {
    const s = await scene(newUser);
    s.payments.failNextCharge = new PaymentError("unavailable", "timed out");
    const order = await started(s);
    expect(order).toMatchObject({ status: "processing", paymentStatus: "none", failureReason: null });
    expect(s.fulfilment.placed).toEqual([]);

    await advanceOrder(order.id, s.deps);
    expect((await getOrder(order.id))!).toMatchObject({ status: "processing", paymentStatus: "charged" });
    expect(s.payments.charges).toHaveLength(1);
    expect(s.fulfilment.placed).toHaveLength(1);
  });

  it("stops after hours of no answer, and says it can't be sure about the money", async () => {
    const s = await scene(newUser);
    s.payments.failNextCharge = new PaymentError("unavailable", "timed out");
    const order = await started(s);
    s.payments.failNextCharge = new PaymentError("unavailable", "timed out");
    await advanceOrder(order.id, { ...s.deps, now: () => new Date(Date.now() + STUCK_AFTER_MS + 60_000) });
    const done = (await getOrder(order.id))!;
    expect(done).toMatchObject({ status: "failed", paymentStatus: "unknown" });
    expect(done.failureReason).not.toContain("weren't charged");
    expect(s.fulfilment.placed).toEqual([]);
  });
});

describe("when Zinc never finishes", () => {
  const later = (s: Awaited<ReturnType<typeof scene>>, ms: number) => ({ ...s.deps, now: () => new Date(Date.now() + ms) });

  it("refunds an order Zinc never accepted, rather than holding the money for ever", async () => {
    const s = await scene(newUser);
    s.fulfilment.failNextPlace = new FulfilmentError("unavailable", "down");
    const order = await started(s);
    s.fulfilment.failNextPlace = new FulfilmentError("unavailable", "down");
    await advanceOrder(order.id, later(s, STUCK_AFTER_MS + 60_000));
    expect((await getOrder(order.id))!).toMatchObject({ status: "failed", paymentStatus: "refunded", refundedCents: CHARGE });
  });

  it("waits while Zinc won't cancel (it may be buying it), then refunds at the limit", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.cancelRefused = true;
    await advanceOrder(order.id, later(s, STUCK_AFTER_MS + 60_000));
    expect((await getOrder(order.id))!.status).toBe("processing");
    await advanceOrder(order.id, later(s, GIVE_UP_AFTER_MS + 60_000));
    expect((await getOrder(order.id))!).toMatchObject({ status: "failed", paymentStatus: "refunded" });
  });

  it("gives up on an order Zinc has stopped answering about", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.checkFails = true;
    await advanceOrder(order.id, later(s, STUCK_AFTER_MS + 60_000));
    expect((await getOrder(order.id))!.status).toBe("processing");
    await advanceOrder(order.id, later(s, GIVE_UP_AFTER_MS + 60_000));
    expect((await getOrder(order.id))!).toMatchObject({ status: "failed", paymentStatus: "refunded" });
  });
});

describe("old money and lost records", () => {
  it("still refunds an order older than a month", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = { state: "failed", reason: "It's out of stock" };
    s.payments.failNextRefund = true;
    await advanceOrder(order.id, s.deps);
    await db.update(orders).set({ createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }).where(eq(orders.id, order.id));
    await settleOrders(s.deps, { userId: s.userId });
    expect((await getOrder(order.id))!).toMatchObject({ paymentStatus: "refunded", refundedCents: CHARGE });
  });

  it("retries recording the purchase, and treats the product as ordered until it is recorded", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = placedAt(1000);
    await advanceOrder(order.id, s.deps);
    // As if the write had failed, with the arrival date already past: without the guard this looks low again and gets bought twice.
    await db.delete(purchaseEvents).where(eq(purchaseEvents.orderId, order.id));
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.update(orders).set({ purchaseRecordedAt: null, arrivesAt: past }).where(eq(orders.id, order.id));
    expect(await listSuggestions(s.userId)).toEqual([]);

    await settleOrders(s.deps, { userId: s.userId });
    expect(await db.select().from(purchaseEvents).where(eq(purchaseEvents.orderId, order.id))).toHaveLength(1);
    expect((await getOrder(order.id))!.purchaseRecordedAt).not.toBeNull();
  });
});

describe("following the parcel", () => {
  const dueLater = (s: Awaited<ReturnType<typeof scene>>) => ({ ...s.deps, now: () => new Date(Date.now() + TRACKING_EVERY_MS + 60_000) });

  it("counts the stock from the day it was delivered, if that beats the estimate", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = placedAt(1000);
    await advanceOrder(order.id, s.deps);
    const expected = (await getOrder(order.id))!.arrivesAt!;
    expect(expected.getTime()).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);

    const placed = placedAt(1000);
    s.fulfilment.result = placed.state === "placed" ? { ...placed, tracking: placed.tracking.map((entry) => ({ ...entry, status: "delivered" })) } : placed;
    await advanceOrder(order.id, dueLater(s));
    const done = (await getOrder(order.id))!;
    expect(done.arrivesAt!.getTime()).toBeLessThan(expected.getTime());
    const [purchase] = await db.select().from(purchaseEvents).where(eq(purchaseEvents.orderId, order.id));
    expect(purchase!.purchasedAt.getTime()).toBe(done.arrivesAt!.getTime());
  });

  it("asks Zinc about a parcel every few hours, not on every poll", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = placedAt(1000);
    await advanceOrder(order.id, s.deps);
    await advanceOrder(order.id, s.deps);
    expect((await listOrdersToSettle(new Date(), s.userId)).map((row) => row.id)).toEqual([]);
    expect((await listOrdersToSettle(new Date(Date.now() + TRACKING_EVERY_MS + 60_000), s.userId)).map((row) => row.id)).toEqual([order.id]);
  });

  it("refunds everything and stops counting the stock when the store cancels after placing", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.result = placedAt(1000);
    await advanceOrder(order.id, s.deps);
    s.fulfilment.result = { state: "failed", reason: "The store couldn't complete the order" };
    await advanceOrder(order.id, dueLater(s));
    expect((await getOrder(order.id))!).toMatchObject({ status: "failed", paymentStatus: "refunded", refundedCents: CHARGE });
    expect(await db.select().from(purchaseEvents).where(eq(purchaseEvents.orderId, order.id))).toEqual([]);
  });
});

describe("cancelling", () => {
  it("stops a processing order and refunds it all, quietly", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    expect(await cancelOrder(s.userId, order.id, s.deps)).toBe("cancelled");
    const done = (await getOrder(order.id))!;
    expect(done).toMatchObject({ status: "cancelled", paymentStatus: "refunded", refundedCents: CHARGE });
    expect(s.fulfilment.cancelled).toEqual(["fake-zinc-1"]);
    expect(await unseenOrderResults(s.userId)).toEqual([]); // they did it; no banner needed
  });

  it("says it's too late when Zinc has gone too far, or it's already placed, and leaves the order alone", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    s.fulfilment.cancelRefused = true;
    expect(await cancelOrder(s.userId, order.id, s.deps)).toBe("too-late");
    expect((await getOrder(order.id))!.status).toBe("processing");
    s.fulfilment.result = placedAt(1000);
    await advanceOrder(order.id, s.deps);
    expect(await cancelOrder(s.userId, order.id, s.deps)).toBe("too-late");
    expect((await getOrder(order.id))!.status).toBe("placed");
  });

  it("won't cancel someone else's order", async () => {
    const s = await scene(newUser);
    const other = await scene(newUser);
    const order = await started(s);
    expect(await cancelOrder(other.userId, order.id, other.deps)).toBe("not-found");
    expect((await getOrder(order.id))!.status).toBe("processing");
  });
});

describe("stores we can't order from", () => {
  it("refuses to buy one, even if asked directly", async () => {
    const s = await scene(newUser);
    const elsewhere = { ...s.suggestion.pick, domain: "cvs.com", concerns: ["not-orderable" as const] };
    await db.update(restockSuggestions).set({ found: { query: "x", listings: 1, pick: elsewhere, alternatives: [] } }).where(eq(restockSuggestions.id, s.suggestion.id));
    const outcome = await buyNow(s.userId, s.suggestion.id, s.deps);
    expect(outcome).toMatchObject({ status: "refused" });
    expect(outcome.status === "refused" && outcome.message).toContain("cvs.com");
    expect(s.payments.charges).toEqual([]);
  });
});

describe("choosing what to buy", () => {
  it("charges for the packs chosen, and records that many", async () => {
    const s = await scene(newUser);
    const result = await buyNow(s.userId, s.suggestion.id, s.deps, { option: 0, packs: 3 });
    if (result.status !== "started") throw new Error("expected it to start");
    expect(s.fulfilment.placed[0]).toMatchObject({ quantity: 3, maxPriceCents: zincCeilingCents(3000) });
    s.fulfilment.result = placedAt(3300);
    await advanceOrder(result.orderId, s.deps);
    const [purchase] = await db.select().from(purchaseEvents).where(eq(purchaseEvents.orderId, result.orderId));
    expect(purchase!.quantity).toBe(36);
  });

  it("refuses an option that isn't in the suggestion, or a silly number of packs", async () => {
    const s = await scene(newUser);
    expect(await buyNow(s.userId, s.suggestion.id, s.deps, { option: 5, packs: 1 })).toMatchObject({ status: "refused" });
    expect(await buyNow(s.userId, s.suggestion.id, s.deps, { option: 0, packs: 500 })).toMatchObject({ status: "refused" });
    expect(s.payments.charges).toEqual([]);
  });
});

describe("the caps that protect the Zinc wallet", () => {
  const limits = (overrides: Partial<PlatformLimits>): PlatformLimits => ({ ...DEFAULT_PLATFORM_LIMITS, ...overrides });

  it("won't let one Buy for me order go over the cap, and says to choose fewer", async () => {
    const s = await scene(newUser);
    const outcome = await buyNow(s.userId, s.suggestion.id, { ...s.deps, limits: limits({ buyNowOrderCents: 2000 }) }, { option: 0, packs: 2 });
    expect(outcome).toMatchObject({ status: "refused", reason: "over-limit" });
    expect(outcome.status === "refused" && outcome.message).toContain("$20.00");
    expect(s.payments.charges).toEqual([]);
    expect(await listOrders(s.userId)).toEqual([]);
  });

  it("holds no more than the cap, so tax can't take the order over it", async () => {
    const s = await scene(newUser);
    const outcome = await buyNow(s.userId, s.suggestion.id, { ...s.deps, limits: limits({ buyNowOrderCents: 1300 }) }, { option: 0, packs: 1 });
    expect(outcome.status).toBe("started");
    expect(s.payments.charges[0]!.amountCents).toBe(1300);
  });

  it("refuses any order once all users together have reached the month's budget", async () => {
    const s = await scene(newUser);
    const outcome = await buyNow(s.userId, s.suggestion.id, { ...s.deps, limits: limits({ allUsersMonthCents: 0 }) });
    expect(outcome).toMatchObject({ status: "refused", reason: "budget-reached" });
    expect(s.payments.charges).toEqual([]);
    expect(await listOrders(s.userId)).toEqual([]);
  });

  it("counts what other users' orders have committed", async () => {
    const s = await scene(newUser);
    const other = await scene(newUser);
    await started(other);
    const committed = await spentByEveryoneSince(monthStart(new Date()));
    expect(committed).toBeGreaterThanOrEqual(CHARGE);
    const justShort = limits({ allUsersMonthCents: committed + CHARGE - 1 });
    expect(await buyNow(s.userId, s.suggestion.id, { ...s.deps, limits: justShort })).toMatchObject({ status: "refused", reason: "budget-reached" });
    const justEnough = limits({ allUsersMonthCents: committed + CHARGE + 100_000 });
    expect((await buyNow(s.userId, s.suggestion.id, { ...s.deps, limits: justEnough })).status).toBe("started");
  });

  it("leaves auto-buy asking, with the reason, when the budget is reached", async () => {
    const s = await scene(newUser, { history: 6 });
    await confirmProduct(s.productId);
    await db.update(products).set({ autobuyEnabled: true }).where(eq(products.id, s.productId));
    const outcome = await considerAutoBuy(s.suggestion, { ...s.deps, limits: limits({ allUsersMonthCents: 0 }) });
    expect(outcome.status).toBe("asked");
    expect(outcome.status === "asked" && outcome.reasons[0]).toContain("ordering limit for this month");
    expect(s.payments.charges).toEqual([]);
  });
});

describe("merging a product with an order on its way", () => {
  it("moves the order along with it, so the kept product isn't bought again", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    const [kept] = await db.insert(products).values({ userId: s.userId, name: "TP", normalizedName: "tp", unit: "rolls", normalPurchaseQty: 12 }).returning();
    expect(await mergeProducts(s.userId, s.productId, kept!.id)).toBe("merged");
    expect((await getOrder(order.id))!.productId).toBe(kept!.id);
  });
});

describe("showing the user how it went", () => {
  it("lists finished orders they haven't seen, until they've seen them", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    expect(await unseenOrderResults(s.userId)).toEqual([]); // still processing: nothing to report yet
    s.fulfilment.result = placedAt(1000);
    await advanceOrder(order.id, s.deps);

    const unseen = await unseenOrderResults(s.userId);
    expect(unseen.map((o) => [o.id, o.status])).toEqual([[order.id, "placed"]]);
    await markOrderResultsSeen(s.userId);
    expect(await unseenOrderResults(s.userId)).toEqual([]);
    expect((await listOrders(s.userId))[0]!.seen).toBe(true);
  });

  it("describes an order with plain data", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    const view = toView(order);
    expect(view).toMatchObject({ status: "processing", source: "buy-now", listing: { title: "Charmin Toilet Paper 12 Rolls", domain: "walmart.com", sample: false }, chargedCents: CHARGE, totalCents: null });
    expect(() => JSON.stringify(view)).not.toThrow();
  });

  it("keeps the order if the product is deleted later", async () => {
    const s = await scene(newUser);
    const order = await started(s);
    await db.update(orders).set({ productId: null }).where(eq(orders.id, order.id));
    expect((await listOrders(s.userId))[0]).toMatchObject({ productName: "Toilet Paper", productId: null });
  });
});

void markPaypalBroken;
