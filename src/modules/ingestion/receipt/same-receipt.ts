import { formatPrice } from "@/lib/format";
import type { Draft } from "../types";

/**
 * Why a second photo might be a different receipt from the draft it is being
 * added to, as sentences for the user (empty when nothing says so). It only
 * compares what both photos actually show: a long receipt split in two usually
 * has its total on one photo, so it passes, and having no lines in common says
 * nothing, since that is normal for two halves.
 *
 * It is a question for the user, never a block: OCR misreads a name or a date
 * now and then.
 */

/** Letters and digits only, so "WinCo Foods" and "WINCO" can be told to be alike. */
const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const dateRead = (draft: Draft) => !draft.warnings.some((warning) => warning.code === "date-missing");
const DAY_MS = 24 * 60 * 60 * 1000;

export function whyDifferentReceipt(first: Draft, second: Draft): string[] {
  const reasons: string[] = [];
  const currency = first.batch.currency ?? "USD";

  const a = first.batch.store;
  const b = second.batch.store;
  if (a && b) {
    const [x, y] = [squash(a), squash(b)];
    // "Whole" and "Whole Foods" are the same shop read two ways; "WinCo" and "Costco" are not.
    if (x && y && !x.includes(y) && !y.includes(x)) reasons.push(`The store looks different (${a} and ${b}).`);
  }

  if (dateRead(first) && dateRead(second)) {
    const [x, y] = [String(first.batch.purchasedAt).slice(0, 10), String(second.batch.purchasedAt).slice(0, 10)];
    // A day of slack for a receipt printed either side of midnight.
    if (Math.abs(Date.parse(x) - Date.parse(y)) > DAY_MS) reasons.push(`The dates differ (${x} and ${y}).`);
  }

  const amounts = (key: "subtotalCents" | "totalCents", label: string) => {
    const [x, y] = [first.totals?.[key] ?? null, second.totals?.[key] ?? null];
    if (x !== null && y !== null && Math.abs(x - y) > 1) {
      reasons.push(`The ${label} differs (${formatPrice(x, currency)} and ${formatPrice(y, currency)}).`);
    }
  };
  amounts("subtotalCents", "subtotal");
  amounts("totalCents", "total");

  return reasons;
}
