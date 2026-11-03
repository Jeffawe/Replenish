/**
 * What a user can tune about auto-buy and about when a product counts as low.
 * Plain data and small pure functions; the database and the screens live elsewhere.
 */

/**
 * Auto-buy never spends money on an estimate we trust less than this. Users can
 * ask for more, never less. (Confidence is a score built in predict.ts, not a
 * probability; about 80% takes roughly four purchases with steady gaps.)
 */
export const MIN_AUTOBUY_CONFIDENCE = 0.8;

export interface UserSettings {
  /** Auto-buy only buys when the estimate's confidence is at least this (0.8 to 1). */
  autobuyMinConfidence: number;
  /** Price range, in cents per item, auto-buy may pay. Null = no limit on that side. */
  autobuyMinPriceCents: number | null;
  autobuyMaxPriceCents: number | null;
  /** Most auto-buy may spend in a calendar month. Null = no cap. */
  autobuyMonthlyCapCents: number | null;
  /** Order this many days before the product is expected to run out, so it arrives in time. */
  autobuyLeadDays: number;
  /** Call a product low this many days before it runs out. Null = the default in predict.ts. */
  lowStockThresholdDays: number | null;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  autobuyMinConfidence: MIN_AUTOBUY_CONFIDENCE,
  autobuyMinPriceCents: null,
  autobuyMaxPriceCents: null,
  autobuyMonthlyCapCents: null,
  autobuyLeadDays: 3,
  lowStockThresholdDays: null,
};

/** A stored confidence kept inside what is allowed, in case the floor is ever raised. */
export function clampConfidence(value: number): number {
  return Math.min(1, Math.max(MIN_AUTOBUY_CONFIDENCE, value));
}

export interface PriceRange {
  minCents: number | null;
  maxCents: number | null;
}

/**
 * The price range for one product. If the product sets either bound it has its
 * own range (a blank side means no limit there); otherwise the user's applies.
 * Bounds aren't mixed, so a product can never end up with an impossible range.
 */
export function priceRangeFor(
  settings: Pick<UserSettings, "autobuyMinPriceCents" | "autobuyMaxPriceCents">,
  product: { autobuyMinPriceCents: number | null; autobuyMaxPriceCents: number | null },
): PriceRange {
  if (product.autobuyMinPriceCents !== null || product.autobuyMaxPriceCents !== null) {
    return { minCents: product.autobuyMinPriceCents, maxCents: product.autobuyMaxPriceCents };
  }
  return { minCents: settings.autobuyMinPriceCents, maxCents: settings.autobuyMaxPriceCents };
}

/** Whether a price (in cents) is inside the range; both ends count as inside. */
export function withinRange(cents: number, range: PriceRange): boolean {
  return (range.minCents === null || cents >= range.minCents) && (range.maxCents === null || cents <= range.maxCents);
}

/** Dollars as whole cents: 12.5 -> 1250 (rounded, so 0.1 + 0.2 style float noise can't leak in). */
export function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}
