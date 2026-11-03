import { z } from "zod";
import type { Candidate } from "@/core/pick-offer";
import { SearchError, type ProductSearch } from "./search-types";

/**
 * Zinc's cross-retailer product search (https://www.zinc.com): used for food and drink, which
 * Channel3 doesn't have. GET /search returns listings whose `url` can go straight into a Zinc
 * order. A search costs $0.01 from the Zinc wallet; the free sandbox key (zn_test_...) returns
 * invented "Sample ..." listings, which are marked `sample` so they are never shown as real.
 *
 * Only Walmart and Amazon are searched because those are the stores Zinc lists as orderable.
 * Zinc has no zip code or store parameter, so perishables (milk, eggs) are unreliable.
 */

const BASE_URL = "https://api.zinc.com";
const STORES = ["walmart", "amazon"];
const RESULTS = 20;
const TIMEOUT_MS = 15_000;

const ResultSchema = z.object({
  url: z.string(),
  retailer: z.string().nullish(),
  product_id: z.string().nullish(),
  title: z.string(),
  image: z.string().nullish(),
  brand: z.string().nullish(),
  /** In cents. */
  price: z.number(),
  available: z.boolean().nullish(),
});
// Read one at a time, so one odd listing is skipped instead of failing the search.
const ResponseSchema = z.object({ status: z.string(), results: z.array(z.unknown()).nullish() });

/** "https://www.walmart.com/ip/1" -> "walmart.com". */
function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The search's results as candidates; `sample` marks listings from the sandbox. */
export function toZincCandidates(body: unknown, sample: boolean): Candidate[] {
  const response = ResponseSchema.safeParse(body);
  if (!response.success) throw new SearchError("Zinc sent an answer in a shape we don't know");
  if (response.data.status !== "completed") throw new SearchError("Zinc's search did not finish");
  return (response.data.results ?? []).flatMap((raw): Candidate[] => {
    const result = ResultSchema.safeParse(raw);
    const domain = result.success ? domainOf(result.data.url) : null;
    if (!result.success || !domain) return [];
    const { url, product_id, title, image, brand, price, available } = result.data;
    return [
      {
        id: product_id ?? url,
        title,
        brands: brand ? [brand] : [],
        imageUrl: image ?? null,
        url,
        domain,
        department: null,
        priceCents: Math.round(price),
        currency: "USD",
        inStock: available !== false,
        condition: null,
        ...(sample ? { sample: true } : {}),
      },
    ];
  });
}

export interface ZincOptions {
  apiKey: string;
  /** For tests. */
  fetch?: typeof fetch;
}

export function createZinc({ apiKey, fetch: fetchImpl = fetch }: ZincOptions): ProductSearch {
  const sample = apiKey.startsWith("zn_test_");
  return {
    async search(query) {
      const params = new URLSearchParams({ q: query, limit: String(RESULTS) });
      for (const store of STORES) params.append("retailer", store);
      let response: Response;
      try {
        response = await fetchImpl(`${BASE_URL}/search?${params}`, {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new SearchError("Could not reach Zinc");
      }
      if (response.status === 401 || response.status === 403) throw new SearchError("Zinc refused the API key");
      if (response.status === 402) throw new SearchError("The Zinc wallet has no money for searches");
      if (response.status === 429) throw new SearchError("Zinc says we are searching too fast");
      if (!response.ok) throw new SearchError(`Zinc failed (${response.status})`);
      return toZincCandidates(await response.json().catch(() => null), sample);
    },
  };
}

/** The Zinc search from ZINC_API_KEY; throws a SearchError when it isn't set. */
export function zincFromEnv(): ProductSearch {
  const apiKey = process.env.ZINC_API_KEY;
  if (!apiKey) throw new SearchError("ZINC_API_KEY is not set");
  return createZinc({ apiKey });
}
