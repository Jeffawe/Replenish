import { formatQuantity } from "@/lib/format";

/**
 * Catches a likely typo in a typed stock count before it is saved ("20" for
 * "2"), so the UI can ask "are you sure?". It never blocks: a surprising
 * answer can be right, and prediction copes with a wrong one anyway (it marks
 * a count far from its guess as disputed and asks again).
 */
export const DEFAULT_PLAUSIBILITY_CONFIG = {
  /** More than this many times the larger of a usual purchase and our guess gets a second look. */
  stockCountTimes: 3,
};

export interface StockCountContext {
  unit: string;
  normalPurchaseQty: number;
  /** Our current guess, if we have one. */
  estimatedRemaining: number | null;
}

/** A question to put to the user when `count` looks unlikely, or null when it looks fine. */
export function checkStockCount(
  count: number,
  context: StockCountContext,
  config = DEFAULT_PLAUSIBILITY_CONFIG,
): string | null {
  const usual = Math.max(context.normalPurchaseQty, context.estimatedRemaining ?? 0);
  if (usual <= 0 || count <= config.stockCountTimes * usual) return null;
  const typical = formatQuantity(context.normalPurchaseQty);
  return `That's ${formatQuantity(count)} ${context.unit}, a lot more than the ${typical} ${context.unit} you usually buy. Is that right?`;
}
