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
  /** What the store says about it, when the search gives it. Titles often leave the pack size out; this usually has it. */
  description?: string | null;
  /** Short selling points from the store. */
  features?: string[];
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
  /** `store` only came from a receipt: it ranks a listing higher, but another store isn't a concern. */
  storeIsGuess?: boolean;
  /** The user's stores in order of preference ("Walmart", "Target"). With any set, a listing elsewhere is a concern. */
  preferredStores?: string[];
  /** Other things the product is called ("bath tissue" for Toilet Paper), from the dictionary. */
  synonyms?: string[];
  /** Whether we can have this store's listing bought. Without it, every store counts. */
  canOrderFrom?: (domain: string) => boolean;
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
  | "other-store"
  /** Zinc can't buy from this store: the user can only follow the link and buy it themselves. */
  | "not-orderable"
  /** The AI that reviewed the listings wasn't sure enough of this one to buy it without asking. */
  | "ai-unsure";

/** What each concern means to the user, short enough for a tag next to a listing. */
export const CONCERN_LABELS: Record<Concern, string> = {
  "outside-price-range": "Over your price limit",
  "size-unknown": "Pack size not stated",
  "size-differs": "Different pack size than usual",
  "other-brand": "Different brand",
  "other-store": "Not your usual store",
  "not-orderable": "We can't order from this store: buy it from the link",
  "ai-unsure": "Worth a second look",
};

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

/**
 * Words that make a listing a thing to do with the product, not the product: a toilet paper holder
 * has every word of "Toilet Paper" in it. Only checked when the product's own name doesn't use the
 * word, so a product really called "Coffee Filters" still finds them. Listing words mean the same
 * to everyone, so this is a plain list; add to it when a search finds a new kind of accessory.
 */
const ACCESSORY_WORDS = new Set(
  [
    "holder", "dispenser", "frother", "cabinet", "storage", "organizer", "rack", "stand", "mount", "caddy", "shelf", "hanger", "basket", "bin", "tray",
    "maker", "brewer", "grinder", "cooker", "steamer", "warmer", "pitcher", "tumbler", "mug", "opener", "filter", "decal", "sticker", "poster", "costume", "toy", "ornament",
  ].map(stem),
);

/**
 * Whether a listing is the kind of thing the product is: every word of the product's name, or of
 * another name for it, is in the title in any order ("Toilet Paper" is in "Charmin Ultra Soft Toilet
 * Paper, 12 Mega Rolls", and "bathroom tissue" is another name for it), and nothing in the title
 * says it is an accessory.
 */
