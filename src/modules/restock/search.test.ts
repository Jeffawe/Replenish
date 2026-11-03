import { describe, expect, it, vi } from "vitest";
import type { Candidate } from "@/core/pick-offer";
import { createRoutedSearch } from "./search";
import { isGrocery, SearchError, type ProductSearch } from "./search-types";

const candidate = (title: string): Candidate => ({ id: title, title, brands: [], imageUrl: null, url: "https://x.test", domain: "x.test", department: null, priceCents: 100, currency: "USD", inStock: true, condition: null });
const engine = (title: string): ProductSearch & { search: ReturnType<typeof vi.fn> } => ({ search: vi.fn(async () => [candidate(title)]) });

describe("isGrocery", () => {
  it("is food and drink, however the category is written", () => {
    expect(isGrocery("Groceries")).toBe(true);
    expect(isGrocery(" beverages ")).toBe(true);
    expect(isGrocery("Household")).toBe(false);
    expect(isGrocery(null)).toBe(false);
  });
});

describe("createRoutedSearch", () => {
  it("sends food to the grocery search and everything else to the household search", async () => {
    const household = engine("household");
    const grocery = engine("grocery");
    const routed = createRoutedSearch({ household, grocery });

    expect((await routed.search("Folgers coffee", { category: "Groceries" }))[0]!.title).toBe("grocery");
    expect((await routed.search("Charmin", { category: "Household" }))[0]!.title).toBe("household");
    expect((await routed.search("Mystery"))[0]!.title).toBe("household");
    expect((await routed.search("Mystery", { category: null }))[0]!.title).toBe("household");
    expect(grocery.search).toHaveBeenCalledWith("Folgers coffee", { category: "Groceries" });
  });

  it("fails only the searches that need a missing engine, and says which key to set", async () => {
    const routed = createRoutedSearch({ household: engine("household") });
    await expect(routed.search("Folgers", { category: "Groceries" })).rejects.toThrow("ZINC_API_KEY is not set");
    expect((await routed.search("Charmin", { category: "Household" }))[0]!.title).toBe("household");

    const groceryOnly = createRoutedSearch({ grocery: engine("grocery") });
    await expect(groceryOnly.search("Charmin", { category: "Household" })).rejects.toThrow(SearchError);
    await expect(groceryOnly.search("Charmin", { category: "Household" })).rejects.toThrow("CHANNEL3_API_KEY is not set");
  });
});
