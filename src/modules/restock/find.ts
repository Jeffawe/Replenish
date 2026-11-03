import { brandsOf, pickOffers, searchQueryFor, type PickedOffer } from "@/core/pick-offer";
import { priceRangeFor, type UserSettings } from "@/core/user-settings";
import { getUserSettings } from "@/modules/settings";
import type { LowProduct } from "./check";
import { SearchError, type ProductSearch } from "./search-types";

/**
 * Finding a low product online and choosing the listing to buy. This step buys nothing and asks
 * nothing: it only says what the best listing is and what is questionable about it. The step
 * after it decides whether that means buying or asking (every concern means asking).
 */

/** How many other listings come back with the best one, for the screen that asks the user. */
const ALTERNATIVES = 2;

export type Finding =
  | { status: "found"; query: string; pick: PickedOffer; alternatives: PickedOffer[]; listings: number }
  | {
      status: "none";
      query: string;
      /** "no-results": the search found nothing. "no-usable-listing": it found some, but none in stock, new and the same kind of thing. */
      reason: "no-results" | "no-usable-listing";
      listings: number;
    }
  | { status: "error"; query: string; message: string };

/** Looks one low product up and picks a listing. Never throws: a failed search is a `Finding`, so one bad lookup can't stop the others. */
export async function findOnline(
  { product, estimate }: Pick<LowProduct, "product" | "estimate">,
  search: ProductSearch,
  settings: Pick<UserSettings, "autobuyMinPriceCents" | "autobuyMaxPriceCents">,
): Promise<Finding> {
  const query = searchQueryFor(product);
  try {
    const candidates = await search.search(query, { category: product.category });
    if (candidates.length === 0) return { status: "none", query, reason: "no-results", listings: 0 };

    const picks = pickOffers(candidates, {
      name: product.name,
      unit: product.unit,
      category: product.category,
      brands: brandsOf(product.brand),
      store: product.boughtFrom,
      quantity: estimate.normalPurchaseQty,
      range: priceRangeFor(settings, product),
    });
    const [best, ...rest] = picks;
    if (!best) return { status: "none", query, reason: "no-usable-listing", listings: candidates.length };
    return { status: "found", query, pick: best, alternatives: rest.slice(0, ALTERNATIVES), listings: candidates.length };
  } catch (error) {
    if (!(error instanceof SearchError)) console.error(`Could not find ${product.name} online`, error);
    return { status: "error", query, message: error instanceof SearchError ? error.message : "The search failed" };
  }
}

export interface RestockResult {
  low: LowProduct;
  finding: Finding;
}

/** The most searches one run makes, because each costs a credit and low products stay listed until something handles them. */
export const SEARCH_LIMIT = 50;
const AT_ONCE = 4;

/**
 * Finds a listing for each low product. Settings are read once per user. Products past the
 * limit are not searched this time (`skipped`): they stay low, so the next run gets them.
 */
export async function findForLowProducts(
  lows: LowProduct[],
  search: ProductSearch,
  limit = SEARCH_LIMIT,
): Promise<{ results: RestockResult[]; skipped: LowProduct[] }> {
  const wanted = lows.slice(0, limit);
  const settingsFor = new Map<string, Promise<UserSettings>>();
  const settings = (userId: string) => {
    if (!settingsFor.has(userId)) settingsFor.set(userId, getUserSettings(userId));
    return settingsFor.get(userId)!;
  };

  const results: RestockResult[] = [];
  for (let start = 0; start < wanted.length; start += AT_ONCE) {
    const chunk = wanted.slice(start, start + AT_ONCE);
    results.push(...(await Promise.all(chunk.map(async (low) => ({ low, finding: await findOnline(low, search, await settings(low.userId)) })))));
  }
  return { results, skipped: lows.slice(limit) };
}
