import { describe, expect, it, vi } from "vitest";
import { createIdentifier } from "./engine";
import { createLookup, LOOKUP_CONFIG, type CachedLookup, type LookupCache } from "./lookup";
import { barcodeCandidates, isProductCode, itemFromLookup } from "./lookup-item";
import { seedData } from "./seed";

const NOW = new Date("2026-10-28T12:00:00Z");

function memoryCache(start: CachedLookup[] = []): LookupCache & { rows: Map<string, CachedLookup> } {
  const rows = new Map(start.map((row) => [row.code, row]));
  return {
    rows,
    get: async (codes) => codes.flatMap((code) => (rows.has(code) ? [rows.get(code)!] : [])),
    put: async (put) => put.forEach((row) => rows.set(row.code, row)),
  };
}

const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const milk = { status: 1, product: { product_name: "Whole Milk", brands: "Great Value, Walmart", categories_tags: ["en:dairies", "en:milks"] } };

describe("asking Open Food Facts about a code", () => {
  it("returns what they say, and keeps it so the same code is never asked twice", async () => {
    const fetcher = vi.fn(async () => answer(milk));
    const cache = memoryCache();
    const lookup = createLookup({ cache, fetch: fetcher as unknown as typeof fetch, now: () => NOW });

    const first = await lookup(["007874235186"]);
    expect(first.get("007874235186")).toEqual({ name: "Whole Milk", brand: "Great Value, Walmart", categories: ["dairies", "milks"] });
    await lookup(["007874235186"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("identifies the app, and sends only the code", async () => {
    const fetcher = vi.fn(async () => answer(milk));
    await createLookup({ cache: memoryCache(), fetch: fetcher as unknown as typeof fetch })(["501072452746"]);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/501072452746.json");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(LOOKUP_CONFIG.userAgent);
  });

  it("remembers a code they don't know, and asks again only after a while", async () => {
    const fetcher = vi.fn(async () => answer({ status: 0 }, 404));
    const cache = memoryCache();
    let now = NOW;
    const lookup = createLookup({ cache, fetch: fetcher as unknown as typeof fetch, now: () => now });

    expect((await lookup(["000111222333"])).size).toBe(0);
    await lookup(["000111222333"]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    now = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    await lookup(["000111222333"]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("doesn't remember a failure, so the next receipt tries again, and never throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("offline");
    });
    const cache = memoryCache();
    const lookup = createLookup({ cache, fetch: fetcher as unknown as typeof fetch });
    expect((await lookup(["007874235186"])).size).toBe(0);
    expect(cache.rows.size).toBe(0);
    const failing = createLookup({ cache: memoryCache(), fetch: (async () => answer({}, 503)) as unknown as typeof fetch });
    expect((await failing(["007874235186"])).size).toBe(0);
  });

  it("only asks about codes that can be a UPC or EAN, once each, up to a limit", async () => {
    const fetcher = vi.fn(async () => answer(milk));
    const many = Array.from({ length: 30 }, (_, i) => String(100000000000 + i));
    await createLookup({ cache: memoryCache(), fetch: fetcher as unknown as typeof fetch })([...many, ...many, "6884", "E 9462", "12"]);
    expect(fetcher).toHaveBeenCalledTimes(LOOKUP_CONFIG.maxPerCall);
    expect(isProductCode("6884")).toBe(false);
    expect(isProductCode("007874235186")).toBe(true);
  });
});

describe("turning a receipt's code into a barcode", () => {
  it("adds the check digit Walmart leaves off, to a 12-digit code that starts with 0", () => {
    expect(barcodeCandidates("007874235191")).toEqual(["078742351919"]);
    expect(barcodeCandidates("004400088210")).toEqual(["044000882105"]);
  });

  it("tries a code as printed when it is already a valid UPC, and the completed reading second", () => {
    // One in ten Walmart codes is a valid UPC by coincidence, so both readings are tried, as printed first.
    expect(barcodeCandidates("003120001605")).toEqual(["003120001605", "031200016058"]);
    expect(barcodeCandidates("036000291452")).toEqual(["036000291452", "360002914522"]);
  });

  it("leaves other codes as they are", () => {
    expect(barcodeCandidates("501072452746")).toEqual(["501072452746"]);
    expect(barcodeCandidates("0049000000443")).toEqual(["0049000000443"]);
  });

  it("looks the completed barcode up", async () => {
    const fetcher = vi.fn(async () => answer(milk));
    await createLookup({ cache: memoryCache(), fetch: fetcher as unknown as typeof fetch })(["007874235191"]);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toContain("/078742351919.json");
  });

  it("tries the second reading when the first isn't known", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => (String(url).includes("/360002914522.") ? answer(milk) : answer({ status: 0 })));
    const found = await createLookup({ cache: memoryCache(), fetch: fetcher as unknown as typeof fetch })(["036000291452"]);
    expect(found.has("036000291452")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("when they say too many requests", () => {
  it("stops asking, doesn't remember the code as unknown, and leaves them alone for a while", async () => {
    const fetcher = vi.fn(async () => answer({}, 429));
    const cache = memoryCache();
    let now = NOW;
    const lookup = createLookup({ cache, fetch: fetcher as unknown as typeof fetch, now: () => now });

    await lookup(["100000000001", "100000000002", "100000000003"]);
    expect(cache.rows.size).toBe(0);
    const asked = fetcher.mock.calls.length;
    expect(asked).toBeLessThanOrEqual(LOOKUP_CONFIG.concurrency);

    await lookup(["100000000004"]);
    expect(fetcher).toHaveBeenCalledTimes(asked);

    now = new Date(NOW.getTime() + LOOKUP_CONFIG.backOffMs + 1000);
    await lookup(["100000000004"]);
    expect(fetcher.mock.calls.length).toBeGreaterThan(asked);
  });
});

describe("what a lookup means", () => {
  const identify = createIdentifier(seedData());

  it("reads the product's name through the dictionary", () => {
    expect(itemFromLookup({ name: "Whole Milk", brand: "Great Value, Walmart", categories: [] }, identify)).toMatchObject({
      item: { name: "Milk" },
      brand: "Great Value",
    });
  });

  it("falls back to the categories, most specific first", () => {
    expect(itemFromLookup({ name: "Moo Moo Nectar 1 gal", brand: "Local Dairy", categories: ["dairies", "milks"] }, identify)?.item.name).toBe("Milk");
  });

  it("takes the main noun of a product name, which comes last", () => {
    expect(itemFromLookup({ name: "Classic Cheese Pizza", brand: "Home Run Inn", categories: [] }, identify)?.item.name).toBe("Frozen Pizza");
    expect(itemFromLookup({ name: "Ultra Thin Sausage Pizza", brand: null, categories: [] }, identify)?.item.name).toBe("Frozen Pizza");
  });

  it("says nothing when the dictionary can't place it", () => {
    expect(itemFromLookup({ name: "Zorbo Gadget", brand: null, categories: ["gadgets"] }, identify)).toBeNull();
  });
});
