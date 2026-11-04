import type { InventoryEstimate } from "./estimate";
import { capToPack, DEFAULT_PREDICT_CONFIG, judgedDaysUntilRunOut, type PredictConfig } from "./predict";

type WindowFacts = Pick<InventoryEstimate, "lowStockThresholdDays"> & Partial<Pick<InventoryEstimate, "usualPackDays" | "thresholdIsDefault">>;

/**
 * When a product is next worth looking at, so a scheduled check can skip everything
 * that isn't close to running out instead of recalculating every product.
 *
 * With no new purchase, count or answer, a product's run-out date doesn't move (stock
 * falls at a steady rate), so the date it becomes worth acting on can be worked out
 * once. It is worked out again whenever one of those inputs changes. Everything else
 * about an estimate (its confidence, say) does change with time, which is why the check
 * recalculates the full estimate for the products it picks rather than trusting stored values.
 */

type RunOutFacts = Pick<InventoryEstimate, "daysUntilRunOut" | "daysUntilRunOutRange"> & WindowFacts;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How close to running out a product must be to need attention: the low-stock threshold,
 * or the user's lead time if that is longer (an order placed then arrives just in time).
 * The default threshold is limited to a share of how long one usual purchase lasts, or something
 * bought weekly would need attention the moment it was bought; a threshold the user set stands. With
 * the defaults (7 days and 3) this is exactly when the dashboard says "Running low".
 */
export function attentionWindowDays(estimate: WindowFacts, leadDays: number): number {
  const threshold = estimate.thresholdIsDefault ? capToPack(estimate.lowStockThresholdDays, estimate.usualPackDays) : estimate.lowStockThresholdDays;
  const lead = estimate.usualPackDays ? Math.min(leadDays, estimate.usualPackDays * DEFAULT_PREDICT_CONFIG.leadMaxShareOfPack) : leadDays;
  return Math.max(threshold, lead);
}

/** Whether the product is low enough (or close enough to running out) to find and buy or ask about. */
export function needsAttention(
  estimate: RunOutFacts,
  leadDays: number,
  config: Pick<PredictConfig, "lowStockUsesEarliestEstimate"> = DEFAULT_PREDICT_CONFIG,
): boolean {
  const days = judgedDaysUntilRunOut(estimate, config);
  return days !== null && days <= attentionWindowDays(estimate, leadDays);
}

export interface NextCheckInput {
  estimate: RunOutFacts;
  now: Date;
  leadDays: number;
  /**
   * The soonest purchase dated after `now`: an order still on its way. Arriving adds stock
   * with nobody doing anything, so that moment is a check too.
   */
  nextArrival?: Date | null;
  config?: Pick<PredictConfig, "lowStockUsesEarliestEstimate">;
}

/**
 * The moment the product first needs attention (now, if it already does), or the next
 * arrival if that comes first. Null when there is nothing to wait for: no estimate yet
 * (it needs a purchase or an answer, and either one refreshes this).
 */
export function nextCheckAt({ estimate, now, leadDays, nextArrival = null, config = DEFAULT_PREDICT_CONFIG }: NextCheckInput): Date | null {
  const days = judgedDaysUntilRunOut(estimate, config);
  if (days === null) return nextArrival;
  const wait = Math.max(0, days - attentionWindowDays(estimate, leadDays));
  const attention = new Date(now.getTime() + wait * DAY_MS);
  return nextArrival !== null && nextArrival < attention ? nextArrival : attention;
}
