import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { products, restockSuggestions } from "@/db/schema";
import type { RestockItem } from "./report";

/**
 * What the user is asked about the next time they log in: "you're low on X; we found this".
 * One row per product. The row keeps the search's result as found, and is shown only while the
 * product still needs attention (its check date has come), so it disappears by itself once the
 * user restocks. Nothing here buys anything.
 */

const httpUrl = z.string().refine((value) => /^https?:\/\//i.test(value), "must be a web link");
const ListingSchema = z.object({
  title: z.string(),
  brands: z.array(z.string()),
  domain: z.string(),
  // The link comes from a search service and ends up in an <a href>, so only web links are accepted.
  url: httpUrl,
  imageUrl: z.string().nullable(),
  channel3Id: z.string(),
  currency: z.string(),
  priceCents: z.number(),
  packSize: z.number().nullable(),
  packs: z.number(),
  totalCents: z.number(),
  withinRange: z.boolean(),
  concerns: z.array(z.enum(["outside-price-range", "size-unknown", "size-differs", "other-brand", "other-store"])),
  sample: z.boolean(),
});
const FoundSchema = z.object({ query: z.string(), listings: z.number(), pick: ListingSchema, alternatives: z.array(ListingSchema) });
type Found = z.input<typeof FoundSchema>;

/** A suggestion as the screen needs it. */
export interface Suggestion {
  id: string;
  productId: string;
  name: string;
  unit: string;
  brand: string | null;
  boughtFrom: string | null;
  /** When the search ran. */
  searchedAt: Date;
  query: string;
  /** The best listing. */
  pick: z.infer<typeof ListingSchema>;
  /** Up to two others, best first. */
  alternatives: z.infer<typeof ListingSchema>[];
}

/** The joined row for a suggestion that should be shown: open, product visible and still needing attention. */
const shown = (userId: string, now: Date) =>
  and(
    eq(restockSuggestions.userId, userId),
    eq(restockSuggestions.status, "open"),
    isNull(products.archivedAt),
    lte(products.nextCheckAt, now),
  );

async function readSuggestions(userId: string, now: Date, only?: string): Promise<Suggestion[]> {
  const rows = await db
    .select({ suggestion: restockSuggestions, product: products })
    .from(restockSuggestions)
    .innerJoin(products, eq(products.id, restockSuggestions.productId))
    .where(and(shown(userId, now), only ? eq(restockSuggestions.id, only) : undefined))
    .orderBy(asc(products.nextCheckAt));

  return rows.flatMap(({ suggestion, product }): Suggestion[] => {
    // A row we can't read (written by an older version) is skipped; the next search replaces it.
    const found = FoundSchema.safeParse(suggestion.found);
    if (!found.success) return [];
    const { pick, alternatives, query } = found.data;
    return [
      {
        id: suggestion.id,
        productId: product.id,
        name: product.name,
        unit: product.unit,
        brand: product.brand,
        boughtFrom: product.boughtFrom,
        searchedAt: suggestion.searchedAt,
        query,
        pick,
        alternatives,
      },
    ];
  });
}

/** The user's open suggestions, most urgent first. */
export function listSuggestions(userId: string, now: Date = new Date()): Promise<Suggestion[]> {
  return readSuggestions(userId, now);
}

/** One of the user's suggestions, if it is still being shown to them. */
export async function getSuggestion(userId: string, id: string, now: Date = new Date()): Promise<Suggestion | null> {
  return (await readSuggestions(userId, now, id))[0] ?? null;
}

/** "Not now": hides the suggestion until the product has stock again. False if it isn't the user's. */
export async function dismissSuggestion(userId: string, id: string): Promise<boolean> {
  const updated = await db
    .update(restockSuggestions)
    .set({ status: "dismissed", updatedAt: new Date() })
    .where(and(eq(restockSuggestions.id, id), eq(restockSuggestions.userId, userId)))
    .returning({ id: restockSuggestions.id });
  return updated.length > 0;
}

/** What is already stored for these products, so a run can skip searching them again. */
export async function existingSuggestions(productIds: string[]): Promise<Map<string, { status: string; searchedAt: Date }>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: restockSuggestions.productId, status: restockSuggestions.status, searchedAt: restockSuggestions.searchedAt })
    .from(restockSuggestions)
    .where(inArray(restockSuggestions.productId, productIds));
  return new Map(rows.map((row) => [row.productId, { status: row.status, searchedAt: row.searchedAt }]));
}

/**
 * Stores what a run found. A found listing is saved (replacing an older one; a dismissed
 * suggestion stays dismissed). A search that found nothing clears an open suggestion, because
 * the listing it showed may be gone. A failed search changes nothing.
 */
export async function saveFindings(items: RestockItem[], now: Date = new Date()): Promise<{ saved: number; cleared: number }> {
  let saved = 0;
  const nothingFound: string[] = [];
  for (const item of items) {
    if (item.status === "none") nothingFound.push(item.productId);
    if (item.status !== "found") continue;
    const found: Found = { query: item.query, listings: item.listings, pick: item.pick, alternatives: item.alternatives };
    await db
      .insert(restockSuggestions)
      .values({ userId: item.userId, productId: item.productId, found, searchedAt: now })
      .onConflictDoUpdate({ target: restockSuggestions.productId, set: { found, searchedAt: now, updatedAt: now } });
    saved++;
  }
  const cleared =
    nothingFound.length === 0
      ? []
      : await db
          .delete(restockSuggestions)
          .where(and(inArray(restockSuggestions.productId, nothingFound), eq(restockSuggestions.status, "open")))
          .returning({ id: restockSuggestions.id });
  return { saved, cleared: cleared.length };
}

/**
 * Removes suggestions for products that no longer need attention (restocked, hidden or deleted
 * data), which also ends a dismissal: next time the product runs low it is asked about again.
 */
export async function forgetStaleSuggestions(now: Date = new Date(), userId?: string): Promise<number> {
  const stale = db
    .select({ id: products.id })
    .from(products)
    .where(or(isNull(products.nextCheckAt), gt(products.nextCheckAt, now), isNotNull(products.archivedAt)));
  const removed = await db
    .delete(restockSuggestions)
    .where(and(inArray(restockSuggestions.productId, stale), userId ? eq(restockSuggestions.userId, userId) : undefined))
    .returning({ id: restockSuggestions.id });
  return removed.length;
}

