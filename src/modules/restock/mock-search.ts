import type { Candidate } from "@/core/pick-offer";
import type { ProductSearch } from "./search-types";

/**
 * A stand-in search that invents three listings for any query, for trying the flow without a
 * Channel3 key (`npm run restock -- --mock`) or when the service is down during a demo. The
 * listings are made up and say so in their titles; never show them as real offers.
 */
export function createMockSearch(): ProductSearch {
  return {
    async search(query) {
      // Same query, same answer: prices come from the query's letters.
      const seed = [...query].reduce((sum, char) => sum + char.charCodeAt(0), 0);
      const stores = ["walmart.com", "target.com", "amazon.com"];
      return stores.map((domain, index): Candidate => ({
        id: `mock-${domain}-${query}`,
        title: `${query} 12 Count (mock listing)`,
        brands: [],
        imageUrl: null,
        url: `https://${domain}/mock/${encodeURIComponent(query)}`,
        domain,
        department: null,
        priceCents: 800 + ((seed * (index + 3)) % 700),
        currency: "USD",
        inStock: true,
        condition: "new",
        sample: true,
      }));
    },
  };
}
