import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { purchaseEvents } from "@/db/schema";
import { refreshNextCheck } from "./next-check";

/**
 * A purchase Replenish made itself (an order that Zinc placed), recorded so the estimates know more
 * is on the way. It is dated for when it should arrive: estimates leave a purchase out until its date
 * (src/core/arrived.ts) and the product's next check is that day. It is approved, not pending: the
 * user didn't have to say yes, so there is nothing to ask them (pending is for orders found in email).
 * Recording it twice for the same order does nothing.
 */
export async function recordAgentPurchase(
  userId: string,
  purchase: {
    orderId: string;
    productId: string;
    /** In the product's own unit. */
    quantity: number;
    unit: string;
    priceCents: number;
    brand: string | null;
    store: string | null;
    arrivesAt: Date;
  },
): Promise<void> {
  await db
    .insert(purchaseEvents)
    .values({
      userId,
      productId: purchase.productId,
      source: "agent",
      orderId: purchase.orderId,
      quantity: purchase.quantity,
      unit: purchase.unit,
      priceCents: purchase.priceCents,
      brand: purchase.brand,
      store: purchase.store,
      purchasedAt: purchase.arrivesAt,
      idempotencyKey: `order:${purchase.orderId}`,
      lineIndex: 0,
      status: "approved",
    })
    .onConflictDoNothing();
  await refreshNextCheck(userId, [purchase.productId]);
}

const orderPurchase = (userId: string, orderId: string) => and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.idempotencyKey, `order:${orderId}`));

/** The parcel's real date is known (it was delivered, or it's running late): the stock counts from then. */
export async function moveAgentPurchase(userId: string, orderId: string, productId: string, arrivesAt: Date): Promise<void> {
  await db.update(purchaseEvents).set({ purchasedAt: arrivesAt }).where(orderPurchase(userId, orderId));
  await refreshNextCheck(userId, [productId]);
}

/** The store cancelled an order after it was placed: nothing is coming, so it stops counting. */
export async function removeAgentPurchase(userId: string, orderId: string, productId: string): Promise<void> {
  await db.delete(purchaseEvents).where(orderPurchase(userId, orderId));
  await refreshNextCheck(userId, [productId]);
}
