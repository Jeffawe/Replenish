import { describe, expect, it } from "vitest";
import type { ProductSummary, PurchaseSummary } from "@/core/purchase-batch";
import { detectPossibleDuplicates } from "./duplicates";

const products: ProductSummary[] = [
  { id: "toilet", name: "Charmin Toilet Paper", brand: null, category: null, unit: "rolls", normalPurchaseQty: 12 },
  { id: "milk", name: "Milk", brand: null, category: null, unit: "gallon", normalPurchaseQty: 1 },
];

const existing: PurchaseSummary = {
  productId: "toilet",
  store: "Walmart",
  quantity: 12,
  purchasedAt: new Date("2026-10-20T09:00:00Z"),
  idempotencyKey: "earlier-submission",
};

type Item = { productName: string; productId?: string; quantity: number };

const batch = (overrides = {}, items: Item[] = [{ productName: "Charmin Toilet Paper", quantity: 12 }]) => ({
  purchasedAt: new Date("2026-10-20T00:00:00Z"),
  store: "Walmart",
  idempotencyKey: "new-submission",
  items,
  ...overrides,
});

describe("detectPossibleDuplicates", () => {
  it("flags the same product, store, day and quantity, matched by name", () => {
    const warnings = detectPossibleDuplicates(batch(), products, [existing]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: "possible-duplicate", lineIndex: 0 });
  });

  it("matches by productId when the line has one", () => {
    const warnings = detectPossibleDuplicates(
      batch({}, [{ productName: "CHRMN ULTRA 12CT", productId: "toilet", quantity: 12 }]),
      products,
      [existing],
    );
    expect(warnings).toHaveLength(1);
  });

  it("matches names ignoring case and spacing, and store ignoring case", () => {
    const warnings = detectPossibleDuplicates(
      batch({ store: " WALMART " }, [{ productName: "  charmin   toilet paper", quantity: 12 }]),
      products,
      [existing],
    );
    expect(warnings).toHaveLength(1);
  });

  it("reports the line that matched, not the others", () => {
    const warnings = detectPossibleDuplicates(
      batch({}, [
        { productName: "Milk", quantity: 1 },
        { productName: "Charmin Toilet Paper", quantity: 12 },
      ]),
      products,
      [existing],
    );
    expect(warnings.map((w) => w.lineIndex)).toEqual([1]);
  });

  it.each([
    ["a different quantity", { quantity: 24 }, {}],
    ["a different store", {}, { store: "Target" }],
    ["a different day", {}, { purchasedAt: new Date("2026-10-21T00:00:00Z") }],
  ])("does not flag %s", (_label, lineChange, batchChange) => {
    const warnings = detectPossibleDuplicates(
      batch(batchChange, [{ productName: "Charmin Toilet Paper", quantity: 12, ...lineChange }]),
      products,
      [existing],
    );
    expect(warnings).toEqual([]);
  });

  it("does not flag a different product", () => {
    const warnings = detectPossibleDuplicates(
      batch({}, [{ productName: "Milk", quantity: 12 }]),
      products,
      [existing],
    );
    expect(warnings).toEqual([]);
  });

  it("cannot compare stores when either is missing, so does not flag", () => {
    expect(detectPossibleDuplicates(batch({ store: undefined }), products, [existing])).toEqual([]);
    expect(detectPossibleDuplicates(batch(), products, [{ ...existing, store: null }])).toEqual([]);
  });

  it("does not flag lines it cannot match to a product", () => {
    const warnings = detectPossibleDuplicates(
      batch({}, [{ productName: "Brand New Thing", quantity: 12 }]),
      products,
      [existing],
    );
    expect(warnings).toEqual([]);
  });

  it("ignores purchases from the same submission, which the receiver already handles", () => {
    const warnings = detectPossibleDuplicates(batch(), products, [
      { ...existing, idempotencyKey: "new-submission" },
    ]);
    expect(warnings).toEqual([]);
  });

  it("treats a stored purchase with no key as a different submission", () => {
    const warnings = detectPossibleDuplicates(batch(), products, [{ ...existing, idempotencyKey: null }]);
    expect(warnings).toHaveLength(1);
  });
});
