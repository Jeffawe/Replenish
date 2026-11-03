import { describe, expect, it } from "vitest";
import { brandsOf, inRightDepartment, isSameKind, isStore, packSizeFrom, pickOffers, searchQueryFor, type Candidate, type Wanted } from "./pick-offer";

const NO_LIMIT = { minCents: null, maxCents: null };

function listing(overrides: Partial<Candidate> & { title: string }): Candidate {
  return {
    id: overrides.title,
    brands: [],
    imageUrl: null,
    url: `https://shop.test/${encodeURIComponent(overrides.title)}`,
    domain: "walmart.com",
    department: null,
    priceCents: 1000,
    currency: "USD",
    inStock: true,
    condition: "new",
    ...overrides,
  };
}

const paper: Wanted = { name: "Toilet Paper", unit: "rolls", category: null, brands: ["Charmin"], store: null, quantity: 12, range: NO_LIMIT };

describe("isSameKind", () => {
  it("needs every word of the name in the title, in any order, plural or not", () => {
    expect(isSameKind("Toilet Paper", "Charmin Ultra Soft Toilet Paper, 12 Mega Rolls")).toBe(true);
    expect(isSameKind("Eggs", "Large Egg Carton")).toBe(true);
    expect(isSameKind("Blueberries", "Fresh Blueberry Pint")).toBe(true);
    expect(isSameKind("Toilet Paper", "Paper Towels 6 Rolls")).toBe(false);
    expect(isSameKind("Milk", "Milk Chocolate Bar")).toBe(true); // a known limit: same words, different thing
  });

  it("is never true for a name with no words", () => {
    expect(isSameKind("", "Anything")).toBe(false);
  });
});

describe("packSizeFrom", () => {
  it("reads the common ways a pack's count is written", () => {
    expect(packSizeFrom("Charmin Ultra Soft Toilet Paper, 12 Mega Rolls", "rolls")).toBe(12);
    expect(packSizeFrom("Bounty Paper Towels, Pack of 6", "rolls")).toBe(6);
    expect(packSizeFrom("Energizer AA Batteries, 24ct", "each")).toBe(24);
    expect(packSizeFrom("Spring Water 24-Pack", "bottles")).toBe(24);
    expect(packSizeFrom("Paper Plates 100 Count", "each")).toBe(100);
    expect(packSizeFrom("Cascade Pods 62 pods", "pods")).toBe(62);
  });

  it("counts the product's own unit, singular or plural", () => {
    expect(packSizeFrom("Whole Milk 1 Gallon", "gallon")).toBe(1);
    expect(packSizeFrom("Whole Milk 2 Gallons", "gallons")).toBe(2);
  });

  it("says nothing when the title doesn't give a count", () => {
    expect(packSizeFrom("Great Value Whole Milk", "gallon")).toBeNull();
    expect(packSizeFrom("Charmin Ultra Soft Toilet Paper", "rolls")).toBeNull();
  });

  it("doesn't read a size in other units as a count", () => {
    expect(packSizeFrom("Whole Milk 128 fl oz", "gallon")).toBeNull();
  });
});

describe("isStore", () => {
  it("matches the store's name to the listing's domain either way round", () => {
    expect(isStore("Walmart", "walmart.com")).toBe(true);
    expect(isStore("Walmart Supercenter #1234", "www.walmart.com")).toBe(true);
    expect(isStore("Whole Foods Market", "wholefoods.com")).toBe(true);
    expect(isStore("Target", "walmart.com")).toBe(false);
  });

  it("is false with no store or a name too short to trust", () => {
    expect(isStore(null, "walmart.com")).toBe(false);
    expect(isStore("A", "a.com")).toBe(false);
  });
});

