import { channel3FromEnv } from "./channel3";
import { isGrocery, SearchError, type ProductSearch } from "./search-types";
import { zincFromEnv } from "./zinc";

/**
 * Sends each search to the service that has that kind of product. A missing engine fails only the
 * searches that need it (with a message saying which key to set), so a missing Zinc key doesn't
 * stop household products from being found.
 */
export function createRoutedSearch(engines: { household?: ProductSearch; grocery?: ProductSearch }): ProductSearch {
  return {
    async search(query, context) {
      const grocery = isGrocery(context?.category ?? null);
      const engine = grocery ? engines.grocery : engines.household;
      if (!engine) throw new SearchError(grocery ? "ZINC_API_KEY is not set (food and drink are searched on Zinc)" : "CHANNEL3_API_KEY is not set (household goods are searched on Channel3)");
      return engine.search(query, context);
    },
  };
}

/** The search to use in this app: Channel3 for household goods and Zinc for food, each only if its key is set. */
export function searchFromEnv(): ProductSearch {
  const present = (build: () => ProductSearch) => {
    try {
      return build();
    } catch (error) {
      if (error instanceof SearchError) return undefined;
      throw error;
    }
  };
  return createRoutedSearch({ household: present(channel3FromEnv), grocery: present(zincFromEnv) });
}
