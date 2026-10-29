import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  inventoryCorrections,
  productAliases,
  products,
  purchaseEvents,
  type InventoryCorrection,
  type Product,
  type PurchaseEventRow,
} from "@/db/schema";
import type { InventoryEstimate } from "@/core/estimate";
import { predict } from "@/core/predict";
import {
  getProduct,
  listCorrections,
  listProductCorrections,
  listProductPurchaseEvents,
  listProducts,
  listPurchaseEvents,
} from "./repo";
import { normalizeProductName } from "@/core/product-name";
import { normalizeBrands, type ProductEdit } from "./types";

export interface InventoryItem {
  product: Product;
  estimate: InventoryEstimate;
  /** Newest first. */
  purchases: PurchaseEventRow[];
  /** Newest first. */
  corrections: InventoryCorrection[];
}

function buildItem(
  product: Product,
  purchases: PurchaseEventRow[],
  corrections: InventoryCorrection[],
  now: Date,
): InventoryItem {
  const estimate = predict({
    product,
    purchases: purchases.map((p) => ({ quantity: p.quantity, purchasedAt: p.purchasedAt })),
    corrections: corrections.map((c) => ({
      remainingQuantity: c.remainingQuantity,
      recordedAt: c.recordedAt,
      estimatedAtTime: c.estimatedAtTime,
    })),
    now,
  });
  return { product, estimate, purchases, corrections };
}

/**
 * Every product the user tracks with its current estimate, most urgent first.
 * Estimates are derived here on every call; nothing is stored.
 */
export async function getInventory(userId: string, now?: Date): Promise<InventoryItem[]> {
  const [productRows, purchaseRows, correctionRows] = await Promise.all([
    listProducts(userId),
    listPurchaseEvents(userId),
    listCorrections(userId),
  ]);
  // Products the user said not to track stay stored but out of sight.
  const tracked = productRows.filter((product) => product.archivedAt === null);
  // Read the clock after the queries so it is a request-time value.
  const at = now ?? new Date();

  const items = tracked.map((product) =>
    buildItem(
      product,
      purchaseRows.filter((p) => p.productId === product.id),
      correctionRows.filter((c) => c.productId === product.id),
      at,
    ),
  );

  // Soonest run-out first; products we can't predict yet go last.
  return items.sort((a, b) => {
    const da = a.estimate.daysUntilRunOut ?? Infinity;
    const db = b.estimate.daysUntilRunOut ?? Infinity;
    return da - db || a.product.name.localeCompare(b.product.name);
  });
}

/**
 * Saves the product's details and any answers from the edit form together.
 * A stock count is recorded as a correction, stamped with what we predicted
 * just before it so past accuracy can be measured. Unchanged settings are
 * rewritten as-is; blank answers clear them.
 */
export async function saveProductEdit(
  userId: string,
  edit: ProductEdit,
): Promise<"saved" | "not-found" | { nameTakenBy: string }> {
  const product = await getProduct(userId, edit.productId);
  if (!product) return "not-found";

  // Renaming: the new name must be free, and the old one is kept as an alias so receipts that used it still match.
  const normalizedName = normalizeProductName(edit.name);
  const renamed = normalizedName !== product.normalizedName;
  if (renamed) {
    const [taken] = await db
      .select({ name: products.name })
      .from(products)
      .where(and(eq(products.userId, userId), eq(products.normalizedName, normalizedName)));
    if (taken) return { nameTakenBy: taken.name };
  }

  const estimatedAtTime = edit.remainingNow === null ? null : await currentGuess(userId, product);

  const updateProduct = db
    .update(products)
    .set({
      name: edit.name,
      normalizedName,
      matchByName: edit.matchByName,
      unit: edit.unit,
      category: edit.category,
      brand: edit.brand,
      fallbackDaysPerPurchase: edit.fallbackDaysPerPurchase,
      typicalLeftoverAtPurchase: edit.typicalLeftoverAtPurchase,
      lowStockThresholdDays: edit.lowStockThresholdDays,
    })
    .where(and(eq(products.id, product.id), eq(products.userId, userId)));

  // Renaming the unit relabels past purchases too; amounts are not converted.
  const relabelPurchases = db
    .update(purchaseEvents)
    .set({ unit: edit.unit })
    .where(and(eq(purchaseEvents.productId, product.id), eq(purchaseEvents.userId, userId)));

  const recordCount = db.insert(inventoryCorrections).values({
    userId,
    productId: product.id,
    remainingQuantity: edit.remainingNow ?? 0,
    estimatedAtTime,
  });

  const keepOldName = db
    .insert(productAliases)
    .values({ userId, productId: product.id, alias: product.normalizedName })
    .onConflictDoUpdate({ target: [productAliases.userId, productAliases.alias], set: { productId: product.id } });

  // One batch, so a failure part-way can't leave the details and history disagreeing.
  await db.batch([
    updateProduct,
    ...(renamed ? [keepOldName] : []),
    ...(edit.unit !== product.unit ? [relabelPurchases] : []),
    ...(edit.remainingNow !== null ? [recordCount] : []),
  ]);
  return "saved";
}

