import type { Identifier } from "./engine";
import type { CatalogItem } from "./types";

/** What a product database said about a code. */
export interface CodeLookup {
  name: string | null;
  brand: string | null;
  /** Category names, most general first ("dairies", "milks", "whole milks"). */
  categories: string[];
}

/** Only codes that can be a UPC or EAN are worth asking a product database about (Costco's item numbers are shorter). */
export const isProductCode = (code: string) => /^\d{8,14}$/.test(code);

const upcCheckDigit = (body: string) => {
  const odd = [...body].reduce((sum, digit, i) => sum + (i % 2 === 0 ? Number(digit) * 3 : Number(digit)), 0);
  return (10 - (odd % 10)) % 10;
};
const isValidUpc = (code: string) => code.length === 12 && upcCheckDigit(code.slice(0, 11)) === Number(code[11]);

/**
 * The barcodes to try, best first, for a code as a receipt prints it. Walmart
 * prints a UPC without its last (check) digit, padded with a leading zero
 * ("007874235191" is 0-78742-35191 and the barcode is 078742351919), so for a
 * 12-digit code starting with 0 that isn't already a valid UPC the check digit
 * is added. A code that is already valid is tried as printed, and a second
 * guess is made only when both readings are possible.
 */
export function barcodeCandidates(code: string): string[] {
  if (!/^0\d{11}$/.test(code)) return [code];
  const completed = code.slice(1) + upcCheckDigit(code.slice(1));
  return isValidUpc(code) ? [code, completed] : [completed];
}

/**
 * The item a product database's answer means, using the dictionary to read
 * the product's name, and failing that its categories from the most specific.
 * Null when it names nothing the dictionary knows.
 */
export function itemFromLookup(lookup: CodeLookup, identify: Identifier): { item: CatalogItem; brand: string | null } | null {
  const brand = lookup.brand?.split(",")[0]?.trim() || null;
  const attempts = [[brand, lookup.name].filter(Boolean).join(" "), ...[...lookup.categories].reverse()];
  for (const text of attempts) {
    if (!text) continue;
    const found = identify(text, { preferLast: true });
    if (found.item) return { item: found.item, brand: found.brand ?? brand };
  }
  return null;
}
