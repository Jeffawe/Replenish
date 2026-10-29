import { normalizeProductName } from "@/core/product-name";
import type { Draft, DraftLine, Warning } from "../types";
import { receiptKey, totalMismatch } from "./totals";

/**
 * Adds a second photo's draft to the first, for a receipt too long for one
 * photo or a first photo that missed something. Photos are merged as lines,
 * not as OCR words (their pixel positions mean nothing to each other):
 *
 * - a line already in the first draft (same wording, price and quantity) is
 *   the overlap between the photos, not a second purchase. Matching is by
 *   count, so a receipt that really has two identical lines keeps both;
 * - new lines are added after the first draft's, so the first draft's line
 *   numbers (and anything the user has done to them) stay valid;
 * - store, date and totals come from whichever photo has them;
 * - warnings that depend on the whole receipt (adding up, date, duplicates)
 *   are worked out again for the merged draft.
 */

/** Warnings about the draft as a whole, rebuilt after a merge. Line warnings are kept. */
const REBUILT = new Set(["total-mismatch", "date-missing", "restaurant-receipt", "possible-duplicate", "already-saved"]);

const lineKey = (draft: Draft, index: number) => {
  const item = draft.batch.items[index]!;
  return `${normalizeProductName(draft.lines?.[index]?.sourceText ?? item.productName)}|${item.priceCents ?? ""}|${item.quantity}`;
};

export function mergeDrafts(first: Draft, second: Draft): Draft {
  const have = new Map<string, number>();
  first.batch.items.forEach((_, i) => have.set(lineKey(first, i), (have.get(lineKey(first, i)) ?? 0) + 1));

  // For each wording, only the lines beyond how many the first draft already has are new.
  const added: number[] = [];
  second.batch.items.forEach((_, i) => {
    const key = lineKey(second, i);
    const left = have.get(key) ?? 0;
    if (left > 0) have.set(key, left - 1);
    else added.push(i);
  });

  const items = [...first.batch.items, ...added.map((i) => second.batch.items[i]!)];
  const lines: DraftLine[] = [
    ...(first.lines ?? first.batch.items.map((item) => ({ sourceText: item.productName, matchedBy: null }))),
    ...added.map((i) => second.lines?.[i] ?? { sourceText: second.batch.items[i]!.productName, matchedBy: null }),
  ];

  // Warnings about a line follow it to its new number.
  const newIndex = new Map(added.map((from, offset) => [from, first.batch.items.length + offset]));
  const lineWarnings = [
    ...first.warnings.filter((w) => !REBUILT.has(w.code)),
    ...second.warnings.flatMap((w): Warning[] => {
      if (REBUILT.has(w.code) || w.lineIndex === undefined) return [];
      const moved = newIndex.get(w.lineIndex);
      return moved === undefined ? [] : [{ ...w, lineIndex: moved }];
    }),
  ];

  const dateKnown = (draft: Draft) => !draft.warnings.some((w) => w.code === "date-missing");
  const dated = dateKnown(first) || !dateKnown(second) ? first : second;
  const store = first.batch.store ?? second.batch.store;
  const currency = first.batch.currency ?? second.batch.currency ?? "USD";
  const purchasedAt = String(dated.batch.purchasedAt);

  const totals = {
    subtotalCents: first.totals?.subtotalCents ?? second.totals?.subtotalCents ?? null,
    totalCents: first.totals?.totalCents ?? second.totals?.totalCents ?? null,
    // Each photo's discount rows are different rows of the receipt.
    discountsCents: (first.totals?.discountsCents ?? 0) + (second.totals?.discountsCents ?? 0),
  };

  const both = [...first.warnings, ...second.warnings];
  const mismatch = totalMismatch(items, totals, currency);
  const wholeReceipt: Warning[] = [
    ...both.filter((w) => w.code === "restaurant-receipt").slice(0, 1),
    ...(dateKnown(first) || dateKnown(second) ? [] : both.filter((w) => w.code === "date-missing").slice(0, 1)),
    ...(mismatch ? [mismatch] : []),
  ];

  return {
    batch: {
      ...first.batch,
      ...(store && { store }),
      purchasedAt,
      currency,
      idempotencyKey: receiptKey(store, purchasedAt, totals.totalCents, first.batch.idempotencyKey.replace(/^receipt-/, "")),
      items,
    },
    warnings: [...wholeReceipt, ...lineWarnings],
    lines,
    sourceText: [first.sourceText, second.sourceText].filter(Boolean).join("\n--- next photo ---\n"),
    totals,
  };
}
