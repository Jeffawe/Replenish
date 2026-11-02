/**
 * A purchase dated ahead of now is an order that hasn't arrived (a pending
 * email order with an expected delivery date). It can't have been used yet, so
 * estimates leave it out until its date; from then on it counts like any other.
 */
export function arrived<T extends { purchasedAt: Date }>(purchases: T[], now: Date): T[] {
  return purchases.filter((purchase) => purchase.purchasedAt.getTime() <= now.getTime());
}
