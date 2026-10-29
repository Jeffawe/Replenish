import { describe, expect, it } from "vitest";
import type { Draft } from "../types";
import { whyDifferentReceipt } from "./same-receipt";

function draft(extra: { store?: string; date?: string; subtotal?: number | null; total?: number | null; dateMissing?: boolean } = {}): Draft {
  return {
    batch: {
      source: "receipt",
      idempotencyKey: "receipt-x",
      ...(extra.store && { store: extra.store }),
      purchasedAt: extra.date ?? "2026-10-20",
      currency: "USD",
      items: [{ productName: "Milk", quantity: 1, unit: "each" }],
    },
    warnings: extra.dateMissing ? [{ code: "date-missing", message: "date" }] : [],
    totals: { subtotalCents: extra.subtotal ?? null, totalCents: extra.total ?? null, discountsCents: 0 },
  };
}

describe("is a second photo a different receipt", () => {
  it("finds nothing wrong with photos that agree or say nothing", () => {
    expect(whyDifferentReceipt(draft({ store: "WinCo Foods" }), draft({ store: "WINCO" }))).toEqual([]);
    expect(whyDifferentReceipt(draft({ store: "Whole Foods" }), draft({ store: "Whole" }))).toEqual([]);
    // One half of a long receipt has the name, the other the total; neither contradicts the other.
    expect(whyDifferentReceipt(draft({ store: "Costco" }), draft({ total: 5000, subtotal: 4600 }))).toEqual([]);
    expect(whyDifferentReceipt(draft({ total: 5000 }), draft({ total: 5000 }))).toEqual([]);
  });

  it("notices a different store", () => {
    expect(whyDifferentReceipt(draft({ store: "WinCo Foods" }), draft({ store: "Costco" }))).toEqual([
      "The store looks different (WinCo Foods and Costco).",
    ]);
  });

  it("notices different dates, with a day of slack, and ignores a date that wasn't read", () => {
    expect(whyDifferentReceipt(draft({ date: "2026-10-20" }), draft({ date: "2026-10-15" }))).toEqual([
      "The dates differ (2026-10-20 and 2026-10-15).",
    ]);
    expect(whyDifferentReceipt(draft({ date: "2026-10-20" }), draft({ date: "2026-10-21" }))).toEqual([]);
    expect(whyDifferentReceipt(draft({ date: "2026-10-20" }), draft({ date: "2026-10-28", dateMissing: true }))).toEqual([]);
  });

  it("notices different totals", () => {
    expect(whyDifferentReceipt(draft({ subtotal: 4600, total: 5000 }), draft({ subtotal: 2619, total: 2800 }))).toEqual([
      "The subtotal differs ($46.00 and $26.19).",
      "The total differs ($50.00 and $28.00).",
    ]);
  });

  it("lists every reason", () => {
    const reasons = whyDifferentReceipt(draft({ store: "WinCo", date: "2026-10-01", total: 100 }), draft({ store: "Costco", date: "2026-10-20", total: 200 }));
    expect(reasons).toHaveLength(3);
  });
});
