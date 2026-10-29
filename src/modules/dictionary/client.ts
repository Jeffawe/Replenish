/**
 * The part of the dictionary that needs no database: the matcher, the shape
 * of the data, and the starter list. Receipt reading imports this (and the
 * browser could). Everything that reads or writes the live dictionary comes
 * from "@/modules/dictionary" (server only).
 */
import { createIdentifier } from "./engine";
import { seedData } from "./seed";

export { createIdentifier, storeKey, type IdentifyContext, type Identifier } from "./engine";
export { seedData } from "./seed";
export { isProductCode, itemFromLookup, type CodeLookup } from "./lookup-item";
export type { CatalogItem, DictionaryData, Identified } from "./types";

/** A matcher over the starter list alone: what tests and a database with nothing in it use. */
export const starterIdentify = createIdentifier(seedData());
