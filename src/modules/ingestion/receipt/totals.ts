import { createHash } from "node:crypto";
import { formatPrice } from "@/lib/format";
import type { Warning } from "../types";

export const sha256 = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/**
 * The idempotency key for a receipt: its store, date and total, not the
 * photo, so a second photo of one receipt is the same purchase. Without a
 * readable total, `fallback` (the photo's own hash) is used.
 */
export function receiptKey(store: string | null | undefined, purchasedAt: string, totalCents: number | null, fallback: string): string {
  const key = totalCents === null ? fallback : sha256(JSON.stringify([store?.toLowerCase() ?? "", purchasedAt, totalCents]));
  return `receipt-${key.slice(0, 32)}`;
}

/**
 * Warns when the lines don't add up to the receipt's subtotal. Lines are at
 * full price and the subtotal is after any coupons, so discounts are allowed for.
 */
export function totalMismatch(
  items: { priceCents?: number | null }[],
  totals: { subtotalCents: number | null; discountsCents: number },
  currency: string,
): Warning | null {
  const itemsTotal = items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
  const afterDiscounts = itemsTotal - totals.discountsCents;
  if (totals.subtotalCents === null || Math.abs(afterDiscounts - totals.subtotalCents) <= 1) return null;
  const discounted =
    totals.discountsCents > 0 ? ` (after ${formatPrice(totals.discountsCents, currency)} of discounts)` : "";
  return {
    code: "total-mismatch",
    message: `The items we found add up to ${formatPrice(afterDiscounts, currency)}${discounted} but the receipt's subtotal is ${formatPrice(totals.subtotalCents, currency)}. Check for a missing, duplicate or discounted line.`,
  };
}
