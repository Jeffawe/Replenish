// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
// The online search is a fake; no request leaves the machine.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Candidate } from "@/core/pick-offer";
import { db } from "@/db/client";
import { products, restockSuggestions } from "@/db/schema";
import { REFRESH_AFTER_MS, runRestockAndAsk } from "./ask";
import { dismissSuggestion, getSuggestion, listSuggestions } from "./suggestions";
import { SearchError, type ProductSearch } from "./search-types";
import { buy, lowProduct, throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

function listing(overrides: Partial<Candidate> & { title: string }): Candidate {
  return { id: overrides.title, brands: [], imageUrl: null, url: `https://shop.test/${encodeURIComponent(overrides.title)}`, domain: "walmart.com", department: null, priceCents: 500, currency: "USD", inStock: true, condition: "new", ...overrides };
}

/** A search that answers from a table and counts the searches. */
function fakeSearch(answers: Record<string, Candidate[] | Error>) {
  const asked: string[] = [];
  const search: ProductSearch = {
    async search(query) {
      asked.push(query);
      const answer = answers[query] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { search, asked };
}

const paperAnswers = {
  "Toilet Paper": [
    listing({ title: "Cheap Toilet Paper 12 Rolls", priceCents: 600, domain: "target.com" }),
    listing({ title: "Soft Toilet Paper 12 Rolls", priceCents: 900, domain: "walmart.com" }),
    listing({ title: "Plush Toilet Paper 12 Rolls", priceCents: 1100, domain: "amazon.com" }),
    listing({ title: "Plain Toilet Paper 12 Rolls", priceCents: 1300, domain: "cvs.com" }),
  ],
};

async function lowPaper(userId: string) {
  return lowProduct(userId, "Toilet Paper", { unit: "rolls" }, 12);
}

describe("asking about low products", () => {
  it("stores the best listing and two others, and shows them to that user only", async () => {
    const userId = await newUser();
    const otherId = await newUser();
    const productId = await lowPaper(userId);
    const { search } = fakeSearch(paperAnswers);

    const report = await runRestockAndAsk(search, { userId });
    expect(report).toMatchObject({ saved: 1, cleared: 0, alreadyAsked: 0 });

    const [suggestion] = await listSuggestions(userId);
    expect(suggestion).toMatchObject({ productId, name: "Toilet Paper", unit: "rolls", query: "Toilet Paper" });
    expect(suggestion!.pick.title).toContain("Toilet Paper");
    expect(suggestion!.alternatives).toHaveLength(2);
    expect(await listSuggestions(otherId)).toEqual([]);
  });

  it("doesn't search a product again while its suggestion is recent, but does once it is old", async () => {
    const userId = await newUser();
    await lowPaper(userId);
    const { search, asked } = fakeSearch(paperAnswers);

    await runRestockAndAsk(search, { userId });
    const second = await runRestockAndAsk(search, { userId });
    expect(asked).toHaveLength(1);
    expect(second).toMatchObject({ saved: 0, alreadyAsked: 1 });

    const later = new Date(Date.now() + REFRESH_AFTER_MS + 1000);
    await runRestockAndAsk(search, { userId, now: later });
    expect(asked).toHaveLength(2);
  });

  it("replaces an old suggestion with the new search, and clears it when the product is no longer found", async () => {
    const userId = await newUser();
    const productId = await lowPaper(userId);
    const answers: Record<string, Candidate[] | Error> = { "Toilet Paper": [listing({ title: "Old Toilet Paper 12 Rolls", priceCents: 700 })] };
    const { search } = fakeSearch(answers);
    await runRestockAndAsk(search, { userId });
    expect((await listSuggestions(userId))[0]!.pick.title).toBe("Old Toilet Paper 12 Rolls");

    const oldEnough = new Date(Date.now() + REFRESH_AFTER_MS + 1000);
    answers["Toilet Paper"] = [listing({ title: "New Toilet Paper 12 Rolls", priceCents: 650 })];
    await runRestockAndAsk(search, { userId, now: oldEnough });
    expect((await listSuggestions(userId, oldEnough))[0]!.pick.title).toBe("New Toilet Paper 12 Rolls");

    answers["Toilet Paper"] = [];
    const evenLater = new Date(oldEnough.getTime() + REFRESH_AFTER_MS + 1000);
    const report = await runRestockAndAsk(search, { userId, now: evenLater });
    expect(report.cleared).toBe(1);
    expect(await listSuggestions(userId, evenLater)).toEqual([]);
    expect(await db.select().from(restockSuggestions).where(eq(restockSuggestions.productId, productId))).toEqual([]);
  });

  it("keeps the old suggestion when the new search fails", async () => {
    const userId = await newUser();
    await lowPaper(userId);
    const answers: Record<string, Candidate[] | Error> = paperAnswers;
    const { search } = fakeSearch(answers);
    await runRestockAndAsk(search, { userId });

    const oldEnough = new Date(Date.now() + REFRESH_AFTER_MS + 1000);
    const failing = fakeSearch({ "Toilet Paper": new SearchError("Channel3 failed (500)") });
    const report = await runRestockAndAsk(failing.search, { userId, now: oldEnough });
    expect(report.items[0]).toMatchObject({ status: "error" });
    expect(await listSuggestions(userId, oldEnough)).toHaveLength(1);
  });

  it("stores nothing for a product nothing was found for", async () => {
    const userId = await newUser();
    await lowPaper(userId);
    const report = await runRestockAndAsk(fakeSearch({}).search, { userId });
    expect(report.saved).toBe(0);
    expect(await listSuggestions(userId)).toEqual([]);
  });
});

describe("not now", () => {
  it("hides the suggestion and isn't searched again, and only for the user it belongs to", async () => {
    const userId = await newUser();
    const otherId = await newUser();
    await lowPaper(userId);
    const { search, asked } = fakeSearch(paperAnswers);
    await runRestockAndAsk(search, { userId });
    const [suggestion] = await listSuggestions(userId);

    expect(await dismissSuggestion(otherId, suggestion!.id)).toBe(false);
    expect(await listSuggestions(userId)).toHaveLength(1);

    expect(await dismissSuggestion(userId, suggestion!.id)).toBe(true);
    expect(await listSuggestions(userId)).toEqual([]);
    expect(await getSuggestion(userId, suggestion!.id)).toBeNull();

    // Even a day later it isn't searched or shown again.
    const later = new Date(Date.now() + 3 * REFRESH_AFTER_MS);
    const report = await runRestockAndAsk(search, { userId, now: later });
    expect(asked).toHaveLength(1);
    expect(report.alreadyAsked).toBe(1);
    expect(await listSuggestions(userId, later)).toEqual([]);
  });

  it("is forgotten once the product has stock again, so the next time it runs low it is asked about", async () => {
    const userId = await newUser();
    const productId = await lowPaper(userId);
    const { search } = fakeSearch(paperAnswers);
    await runRestockAndAsk(search, { userId });
    await dismissSuggestion(userId, (await listSuggestions(userId))[0]!.id);

    await buy(userId, "Toilet Paper", 0, 12, { unit: "rolls" }); // restocked: the check date moves into the future
    expect((await runRestockAndAsk(search, { userId })).forgotten).toBe(1);
    expect(await db.select().from(restockSuggestions).where(eq(restockSuggestions.productId, productId))).toEqual([]);
  });
});

describe("what is shown", () => {
  it("disappears by itself once the product is restocked, before any run clears it", async () => {
    const userId = await newUser();
    await lowPaper(userId);
    await runRestockAndAsk(fakeSearch(paperAnswers).search, { userId });
    expect(await listSuggestions(userId)).toHaveLength(1);

    await buy(userId, "Toilet Paper", 0, 12, { unit: "rolls" });
    expect(await listSuggestions(userId)).toEqual([]);
  });

  it("leaves out hidden products", async () => {
    const userId = await newUser();
    const productId = await lowPaper(userId);
    await runRestockAndAsk(fakeSearch(paperAnswers).search, { userId });
    await db.update(products).set({ archivedAt: new Date() }).where(eq(products.id, productId));
    expect(await listSuggestions(userId)).toEqual([]);
  });

  it("skips a stored result it can't read, and a link that isn't a web link", async () => {
    const userId = await newUser();
    const productId = await lowPaper(userId);
    await runRestockAndAsk(fakeSearch(paperAnswers).search, { userId });
    const [row] = await db.select().from(restockSuggestions).where(eq(restockSuggestions.productId, productId));

    await db.update(restockSuggestions).set({ found: { nonsense: true } }).where(eq(restockSuggestions.id, row!.id));
    expect(await listSuggestions(userId)).toEqual([]);

    const found = row!.found as { pick: { url: string } };
    await db.update(restockSuggestions).set({ found: { ...found, pick: { ...found.pick, url: "javascript:alert(1)" } } }).where(eq(restockSuggestions.id, row!.id));
    expect(await listSuggestions(userId)).toEqual([]);
  });
});