describe("inRightDepartment", () => {
  it("only accepts departments the product's category is sold under", () => {
    expect(inRightDepartment("Household", "Home & Garden")).toBe(true);
    expect(inRightDepartment("Household", "Electronics")).toBe(true); // batteries
    expect(inRightDepartment("Household", "Apparel & Accessories")).toBe(false);
    expect(inRightDepartment("Groceries", "Health & Beauty")).toBe(false);
    expect(inRightDepartment("Groceries", "Food, Beverages & Tobacco")).toBe(true);
    expect(inRightDepartment("Pet", "Animals & Pet Supplies")).toBe(true);
  });

  it("doesn't check when the category or the department is unknown", () => {
    expect(inRightDepartment(null, "Apparel & Accessories")).toBe(true);
    expect(inRightDepartment("Household", null)).toBe(true);
    expect(inRightDepartment("Zorbo", "Apparel & Accessories")).toBe(true);
    expect(inRightDepartment("groceries ", "Food, Beverages & Tobacco")).toBe(true);
  });
});

describe("pickOffers: what is left out", () => {
  it("drops listings that are out of stock, used, not in dollars, free, or a different kind of thing", () => {
    const picks = pickOffers(
      [
        listing({ title: "Charmin Toilet Paper 12 Rolls", inStock: false }),
        listing({ title: "Charmin Toilet Paper 12 Rolls used", condition: "used" }),
        listing({ title: "Charmin Toilet Paper 12 Rolls EUR", currency: "EUR" }),
        listing({ title: "Charmin Toilet Paper 12 Rolls free", priceCents: 0 }),
        listing({ title: "Charmin Paper Towels 12 Rolls" }),
        listing({ title: "Charmin Toilet Paper 12 Rolls ok", condition: null }),
      ],
      paper,
    );
    expect(picks.map((pick) => pick.candidate.title)).toEqual(["Charmin Toilet Paper 12 Rolls ok"]);
  });

  it("drops listings in the wrong department: the perfume called Milk is not milk", () => {
    const milk: Wanted = { name: "Milk", unit: "gallon", category: "Groceries", brands: ["Great Value"], store: null, quantity: 1, range: NO_LIMIT };
    expect(
      pickOffers(
        [
          listing({ title: "Milk", department: "Health & Beauty", brands: ["Commodity"] }),
          listing({ title: "Milk Carton", department: "Home & Garden", brands: ["Boscov's"] }),
          listing({ title: "Coffee Mate Milk", department: "Food, Beverages & Tobacco", brands: ["Great Value"] }),
          listing({ title: "Milk Bottle", department: null }),
        ],
        milk,
      ).map((pick) => pick.candidate.title),
    ).toEqual(["Coffee Mate Milk", "Milk Bottle"]);
  });

  it("returns nothing when there are no listings", () => {
    expect(pickOffers([], paper)).toEqual([]);
  });
});

