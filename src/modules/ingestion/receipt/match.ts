import type { ProductSummary } from "@/core/purchase-batch";
import { normalizeProductName } from "@/core/product-name";
import { codeAlias, isCodeAlias } from "../aliases";
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
/** A wording this close to one the user confirmed (by letters, so OCR slips like "GI" for "GL" still match) counts as it. */
const MIN_ALIAS_LIKENESS = 0.85;
/** Short wordings are too easy to confuse one letter apart. */
const MIN_ALIAS_LENGTH_FOR_LIKENESS = 6;

/** 1 for identical text, 0 for nothing in common: 1 - edit distance / longer length. */
function likeness(a: string, b: string): number {
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return 1 - previous[b.length]! / longer;
}

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
export function createMatcher(products: ProductSummary[], aliases: ProductAlias[], store?: string | null) {
  const byId = new Map(products.map((product) => [product.id, product]));
  // A product the user said not to match by name is only found through its aliases.
  const named = products.filter((product) => product.matchByName !== false);
  const byName = new Map(named.map((product) => [normalizeProductName(product.name), product]));
  const byAlias = new Map(aliases.map((a) => [a.alias, byId.get(a.productId)]));
  const words = named.map((product) => ({ product, words: tokenize(product.name) }));
  const wordings = aliases.filter((a) => !isCodeAlias(a.alias) && a.alias.length >= MIN_ALIAS_LENGTH_FOR_LIKENESS);

  /** A confirmed wording close to this one, when one clearly is (and nothing close points at another product). */
  const nearAlias = (key: string): ProductSummary | null => {
    if (key.length < MIN_ALIAS_LENGTH_FOR_LIKENESS) return null;
    const ranked = wordings
      .map((a) => ({ productId: a.productId, score: likeness(key, a.alias) }))
      .filter((r) => r.score >= MIN_ALIAS_LIKENESS)
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || ranked.some((r) => r.productId !== best.productId && best.score - r.score < MIN_LEAD)) return null;
    return byId.get(best.productId) ?? null;
  };

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

  /** The user's product for a dictionary item: the one named for it, or the one that holds its words. */
  const forItem = (itemName: string): ProductSummary | null =>
    byName.get(normalizeProductName(itemName)) ?? onlyProductContaining(itemName);

  function match(receiptName: string, itemName?: string, code?: string): LineMatch | null {
    const key = normalizeProductName(receiptName);

    // The store's own item code, once the user has confirmed it, names the item whatever the wording says.
    const coded = code ? codeAlias(store, code) : null;
    const byCode = coded ? byAlias.get(coded) : undefined;
    if (byCode) return { product: byCode, by: "code" };

    const byOwnName = byName.get(key);
    if (byOwnName) return { product: byOwnName, by: "name" };

    const aliased = byAlias.get(key);
    if (aliased) return { product: aliased, by: "alias" };

    // Close to a confirmed wording: likely the same item read slightly differently, so offered for checking.
    const near = nearAlias(key);
    if (near) return { product: near, by: "similar" };

    if (itemName) {
      const item = byName.get(normalizeProductName(itemName));
      if (item) return { product: item, by: "name" };
      const holder = onlyProductContaining(itemName);
      if (holder) return { product: holder, by: "similar" };
    }

    const similar = mostSimilar(receiptName) ?? (itemName ? mostSimilar(itemName) : null);
    return similar ? { product: similar, by: "similar" } : null;
  }

  return Object.assign(match, { forItem });
}
