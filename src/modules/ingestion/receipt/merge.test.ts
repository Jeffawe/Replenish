import { describe, expect, it } from "vitest";
import type { Draft } from "../types";
import { mergeDrafts } from "./merge";

type Item = { name: string; wording?: string; price?: number; quantity?: number };

function draft(items: Item[], extra: Partial<Draft> & { store?: string; date?: string } = {}): Draft {
  const { store, date, ...rest } = extra;
  return {
    batch: {
      source: "receipt",
      idempotencyKey: "receipt-photo-hash-abcdef",
      ...(store && { store }),
      purchasedAt: date ?? "2026-10-20",
      currency: "USD",
      rawRef: "receipt-photo:aaaaaaaaaaaaaaaa",
      items: items.map((i) => ({ productName: i.name, quantity: i.quantity ?? 1, unit: "each", ...(i.price !== undefined && { priceCents: i.price }) })),
    },
    warnings: [],
    lines: items.map((i) => ({ sourceText: i.wording ?? i.name.toUpperCase(), matchedBy: null })),
    sourceText: "rows",
    totals: { subtotalCents: null, totalCents: null, discountsCents: 0 },
    ...rest,
  };
}

const names = (d: Draft) => d.batch.items.map((i) => i.productName);

describe("adding a second photo to a draft", () => {
  it("adds lines the first photo didn't have, after its own", () => {
    const merged = mergeDrafts(draft([{ name: "Milk", price: 398 }]), draft([{ name: "Bread", price: 250 }]));
    expect(names(merged)).toEqual(["Milk", "Bread"]);
    expect(merged.lines!.map((l) => l.sourceText)).toEqual(["MILK", "BREAD"]);
  });

  it("recognizes the overlap between the photos instead of doubling it", () => {
    const first = draft([{ name: "Milk", price: 398 }, { name: "Eggs", price: 300 }]);
    const second = draft([{ name: "Eggs", price: 300 }, { name: "Bread", price: 250 }]);
    expect(names(mergeDrafts(first, second))).toEqual(["Milk", "Eggs", "Bread"]);
  });

  it("keeps two identical lines when the receipt really has two", () => {
    const twice = draft([{ name: "Bananas", price: 129 }, { name: "Bananas", price: 129 }]);
    expect(names(mergeDrafts(twice, twice))).toEqual(["Bananas", "Bananas"]);
    expect(names(mergeDrafts(draft([{ name: "Bananas", price: 129 }]), twice))).toEqual(["Bananas", "Bananas"]);
  });

  it("takes store, date and totals from whichever photo has them", () => {
    const first = draft([{ name: "Milk", price: 398 }], { warnings: [{ code: "date-missing", message: "date" }] });
    const second = draft([{ name: "Bread", price: 250 }], {
      store: "Walmart",
      date: "2026-10-15",
      totals: { subtotalCents: 648, totalCents: 700, discountsCents: 0 },
    });
    const merged = mergeDrafts(first, second);
    expect(merged.batch).toMatchObject({ store: "Walmart", purchasedAt: "2026-10-15" });
    expect(merged.totals).toEqual({ subtotalCents: 648, totalCents: 700, discountsCents: 0 });
    expect(merged.warnings.map((w) => w.code)).toEqual([]);
  });

  it("works out again whether the lines add up, so a split receipt stops warning once it is whole", () => {
    const totals = { subtotalCents: 648, totalCents: 700, discountsCents: 0 };
    const first = draft([{ name: "Milk", price: 398 }], {
      totals,
      warnings: [{ code: "total-mismatch", message: "old" }],
    });
    expect(mergeDrafts(first, draft([{ name: "Bread", price: 250 }])).warnings).toEqual([]);

    const stillMissing = mergeDrafts(first, draft([{ name: "Salt", price: 100 }]));
    expect(stillMissing.warnings.map((w) => w.code)).toEqual(["total-mismatch"]);
  });

  it("sums the photos' discounts", () => {
    const a = draft([{ name: "Milk", price: 500 }], { totals: { subtotalCents: 900, totalCents: null, discountsCents: 100 } });
    const b = draft([{ name: "Bread", price: 500 }], { totals: { subtotalCents: null, totalCents: null, discountsCents: 0 } });
    expect(mergeDrafts(a, b).warnings).toEqual([]);
  });

  it("keeps the date warning only when neither photo had a date", () => {
    const missing = { warnings: [{ code: "date-missing", message: "date" }] };
    expect(mergeDrafts(draft([{ name: "Milk" }], missing), draft([{ name: "Bread" }], missing)).warnings.map((w) => w.code)).toEqual(["date-missing"]);
  });

  it("moves a warning about a line to where the line now is, and drops it with an overlapping line", () => {
    const first = draft([{ name: "Milk", price: 398 }]);
    const second = draft([{ name: "Milk", price: 398 }, { name: "Bread", price: 250 }], {
      warnings: [
        { code: "check-quantity", lineIndex: 0, message: "about milk" },
        { code: "check-quantity", lineIndex: 1, message: "about bread" },
      ],
    });
    expect(mergeDrafts(first, second).warnings).toEqual([{ code: "check-quantity", lineIndex: 1, message: "about bread" }]);
  });

  it("builds the receipt's key from the merged store, date and total once there is a total", () => {
    const first = draft([{ name: "Milk", price: 398 }], { store: "Walmart" });
    const withTotal = draft([{ name: "Bread", price: 250 }], { totals: { subtotalCents: null, totalCents: 700, discountsCents: 0 } });
    const merged = mergeDrafts(first, withTotal);
    expect(merged.batch.idempotencyKey).not.toBe(first.batch.idempotencyKey);
    // The same receipt photographed in a different order is the same purchase.
    expect(mergeDrafts(withTotal, { ...first, batch: { ...first.batch, store: "Walmart" } }).batch.idempotencyKey).toBe(
      mergeDrafts({ ...withTotal, batch: { ...withTotal.batch, store: "Walmart" } }, first).batch.idempotencyKey,
    );
  });

  it("stays a restaurant receipt if either photo was", () => {
    const restaurant = { warnings: [{ code: "restaurant-receipt", message: "restaurant" }] };
    expect(mergeDrafts(draft([{ name: "Milk" }]), draft([{ name: "Bread" }], restaurant)).warnings.map((w) => w.code)).toEqual(["restaurant-receipt"]);
  });
});
