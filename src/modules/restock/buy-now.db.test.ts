// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
// The online search is a fake; no request leaves the machine.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Candidate } from "@/core/pick-offer";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { findForBuyNow } from "./buy-now";
import type { ProductSearch } from "./search-types";
import { getSuggestionToBuy, listSuggestions } from "./suggestions";
import { stockedProduct, throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

const eggs = (title: string, priceCents: number): Candidate => ({
  id: title, title, brands: [], imageUrl: null, url: `https://shop.test/${encodeURIComponent(title)}`, domain: "walmart.com",
  department: null, priceCents, currency: "USD", inStock: true, condition: "new",
});

function fakeSearch(answer: Candidate[]) {
  const asked: string[] = [];
  const search: ProductSearch = { async search(query) { asked.push(query); return answer; } };
  return { search, asked };
}

describe("Buy now on a product that isn't low", () => {
  it("finds a listing and keeps it as the product's suggestion, without asking about it on the dashboard", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId, "Eggs");
    const { search, asked } = fakeSearch([eggs("Large Eggs 24 Count", 700), eggs("Brown Eggs 24 Count", 900)]);

    const found = await findForBuyNow(userId, productId, search);
    expect(found.status).toBe("ready");
    if (found.status !== "ready") return;
    expect(found.suggestion).toMatchObject({ productId, name: "Eggs" });
    expect(found.suggestion.pick.title).toBe("Large Eggs 24 Count");
    expect(asked).toHaveLength(1);

    // Not low, so the "running low" cards don't show it; buying by its id still works.
    expect(await listSuggestions(userId)).toEqual([]);
    expect(await getSuggestionToBuy(userId, { id: found.suggestion.id })).toMatchObject({ id: found.suggestion.id });
  });

  it("reuses a search from the last day instead of paying for another", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId, "Eggs");
    const { search, asked } = fakeSearch([eggs("Large Eggs 24 Count", 700)]);
    await findForBuyNow(userId, productId, search);
    const again = await findForBuyNow(userId, productId, search);
    expect(again.status).toBe("ready");
    expect(asked).toHaveLength(1);
  });

  it("says so when nothing is for sale, and doesn't make the scheduled run skip the product", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId, "Eggs");
    const found = await findForBuyNow(userId, productId, fakeSearch([]).search);
    expect(found).toEqual({ status: "unavailable", message: "We couldn't find Eggs for sale online right now." });
    const [row] = await db.select().from(products).where(eq(products.id, productId));
    expect(row!.restockNoneFoundAt).toBeNull();
  });

  it("only works on the user's own product and suggestion", async () => {
    const userId = await newUser();
    const otherId = await newUser();
    const productId = await stockedProduct(userId, "Eggs");
    const { search } = fakeSearch([eggs("Large Eggs 24 Count", 700)]);
    expect(await findForBuyNow(otherId, productId, search)).toMatchObject({ status: "unavailable" });
    const found = await findForBuyNow(userId, productId, search);
    if (found.status !== "ready") throw new Error("expected a listing");
    expect(await getSuggestionToBuy(otherId, { id: found.suggestion.id })).toBeNull();
  });
});