export function isSameKind(name: string, title: string, synonyms: string[] = []): boolean {
  const names = [name, ...synonyms].map(words).filter((list) => list.length > 0);
  if (words(name).length === 0) return false;
  const have = new Set(words(title));
  const named = new Set(names.flat());
  if ([...have].some((word) => ACCESSORY_WORDS.has(word) && !named.has(word))) return false;
  return names.some((list) => list.every((word) => have.has(word)));
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

/** Words that count items on their own (a pack is counted separately, because packs multiply). */
const COUNT_WORDS = "ct|count|counts|pcs|pc|pieces|piece|each|ea";
/** Units that measure an amount: "6 Pack" of milk says nothing about how many gallons. */
const MEASURE_UNITS = new Set(["gallon", "gal", "oz", "ounce", "fl", "lb", "pound", "liter", "litre", "ml", "quart", "qt", "pint", "pt", "kg", "gram"]);
const MOST_IN_A_LISTING = 5000;

/**
 * How many units one listing holds: "12 Mega Rolls", "Pack of 6", "24ct", "6-pack". A count and a
 * pack multiply, so "6 Mega Rolls (Pack of 4)" is 24 and "2 Pack, 42 Count Each" is 84; "2 Pack of 8
 * Rolls" is 16. Counts the product's own unit too ("12 rolls" when the unit is rolls). Null when
 * nothing says; "1 gallon" is only read when the product counts in gallons, and a pack alone says
 * nothing for a unit that measures an amount.
 */
export function packSizeFrom(title: string, unit: string): number | null {
  const text = title.toLowerCase();
  const unitWord = stem(alnum(unit).split(" ").pop() ?? "");
  const measured = MEASURE_UNITS.has(unitWord);
  const unitPattern = unitWord ? `${unitWord}(?:s|es)?` : "";
  const counted = [...(measured ? [] : [COUNT_WORDS]), unitPattern].filter(Boolean).join("|");
  const valid = (size: number) => (Number.isInteger(size) && size > 0 && size <= MOST_IN_A_LISTING ? size : null);

  const nested = /(\d+)\s*-?\s*(?:pack|pk)\s+of\s+(\d+)/.exec(text);
  if (nested && !measured) return valid(Number(nested[1]) * Number(nested[2]));

  const count = counted ? new RegExp(`(\\d+)(?!\\s*-?\\s*ply)\\s*-?\\s*(?:[a-z]+\\s+)?(?:${counted})\\b`).exec(text) : null;
  const packOf = /(?:pack|case|set) of (\d+)/.exec(text);
  const numberedPack = /(\d+)\s*-?\s*(?:pack|pk)\b/.exec(text);
  const pack = packOf ?? numberedPack;

  if (!count) return pack && !measured ? valid(Number(pack[1])) : null;
  if (!pack) return valid(Number(count[1]));
  // "Pack of 12 Rolls" and "12 Pack, 12 Rolls" are the same 12, not 12 packs of 12.
  const sameNumber = count[1] === pack[1] || (packOf !== null && packOf.index + packOf[0].length - packOf[1]!.length === count.index);
  return valid(sameNumber ? Number(count[1]) : Number(count[1]) * Number(pack[1]));
}

/**
 * The stores Zinc can buy from without the user's own account, among those that sell things that get
 * used up (from Zinc's GET /retailers, November 2026; it also lists fashion and specialist stores). Check
 * that list when adding one: Target, CVS and Walgreens aren't on it.
 */
export const ORDERABLE_STORES = ["amazon.com", "walmart.com", "lowes.com", "homedepot.com", "acehardware.com", "bestbuy.com", "chewy.com", "wayfair.com", "grainger.com", "sephora.com", "macys.com"];

/** Whether Zinc can buy from this store. */
export function canOrderFrom(domain: string): boolean {
  return ORDERABLE_STORES.includes(domain.trim().toLowerCase().replace(/^www\./, ""));
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

/**
 * Whether a store is one the user has said they want. A store a receipt happened to fill in isn't
 * them saying so: it ranks a listing higher but is no reason to stop and ask, because the stores we
 * can buy from online often aren't the ones people shop at in person.
 */
export function isWantedStore(wanted: Pick<Wanted, "store" | "storeIsGuess" | "preferredStores">, domain: string): boolean {
  const preferred = wanted.preferredStores ?? [];
  const typed = wanted.store !== null && !wanted.storeIsGuess;
  if (preferred.length === 0 && !typed) return true;
  return isStore(wanted.store, domain) || preferred.some((store) => isStore(store, domain));
}

/** The usual store first, then the user's stores in their order, then everything else. */
function storeRank(wanted: Pick<Wanted, "store" | "preferredStores">, domain: string): number {
  if (isStore(wanted.store, domain)) return 0;
  const preferred = wanted.preferredStores ?? [];
  const at = preferred.findIndex((store) => isStore(store, domain));
  return at === -1 ? preferred.length + 1 : at + 1;
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
 * One listing as an offer: its pack size, how many packs make the usual amount, what that costs, and
 * what is questionable about it. `knownSize` is a pack size from a better source than the text (the AI's reading).
 */
export function offerFor(candidate: Candidate, wanted: Wanted, knownSize: number | null = null): PickedOffer {
  const quantity = wanted.quantity > 0 ? wanted.quantity : 1;
  const packSize = knownSize ?? packSizeFrom(candidate.title, wanted.unit) ?? (candidate.description ? packSizeFrom(candidate.description, wanted.unit) : null);
  const packs = packSize === null ? 1 : Math.max(1, Math.ceil(quantity / packSize - 1e-9));
  const totalCents = candidate.priceCents * packs;
  const inRange = withinRange(totalCents, wanted.range);
  const concerns: Concern[] = [];
  if (wanted.canOrderFrom && !wanted.canOrderFrom(candidate.domain)) concerns.push("not-orderable");
  if (!inRange) concerns.push("outside-price-range");
  if (packSize === null) concerns.push("size-unknown");
  else if (sizeFit(packSize, packs, quantity) === 0) concerns.push("size-differs");
  if (wanted.brands.length > 0 && !hasBrand(wanted.brands, candidate)) concerns.push("other-brand");
  if (!isWantedStore(wanted, candidate.domain)) concerns.push("other-store");
  return { candidate, packSize, packs, totalCents, withinRange: inRange, concerns };
}

/**
 * Every usable listing, best first. Order of what matters: a store we can order from, inside the price range, a pack size
 * that fits the usual purchase, a brand the product has been bought in, the usual or preferred store, then
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
      isSameKind(wanted.name, candidate.title, wanted.synonyms),
  );

  const ranked = usable.map((candidate) => {
    const pick = offerFor(candidate, wanted);
    const perUnit = candidate.priceCents / (pick.packSize ?? 1);
    const orderable = !pick.concerns.includes("not-orderable");
    const fit = sizeFit(pick.packSize, pick.packs, quantity);
    const brandMatch = !pick.concerns.includes("other-brand");
    return { pick, key: [orderable ? 0 : 1, pick.withinRange ? 0 : 1, 2 - fit, brandMatch ? 0 : 1, storeRank(wanted, candidate.domain), perUnit, candidate.priceCents] };
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
