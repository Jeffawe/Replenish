import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { isAwaitingAnswer, isConfirmed } from "@/core/pending";
import { db } from "@/db/client";
import { inventoryCorrections, products, purchaseEvents, rejectedLines, type PurchaseEventRow } from "@/db/schema";
import { unitKey } from "./ingest";
import { refreshNextCheck } from "./next-check";

/**
 * The user's answers about pending purchases (see core/pending.ts). Pending
 * purchases are already counted in estimates; answering only makes them final
 * ("yes", optionally corrected) or removes them ("no").
 */

export interface PendingPurchase {
  id: string;
  /** The order they came in: lines with the same key were one email. */
  orderKey: string | null;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  brand: string | null;
  store: string | null;
  /** When it arrives (or arrived). */
  purchasedAt: Date;
  /** True when this line made the product; "no" then removes the product too. */
  madeProduct: boolean;
}

/** What the user is still being asked, oldest order first. */
export async function listPendingPurchases(userId: string, now = new Date()): Promise<PendingPurchase[]> {
  const rows = await db
    .select({ event: purchaseEvents, productName: products.name })
    .from(purchaseEvents)
    .innerJoin(products, eq(products.id, purchaseEvents.productId))
    .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.status, "pending")))
    .orderBy(purchaseEvents.createdAt);

  return rows
    .filter(({ event }) => isAwaitingAnswer(event, now))
    .map(({ event, productName }) => ({
      id: event.id,
      orderKey: event.idempotencyKey,
      productId: event.productId,
      productName,
      unit: event.unit,
      quantity: event.quantity,
      brand: event.brand,
      store: event.store,
      purchasedAt: event.purchasedAt,
      madeProduct: event.pendingUntil === null,
    }));
}

/** The rows the user can still answer (theirs, still pending), whatever ids were asked for. */
async function pendingRows(userId: string, ids: string[]): Promise<PurchaseEventRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(purchaseEvents)
    .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.status, "pending"), inArray(purchaseEvents.id, ids)));
}

/** Deletes products that were made by a pending line and have nothing left. */
async function dropEmptiedProducts(userId: string, productIds: string[]) {
  for (const productId of new Set(productIds)) {
    const [left] = await db
      .select({ id: purchaseEvents.id })
      .from(purchaseEvents)
      .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.productId, productId)))
      .limit(1);
    const [counted] = await db
      .select({ id: inventoryCorrections.id })
      .from(inventoryCorrections)
      .where(and(eq(inventoryCorrections.userId, userId), eq(inventoryCorrections.productId, productId)))
      .limit(1);
    if (!left && !counted) await db.delete(products).where(and(eq(products.id, productId), eq(products.userId, userId)));
  }
}

export interface PendingEdit {
  id: string;
  /** Corrects the quantity (a pack size that was read wrongly). */
  quantity?: number;
  /** Moves the line to another of the user's products (same unit). */
  productId?: string;
}

export interface ApproveResult {
  approved: number;
  /** Edits that couldn't be applied; those lines stay pending. */
  problems: string[];
}

/** "Yes", with any corrections. */
export async function approvePending(userId: string, edits: PendingEdit[]): Promise<ApproveResult> {
  const rows = await pendingRows(userId, edits.map((edit) => edit.id));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const problems: string[] = [];
  const emptied: string[] = [];
  const kept: string[] = [];
  const touched: string[] = [];
  let approved = 0;

  for (const edit of edits) {
    const row = byId.get(edit.id);
    if (!row) continue;

    if (edit.quantity !== undefined && !(Number.isFinite(edit.quantity) && edit.quantity > 0 && edit.quantity <= 1_000_000)) {
      problems.push("The quantity must be more than 0.");
      continue;
    }

    const change: Partial<typeof purchaseEvents.$inferInsert> = { status: "approved", pendingUntil: null };
    if (edit.quantity !== undefined) change.quantity = edit.quantity;

    if (edit.productId && edit.productId !== row.productId) {
      const [target] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, edit.productId), eq(products.userId, userId)));
      if (!target) {
        problems.push("That product isn't yours.");
        continue;
      }
      if (unitKey(target.unit) !== unitKey(row.unit)) {
        problems.push(`${target.name} is counted in ${target.unit}, not ${row.unit}.`);
        continue;
      }
      change.productId = target.id;
      change.unit = target.unit;
      if (row.pendingUntil === null) emptied.push(row.productId);
    }

    await db.update(purchaseEvents).set(change).where(and(eq(purchaseEvents.id, row.id), eq(purchaseEvents.userId, userId)));
    touched.push(row.productId, change.productId ?? row.productId);
    // "Yes, this order is mine" already answers "keep tracking this new product?", so don't ask again.
    if (row.pendingUntil === null) kept.push(change.productId ?? row.productId);
    approved++;
  }

  if (kept.length > 0) {
    await db
      .update(products)
      .set({ confirmedAt: new Date(), archivedAt: null })
      .where(and(eq(products.userId, userId), inArray(products.id, [...new Set(kept)])));
  }

  await dropEmptiedProducts(userId, emptied);
  await refreshNextCheck(userId, touched);
  return { approved, problems };
}

/**
 * "No": the lines are deleted, the order line is remembered so the same email
 * can't bring it back, and a product only these lines made is removed.
 */
export async function rejectPending(userId: string, ids: string[]): Promise<{ rejected: number }> {
  const rows = await pendingRows(userId, ids);
  if (rows.length === 0) return { rejected: 0 };

  const remembered = rows.filter((row) => row.idempotencyKey !== null && row.lineIndex !== null);
  if (remembered.length > 0) {
    await db
      .insert(rejectedLines)
      .values(remembered.map((row) => ({ userId, idempotencyKey: row.idempotencyKey!, lineIndex: row.lineIndex! })))
      .onConflictDoNothing();
  }
  await db
    .delete(purchaseEvents)
    .where(and(eq(purchaseEvents.userId, userId), inArray(purchaseEvents.id, rows.map((row) => row.id))));
  await dropEmptiedProducts(userId, rows.filter((row) => row.pendingUntil === null).map((row) => row.productId));
  await refreshNextCheck(userId, rows.map((row) => row.productId));
  return { rejected: rows.length };
}

/** Whether the product still has an unanswered purchase that made it (see core/pending.ts isConfirmed). */
export async function isProductConfirmed(userId: string, productId: string): Promise<boolean> {
  const rows = await db
    .select({ status: purchaseEvents.status, pendingUntil: purchaseEvents.pendingUntil })
    .from(purchaseEvents)
    .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.productId, productId), ne(purchaseEvents.status, "approved")));
  return isConfirmed(rows);
}

/**
 * Products that a still-unanswered order made. They count in estimates but
 * aren't asked about yet ("keep tracking this?" waits for the answer to the order).
 */
export async function listUnconfirmedProductIds(userId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ productId: purchaseEvents.productId })
    .from(purchaseEvents)
    .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.status, "pending"), isNull(purchaseEvents.pendingUntil)));
  return new Set(rows.map((row) => row.productId));
}
