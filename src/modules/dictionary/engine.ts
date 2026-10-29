import type { CatalogItem, DictionaryData, Identified } from "./types";

const STEMS: [RegExp, string][] = [
  [/ies$/, "y"],
  [/oes$/, "o"],
  [/([^s])s$/, "$1"],
];
/** "berries" -> "berry", "tomatoes" -> "tomato", "eggs" -> "egg". Short words are left alone. */
const stem = (word: string) => {
  if (word.length <= 3) return word;
  for (const [pattern, replacement] of STEMS) if (pattern.test(word)) return word.replace(pattern, replacement);
  return word;
};

/** Words, as written, and their matching keys. Apostrophes join a word ("member's" -> "members"). */
function words(text: string): { text: string; key: string }[] {
  return text
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}%]+/u)
    .filter((word) => word && word.toLowerCase() !== "and")
    .map((word) => ({ text: word, key: stem(word.toLowerCase()) }));
}

interface Entry<T> {
  keys: string[];
  value: T;
}

function entries<T>(terms: string, value: T): Entry<T>[] {
  return terms
    .split(",")
    .map((term) => words(term.trim()).map((word) => word.key))
    .filter((keys) => keys.length > 0)
    .map((keys) => ({ keys, value }));
}

/** Where `keys` appears as a run in `within`, or -1. */
function findRun(within: string[], keys: string[]): number {
  for (let start = 0; start + keys.length <= within.length; start++) {
    if (keys.every((key, i) => within[start + i] === key)) return start;
  }
  return -1;
}

/** The entry with the longest term found in the words. On a tie the earlier entry wins (consumables come first). */
function longestMatch<T>(keys: string[], list: Entry<T>[]) {
  let best: { entry: Entry<T>; at: number } | null = null;
  for (const entry of list) {
    if (best && entry.keys.length <= best.entry.keys.length) continue;
    const at = findRun(keys, entry.keys);
    if (at !== -1) best = { entry, at };
  }
  return best;
}

/** Normalizes a store name for keying item codes: "Wal-Mart" and "WALMART" are one store. */
export const storeKey = (store: string | null | undefined) => (store ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The match whose words end last, then the longest: the main noun of a product name comes last ("cheese pizza" is a pizza). */
function lastMatch<T>(keys: string[], list: Entry<T>[]) {
  let best: { entry: Entry<T>; at: number } | null = null;
  for (const entry of list) {
    const at = findRun(keys, entry.keys);
    if (at === -1) continue;
    const end = at + entry.keys.length;
    if (!best || end > best.at + best.entry.keys.length || (end === best.at + best.entry.keys.length && entry.keys.length > best.entry.keys.length)) best = { entry, at };
  }
  return best;
}

/** What identify() can be told about a line beyond its words. */
export interface IdentifyContext {
  /** Take the item named last rather than the longest term: for a product's full name, whose main noun is last. */
  preferLast?: boolean;
  /** The store's own item code for the line (a UPC, or Costco's item number). */
  code?: string;
  store?: string | null;
}

export type Identifier = (receiptName: string, context?: IdentifyContext) => Identified;

/**
 * Builds the matcher over dictionary data. Pure: the data comes from the
 * database (or the starter list), and nothing here knows which.
 *
 * What a line is, in order of trust: its store's item code, then the longest
 * item term in its words, then what its brand makes when the brand only
 * makes one thing.
 */
export function createIdentifier(data: DictionaryData): Identifier {
  const items = new Map<string, CatalogItem>(data.items.map((item) => [item.name, item]));
  // Consumables first, so on a tie the item you use up wins over a durable.
  const orderedTerms = [...data.terms].sort((a, b) => Number(items.get(b.item)?.consumable) - Number(items.get(a.item)?.consumable));
  const itemEntries: Entry<CatalogItem>[] = orderedTerms.flatMap((term) => {
    const item = items.get(term.item);
    return item ? entries(term.text, item) : [];
  });
  const brandEntries: Entry<{ name: string; implies: CatalogItem | null }>[] = data.brands.flatMap((brand) =>
    entries(brand.terms.join(","), { name: brand.name, implies: brand.implies ? (items.get(brand.implies) ?? null) : null }),
  );
  const byCode = new Map(data.codes.flatMap((c) => (items.get(c.item) ? [[`${storeKey(c.store)}#${c.code}`, items.get(c.item)!] as const] : [])));

  return function identify(receiptName, context = {}) {
    const all = words(receiptName);
    const keys = all.map((word) => word.key);

    const brand = longestMatch(keys, brandEntries);
    const brandWords = brand ? new Set(brand.entry.keys.map((_, i) => brand.at + i)) : new Set<number>();
    // Look for the item outside the brand's words, so "Bounty" doesn't also count as a word of the item.
    const rest = all.filter((_, i) => !brandWords.has(i));
    const restKeys = rest.map((word) => word.key);
    const item = context.preferLast ? lastMatch(restKeys, itemEntries) : longestMatch(restKeys, itemEntries);
    const coded = context.code ? byCode.get(`${storeKey(context.store)}#${context.code}`) : undefined;

    return {
      item: coded ?? item?.entry.value ?? brand?.entry.value.implies ?? null,
      brand: brand?.entry.value.name ?? null,
      withoutBrand: rest.map((word) => word.text).join(" "),
    };
  };
}
