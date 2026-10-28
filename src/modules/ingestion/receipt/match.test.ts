import { describe, expect, it } from "vitest";
import type { ProductSummary } from "@/core/purchase-batch";
import { createMatcher } from "./match";

const product = (id: string, name: string, unit = "each"): ProductSummary => ({
  id,
  name,
  brand: null,
  category: null,
  unit,
  normalPurchaseQty: 1,
});

const milk = product("p-milk", "Whole Milk", "gallon");
const tp = product("p-tp", "Charmin Ultra Soft Toilet Paper", "rolls");
const eggs = product("p-eggs", "Eggs", "dozen");
const almond = product("p-almond", "Almond Milk", "carton");
const products = [milk, tp, eggs, almond];

describe("createMatcher", () => {
  const match = createMatcher(products, [{ alias: "gv whl mlk gl", productId: "p-milk" }]);

  it("matches a product's own name, ignoring case and spacing", () => {
    expect(match("WHOLE   MILK")).toEqual({ product: milk, by: "name" });
  });

  it("matches a wording the user has taught us", () => {
    expect(match("GV WHL MLK GL")).toEqual({ product: milk, by: "alias" });
  });

  it("matches abbreviations when one product clearly stands out", () => {
    expect(match("WHL MLK")).toEqual({ product: milk, by: "similar" });
    expect(match("CHARMIN ULTRA SOFT")).toEqual({ product: tp, by: "similar" });
    expect(match("EGG")).toEqual({ product: eggs, by: "similar" });
  });

  it("matches nothing when nothing is close", () => {
    expect(match("PAPER TOWELS")).toBeNull();
    expect(match("BANANAS")).toBeNull();
  });

  it("does not guess between products it can't tell apart", () => {
    // "Milk" is half of each of "Whole Milk" and "Almond Milk".
    expect(match("MILK")).toBeNull();
  });

  it("prefers the product that explains more of the line", () => {
    expect(match("ALMOND MILK")).toEqual({ product: almond, by: "name" });
    expect(match("ALMND MLK")).toEqual({ product: almond, by: "similar" });
  });

  it("ignores an alias whose product is gone", () => {
    const stale = createMatcher(products, [{ alias: "mystery item", productId: "deleted" }]);
    expect(stale("MYSTERY ITEM")).toBeNull();
  });

  it("uses the dictionary's item name when the wording itself doesn't match", () => {
    const plain = createMatcher([product("p-tp", "Toilet Paper", "rolls")], []);
    expect(plain("CHARMIN ULTRA", "Toilet Paper")).toMatchObject({ product: { id: "p-tp" }, by: "name" });
  });

  it("ties the item to the one product whose name holds it", () => {
    const branded = createMatcher([product("p-pt", "Bounty Paper Towels", "rolls"), milk], []);
    expect(branded("BOUNTY SELECT", "Paper Towels")).toMatchObject({ product: { id: "p-pt" }, by: "similar" });
  });

  it("doesn't pick between several products holding the item", () => {
    expect(match("GV MLK", "Milk")).toBeNull();
  });

  it("prefers a learned alias to the dictionary", () => {
    expect(match("GV WHL MLK GL", "Milk")).toMatchObject({ by: "alias" });
  });

  it("copes with no products", () => {
    expect(createMatcher([], [])("MILK")).toBeNull();
  });
});
