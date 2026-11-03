// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
// The online search is a fake; no request leaves the machine.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Candidate } from "@/core/pick-offer";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { saveAutobuySettings } from "@/modules/settings";
import { SearchError, type ProductSearch } from "./search-types";
import { runRestock } from "./run";
import { lowProduct, stockedProduct, throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

function listing(overrides: Partial<Candidate> & { title: string }): Candidate {
  return { id: overrides.title, brands: [], imageUrl: null, url: `https://shop.test/${encodeURIComponent(overrides.title)}`, domain: "walmart.com", department: null, priceCents: 500, currency: "USD", inStock: true, condition: "new", ...overrides };
}

/** A search that answers from a table and remembers what it was asked. */
function fakeSearch(answers: Record<string, Candidate[] | Error>) {
  const asked: string[] = [];
  const categories: (string | null | undefined)[] = [];
  const search: ProductSearch = {
    async search(query, context) {
      asked.push(query);
      categories.push(context?.category);
      const answer = answers[query] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { search, asked, categories };
}

describe("the restock report", () => {
  it("lists only low products, searched by name and latest brand, with the chosen listing", async () => {
    const userId = await newUser();
    await stockedProduct(userId, "Eggs");
    const productId = await lowProduct(userId, "Toilet Paper", { unit: "rolls", brand: "Charmin", store: "Walmart" }, 12);
    const { search, asked } = fakeSearch({
      "Charmin Toilet Paper": [
        listing({ title: "Charmin Toilet Paper 12 Rolls", priceCents: 1400, domain: "target.com" }),
        listing({ title: "Charmin Toilet Paper 12 Rolls", priceCents: 1500, domain: "walmart.com", url: "https://walmart.test/tp", id: "ch3_tp" }),
      ],
    });

    const report = await runRestock(search, { userId });
    expect(asked).toEqual(["Charmin Toilet Paper"]);
    expect(report).toMatchObject({ checked: 1, moreDue: false, skipped: [], errors: [] });
    expect(report.items).toHaveLength(1);

    const item = report.items[0]!;
    expect(item).toMatchObject({
      userId,
      productId,
      name: "Toilet Paper",
      brand: "Charmin",
      unit: "rolls",
      boughtFrom: "Walmart",
      confirmed: false,
      autobuyEnabled: false,
      usualQuantity: 12,
      query: "Charmin Toilet Paper",
      listings: 2,
      status: "found",
    });
    expect(item.estimate).toMatchObject({ rateSource: "history" });
    if (item.status !== "found") throw new Error("expected a listing");
    // The user's usual store wins over a cheaper one at another store.
    expect(item.pick).toMatchObject({ url: "https://walmart.test/tp", channel3Id: "ch3_tp", domain: "walmart.com", priceCents: 1500, packSize: 12, packs: 1, totalCents: 1500, withinRange: true, concerns: [] });
    expect(item.alternatives.map((a) => a.domain)).toEqual(["target.com"]);
  });

  it("is plain data: it survives JSON unchanged apart from the date", async () => {
    const userId = await newUser();
    await lowProduct(userId, "Milk", { unit: "gallon" }, 1);
    const { search } = fakeSearch({ Milk: [listing({ title: "Whole Milk 1 Gallon", priceCents: 399 })] });
    const report = await runRestock(search, { userId });
    const roundTripped = JSON.parse(JSON.stringify(report));
    expect(roundTripped).toEqual({ ...report, checkedAt: report.checkedAt.toISOString() });
  });

  it("applies the user's price range to the order, and the product's own range instead when it has one", async () => {
    const userId = await newUser();
    const productId = await lowProduct(userId, "Milk", { unit: "gallon" }, 1);
    const { search } = fakeSearch({ Milk: [listing({ title: "Whole Milk 1 Gallon", priceCents: 800 })] });
    const range = (max: number | null) => ({ autobuyMinConfidence: 0.8, autobuyMinPriceCents: null, autobuyMaxPriceCents: max, autobuyMonthlyCapCents: null, autobuyLeadDays: 3 });

    await saveAutobuySettings(userId, range(500));
    expect((await runRestock(search, { userId })).items[0]).toMatchObject({ status: "found", pick: { withinRange: false, concerns: ["outside-price-range"] } });

    await db.update(products).set({ autobuyMaxPriceCents: 1000 }).where(eq(products.id, productId));
    expect((await runRestock(search, { userId })).items[0]).toMatchObject({ status: "found", pick: { withinRange: true, concerns: [] } });
  });

  it("says why nothing was found, and keeps going when one search fails", async () => {
    const userId = await newUser();
    await lowProduct(userId, "Milk");
    await lowProduct(userId, "Rice");
    await lowProduct(userId, "Soap");
    const { search } = fakeSearch({
      Milk: [],
      Rice: new SearchError("Channel3 failed (500)"),
      Soap: [listing({ title: "Dish Sponge 6 Pack" })],
    });

    const byName = Object.fromEntries((await runRestock(search, { userId })).items.map((item) => [item.name, item]));
    expect(byName.Milk).toMatchObject({ status: "none", reason: "no-results", listings: 0 });
    expect(byName.Rice).toMatchObject({ status: "error", message: "Channel3 failed (500)" });
    expect(byName.Soap).toMatchObject({ status: "none", reason: "no-usable-listing", listings: 1 });
  });

  it("searches at most its limit and names the rest as skipped, so they are found next time", async () => {
    const userId = await newUser();
    for (const name of ["Milk", "Eggs", "Rice"]) await lowProduct(userId, name);
    const { search, asked } = fakeSearch({});
    const report = await runRestock(search, { userId }, 2);
    expect(asked).toHaveLength(2);
    expect(report.items).toHaveLength(2);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]).toMatchObject({ userId, name: expect.any(String), productId: expect.any(String) });
  });

  it("tells the search each product's category, so food and household goods can go to different services", async () => {
    const userId = await newUser();
    const milk = await lowProduct(userId, "Milk");
    const paper = await lowProduct(userId, "Toilet Paper", { unit: "rolls" }, 12);
    await db.update(products).set({ category: "Groceries" }).where(eq(products.id, milk));
    await db.update(products).set({ category: "Household" }).where(eq(products.id, paper));
    const { search, categories } = fakeSearch({});
    await runRestock(search, { userId });
    expect([...categories].sort()).toEqual(["Groceries", "Household"]);
  });

  it("leaves other accounts' products out when asked for one account", async () => {
    const userId = await newUser();
    const otherId = await newUser();
    await lowProduct(userId, "Milk");
    await lowProduct(otherId, "Rice");
    const { search, asked } = fakeSearch({});
    const report = await runRestock(search, { userId });
    expect(report.items.map((item) => item.name)).toEqual(["Milk"]);
    expect(asked).toEqual(["Milk"]);
  });
});
