/** Receipt photos a user may read per calendar month when neither they nor RECEIPT_LIMIT say otherwise. */
export const DEFAULT_RECEIPT_LIMIT = 10;

/**
 * How many photos this user may read a month: their own limit if one is set,
 * else the RECEIPT_LIMIT value, else the built-in default. A bad value (not a
 * whole number, or negative) is ignored rather than locking everyone out.
 */
export function effectiveReceiptLimit(userLimit: number | null, envValue: string | undefined): number {
  if (userLimit !== null && userLimit >= 0) return userLimit;
  const fromEnv = envValue?.trim() ? Number(envValue) : NaN;
  return Number.isInteger(fromEnv) && fromEnv >= 0 ? fromEnv : DEFAULT_RECEIPT_LIMIT;
}

/** Months are UTC calendar months, so every user's month turns over at the same moment. */
export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/** What the user is told when they are out of photos. Safe to show. */
export function limitReachedMessage(limit: number, now: Date): string {
  const resets = nextMonthStart(now).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  if (limit === 0) return "Reading receipt photos isn't available on this account.";
  return `You've used all ${limit} of your receipt photos for this month. You'll get more on ${resets}.`;
}
