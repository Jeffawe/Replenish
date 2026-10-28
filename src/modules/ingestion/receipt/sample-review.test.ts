import { describe, expect, it } from "vitest";
import type { Draft } from "../types";
import { compareDraft, compareParse, type Confirmed } from "./sample-review";

const draft: Draft = {
  batch: {
    source: "receipt",
    idempotencyKey: "k",
    store: "Walmart",
    purchasedAt: "2026-10-20",
    items: [
      { productName: "Milk", quantity: 1, unit: "gallon", priceCents: 398 },
      { productName: "Paper Towels", quantity: 6, unit: "rolls", priceCents: 997 },
      { productName: "Ice Cream", quantity: 1, unit: "each", priceCents: 500 },
      { productName: "Slippers", quantity: 1, unit: "each", priceCents: 1200 },
      { productName: "Bananas", quantity: 1, unit: "each", priceCents: 150 },
    ],
  },
  warnings: [],
  lines: [
    { sourceText: "WHL MLK", matchedBy: null },
    { sourceText: "PAPER TWL 6PK", matchedBy: null },
    { sourceText: "ICE CRM", matchedBy: null },
    { sourceText: "WMN SLIPPE", matchedBy: null, excludeReason: "Not something that gets used up." },
    { sourceText: "WMN HAT", matchedBy: null, excludeReason: "Not something that gets used up." },
  ],
};

describe("comparing a draft with what the user saved", () => {
  const confirmed: Confirmed = {
    batch: {
      store: "Walmart",
      purchasedAt: "2026-10-20",
      items: [
        { productName: "Milk", quantity: 1, unit: "gallon", priceCents: 398 },
        { productName: "Paper Towels", quantity: 12, unit: "rolls", priceCents: 997 },
        { productName: "Slippers", quantity: 1, unit: "each", priceCents: 1200 },
      ],
    },
    review: { sources: ["WHL MLK", "PAPER TWL 6PK", "WMN SLIPPE"], skipped: ["ICE CRM", "WMN HAT"] },
  };

  it("says what happened to every drafted line", () => {
    const { lines } = compareDraft(draft, confirmed);
    expect(lines.map((line) => [line.wording, line.verdict])).toEqual([
      ["WHL MLK", "as-is"],
      ["PAPER TWL 6PK", "edited"],
      ["ICE CRM", "removed"],
      ["WMN SLIPPE", "added"],
      ["WMN HAT", "left-out"],
    ]);
    expect(lines[1]!.changes).toEqual(["quantity: 6 -> 12"]);
  });

  it("notes a changed store or date, and ignores case and spacing", () => {
    const changed = compareDraft(draft, { ...confirmed, batch: { ...confirmed.batch, store: " WALMART ", purchasedAt: "2026-10-19" } });
    expect(changed.store).toBeNull();
    expect(changed.date).toEqual({ drafted: "2026-10-20", saved: "2026-10-19" });
    expect(compareDraft(draft, { ...confirmed, batch: { ...confirmed.batch, store: "Target" } }).store).toEqual({ drafted: "Walmart", saved: "Target" });
  });

  it("answers repeated wordings one at a time", () => {
    const twice: Draft = {
      ...draft,
      batch: { ...draft.batch, items: [draft.batch.items![0]!, draft.batch.items![0]!] },
      lines: [{ sourceText: "WHL MLK", matchedBy: null }, { sourceText: "WHL MLK", matchedBy: null }],
    };
    const once: Confirmed = { batch: { ...confirmed.batch, items: [confirmed.batch.items[0]!] }, review: { sources: ["WHL MLK"], skipped: [] } };
    expect(compareDraft(twice, once).lines.map((line) => line.verdict)).toEqual(["as-is", "removed"]);
  });
});

describe("comparing the parser with what the user saved", () => {
  const confirmed: Confirmed = {
    batch: {
      purchasedAt: "2026-10-20",
      items: [
        { productName: "Milk", quantity: 1, unit: "gallon", priceCents: 398 },
        { productName: "Eggs", quantity: 1, unit: "each", priceCents: 300 },
        { productName: "Bread", quantity: 1, unit: "loaf", priceCents: 250 },
      ],
    },
    review: { sources: ["WHL MLK", "EGGS", "BREAD"], skipped: ["SLIPPERS"] },
  };

  it("finds lines, differences, misses and extras", () => {
    const parsed = [
      { name: "WHL MLK", quantity: 1, unit: null, priceCents: 398 },
      { name: "EGGS", quantity: 2, unit: null, priceCents: 300 },
      { name: "SLIPPERS", quantity: 1, unit: null, priceCents: 1200 },
      { name: "TAX 8.25", quantity: 1, unit: null, priceCents: 99 },
    ];
    expect(compareParse(parsed, confirmed)).toEqual([
      { wording: "WHL MLK", verdict: "found" },
      { wording: "EGGS", verdict: "different", detail: "quantity 2 vs 1" },
      { wording: "BREAD", verdict: "missing" },
      { wording: "TAX 8.25", verdict: "extra" },
    ]);
  });
});
