import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { ignoredWordings, productAliases, products, questionSnoozes } from "@/db/schema";

/**
 * Storage for what the user tells the app about a product outside of a
 * purchase: "yes, track it", "no, don't", the usage answers, and "not now" on
 * a question. Stock counts are in service.ts (recordStockCount).
 */

const owned = (userId: string, productId: string) => and(eq(products.id, productId), eq(products.userId, userId));

/** The product's name and the receipt wordings learned for it, normalized; empty if it isn't the user's. */
async function wordingsOf(userId: string, productId: string): Promise<string[]> {
  const [product] = await db
    .select({ normalizedName: products.normalizedName })
    .from(products)
    .where(owned(userId, productId));
  if (!product) return [];
  const aliases = await db
    .select({ alias: productAliases.alias })
    .from(productAliases)
    .where(and(eq(productAliases.userId, userId), eq(productAliases.productId, productId)));
  // Item codes ("#walmart#0078...") aren't wordings a receipt line could be ticked by.
  return [...new Set([product.normalizedName, ...aliases.map((row) => row.alias).filter((alias) => !alias.startsWith("#"))])];
}

/** "Yes, keep track of this": the product stops being asked about as new. */
export async function confirmProduct(userId: string, productId: string): Promise<void> {
  await db.update(products).set({ confirmedAt: new Date(), archivedAt: null }).where(owned(userId, productId));
}

/**
 * "No, don't track this": hides the product (nothing is deleted) and
 * remembers its name and the receipt wordings that led to it as left out, so
 * future receipts start that line unticked.
 */
export async function archiveProduct(userId: string, productId: string): Promise<void> {
  const wordings = await wordingsOf(userId, productId);
  if (wordings.length === 0) return;
  await db.batch([
    db.update(products).set({ archivedAt: new Date() }).where(owned(userId, productId)),
    db
      .insert(ignoredWordings)
      .values(wordings.map((wording) => ({ userId, wording })))
      .onConflictDoNothing({ target: [ignoredWordings.userId, ignoredWordings.wording] }),
  ]);
}

/** Takes back a "yes, keep track of this". */
export async function unconfirmProduct(userId: string, productId: string): Promise<void> {
  await db.update(products).set({ confirmedAt: null }).where(owned(userId, productId));
}

/** Takes back a "no, don't track this": shows the product again and forgets its wordings as left out. */
export async function restoreProduct(userId: string, productId: string): Promise<void> {
  const wordings = await wordingsOf(userId, productId);
  if (wordings.length === 0) return;
  await db.batch([
    db.update(products).set({ archivedAt: null }).where(owned(userId, productId)),
    db.delete(ignoredWordings).where(and(eq(ignoredWordings.userId, userId), inArray(ignoredWordings.wording, wordings))),
  ]);
}

/** The answers to "how long does one last?" and "how much is left when you restock?". Unset fields are left alone. */
export async function saveUsageAnswers(
  userId: string,
  productId: string,
  // null clears an answer (an undo).
  answers: { fallbackDaysPerPurchase?: number | null; typicalLeftoverAtPurchase?: number | null },
): Promise<void> {
  if (Object.keys(answers).length === 0) return;
  await db.update(products).set(answers).where(owned(userId, productId));
}

/** "Not now": keeps that kind of question about that product quiet until `until`. */
export async function snoozeQuestion(userId: string, productId: string, kind: string, until: Date): Promise<void> {
  await db
    .insert(questionSnoozes)
    .values({ userId, productId, kind, until })
    .onConflictDoUpdate({
      target: [questionSnoozes.userId, questionSnoozes.productId, questionSnoozes.kind],
      set: { until },
    });
}

/** Questions still snoozed at `now`, as "productId:kind" keys. */
export async function listSnoozed(userId: string, now: Date): Promise<Set<string>> {
  const rows = await db
    .select({ productId: questionSnoozes.productId, kind: questionSnoozes.kind })
    .from(questionSnoozes)
    .where(and(eq(questionSnoozes.userId, userId), gt(questionSnoozes.until, now)));
  return new Set(rows.map((row) => `${row.productId}:${row.kind}`));
}
