import { withinRange, type PriceRange } from "./user-settings";

/**
 * Chooses which online listing to buy (or show) for a product that is running low.
 * Plain data in, plain data out; the search itself is src/modules/restock.
 *
 * Nothing here removes an offer for being too dear or the wrong size: every limit means
 * "ask the user", so those offers are kept, ranked last and labelled with a concern. Only an
 * offer that cannot be the product at all (not in stock, used, in the wrong department, not the
 * same kind of thing) is dropped.
 */

/** One store's listing of one product, as a search found it. */
export interface Candidate {
  /** The search service's id for the product; the same product has one candidate per store. */
  id: string;
  title: string;
  brands: string[];
  imageUrl: string | null;
  url: string;
  /** The store's domain, "walmart.com". */
  domain: string;
  /** The top of the product's category in the search service's tree ("Home & Garden"); null when it has none. */
  department: string | null;
  /** The listed price for one pack, in cents. */
  priceCents: number;
  currency: string;
  inStock: boolean;
  condition: string | null;
  /** Invented by a sandbox or a mock, not a real offer. Never show it as one, and never buy it with real money. */
  sample?: boolean;
}

/** What we are looking for. */
export interface Wanted {
  name: string;
  /** What the product is counted in ("rolls", "gallon"). */
  unit: string;
  /** The product's own category ("Household", "Groceries"), or null when unknown. */
  category: string | null;
  /** Brands it has been bought in, newest last; empty when unknown. */
  brands: string[];
  /** Where it is usually bought ("Walmart"), as the user or a receipt wrote it. */
  store: string | null;
  /** How many units one purchase usually is. */
  quantity: number;
  /** The price range that applies to this product, for the whole order. */
  range: PriceRange;
}

/** Things worth knowing about a pick; the step that buys decides which of them mean "ask first". */
export type Concern =
  | "outside-price-range"
  /** The title doesn't say how many units a pack has, so how many to order is a guess. */
  | "size-unknown"
  /** The pack is much bigger or smaller than the usual purchase. */
  | "size-differs"
  | "other-brand"
  | "other-store";

export interface PickedOffer {
  candidate: Candidate;
  /** Units in one pack, or null when the title doesn't say. */
  packSize: number | null;
  /** How many packs to order to get the usual amount. */
  packs: number;
  /** What the order costs: packs times the pack price. */
  totalCents: number;
  withinRange: boolean;
  concerns: Concern[];
}

const STOP_WORDS = new Set(["and", "with", "the", "for", "of", "in", "a"]);

const alnum = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Folds a plural so "eggs" meets "egg" and "berries" meets "berry". */
const stem = (word: string) => (word.endsWith("ies") && word.length > 4 ? `${word.slice(0, -3)}y` : word.endsWith("es") && word.length > 4 ? word.slice(0, -2) : word.endsWith("s") && word.length > 3 ? word.slice(0, -1) : word);
const words = (text: string) => alnum(text).split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word)).map(stem);

/** Whether a listing is the kind of thing the product is: "Toilet Paper" is in "Charmin Ultra Soft Toilet Paper, 12 Mega Rolls" because every word of the name is, in any order. */
export function isSameKind(name: string, title: string): boolean {
  const wanted = words(name);
  if (wanted.length === 0) return false;
  const have = new Set(words(title));
  return wanted.every((word) => have.has(word));
}

/**
 * Which departments of the search service's category tree (Google's product taxonomy, which
 * Channel3 uses) a product of each of our categories can be sold under. A search for "Milk"
 * also finds cleansing milk, milk cartons and a perfume called Milk; this keeps those out.
 * A category not listed here, or a listing with no department, is not checked.
 */
const DEPARTMENTS: Record<string, string[]> = {
  groceries: ["Food, Beverages & Tobacco"],
  beverages: ["Food, Beverages & Tobacco"],
  household: ["Home & Garden", "Hardware", "Electronics", "Office Supplies"],
  "personal care": ["Health & Beauty"],
  health: ["Health & Beauty"],
  pet: ["Animals & Pet Supplies"],
  baby: ["Baby & Toddler", "Health & Beauty"],
};

/** Whether a listing is in a department the product's category can be sold under. Unknown on either side counts as yes. */
export function inRightDepartment(category: string | null, department: string | null): boolean {
  if (!category || !department) return true;
  const allowed = DEPARTMENTS[category.trim().toLowerCase()];
  return !allowed || allowed.includes(department);
}

/** Words that stand for "items in a pack" on their own. */
const COUNT_WORDS = "ct|count|counts|pk|pack|packs|pcs|pc|pieces|piece|each|ea";

/**
 * How many units the title says one pack holds: "12 Mega Rolls", "Pack of 6", "24ct", "6-pack".
 * Counts the product's own unit too ("12 rolls" when the unit is rolls). Null when nothing says;
 * "1 gallon" is only read when the product counts in gallons. Takes the first number that fits.
 */
