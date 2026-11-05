import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type {
  IngestResult,
  LineResult,
  ProductSummary,
  PurchaseBatch,
  PurchaseSummary,
} from "@/core/purchase-batch";
import { db } from "@/db/client";
import { products, purchaseEvents, rejectedLines, type Product } from "@/db/schema";
import { cleanStore } from "@/core/bought-from";
import { pendingUntilFor } from "@/core/pending";
import { refreshNextCheck } from "./next-check";
import { listProducts } from "./repo";
import { normalizeProductName } from "@/core/product-name";
import { normalizeBrands } from "./types";

type Line = PurchaseBatch["items"][number];

// "roll" and "rolls", "Gallon" and "gallons" are the same unit.
export const unitKey = (unit: string) => unit.trim().toLowerCase().replace(/s$/, "");

/**
 * The receiver. Every sender's data ends up here, so it stays deliberately
 * plain: match each line to a product (never creating a duplicate), then store
 * it. It makes no attempt to be clever about messy names or suspicious
 * purchases; that is the sender's job.
 *
 * A line is rejected, without failing the rest of the batch, when it names a
 * product that isn't the user's or its unit differs from the product's. Safe
 * to retry: the same idempotencyKey never stores a line twice.
 */
export async function ingestPurchaseBatch(
  userId: string,
  batch: PurchaseBatch,
): Promise<IngestResult> {
  const known = await listProducts(userId);
  const byId = new Map(known.map((p) => [p.id, p]));
  const byName = new Map(known.map((p) => [p.normalizedName, p]));
  const register = (product: Product) => {
    byId.set(product.id, product);
    byName.set(product.normalizedName, product);
  };

  const rejected = new Map<number, string>();
  const accepted: { index: number; line: Line; product: Product; productCreated: boolean }[] = [];

  // Which line of the source each is, for the idempotency check (see PurchaseLineSchema.line).
  const lineNumber = (index: number) => batch.items[index]!.line ?? index;
  // Lines the user rejected earlier stay rejected when the same order arrives again.
  const declined = await declinedLines(userId, batch.idempotencyKey);

  for (const [index, line] of batch.items.entries()) {
    if (declined.has(lineNumber(index))) {
      rejected.set(index, "You rejected this order earlier");
      continue;
    }
    const resolved = await resolveProduct(userId, line, byId, byName, register, batch.source);
    if ("reason" in resolved) {
      rejected.set(index, resolved.reason);
    } else if (unitKey(resolved.product.unit) !== unitKey(line.unit)) {
      rejected.set(
        index,
        `unit "${line.unit}" differs from this product's unit "${resolved.product.unit}"`,
      );
    } else {
      accepted.push({ index, line, ...resolved });
    }
  }

  // The unique (user, idempotencyKey, line) index decides: a line that was
  // already stored comes back empty here instead of being stored twice.
  const now = new Date();
  const inserts = accepted.map(({ index, line, product, productCreated }) =>
    db
      .insert(purchaseEvents)
      .values({
        userId,
        productId: product.id,
        source: batch.source,
        quantity: line.quantity,
        unit: product.unit,
        priceCents: line.priceCents ?? null,
        brand: line.brand ?? null,
        currency: batch.currency,
        store: batch.store ?? null,
        purchasedAt: batch.purchasedAt,
        rawRef: batch.rawRef ?? null,
        orderId: batch.orderId ?? null,
        idempotencyKey: batch.idempotencyKey,
        lineIndex: lineNumber(index),
        status: batch.status,
        pendingUntil: batch.status === "pending" ? pendingUntilFor(productCreated, now) : null,
      })
      .onConflictDoNothing({
        target: [purchaseEvents.userId, purchaseEvents.idempotencyKey, purchaseEvents.lineIndex],
      })
      .returning({ id: purchaseEvents.id }),
  );
  const stored = inserts.length > 0 ? await db.batch(inserts as [(typeof inserts)[0], ...typeof inserts]) : [];
  await addNewBrands(accepted);
  const bought = accepted.filter((_, i) => stored[i]?.length).map(({ product }) => product);
  await restoreArchived(bought);
  await rememberStore(bought, batch.store, batch.purchasedAt);
  if (bought.length > 0) await refreshNextCheck(userId, bought.map((product) => product.id));

  const items: LineResult[] = [];
  for (const [index, reason] of rejected) items.push({ index, result: "rejected", reason });

  const alreadyStored = stored.some((rows) => rows.length === 0)
    ? new Map(
        (
          await db
            .select({
              id: purchaseEvents.id,
              productId: purchaseEvents.productId,
              lineIndex: purchaseEvents.lineIndex,
            })
            .from(purchaseEvents)
            .where(
              and(
                eq(purchaseEvents.userId, userId),
                eq(purchaseEvents.idempotencyKey, batch.idempotencyKey),
              ),
            )
        ).map((row) => [row.lineIndex, row]),
      )
    : new Map();

  accepted.forEach(({ index, product, productCreated }, i) => {
    const [row] = stored[i];
    if (row) {
      items.push({
        index,
        result: "created",
        productId: product.id,
        productCreated,
        purchaseEventId: row.id,
      });
    } else {
      const existing = alreadyStored.get(lineNumber(index));
      items.push({
        index,
        result: "duplicate",
        productId: existing?.productId ?? product.id,
        purchaseEventId: existing?.id ?? "",
      });
    }
  });

  items.sort((a, b) => a.index - b.index);
  const status = items.some((i) => i.result === "created")
    ? "processed"
    : items.some((i) => i.result === "duplicate")
      ? "duplicate"
      : "rejected";
  return { status, items };
}

