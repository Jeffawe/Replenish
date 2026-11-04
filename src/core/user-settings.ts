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
  /** The stores the user wants to buy from, most wanted first. Empty = no preference. */
  preferredStores: string[];
  /** The user said not to ask for confirmation on "Buy for me". */
  skipBuyConfirm: boolean;
}

export const DEFAULT_USER_SETTINGS: UserSettings = {
  autobuyMinConfidence: MIN_AUTOBUY_CONFIDENCE,
  autobuyMinPriceCents: null,
  autobuyMaxPriceCents: null,
  autobuyMonthlyCapCents: null,
  autobuyLeadDays: 3,
  lowStockThresholdDays: null,
  preferredStores: [],
  skipBuyConfirm: false,
};

/** A stored confidence kept inside what is allowed, in case the floor is ever raised. */
export function clampConfidence(value: number): number {
  return Math.min(1, Math.max(MIN_AUTOBUY_CONFIDENCE, value));
}

/**
 * What may be spent, whatever a user sets, because orders are paid from our Zinc wallet first. Users
 * can lower the auto-buy limits, never raise them. The owner sets these in the environment, in dollars:
 * AUTOBUY_MAX_ORDER, AUTOBUY_MAX_MONTH and BUY_NOW_MAX_ORDER; and PLANNED_USERS, a count. A missing or
 * nonsense value means the default.
 */
export interface PlatformLimits {
  /** The most auto-buy may spend on one order, fees included. */
  orderCents: number;
  /** The most auto-buy may spend for one user in a month. */
  monthCents: number;
  /** The most one "Buy for me" order may cost, fees included. */
  buyNowOrderCents: number;
  /** How many users the budget is planned for. Raise it as the app grows. */
  plannedUsers: number;
  /** The most all users' orders together may cost in a month: plannedUsers x monthCents. */
  allUsersMonthCents: number;
}

export const DEFAULT_PLANNED_USERS = 100;

export const DEFAULT_PLATFORM_LIMITS: PlatformLimits = {
  orderCents: 5000,
  monthCents: 20000,
  buyNowOrderCents: 15000,
  plannedUsers: DEFAULT_PLANNED_USERS,
  allUsersMonthCents: DEFAULT_PLANNED_USERS * 20000,
};

export function platformLimitsFrom(env: { order?: string; month?: string; buyNowOrder?: string; plannedUsers?: string }): PlatformLimits {
  const positive = (value: string | undefined) => {
    const parsed = Number(value);
    return value?.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };
  const cents = (value: string | undefined, fallback: number) => {
    const dollars = positive(value);
    return dollars === null ? fallback : Math.round(dollars * 100);
  };
  const monthCents = cents(env.month, DEFAULT_PLATFORM_LIMITS.monthCents);
  const users = positive(env.plannedUsers);
  const plannedUsers = users !== null && users >= 1 ? Math.floor(users) : DEFAULT_PLANNED_USERS;
  return {
    orderCents: cents(env.order, DEFAULT_PLATFORM_LIMITS.orderCents),
    monthCents,
    buyNowOrderCents: cents(env.buyNowOrder, DEFAULT_PLATFORM_LIMITS.buyNowOrderCents),
    plannedUsers,
    allUsersMonthCents: plannedUsers * monthCents,
  };
}

/** A limit the user set, held to the platform's most. No limit of their own means the platform's. */
export function effectiveLimit(userCents: number | null, platformCents: number): number {
  return userCents === null ? platformCents : Math.min(userCents, platformCents);
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