export function packSizeFrom(title: string, unit: string): number | null {
  const text = title.toLowerCase();
  const unitWord = stem(alnum(unit).split(" ").pop() ?? "");
  const unitPattern = unitWord ? `|${unitWord}(?:s|es)?` : "";
  const patterns = [
    /pack of (\d+)/,
    /case of (\d+)/,
    /(\d+)\s*-?\s*(?:pack|pk)\b/,
    new RegExp(`(\\d+)\\s*-?\\s*(?:[a-z]+\\s+)?(?:${COUNT_WORDS}${unitPattern})\\b`),
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(text);
    const size = found ? Number(found[1]) : NaN;
    if (Number.isInteger(size) && size > 0 && size <= 1000) return size;
  }
  return null;
}

/** Letters and digits only, with "www." and the ending dropped: "www.walmart.com" -> "walmart". */
function storeKey(text: string): string {
  const withoutEnding = text.toLowerCase().replace(/^www\./, "").replace(/\.(com|net|org|co|us|ca|co\.uk)$/, "");
  return withoutEnding.replace(/[^a-z0-9]/g, "");
}

/** Whether a listing's domain is the store the user usually buys it from ("Walmart Supercenter" is walmart.com). */
export function isStore(store: string | null, domain: string): boolean {
  if (!store) return false;
  const wanted = storeKey(store);
  const have = storeKey(domain);
  if (wanted.length < 3 || have.length < 3) return false;
  return wanted.includes(have) || have.includes(wanted);
}

function hasBrand(wanted: string[], candidate: Candidate): boolean {
  const title = alnum(candidate.title);
  return wanted.some((brand) => {
    const key = alnum(brand);
    if (!key) return false;
    return title.includes(key) || candidate.brands.some((own) => alnum(own).includes(key) || key.includes(alnum(own)));
  });
}

/** How well a pack fits the usual purchase: 2 = about right, 1 = can't tell, 0 = much bigger or smaller. */
function sizeFit(packSize: number | null, packs: number, quantity: number): 0 | 1 | 2 {
  if (packSize === null) return 1;
  const total = packSize * packs;
  return total >= quantity && total <= quantity * 1.5 ? 2 : 0;
}

/**
 * Every usable listing, best first. Order of what matters: inside the price range, a pack size
 * that fits the usual purchase, a brand the product has been bought in, the usual store, then
 * the lowest price per unit. Ties fall to the lower pack price, then the link, so the same
 * results always give the same answer.
 */
export function pickOffers(candidates: Candidate[], wanted: Wanted): PickedOffer[] {
  const quantity = wanted.quantity > 0 ? wanted.quantity : 1;
  const usable = candidates.filter(
    (candidate) =>
      candidate.inStock &&
      candidate.priceCents > 0 &&
      candidate.currency.toUpperCase() === "USD" &&
      (candidate.condition === null || candidate.condition === "new") &&
      inRightDepartment(wanted.category, candidate.department) &&
      isSameKind(wanted.name, candidate.title),
  );

  const ranked = usable.map((candidate) => {
    const packSize = packSizeFrom(candidate.title, wanted.unit);
    const packs = packSize === null ? 1 : Math.max(1, Math.ceil(quantity / packSize - 1e-9));
    const totalCents = candidate.priceCents * packs;
    const inRange = withinRange(totalCents, wanted.range);
    const fit = sizeFit(packSize, packs, quantity);
    const brandMatch = wanted.brands.length === 0 || hasBrand(wanted.brands, candidate);
    const storeMatch = isStore(wanted.store, candidate.domain);

    const concerns: Concern[] = [];
    if (!inRange) concerns.push("outside-price-range");
    if (packSize === null) concerns.push("size-unknown");
    else if (fit === 0) concerns.push("size-differs");
    if (!brandMatch) concerns.push("other-brand");
    if (wanted.store && !storeMatch) concerns.push("other-store");

    const pick: PickedOffer = { candidate, packSize, packs, totalCents, withinRange: inRange, concerns };
    const perUnit = candidate.priceCents / (packSize ?? 1);
    return { pick, key: [inRange ? 0 : 1, 2 - fit, brandMatch ? 0 : 1, storeMatch ? 0 : 1, perUnit, candidate.priceCents] };
  });

  ranked.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i]! - b.key[i]!;
    return a.pick.candidate.url < b.pick.candidate.url ? -1 : a.pick.candidate.url > b.pick.candidate.url ? 1 : 0;
  });
  return ranked.map((entry) => entry.pick);
}

/** The search text for a product: its latest brand and its name ("Charmin Toilet Paper"). */
export function searchQueryFor(product: { name: string; brand: string | null }): string {
  const brand = product.brand?.split(",").map((part) => part.trim()).filter(Boolean).pop();
  return [brand, product.name].filter(Boolean).join(" ");
}

/** A product's brands, from its comma-separated list. */
export function brandsOf(brand: string | null): string[] {
  return (brand ?? "").split(",").map((part) => part.trim()).filter(Boolean);
}