/** Buying a product the user had hidden ("don't track this") brings it back, rather than hiding the purchase too. */
async function declinedLines(userId: string, idempotencyKey: string): Promise<Set<number>> {
  const rows = await db
    .select({ lineIndex: rejectedLines.lineIndex })
    .from(rejectedLines)
    .where(and(eq(rejectedLines.userId, userId), eq(rejectedLines.idempotencyKey, idempotencyKey)));
  return new Set(rows.map((row) => row.lineIndex));
}

/**
 * Where a product is bought: the store of its latest purchase, unless the user typed their
 * own. An older receipt arriving late doesn't change it, because only a purchase at least
 * as new as the product's newest (this one is already stored) may set it.
 */
async function rememberStore(bought: Product[], store: string | null | undefined, purchasedAt: Date) {
  const name = cleanStore(store);
  const ids = [...new Set(bought.map((product) => product.id))];
  if (name === null || ids.length === 0) return;
  await db
    .update(products)
    .set({ boughtFrom: name })
    .where(
      and(
        inArray(products.id, ids),
        eq(products.boughtFromByUser, false),
        sql`${purchasedAt.toISOString()}::timestamptz >= coalesce((select max(${purchaseEvents.purchasedAt}) from ${purchaseEvents} where ${purchaseEvents.productId} = ${products.id}), '-infinity'::timestamptz)`,
      ),
    );
}

async function restoreArchived(bought: Product[]) {
  const ids = [...new Set(bought.filter((product) => product.archivedAt !== null).map((product) => product.id))];
  if (ids.length > 0) await db.update(products).set({ archivedAt: null }).where(inArray(products.id, ids));
}

/**
 * A product is bought in whatever brands its purchases name, so a brand seen
 * for the first time is added to the product's list.
 */
async function addNewBrands(accepted: { line: Line; product: Product }[]) {
  const updated = new Map<string, string | null>();
  for (const { line, product } of accepted) {
    if (!line.brand) continue;
    const current = updated.get(product.id) ?? product.brand;
    const next = normalizeBrands(current ? `${current}, ${line.brand}` : line.brand);
    if (next !== current) updated.set(product.id, next);
  }
  if (updated.size === 0) return;
  const updates = [...updated].map(([id, brand]) => db.update(products).set({ brand }).where(eq(products.id, id)));
  await db.batch(updates as [(typeof updates)[0], ...typeof updates]);
}

/** The user's existing products, for a sender to match its lines against before sending. */
export async function listProductSummaries(userId: string): Promise<ProductSummary[]> {
  const rows = await listProducts(userId);
  // Hidden products aren't offered for matching; a line naming one exactly still finds it and brings it back.
  return rows
    .filter((row) => row.archivedAt === null)
    .map(({ id, name, brand, category, unit, normalPurchaseQty, matchByName }) => ({
      id,
      name,
      brand,
      category,
      unit,
      normalPurchaseQty,
      matchByName,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Stored purchases within a day either side of `around`, for a sender to spot likely duplicates. */
export async function listPurchasesNear(userId: string, around: Date): Promise<PurchaseSummary[]> {
  const day = 24 * 60 * 60 * 1000;
  return db
    .select({
      productId: purchaseEvents.productId,
      store: purchaseEvents.store,
      quantity: purchaseEvents.quantity,
      purchasedAt: purchaseEvents.purchasedAt,
      idempotencyKey: purchaseEvents.idempotencyKey,
      lineIndex: purchaseEvents.lineIndex,
    })
    .from(purchaseEvents)
    .where(
      and(
        eq(purchaseEvents.userId, userId),
        gte(purchaseEvents.purchasedAt, new Date(around.getTime() - day)),
        lte(purchaseEvents.purchasedAt, new Date(around.getTime() + day)),
      ),
    );
}

/** The sender's productId if given, else a name match, else a new product. */
async function resolveProduct(
  userId: string,
  line: Line,
  byId: Map<string, Product>,
  byName: Map<string, Product>,
  register: (product: Product) => void,
  source: string,
): Promise<{ product: Product; productCreated: boolean } | { reason: string }> {
  if (line.productId) {
    const product = byId.get(line.productId);
    return product
      ? { product, productCreated: false }
      : { reason: "productId does not match any of this user's products" };
  }

  const normalizedName = normalizeProductName(line.productName);
  const existing = byName.get(normalizedName);
  if (existing) return { product: existing, productCreated: false };

  // The unique (user, normalized name) index makes this safe when two requests
  // race to create the same product: one inserts, the other reads it back.
  const [inserted] = await db
    .insert(products)
    .values({
      userId,
      name: line.productName,
      normalizedName,
      brand: normalizeBrands(line.brand ?? null),
      category: line.category ?? null,
      unit: line.unit,
      normalPurchaseQty: line.quantity,
      // Typing a product in already says "keep track of this", so it isn't asked. A receipt or email only suggests one.
      confirmedAt: source === "manual" ? new Date() : null,
    })
    .onConflictDoNothing({ target: [products.userId, products.normalizedName] })
    .returning();
  if (inserted) {
    register(inserted);
    return { product: inserted, productCreated: true };
  }

  const [winner] = await db
    .select()
    .from(products)
    .where(and(eq(products.userId, userId), eq(products.normalizedName, normalizedName)));
  register(winner);
  return { product: winner, productCreated: false };
}
