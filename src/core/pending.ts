/**
 * Pending purchases: orders that arrived from an automatic source (email)
 * while the user wasn't looking. They count in estimates straight away and the
 * user is asked about them when they next open the app.
 *
 * - A line for a product the user already had asks for PENDING_DAYS, then
 *   counts as approved (`pendingUntil` is that date).
 * - A line that made a new product has no limit (`pendingUntil` is null): it
 *   keeps asking and keeps counting, but the product stays unconfirmed, so
 *   anything that spends money for the user (auto-buy, later) leaves it alone.
 */
export const PENDING_DAYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PendingState {
  status: string;
  pendingUntil: Date | null;
}

/** When a new pending line stops asking: null for a new product, else PENDING_DAYS from `from`. */
export function pendingUntilFor(productCreated: boolean, from: Date): Date | null {
  return productCreated ? null : new Date(from.getTime() + PENDING_DAYS * DAY_MS);
}

/** Still waiting for the user's answer (and so worth asking about). */
export function isAwaitingAnswer(purchase: PendingState, now: Date): boolean {
  return purchase.status === "pending" && (purchase.pendingUntil === null || purchase.pendingUntil > now);
}

/**
 * False while a purchase that made the product is still unanswered. Pending
 * lines on a product the user already had don't unconfirm it.
 */
export function isConfirmed(purchases: PendingState[]): boolean {
  return !purchases.some((purchase) => purchase.status === "pending" && purchase.pendingUntil === null);
}
