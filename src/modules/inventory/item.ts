import type { InventoryCorrection, Product, PurchaseEventRow } from "@/db/schema";
import { predict } from "@/core/predict";
import type { InventoryEstimate } from "@/core/estimate";

export interface InventoryItem {
  product: Product;
  estimate: InventoryEstimate;
  /** Newest first. */
  purchases: PurchaseEventRow[];
  /** Newest first. */
  corrections: InventoryCorrection[];
}

export function buildItem(
  product: Product,
  purchases: PurchaseEventRow[],
  corrections: InventoryCorrection[],
  now: Date,
  userLowStockThresholdDays?: number | null,
): InventoryItem {
  const estimate = predict({
    product,
    userLowStockThresholdDays: userLowStockThresholdDays ?? undefined,
    purchases: purchases.map((p) => ({ quantity: p.quantity, purchasedAt: p.purchasedAt, agent: p.source === "agent" })),
    corrections: corrections.map((c) => ({
      remainingQuantity: c.remainingQuantity,
      recordedAt: c.recordedAt,
      estimatedAtTime: c.estimatedAtTime,
    })),
    now,
  });
  return { product, estimate, purchases, corrections };
}
