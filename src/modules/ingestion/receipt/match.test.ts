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

describe("createMatcher: item codes", () => {
  const aliases = [
    { alias: "#walmart#007874235186", productId: "p-almond" },
    { alias: "gv whl mlk gl", productId: "p-milk" },
  ];

  it("goes by a confirmed item code at that store, whatever the wording says", () => {
    const match = createMatcher(products, aliases, "Walmart");
    expect(match("GV WHL MLK GL", undefined, "007874235186")).toEqual({ product: almond, by: "code" });
    expect(match("XQZ BLRRY", undefined, "007874235186")).toEqual({ product: almond, by: "code" });
  });

  it("ignores a code from another store, and an unknown code", () => {
    expect(createMatcher(products, aliases, "Target")("GV WHL MLK GL", undefined, "007874235186")).toEqual({ product: milk, by: "alias" });
    expect(createMatcher(products, aliases, "Walmart")("GV WHL MLK GL", undefined, "000000000001")).toEqual({ product: milk, by: "alias" });
    expect(createMatcher(products, aliases)("GV WHL MLK GL", undefined, "007874235186")).toEqual({ product: milk, by: "alias" });
  });
});

describe("createMatcher: wordings close to ones the user confirmed", () => {
  it("matches an OCR slip of a confirmed wording, for checking", () => {
    const match = createMatcher(products, [{ alias: "gv whl mlk gl", productId: "p-milk" }]);
    expect(match("GV WHL MLK GI")).toEqual({ product: milk, by: "similar" });
    expect(match("GV WHI MLK GL")).toEqual({ product: milk, by: "similar" });
  });

  it("doesn't guess between two products' wordings that are both close", () => {
    const match = createMatcher(products, [
      { alias: "kirkland milk 1", productId: "p-milk" },
      { alias: "kirkland milk 2", productId: "p-almond" },
    ]);
    expect(match("KIRKLAND MILK 3")).toBeNull();
  });

  it("leaves short wordings alone, where one letter is a different item", () => {
    const match = createMatcher(products, [{ alias: "eggs", productId: "p-eggs" }]);
    expect(match("EGGO")).toBeNull();
  });

  it("never treats an item code as a wording", () => {
    const match = createMatcher(products, [{ alias: "#walmart#007874235186", productId: "p-almond" }]);
    expect(match("#walmart#007874235187")).toBeNull();
  });
});

describe("createMatcher: a product not matched by its name", () => {
  const mine = { ...product("p-coffee", "Mom's coffee", "bag"), matchByName: false };

  it("isn't found by its name, or by words like it", () => {
    const match = createMatcher([mine], []);
    expect(match("MOMS COFFEE")).toBeNull();
    expect(match("Mom's coffee")).toBeNull();
  });

  it("is still found by the wordings it was matched by before", () => {
    expect(createMatcher([mine], [{ alias: "starbucks pike pl", productId: "p-coffee" }])("STARBUCKS PIKE PL")).toEqual({
      product: mine,
      by: "alias",
    });
  });
});
