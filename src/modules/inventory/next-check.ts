import { and, eq, inArray } from "drizzle-orm";
import { arrived } from "@/core/arrived";
import type { InventoryEstimate } from "@/core/estimate";
import { needsAttention, nextCheckAt } from "@/core/next-check";
import { db } from "@/db/client";
import { products, type Product } from "@/db/schema";
import { getUserSettings } from "@/modules/settings";
import { buildItem } from "./item";
import { listCorrectionsFor, listProducts, listPurchaseEventsFor } from "./repo";

/**
 * Keeps `products.next_check_at` current: the moment each tracked product first needs attention
 * (src/core/next-check.ts). `refreshNextCheck` is called wherever a purchase, count, answer,
 * product or setting changes. The scheduled check that reads these dates (and the sweep that
 * recalculates all of them) is in src/modules/restock; it uses `evaluateProducts` and
 * `saveNextCheckDates` from here, so the estimate and the date are worked out in one place.
 */

/** A product's estimate and check date, worked out together. */
export interface Evaluated {
  product: Product;
  estimate: InventoryEstimate | null;
  needsAttention: boolean;
  nextCheck: Date | null;
}

/** Estimates and check dates for these products, all of one user's. Hidden (archived) products have neither. */
export async function evaluateProducts(userId: string, rows: Product[], at: Date | undefined): Promise<{ computed: Evaluated[]; at: Date }> {
  const tracked = rows.filter((product) => product.archivedAt === null);
  const ids = tracked.map((product) => product.id);
  const [purchases, corrections, settings] = await Promise.all([
    ids.length > 0 ? listPurchaseEventsFor(userId, ids) : [],
    ids.length > 0 ? listCorrectionsFor(userId, ids) : [],
    getUserSettings(userId),
  ]);
  // Read the clock after the queries so it is a request-time value.
  const now = at ?? new Date();

  const group = <T extends { productId: string }>(list: T[]) => {
    const byProduct = new Map<string, T[]>();
    for (const entry of list) byProduct.set(entry.productId, [...(byProduct.get(entry.productId) ?? []), entry]);
    return byProduct;
  };
  const purchasesBy = group(purchases);
  const correctionsBy = group(corrections);

  const computed = rows.map((product): Evaluated => {
    if (product.archivedAt !== null) return { product, estimate: null, needsAttention: false, nextCheck: null };
    const own = purchasesBy.get(product.id) ?? [];
    const { estimate } = buildItem(product, arrived(own, now), correctionsBy.get(product.id) ?? [], now, settings.lowStockThresholdDays);
    // An order still on its way adds stock the moment it arrives, so that is a check too.
    const coming = own.filter((purchase) => purchase.purchasedAt > now).map((purchase) => purchase.purchasedAt.getTime());
    return {
      product,
      estimate,
      needsAttention: needsAttention(estimate, settings.autobuyLeadDays),
      nextCheck: nextCheckAt({
        estimate,
        now,
        leadDays: settings.autobuyLeadDays,
        nextArrival: coming.length > 0 ? new Date(Math.min(...coming)) : null,
      }),
    };
  });
  return { computed, at: now };
}

export async function saveNextCheckDates(entries: Pick<Evaluated, "product" | "nextCheck">[]): Promise<void> {
  if (entries.length === 0) return;
  const updates = entries.map(({ product, nextCheck }) =>
    db.update(products).set({ nextCheckAt: nextCheck }).where(eq(products.id, product.id)),
  );
  await db.batch(updates as [(typeof updates)[0], ...typeof updates]);
}

/** Works out and stores the check dates; throws if the database does (the sweep wants to know). */
export async function recalculateNextChecks(userId: string, productIds: string[] | undefined, now: Date | undefined): Promise<number> {
  const rows =
    productIds === undefined
      ? await listProducts(userId)
      : productIds.length === 0
        ? []
        : await db.select().from(products).where(and(eq(products.userId, userId), inArray(products.id, productIds)));
  if (rows.length === 0) return 0;
  const { computed } = await evaluateProducts(userId, rows, now);
  await saveNextCheckDates(computed);
  return computed.length;
}

/**
 * Recalculates when these products (or all of the user's) next need checking. Call it after
 * anything that changes an estimate. It can never fail the save it follows: if it can't run,
 * the date is stale until the next sweep, and the user's change is already stored.
 */
export async function refreshNextCheck(userId: string, productIds?: string[], now?: Date): Promise<void> {
  try {
    await recalculateNextChecks(userId, productIds === undefined ? undefined : [...new Set(productIds)], now);
  } catch (error) {
    console.error("Could not refresh when products are next checked", error);
  }
}
