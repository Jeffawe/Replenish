import { and, eq, gte, lte } from "drizzle-orm";
import type {
  IngestResult,
  LineResult,
  ProductSummary,
  PurchaseBatch,
  PurchaseSummary,
} from "@/core/purchase-batch";
import { db } from "@/db/client";
import { products, purchaseEvents, type Product } from "@/db/schema";
import { listProducts } from "./repo";
import { normalizeProductName } from "@/core/product-name";
import { normalizeBrands } from "./types";

type Line = PurchaseBatch["items"][number];

// "roll" and "rolls", "Gallon" and "gallons" are the same unit.
const unitKey = (unit: string) => unit.trim().toLowerCase().replace(/s$/, "");

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

  for (const [index, line] of batch.items.entries()) {
    const resolved = await resolveProduct(userId, line, byId, byName, register);
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
  const inserts = accepted.map(({ index, line, product }) =>
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
        lineIndex: index,
      })
      .onConflictDoNothing({
        target: [purchaseEvents.userId, purchaseEvents.idempotencyKey, purchaseEvents.lineIndex],
      })
      .returning({ id: purchaseEvents.id }),
  );
  const stored = inserts.length > 0 ? await db.batch(inserts as [(typeof inserts)[0], ...typeof inserts]) : [];
  await addNewBrands(accepted);

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
      const existing = alreadyStored.get(index);
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
  return rows
    .map(({ id, name, brand, category, unit, normalPurchaseQty }) => ({
      id,
      name,
      brand,
      category,
      unit,
      normalPurchaseQty,
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
