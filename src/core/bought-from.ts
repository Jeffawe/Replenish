/**
 * Where a product is usually bought. Receipts and orders fill it in (the store of
 * the latest purchase) until the user types their own, which then sticks.
 */

export interface BoughtFrom {
  boughtFrom: string | null;
  /** The user typed it, so receipts leave it alone. */
  boughtFromByUser: boolean;
}

/** A store name as stored: trimmed, single-spaced, or null when blank. */
export function cleanStore(value: string | null | undefined): string | null {
  const store = (value ?? "").trim().replace(/\s+/g, " ");
  return store === "" ? null : store;
}

/**
 * What saving the Edit form does to "where it was bought". `typed` is the form's
 * value: undefined = the form didn't have the field, so nothing changes; blank
 * clears it (and lets receipts fill it again); the same name as now changes
 * nothing (saving the form must not turn a receipt's value into the user's);
 * anything else is the user's own and sticks.
 */
export function boughtFromAfterEdit(current: BoughtFrom, typed: string | null | undefined): BoughtFrom {
  // Always a fresh object with just these two fields: callers spread the result into a database update.
  const unchanged = { boughtFrom: current.boughtFrom, boughtFromByUser: current.boughtFromByUser };
  if (typed === undefined) return unchanged;
  const store = cleanStore(typed);
  if (store === null) return { boughtFrom: null, boughtFromByUser: false };
  if (store.toLowerCase() === current.boughtFrom?.toLowerCase()) return unchanged;
  return { boughtFrom: store, boughtFromByUser: true };
}
