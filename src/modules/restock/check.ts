import { and, asc, eq, isNull, lte } from "drizzle-orm";
import type { InventoryEstimate } from "@/core/estimate";
import { db } from "@/db/client";
import { products, type Product } from "@/db/schema";
import { evaluateProducts, recalculateNextChecks, saveNextCheckDates, type Evaluated } from "@/modules/inventory/next-check";

/**
 * The low-stock check. Each tracked product has a `next_check_at` (src/core/next-check.ts): the
 * moment it first needs attention. The scheduled check loads only the products that are due,
 * works out their full estimates, and returns the ones that are low. Everything else it looked
 * at gets its date moved forward.
 *
 * `next_check_at` is kept current by `refreshNextCheck` (src/modules/inventory/next-check.ts),
 * called wherever a purchase, count, answer, product or setting changes. A write path that
 * forgets would leave a product checked late, so `sweepNextChecks` recalculates everything now
 * and then as a safety net.
 */

/** A product that needs attention, with its estimate worked out at check time. */
export interface LowProduct {
  userId: string;
  product: Product;
  estimate: InventoryEstimate;
}

export interface CheckOptions {
  now?: Date;
  /** Only this user's products (tests, and checking one account by hand). */
  userId?: string;
}

export interface SweepResult {
  users: number;
  products: number;
  errors: { userId: string; message: string }[];
}

/** Recalculates every product's check date for everyone. Slow on purpose: it is the safety net, and the first fill after a deploy. */
export async function sweepNextChecks({ now, userId }: CheckOptions = {}): Promise<SweepResult> {
  const owners = await db
    .selectDistinct({ userId: products.userId })
    .from(products)
    .where(userId ? eq(products.userId, userId) : undefined);
  const result: SweepResult = { users: 0, products: 0, errors: [] };
  for (const owner of owners) {
    try {
      result.products += await recalculateNextChecks(owner.userId, undefined, now);
      result.users++;
    } catch (error) {
      result.errors.push({ userId: owner.userId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export interface LowStockCheck {
  checkedAt: Date;
  /** How many due products were looked at. */
  checked: number;
  /** The products that need attention, with their estimates, soonest to run out first. */
  low: LowProduct[];
  /** More were due than one run takes (`limit`); the rest are picked up by the next run. */
  moreDue: boolean;
  errors: { userId: string; message: string }[];
}

/** The most due products one run looks at, so a run fits in a function's time limit. */
export const CHECK_LIMIT = 500;

/**
 * The scheduled check: finds the products whose time has come, recalculates their estimates
 * and returns the low ones. A product that turns out not to be low yet has its date moved
 * forward. Low ones are left as they are, so they are listed again until something handles
 * them (that is the next step; nothing is bought or asked here).
 */
export async function runLowStockCheck({ now, userId }: CheckOptions = {}, limit = CHECK_LIMIT): Promise<LowStockCheck> {
  const at = now ?? new Date();
  const due = await db
    .select()
    .from(products)
    .where(and(lte(products.nextCheckAt, at), isNull(products.archivedAt), userId ? eq(products.userId, userId) : undefined))
    .orderBy(asc(products.nextCheckAt))
    .limit(limit + 1);
  const moreDue = due.length > limit;
  const batch = due.slice(0, limit);

  const byUser = new Map<string, Product[]>();
  for (const product of batch) byUser.set(product.userId, [...(byUser.get(product.userId) ?? []), product]);

  const low: LowProduct[] = [];
  const later: Evaluated[] = [];
  const errors: LowStockCheck["errors"] = [];
  for (const [owner, rows] of byUser) {
    try {
      const { computed } = await evaluateProducts(owner, rows, at);
      for (const entry of computed) {
        if (entry.needsAttention && entry.estimate) low.push({ userId: owner, product: entry.product, estimate: entry.estimate });
        else later.push(entry);
      }
    } catch (error) {
      errors.push({ userId: owner, message: error instanceof Error ? error.message : String(error) });
    }
  }
  await saveNextCheckDates(later);

  low.sort((a, b) => (a.estimate.daysUntilRunOut ?? Infinity) - (b.estimate.daysUntilRunOut ?? Infinity));
  return { checkedAt: at, checked: batch.length, low, moreDue, errors };
}

/** A low product as plain data for a response or a printout: the product's facts and its estimate (without the full rate workings). */
export function describeLowProduct({ userId, product, estimate }: LowProduct) {
  const details: Omit<InventoryEstimate, "rate"> & { rate?: InventoryEstimate["rate"] } = { ...estimate };
  delete details.rate;
  return {
    userId,
    productId: product.id,
    name: product.name,
    brand: product.brand,
    unit: product.unit,
    boughtFrom: product.boughtFrom,
    confirmed: product.confirmedAt !== null,
    autobuyEnabled: product.autobuyEnabled,
    estimate: details,
  };
}
