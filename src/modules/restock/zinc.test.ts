import { describe, expect, it, vi } from "vitest";
import { createZinc, toZincCandidates } from "./zinc";
import { SearchError } from "./search-types";

// Shaped after what Zinc's /search returned from the sandbox.
const body = {
  status: "completed",
  query: "Folgers ground coffee",
  results: [
    { url: "https://www.amazon.com/zinc-sandbox/dp/B0ZTD2BEC8", retailer: "amazon", product_id: "B0ZTD2BEC8", title: "Folgers Classic Roast Ground Coffee 25.9 oz", image: null, brand: "Folgers", price: 1299, stars: 4.7, num_reviews: 15309, available: true, free_shipping: null, has_variants: null },
    { url: "https://www.walmart.com/ip/zinc-sandbox/991", retailer: "walmart", product_id: null, title: "Folgers Coffee", image: "https://img.test/c.jpg", brand: null, price: 899.4, available: null },
    { url: "https://www.walmart.com/ip/sold-out", retailer: "walmart", title: "Folgers Decaf", price: 700, available: false },
    { url: "not a url", title: "Broken", price: 100 },
    { title: "no url", price: 100 },
  ],
  excluded_by_price: 0,
  hint: null,
};

const respond = (status: number, json: unknown = body) => new Response(JSON.stringify(json), { status });

describe("toZincCandidates", () => {
  it("makes a candidate per listing: domain from the link, price already in cents, skipping what it can't read", () => {
    const candidates = toZincCandidates(body, false);
    expect(candidates).toEqual([
      { id: "B0ZTD2BEC8", title: "Folgers Classic Roast Ground Coffee 25.9 oz", brands: ["Folgers"], imageUrl: null, url: "https://www.amazon.com/zinc-sandbox/dp/B0ZTD2BEC8", domain: "amazon.com", department: null, priceCents: 1299, currency: "USD", inStock: true, condition: null },
      expect.objectContaining({ id: "https://www.walmart.com/ip/zinc-sandbox/991", brands: [], imageUrl: "https://img.test/c.jpg", domain: "walmart.com", priceCents: 899, inStock: true }),
      expect.objectContaining({ title: "Folgers Decaf", inStock: false }),
    ]);
    expect(candidates.every((c) => c.sample === undefined)).toBe(true);
  });

  it("marks every listing as sample data when asked", () => {
    expect(toZincCandidates(body, true).every((c) => c.sample === true)).toBe(true);
  });

  it("refuses an answer that isn't a finished search", () => {
    expect(() => toZincCandidates({ status: "processing" }, false)).toThrow("did not finish");
    expect(() => toZincCandidates({ nope: 1 }, false)).toThrow(SearchError);
    expect(() => toZincCandidates(null, false)).toThrow(SearchError);
  });

  it("copes with a finished search that has no results", () => {
    expect(toZincCandidates({ status: "completed", results: null }, false)).toEqual([]);
  });
});

describe("createZinc", () => {
  it("searches Walmart and Amazon with the key as a bearer token", async () => {
    const fetchMock = vi.fn(async () => respond(200));
    const search = createZinc({ apiKey: "zn_live_secret", fetch: fetchMock as unknown as typeof fetch });
    const found = await search.search("Folgers coffee");
    expect(found).toHaveLength(3);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.zinc.com/search");
    expect(parsed.searchParams.get("q")).toBe("Folgers coffee");
    expect(parsed.searchParams.get("limit")).toBe("20");
    expect(parsed.searchParams.getAll("retailer")).toEqual(["walmart", "amazon"]);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer zn_live_secret");
  });

  it("marks listings from a sandbox key (zn_test_) as sample data, and a live key's as real", async () => {
    const respondOk = (async () => respond(200)) as unknown as typeof fetch;
    expect((await createZinc({ apiKey: "zn_test_abc", fetch: respondOk }).search("x")).every((c) => c.sample === true)).toBe(true);
    expect((await createZinc({ apiKey: "zn_live_abc", fetch: respondOk }).search("x")).some((c) => c.sample)).toBe(false);
  });

  it("says what went wrong without leaking the key", async () => {
    const failing = (status: number) => createZinc({ apiKey: "zn_live_secret", fetch: (async () => respond(status, {})) as unknown as typeof fetch });
    await expect(failing(401).search("x")).rejects.toThrow("refused the API key");
    await expect(failing(402).search("x")).rejects.toThrow("wallet has no money");
    await expect(failing(429).search("x")).rejects.toThrow("too fast");
    await expect(failing(500).search("x")).rejects.toThrow("Zinc failed (500)");

    const down = createZinc({ apiKey: "zn_live_secret", fetch: (async () => { throw new Error("ECONNREFUSED zn_live_secret"); }) as unknown as typeof fetch });
    const error = (await down.search("x").catch((e: Error) => e)) as Error;
    expect(error).toBeInstanceOf(SearchError);
    expect(error.message).toBe("Could not reach Zinc");
  });

  it("treats an answer that isn't JSON as a failure", async () => {
    const search = createZinc({ apiKey: "k", fetch: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    await expect(search.search("x")).rejects.toThrow(SearchError);
  });
});