/** What we predict is left right now, to stamp on a stock count so past accuracy can be measured. */
async function currentGuess(userId: string, product: Product): Promise<number | null> {
  const [purchases, corrections] = await Promise.all([
    listProductPurchaseEvents(userId, product.id),
    listProductCorrections(userId, product.id),
  ]);
  return buildItem(product, purchases, corrections, new Date()).estimate.estimatedRemaining;
}

/**
 * Records one stock count ("I have about 4 left"), stamped with what we
 * predicted just before it. Returns the count's id so it can be undone.
 */
export async function recordStockCount(
  userId: string,
  productId: string,
  remainingQuantity: number,
): Promise<{ correctionId: string } | "not-found"> {
  const product = await getProduct(userId, productId);
  if (!product) return "not-found";
  const estimatedAtTime = await currentGuess(userId, product);
  const [row] = await db
    .insert(inventoryCorrections)
    .values({ userId, productId, remainingQuantity, estimatedAtTime })
    .returning({ id: inventoryCorrections.id });
  return { correctionId: row.id };
}

/** Takes back a stock count the user just gave ("Undo"). The latest answer always wins otherwise. */
export async function undoStockCount(userId: string, correctionId: string): Promise<void> {
  await db
    .delete(inventoryCorrections)
    .where(and(eq(inventoryCorrections.id, correctionId), eq(inventoryCorrections.userId, userId)));
}

/**
 * Merges `fromId` into `intoId`: a product that turned out to be the same as
 * another (a receipt made "Large Eggs" when the user already had "Eggs").
 * Every purchase and stock count moves over, so the estimate is worked out
 * from the combined history; its wordings, item codes and name become the
 * other product's, so receipts that matched it now match `intoId`; its brands
 * join the other's. Then it is deleted. Units must match, since amounts aren't
 * converted. Can't be undone.
 */
export async function mergeProducts(
  userId: string,
  fromId: string,
  intoId: string,
): Promise<"merged" | "not-found" | "same" | { unitsDiffer: [string, string] }> {
  if (fromId === intoId) return "same";
  const [from, into] = await Promise.all([getProduct(userId, fromId), getProduct(userId, intoId)]);
  if (!from || !into) return "not-found";
  const unitKey = (unit: string) => unit.trim().toLowerCase().replace(/s$/, "");
  if (unitKey(from.unit) !== unitKey(into.unit)) return { unitsDiffer: [from.unit, into.unit] };

  await db.batch([
    db.update(purchaseEvents).set({ productId: into.id, unit: into.unit }).where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.productId, from.id))),
    db.update(inventoryCorrections).set({ productId: into.id }).where(and(eq(inventoryCorrections.userId, userId), eq(inventoryCorrections.productId, from.id))),
    db.update(productAliases).set({ productId: into.id }).where(and(eq(productAliases.userId, userId), eq(productAliases.productId, from.id))),
    db
      .insert(productAliases)
      .values({ userId, productId: into.id, alias: from.normalizedName })
      .onConflictDoUpdate({ target: [productAliases.userId, productAliases.alias], set: { productId: into.id } }),
    db
      .update(products)
      .set({
        brand: normalizeBrands([into.brand, from.brand].filter(Boolean).join(", ") || null),
        // Answers the kept product lacks are taken from the merged one.
        fallbackDaysPerPurchase: into.fallbackDaysPerPurchase ?? from.fallbackDaysPerPurchase,
        typicalLeftoverAtPurchase: into.typicalLeftoverAtPurchase ?? from.typicalLeftoverAtPurchase,
        lowStockThresholdDays: into.lowStockThresholdDays ?? from.lowStockThresholdDays,
        category: into.category ?? from.category,
        confirmedAt: into.confirmedAt ?? from.confirmedAt ?? new Date(),
        archivedAt: null,
      })
      .where(and(eq(products.userId, userId), eq(products.id, into.id))),
    db.delete(products).where(and(eq(products.userId, userId), eq(products.id, from.id))),
  ]);
  return "merged";
}
