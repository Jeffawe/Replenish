import type { ProductSummary, PurchaseSummary } from "@/core/purchase-batch";
import { normalizeProductName } from "@/core/product-name";
import type { Warning } from "./types";

interface BatchForCheck {
  purchasedAt: Date;
  store?: string;
  idempotencyKey: string;
  items: { productName: string; productId?: string; quantity: number }[];
}

const day = (date: Date) => date.toISOString().slice(0, 10);
const sameStore = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Flags lines that look like something already recorded: same product, same
 * store, same day, same quantity. A warning, never a block; whether it really
 * is a duplicate is for the user to say. A line is matched to a product by its
 * productId, else by name. Lines from a retry of the same submission (same
 * idempotencyKey) are not warned about, since the receiver already handles those.
 */
export function detectPossibleDuplicates(
  batch: BatchForCheck,
  products: ProductSummary[],
  nearby: PurchaseSummary[],
): Warning[] {
  const idByName = new Map(products.map((p) => [normalizeProductName(p.name), p.id]));
  const warnings: Warning[] = [];

  batch.items.forEach((line, lineIndex) => {
    const productId = line.productId ?? idByName.get(normalizeProductName(line.productName));
    if (!productId) return;

    const match = nearby.find(
      (existing) =>
        existing.productId === productId &&
        existing.idempotencyKey !== batch.idempotencyKey &&
        sameStore(existing.store, batch.store) &&
        day(existing.purchasedAt) === day(batch.purchasedAt) &&
        existing.quantity === line.quantity,
    );
    if (match) {
      warnings.push({
        code: "possible-duplicate",
        lineIndex,
        message: `${line.quantity} ${line.productName} from ${batch.store} on ${day(batch.purchasedAt)} looks like a purchase already recorded.`,
      });
    }
  });
  return warnings;
}
