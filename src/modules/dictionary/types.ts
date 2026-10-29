/** An item the dictionary knows: what a receipt line is, as the user would name the thing they track. */
export interface CatalogItem {
  name: string;
  category: string;
  /** The unit a new product of this kind is counted in, when it isn't just "each". */
  unit: string | null;
  /** False for things that don't get used up (furniture, electronics...). Their name is their category. */
  consumable: boolean;
}

export interface Identified {
  item: CatalogItem | null;
  /** Display name, like "Great Value". */
  brand: string | null;
  /** The receipt's words without the brand's, for naming an item the dictionary doesn't know. */
  withoutBrand: string;
}

/** Everything the matcher knows, as plain data. It is loaded from the database or from the starter list (seed.ts). */
export interface DictionaryData {
  items: CatalogItem[];
  /** A wording that means an item, by the item's name. */
  terms: { text: string; item: string }[];
  /** A brand, the wordings that mean it, and the item it makes if it only makes one thing. */
  brands: { name: string; terms: string[]; implies: string | null }[];
  /** A store's own code for an item (a UPC, a Costco number). */
  codes: { store: string; code: string; item: string }[];
}
