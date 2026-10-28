import type { ProductSummary } from "@/core/purchase-batch";
import { normalizeProductName } from "@/core/product-name";
import type { DraftLine } from "../types";

/** A wording the user has already told us belongs to a product. */
export interface ProductAlias {
  /** Normalized (see normalizeProductName). */
  alias: string;
  productId: string;
}

export interface LineMatch {
  product: ProductSummary;
  by: NonNullable<DraftLine["matchedBy"]>;
}

const STOP_WORDS = new Set(["the", "of", "and", "with", "for"]);
const MIN_SIMILARITY = 0.75;
const MIN_LEAD = 0.1;

const tokenize = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));

const isSubsequence = (short: string, long: string) => {
  let at = 0;
  for (const char of long) if (char === short[at]) at++;
  return at === short.length;
};

/**
 * Whether a word from the receipt is a (possibly abbreviated) form of a
 * product word: "mlk" for "milk", "whl" for "whole", "chkn" for "chicken",
 * "towel" for "towels". Abbreviations keep the first letter and the order.
 */
function sameWord(fromReceipt: string, fromProduct: string): boolean {
  if (fromReceipt === fromProduct) return true;
  if (fromReceipt + "s" === fromProduct || fromProduct + "s" === fromReceipt) return true;
  if (fromReceipt.length < 3) return false;
  return (
    fromProduct.startsWith(fromReceipt) ||
    (fromReceipt[0] === fromProduct[0] && isSubsequence(fromReceipt, fromProduct))
  );
}

/**
 * How well a receipt line's words and a product's words cover each other, from
 * 0 to 1. Half is how much of the product the line mentions, half is how much
 * of the line is explained by the product, so neither "Milk" matching every
 * milk nor a long name matching on one shared word scores high.
 */
function similarity(receiptWords: string[], productWords: string[]): number {
  if (receiptWords.length === 0 || productWords.length === 0) return 0;
  const productCovered = productWords.filter((p) => receiptWords.some((r) => sameWord(r, p))).length;
  const receiptCovered = receiptWords.filter((r) => productWords.some((p) => sameWord(r, p))).length;
  return 0.5 * (productCovered / productWords.length) + 0.5 * (receiptCovered / receiptWords.length);
}

/**
 * Ties a receipt's wording to one of the user's products, trying in order:
 * the product's own name, an alias the user taught us, the dictionary's name
 * for the item ("Milk" for "GV WHL MLK GL"), the one product whose name holds
 * that item name ("Paper Towels" in "Bounty Paper Towels"), then (only when
 * one product clearly stands out) a similar-enough name. Null when nothing
 * fits; the line then becomes a new product unless the user picks one.
 */
export function createMatcher(products: ProductSummary[], aliases: ProductAlias[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const byName = new Map(products.map((product) => [normalizeProductName(product.name), product]));
  const byAlias = new Map(aliases.map((a) => [a.alias, byId.get(a.productId)]));
  const words = products.map((product) => ({ product, words: tokenize(product.name) }));

  const mostSimilar = (name: string): ProductSummary | null => {
    const receiptWords = tokenize(name);
    const ranked = words
      .map(({ product, words: productWords }) => ({ product, score: similarity(receiptWords, productWords) }))
      .sort((a, b) => b.score - a.score);
    const [best, runnerUp] = ranked;
    const clear = best && best.score >= MIN_SIMILARITY && (!runnerUp || best.score - runnerUp.score >= MIN_LEAD);
    return clear ? best.product : null;
  };

  const onlyProductContaining = (itemName: string): ProductSummary | null => {
    const itemWords = tokenize(itemName);
    const holding = words.filter(({ words: productWords }) =>
      itemWords.every((word) => productWords.some((p) => p === word || p === word + "s" || p + "s" === word)),
    );
    return itemWords.length > 0 && holding.length === 1 ? holding[0].product : null;
  };

  return function match(receiptName: string, itemName?: string): LineMatch | null {
    const key = normalizeProductName(receiptName);

    const named = byName.get(key);
    if (named) return { product: named, by: "name" };

    const aliased = byAlias.get(key);
    if (aliased) return { product: aliased, by: "alias" };

    if (itemName) {
      const item = byName.get(normalizeProductName(itemName));
      if (item) return { product: item, by: "name" };
      const holder = onlyProductContaining(itemName);
      if (holder) return { product: holder, by: "similar" };
    }

    const similar = mostSimilar(receiptName) ?? (itemName ? mostSimilar(itemName) : null);
    return similar ? { product: similar, by: "similar" } : null;
  };
}
