import type { InventoryEstimate } from "./estimate";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A product we expected to run out long ago, with nothing new since: the user has probably stopped
 * buying it, or buys it somewhere we can't see. Searching for it again and again costs credits and
 * answers the wrong question, so we stop, and ask "are you still using this?" instead.
 */
export const ABANDONED_AFTER = {
  /** How many usual purchases' worth of time past the expected run-out. */
  packs: 2,
  /** And never sooner than this, so something used up in days isn't given up on within a week. */
  days: 30,
};

type Facts = Pick<InventoryEstimate, "anchor" | "consumptionPerDay" | "usualPackDays">;

/** How many days past its expected run-out the product is; 0 when it hasn't reached it. */
export function overdueDays({ anchor, consumptionPerDay }: Facts, now: Date): number {
  if (!anchor || !consumptionPerDay) return 0;
  const lasted = anchor.quantity / consumptionPerDay;
  return Math.max(0, (now.getTime() - anchor.at.getTime()) / DAY_MS - lasted);
}

export function isAbandoned(estimate: Facts, now: Date): boolean {
  return overdueDays(estimate, now) > Math.max(ABANDONED_AFTER.packs * (estimate.usualPackDays ?? 0), ABANDONED_AFTER.days);
}