describe("pickOffers: the order", () => {
  it("prefers a pack that fits the usual purchase over a cheaper single roll or a huge bulk pack", () => {
    const picks = pickOffers(
      [
        listing({ title: "Charmin Toilet Paper 1 Roll", priceCents: 150 }),
        listing({ title: "Charmin Toilet Paper 48 Rolls", priceCents: 4000 }),
        listing({ title: "Charmin Toilet Paper 12 Rolls", priceCents: 1400 }),
      ],
      paper,
    );
    expect(picks[0]!.candidate.title).toBe("Charmin Toilet Paper 12 Rolls");
    expect(picks[0]).toMatchObject({ packSize: 12, packs: 1, totalCents: 1400, concerns: [] });
  });

  it("orders enough smaller packs to reach the usual amount, and prices the whole order", () => {
    const [pick] = pickOffers([listing({ title: "Charmin Toilet Paper 4 Rolls", priceCents: 500 })], paper);
    expect(pick).toMatchObject({ packSize: 4, packs: 3, totalCents: 1500 });
  });

  it("puts an in-range order ahead of a better-matching one that is out of range, and says so", () => {
    const picks = pickOffers(
      [
        listing({ title: "Charmin Toilet Paper 12 Rolls", priceCents: 3000 }),
        listing({ title: "Quilted Northern Toilet Paper 12 Rolls", priceCents: 1200, brands: ["Quilted Northern"] }),
      ],
      { ...paper, range: { minCents: null, maxCents: 2000 } },
    );
    expect(picks.map((pick) => pick.candidate.title)).toEqual(["Quilted Northern Toilet Paper 12 Rolls", "Charmin Toilet Paper 12 Rolls"]);
    expect(picks[0]!.withinRange).toBe(true);
    expect(picks[1]).toMatchObject({ withinRange: false, concerns: ["outside-price-range"] });
  });

  it("checks the whole order against the range, not one pack", () => {
    const [pick] = pickOffers([listing({ title: "Charmin Toilet Paper 4 Rolls", priceCents: 500 })], { ...paper, range: { minCents: null, maxCents: 1000 } });
    expect(pick!.totalCents).toBe(1500);
    expect(pick!.withinRange).toBe(false);
  });

  it("prefers the product's brand, then the usual store, then the lowest price per unit", () => {
    const picks = pickOffers(
      [
        listing({ title: "Cheap Toilet Paper 12 Rolls", priceCents: 600, domain: "target.com" }),
        listing({ title: "Charmin Toilet Paper 12 Rolls", priceCents: 1500, domain: "target.com" }),
        listing({ title: "Charmin Toilet Paper 12 Rolls", priceCents: 1700, domain: "walmart.com", url: "https://walmart.test/c" }),
      ],
      { ...paper, store: "Walmart" },
    );
    expect(picks.map((pick) => pick.candidate.domain + pick.candidate.priceCents)).toEqual(["walmart.com1700", "target.com1500", "target.com600"]);
    expect(picks[0]!.concerns).toEqual([]);
    expect(picks[1]!.concerns).toEqual(["other-store"]);
    expect(picks[2]!.concerns).toEqual(["other-brand", "other-store"]);
  });

  it("matches the brand from the listing's brand list as well as its title", () => {
    const [pick] = pickOffers([listing({ title: "Ultra Soft Toilet Paper 12 Rolls", brands: ["Charmin"] })], paper);
    expect(pick!.concerns).toEqual([]);
  });

  it("has no brand preference when the product's brand isn't known", () => {
    const [pick] = pickOffers([listing({ title: "Any Toilet Paper 12 Rolls" })], { ...paper, brands: [] });
    expect(pick!.concerns).toEqual([]);
  });

  it("flags a title with no count, and a size far from the usual", () => {
    const picks = pickOffers(
      [listing({ title: "Charmin Toilet Paper" }), listing({ title: "Charmin Toilet Paper 48 Rolls" })],
      paper,
    );
    const byTitle = Object.fromEntries(picks.map((pick) => [pick.candidate.title, pick]));
    expect(byTitle["Charmin Toilet Paper"]).toMatchObject({ packSize: null, packs: 1, concerns: ["size-unknown"] });
    expect(byTitle["Charmin Toilet Paper 48 Rolls"]!.concerns).toEqual(["size-differs"]);
    // Not knowing the size is better than knowing it is wrong.
    expect(picks[0]!.candidate.title).toBe("Charmin Toilet Paper");
  });

  it("gives the same order however the listings arrive", () => {
    const a = listing({ title: "Charmin Toilet Paper 12 Rolls", url: "https://a.test" });
    const b = listing({ title: "Charmin Toilet Paper 12 Rolls", url: "https://b.test" });
    expect(pickOffers([a, b], paper).map((p) => p.candidate.url)).toEqual(pickOffers([b, a], paper).map((p) => p.candidate.url));
  });

  it("copes with a usual amount of zero or a fraction", () => {
    expect(pickOffers([listing({ title: "Whole Milk 1 Gallon" })], { ...paper, name: "Milk", unit: "gallon", brands: [], quantity: 0 })[0]).toMatchObject({ packs: 1 });
    expect(pickOffers([listing({ title: "Whole Milk 1 Gallon" })], { ...paper, name: "Milk", unit: "gallon", brands: [], quantity: 0.5 })[0]).toMatchObject({ packs: 1 });
  });
});

describe("searchQueryFor and brandsOf", () => {
  it("searches for the newest brand and the name", () => {
    expect(searchQueryFor({ name: "Toilet Paper", brand: "Charmin, Quilted Northern" })).toBe("Quilted Northern Toilet Paper");
    expect(searchQueryFor({ name: "Milk", brand: null })).toBe("Milk");
  });

  it("splits the brand list", () => {
    expect(brandsOf("Charmin, Quilted Northern")).toEqual(["Charmin", "Quilted Northern"]);
    expect(brandsOf(null)).toEqual([]);
  });
});
