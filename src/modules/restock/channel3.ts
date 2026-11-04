import { z } from "zod";
import type { Candidate } from "@/core/pick-offer";
import { SearchError, type ProductSearch } from "./search-types";

/**
 * Channel3: a product search across stores (https://channel3.ai/docs). One call to
 * POST /v1/search costs one credit (1,000 a month are free). A product comes back with one
 * offer per store, so the user's usual store is found in the same call, without a store filter.
 */

const BASE_URL = "https://api.trychannel3.com";
const RESULTS = 20;
const TIMEOUT_MS = 15_000;

// Only what the page documents as always present is required; the rest may be missing or null.
const OfferSchema = z.object({
  url: z.string(),
  domain: z.string(),
  price: z.object({ price: z.number(), currency: z.string() }),
  availability: z.string(),
  condition: z.string().nullish(),
});
const ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  brands: z.array(z.object({ name: z.string() })).nullish(),
  images: z.array(z.object({ url: z.string(), is_main_image: z.boolean().nullish() })).nullish(),
  // path runs from the top department down: [{title: "Home & Garden"}, {title: "Household Supplies"}, ...]
  category: z.object({ title: z.string(), path: z.array(z.object({ title: z.string() })).nullish() }).nullish(),
  // Titles often say only "Toilet Paper"; the pack size is usually in here ("This Mega pack contains 6 rolls").
  description: z.string().nullish(),
  key_features: z.array(z.string()).nullish(),
  offers: z.array(z.unknown()),
});
// Products and offers are read one at a time, so one odd listing is skipped instead of failing the search.
const ResponseSchema = z.object({ products: z.array(z.unknown()) });

/** The search's products as one candidate per store listing. */
export function toCandidates(body: unknown): Candidate[] {
  const response = ResponseSchema.safeParse(body);
  if (!response.success) throw new SearchError("Channel3 sent an answer in a shape we don't know");
  return response.data.products.flatMap((raw) => {
    const product = ProductSchema.safeParse(raw);
    if (!product.success) return [];
    const { id, title, brands, images, category, description, key_features, offers } = product.data;
    const department = category?.path?.[0]?.title ?? category?.title ?? null;
    const image = images?.find((entry) => entry.is_main_image) ?? images?.[0];
    return offers.flatMap((rawOffer): Candidate[] => {
      const offer = OfferSchema.safeParse(rawOffer);
      if (!offer.success) return [];
      return [
        {
          id,
          title,
          brands: (brands ?? []).map((brand) => brand.name),
          imageUrl: image?.url ?? null,
          url: offer.data.url,
          domain: offer.data.domain,
          department,
          priceCents: Math.round(offer.data.price.price * 100),
          currency: offer.data.price.currency,
          inStock: offer.data.availability === "InStock",
          condition: offer.data.condition ?? null,
          ...(description ? { description } : {}),
          ...(key_features?.length ? { features: key_features } : {}),
        },
      ];
    });
  });
}

export interface Channel3Options {
  apiKey: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests: how long to wait before the one retry after "slow down". */
  retryAfterMs?: number;
}

export function createChannel3({ apiKey, fetch: fetchImpl = fetch, retryAfterMs }: Channel3Options): ProductSearch {
  async function post(query: string): Promise<Response> {
    return fetchImpl(`${BASE_URL}/v1/search`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        query,
        limit: RESULTS,
        filters: { availability: ["InStock"] },
        config: { country: "US", currency: "USD" },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }

  return {
    async search(query) {
      let response: Response;
      try {
        response = await post(query);
        if (response.status === 429) {
          // "Slow down": the API says to wait (5 seconds) and try again.
          const wait = retryAfterMs ?? (Number(response.headers.get("retry-after")) || 5) * 1000;
          await new Promise((resolve) => setTimeout(resolve, wait));
          response = await post(query);
        }
      } catch {
        throw new SearchError("Could not reach Channel3");
      }
      if (response.status === 401 || response.status === 403) throw new SearchError("Channel3 refused the API key");
      if (response.status === 429) throw new SearchError("Channel3 says we are searching too fast");
      if (!response.ok) throw new SearchError(`Channel3 failed (${response.status})`);
      return toCandidates(await response.json().catch(() => null));
    },
  };
}

/** The search to use in this app, from CHANNEL3_API_KEY; throws a SearchError when it isn't set. */
export function channel3FromEnv(): ProductSearch {
  const apiKey = process.env.CHANNEL3_API_KEY;
  if (!apiKey) throw new SearchError("CHANNEL3_API_KEY is not set");
  return createChannel3({ apiKey });
}
