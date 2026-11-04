import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import { LEGACY_FEES_CENTS } from "@/core/order-money";
import { db } from "@/db/client";
import { orders, paypalAccounts, type OrderRow, type PaypalAccountRow } from "@/db/schema";
import type { SuggestedAddress } from "./payments";
import { monthRange } from "./query";
import { ORDERS_PAGE_SIZE, ListingSchema, TrackingSchema, type OrderSource, type OrderStatus, type OrderView, type PaymentStatus, type Tracking } from "./types";

/** The only place the orders module touches the database. */

export const getPaypalAccount = async (userId: string): Promise<PaypalAccountRow | null> =>
  (await db.select().from(paypalAccounts).where(eq(paypalAccounts.userId, userId)))[0] ?? null;

/** Remembers that the user was sent to PayPal to approve. If they already have a saved PayPal it keeps working until the new one is approved. */
export async function savePendingSetup(userId: string, setupTokenId: string): Promise<void> {
  await db
    .insert(paypalAccounts)
    .values({ userId, status: "pending", setupTokenId })
    .onConflictDoUpdate({ target: paypalAccounts.userId, set: { setupTokenId, updatedAt: sql`now()` } });
}

export async function activatePaypal(userId: string, vaultId: string, payerEmail: string | null, suggestedAddress: SuggestedAddress | null = null): Promise<void> {
  await db
    .insert(paypalAccounts)
    .values({ userId, status: "active", vaultId, payerEmail, suggestedAddress })
    .onConflictDoUpdate({ target: paypalAccounts.userId, set: { status: "active", vaultId, payerEmail, suggestedAddress, setupTokenId: null, updatedAt: sql`now()` } });
}

/** PayPal said the saved permission no longer works: the user has to connect again. */
export async function markPaypalBroken(userId: string): Promise<void> {
  await db.update(paypalAccounts).set({ status: "reconnect", updatedAt: sql`now()` }).where(eq(paypalAccounts.userId, userId));
}

export async function removePaypal(userId: string): Promise<void> {
  await db.delete(paypalAccounts).where(eq(paypalAccounts.userId, userId));
}

type NewOrder = typeof orders.$inferInsert;

/** Stores a new order. Returns "already-ordering" when this product already has one in progress. */
export async function insertOrder(values: NewOrder): Promise<OrderRow | "already-ordering"> {
  try {
    const [row] = await db.insert(orders).values(values).returning();
    return row!;
  } catch (error) {
    // The unique index that allows one processing order per product. Drizzle wraps the database's
    // error, so the code is on the error or on what caused it.
    const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return "already-ordering";
    throw error;
  }
}

export const getOrder = async (id: string): Promise<OrderRow | null> =>
  (await db.select().from(orders).where(eq(orders.id, id)))[0] ?? null;

export async function updateOrder(id: string, patch: Partial<Omit<NewOrder, "id" | "userId">>): Promise<OrderRow> {
  const [row] = await db.update(orders).set({ ...patch, updatedAt: sql`now()` }).where(eq(orders.id, id)).returning();
  return row!;
}

/**
 * Changes an order only if it is still in the status the caller saw, so two runs moving the same
 * order along (the Orders page and the cron job), or the user cancelling while Zinc answers, can't
 * overwrite each other. Null means someone else got there first.
 */
export async function updateOrderIf(id: string, status: string, patch: Partial<Omit<NewOrder, "id" | "userId">>): Promise<OrderRow | null> {
  const [row] = await db.update(orders).set({ ...patch, updatedAt: sql`now()` }).where(and(eq(orders.id, id), eq(orders.status, status))).returning();
  return row ?? null;
}

export const listUserOrders = (userId: string, limit = 50): Promise<OrderRow[]> =>
  db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt)).limit(limit);

/** One page of the user's orders, newest first, optionally only those made in one month. Also how many match. */
export async function listOrdersPageRows(userId: string, { month, page }: { month: string | null; page: number }): Promise<{ rows: OrderRow[]; total: number }> {
  const range = month ? monthRange(month) : null;
  const where = and(eq(orders.userId, userId), range ? gte(orders.createdAt, range.from) : undefined, range ? lt(orders.createdAt, range.to) : undefined);
  const [{ n }] = await db.select({ n: count() }).from(orders).where(where);
  const rows = await db.select().from(orders).where(where).orderBy(desc(orders.createdAt), desc(orders.id)).limit(ORDERS_PAGE_SIZE).offset((page - 1) * ORDERS_PAGE_SIZE);
  return { rows, total: n };
}

/** The months (UTC) the user has orders in, newest first, with how many. */
export async function orderMonths(userId: string): Promise<{ month: string; count: number }[]> {
  const month = sql<string>`to_char(${orders.createdAt} at time zone 'UTC', 'YYYY-MM')`;
  const rows = await db.select({ month, count: count() }).from(orders).where(eq(orders.userId, userId)).groupBy(month).orderBy(desc(month));
  return rows;
}

export const getUserOrder = async (userId: string, id: string): Promise<OrderRow | null> =>
  (await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.userId, userId))))[0] ?? null;

