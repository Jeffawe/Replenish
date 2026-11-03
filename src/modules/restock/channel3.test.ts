import { describe, expect, it, vi } from "vitest";
import { createChannel3, toCandidates } from "./channel3";
import { SearchError } from "./search-types";

// Shaped after Channel3's documented response (https://channel3.ai/docs/api-reference/v1/search).
const body = {
  products: [
    {
      id: "p_1",
      title: "Charmin Ultra Soft Toilet Paper, 12 Mega Rolls",
      brands: [{ id: "b_1", name: "Charmin" }],
      category: { slug: "toilet-paper", title: "Toilet Paper", path: [{ slug: "home-garden", title: "Home & Garden" }, { slug: "household-supplies", title: "Household Supplies" }, { slug: "toilet-paper", title: "Toilet Paper" }] },
      images: [
        { url: "https://img.test/side.jpg", is_main_image: false },
        { url: "https://img.test/main.jpg", is_main_image: true },
      ],
      offers: [
        { url: "https://www.buy.trychannel3.com/a", domain: "walmart.com", price: { price: 14.97, compare_at_price: null, currency: "USD" }, availability: "InStock", condition: "new" },
        { url: "https://www.buy.trychannel3.com/b", domain: "target.com", price: { price: 15.49, currency: "USD" }, availability: "OutOfStock", condition: null },
        { domain: "broken.com" },
      ],
    },
    { title: "no id" },
  ],
  next_page_token: null,
};

function respond(status: number, json: unknown = body, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(json), { status, headers });
}

describe("toCandidates", () => {
  it("makes one candidate per store listing, in cents, and skips what it can't read", () => {
    const candidates = toCandidates(body);
    expect(candidates).toEqual([
      {
        id: "p_1",
        title: "Charmin Ultra Soft Toilet Paper, 12 Mega Rolls",
        brands: ["Charmin"],
        imageUrl: "https://img.test/main.jpg",
        url: "https://www.buy.trychannel3.com/a",
        domain: "walmart.com",
        department: "Home & Garden",
        priceCents: 1497,
        currency: "USD",
        inStock: true,
        condition: "new",
      },
      expect.objectContaining({ domain: "target.com", priceCents: 1549, inStock: false, condition: null }),
    ]);
  });

  it("has no department when the product has no category, or only a top-level one", () => {
    const offer = { url: "u", domain: "d.com", price: { price: 1, currency: "USD" }, availability: "InStock" };
    expect(toCandidates({ products: [{ id: "a", title: "A", offers: [offer] }] })[0]!.department).toBeNull();
    expect(toCandidates({ products: [{ id: "a", title: "A", category: null, offers: [offer] }] })[0]!.department).toBeNull();
    expect(toCandidates({ products: [{ id: "a", title: "A", category: { title: "Electronics" }, offers: [offer] }] })[0]!.department).toBe("Electronics");
  });

  it("rounds prices to whole cents", () => {
    const [candidate] = toCandidates({ products: [{ id: "x", title: "X", offers: [{ url: "u", domain: "d.com", price: { price: 4.35, currency: "USD" }, availability: "InStock" }] }] });
    expect(candidate!.priceCents).toBe(435);
  });

  it("refuses an answer that isn't a list of products", () => {
    expect(() => toCandidates({ error: "nope" })).toThrow(SearchError);
    expect(() => toCandidates(null)).toThrow(SearchError);
  });
});

describe("createChannel3", () => {
  it("asks for in-stock US results with the key in the header, and returns the candidates", async () => {
    const fetchMock = vi.fn(async () => respond(200));
    const search = createChannel3({ apiKey: "secret-key", fetch: fetchMock as unknown as typeof fetch });
    const found = await search.search("Charmin Toilet Paper");
    expect(found).toHaveLength(2);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("secret-key");
    expect(JSON.parse(init.body as string)).toEqual({
      query: "Charmin Toilet Paper",
      limit: 20,
      filters: { availability: ["InStock"] },
      config: { country: "US", currency: "USD" },
    });
  });

  it("waits and tries once more when told to slow down", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(429, {}, { "retry-after": "5" })).mockResolvedValueOnce(respond(200));
    const search = createChannel3({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch, retryAfterMs: 1 });
    expect(await search.search("x")).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second 'slow down'", async () => {
    const fetchMock = vi.fn(async () => respond(429, {}));
    const search = createChannel3({ apiKey: "k", fetch: fetchMock as unknown as typeof fetch, retryAfterMs: 1 });
    await expect(search.search("x")).rejects.toThrow("searching too fast");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("says what went wrong without leaking the key", async () => {
    const failing = (status: number) => createChannel3({ apiKey: "secret-key", fetch: (async () => respond(status, {})) as unknown as typeof fetch });
    await expect(failing(401).search("x")).rejects.toThrow("refused the API key");
    await expect(failing(500).search("x")).rejects.toThrow("Channel3 failed (500)");

    const down = createChannel3({ apiKey: "secret-key", fetch: (async () => { throw new Error("connect ECONNREFUSED secret-key"); }) as unknown as typeof fetch });
    const error = await down.search("x").catch((e: Error) => e);
    expect(error).toBeInstanceOf(SearchError);
    expect((error as Error).message).toBe("Could not reach Channel3");
  });

  it("treats an answer that isn't JSON as a failure", async () => {
    const search = createChannel3({ apiKey: "k", fetch: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch });
    await expect(search.search("x")).rejects.toThrow(SearchError);
  });
});
