import { evaluateProducts } from "@/modules/inventory/next-check";
import { getProduct } from "@/modules/inventory/repo";
import { REFRESH_AFTER_MS } from "./ask";
import { findForLowProducts } from "./find";
import { toRestockItem } from "./report";
import { searchFromEnv } from "./search";
import type { ProductSearch } from "./search-types";
import { getSuggestionToBuy, productsWithActiveOrder, saveFindings, type Suggestion } from "./suggestions";

/**
 * "Buy now" on any product's card, not only a low one. The scheduled run only searches for products
 * that are running out, so this does the same search for one product when the user asks, and keeps
 * the result as the product's suggestion. From there it is the same step as "Buy for me": the user
 * sees the listing and every fee, chooses how many, and the orders module places it. Nothing here buys.
 */

export type BuyNowFinding =
  | { status: "ready"; suggestion: Suggestion }
  /** Nothing to buy, with a sentence for the user. */
  | { status: "unavailable"; message: string };

export async function findForBuyNow(userId: string, productId: string, search: ProductSearch = searchFromEnv(), now: Date = new Date()): Promise<BuyNowFinding> {
  const product = await getProduct(userId, productId);
  if (!product || product.archivedAt !== null) return { status: "unavailable", message: "We can't find that product any more." };
  if ((await productsWithActiveOrder([product.id], now)).size > 0) return { status: "unavailable", message: `${product.name} is already being ordered.` };

  // Searching costs a credit, so a search from the last day is reused (the same window the scheduled run uses).
  const stored = await getSuggestionToBuy(userId, { productId: product.id }, now);
  if (stored && now.getTime() - stored.searchedAt.getTime() < REFRESH_AFTER_MS) return { status: "ready", suggestion: stored };

  const { computed } = await evaluateProducts(userId, [product], now);
  const estimate = computed[0]?.estimate;
  if (!estimate) return { status: "unavailable", message: "We can't work out how much of this you buy yet." };

  const { results } = await findForLowProducts([{ userId, product, estimate }], search, 1);
  const finding = results[0]?.finding;
  if (!finding || finding.status === "error") return { status: "unavailable", message: `We couldn't search for ${product.name} just now. Please try again in a moment.` };
  if (finding.status === "none") return { status: "unavailable", message: `We couldn't find ${product.name} for sale online right now.` };

  // Only a found listing is stored: a miss here must not make the scheduled run skip this product for a day.
  await saveFindings([toRestockItem(results[0]!)], now);
  const saved = await getSuggestionToBuy(userId, { productId: product.id }, now);
  return saved ? { status: "ready", suggestion: saved } : { status: "unavailable", message: "We couldn't save that listing. Please try again." };
}