/** How often Zinc is asked about a placed order's parcel. */
export const TRACKING_EVERY_MS = 3 * 60 * 60 * 1000;
/** Parcels are followed for this long after the order. */
export const TRACKING_FOR_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Orders with something left to do: in progress first, then any still owed a refund (however old:
 * that money is the user's), a purchase to record, or parcels due a check. The ones checked longest
 * ago come first, so a long list is worked through rather than starting over each time.
 */
export async function listOrdersToSettle(now: Date, userId?: string): Promise<OrderRow[]> {
  const owedRefund = and(isNotNull(orders.paypalCaptureId), ne(orders.status, "processing"), sql`${orders.chargedCents} > ${orders.refundedCents}`, or(inArray(orders.status, ["failed", "cancelled"]), sql`${orders.chargedCents} - coalesce(${orders.totalCents}, ${orders.chargedCents}) > ${orders.refundedCents}`));
  const parcelDue = and(eq(orders.status, "placed"), gt(orders.createdAt, new Date(now.getTime() - TRACKING_FOR_MS)), or(isNull(orders.trackingCheckedAt), lte(orders.trackingCheckedAt, new Date(now.getTime() - TRACKING_EVERY_MS))));
  const purchaseUnrecorded = and(eq(orders.status, "placed"), isNotNull(orders.productId), isNull(orders.purchaseRecordedAt));
  return db
    .select()
    .from(orders)
    .where(and(or(eq(orders.status, "processing"), owedRefund, parcelDue, purchaseUnrecorded), userId ? eq(orders.userId, userId) : undefined))
    .orderBy(sql`(${orders.status} = 'processing') desc`, sql`${orders.trackingCheckedAt} asc nulls first`, asc(orders.createdAt))
    .limit(200);
}

/** Whether an order for this product went wrong lately: one auto-buy tried that failed, or any the user cancelled. Newest first. */
export async function recentOrderProblem(productId: string, since: Date): Promise<"failed" | "cancelled" | null> {
  const [row] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(and(eq(orders.productId, productId), gt(orders.createdAt, since), or(and(eq(orders.source, "auto"), eq(orders.status, "failed")), eq(orders.status, "cancelled"))))
    .orderBy(desc(orders.createdAt))
    .limit(1);
  return (row?.status as "failed" | "cancelled" | undefined) ?? null;
}

/** Orders being processed or on their way, for the dashboard's product cards. */
export const listActiveOrders = (userId: string, now: Date): Promise<OrderRow[]> =>
  db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), isNotNull(orders.productId), or(eq(orders.status, "processing"), and(eq(orders.status, "placed"), gt(orders.arrivesAt, now)))))
    .orderBy(desc(orders.createdAt));

/** How it turned out, for orders the user hasn't been shown yet. */
export const listUnseenResults = (userId: string): Promise<OrderRow[]> =>
  db
    .select()
    .from(orders)
    .where(and(eq(orders.userId, userId), ne(orders.status, "processing"), isNull(orders.seenAt)))
    .orderBy(desc(orders.updatedAt));

export async function markSeen(userId: string, ids?: string[]): Promise<void> {
  await db
    .update(orders)
    .set({ seenAt: sql`now()` })
    .where(and(eq(orders.userId, userId), isNull(orders.seenAt), ne(orders.status, "processing"), ids ? inArray(orders.id, ids) : undefined));
}

/** What the user has spent or committed this month: processing orders at what was charged, placed ones at what they really cost. */
export async function spentSince(userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ status: orders.status, charged: orders.chargedCents, total: orders.totalCents })
    .from(orders)
    .where(and(eq(orders.userId, userId), gt(orders.createdAt, since), inArray(orders.status, ["processing", "placed"])));
  return rows.reduce((sum, row) => sum + (row.status === "placed" ? (row.total ?? row.charged ?? 0) : (row.charged ?? 0)), 0);
}

/**
 * What all users' orders have spent or committed since then. Placed orders at what they really cost;
 * ones in progress at what they hold, or will hold if PayPal hasn't been charged yet.
 */
export async function spentByEveryoneSince(since: Date): Promise<number> {
  const [row] = await db
    .select({
      cents: sql<number>`coalesce(sum(case when ${orders.status} = 'placed' then coalesce(${orders.totalCents}, ${orders.chargedCents}, 0) else coalesce(${orders.chargedCents}, ${orders.ceilingCents} + coalesce(${orders.feesCents}, ${LEGACY_FEES_CENTS})) end), 0)::int`,
    })
    .from(orders)
    .where(and(gt(orders.createdAt, since), inArray(orders.status, ["processing", "placed"])));
  return row?.cents ?? 0;
}

/** An order as the screens need it. A listing or tracking record that can't be read (shouldn't happen) is replaced by something harmless. */
export function toView(row: OrderRow): OrderView {
  const listing = ListingSchema.safeParse(row.listing);
  const tracking: Tracking[] = Array.isArray(row.tracking) ? row.tracking.flatMap((entry) => {
    const parsed = TrackingSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  return {
    id: row.id,
    productId: row.productId,
    productName: row.productName,
    source: row.source as OrderSource,
    status: row.status as OrderStatus,
    paymentStatus: row.paymentStatus as PaymentStatus,
    failureReason: row.failureReason,
    decision: row.decision,
    listing: listing.success ? listing.data : { title: row.productName, domain: "", url: "https://example.com", brand: null, priceCents: 0, packSize: null, sample: false },
    packs: row.packs,
    chargedCents: row.chargedCents,
    totalCents: row.totalCents,
    refundedCents: row.refundedCents,
    feesCents: row.feesCents ?? LEGACY_FEES_CENTS,
    tracking,
    merchantOrderId: row.merchantOrderId,
    arrivesAt: row.arrivesAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    seen: row.seenAt !== null,
  };
}
