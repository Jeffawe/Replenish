import type { Candidate } from "@/core/pick-offer";
/** Why a search failed. The message is safe to show or log; it never contains a key. */
export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

/** What a search is told about the product besides its text. */
export interface SearchContext {
  /** The product's category ("Groceries", "Household"), or null when unknown. */
  category: string | null;
}

/** Anything that can look a product up online. Channel3 and Zinc are real ones; tests and demos use a fake. */
export interface ProductSearch {
  search(query: string, context?: SearchContext): Promise<Candidate[]>;
}

/** Food and drink are searched on Zinc: Channel3 has no food in it (checked on the live API). */
export function isGrocery(category: string | null): boolean {
  return category !== null && ["groceries", "beverages"].includes(category.trim().toLowerCase());
}
