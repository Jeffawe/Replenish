import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notExists, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { orders, products, restockSuggestions } from "@/db/schema";
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
  concerns: z.array(z.enum(["outside-price-range", "size-unknown", "size-differs", "other-brand", "other-store", "not-orderable", "ai-unsure"])),
  sample: z.boolean(),
});
const FoundSchema = z.object({ query: z.string(), listings: z.number(), pick: ListingSchema, alternatives: z.array(ListingSchema), reason: z.string().nullish() });
type Found = z.input<typeof FoundSchema>;

/** A suggestion as the screen needs it. */
export interface Suggestion {
  /** How many units one purchase usually is, to start "I just bought this" from. */
  usualQuantity: number;
  id: string;
  userId: string;
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
  /** Why the AI chose this listing, in a sentence for the user. Null when the rules chose alone. */
  reason: string | null;
}

/**
 * An order still in progress or on its way: the product is being dealt with, so it isn't suggested
 * or bought again. A placed order not yet recorded as a purchase counts however old it is, because
 * until it is recorded the estimate doesn't know it was bought and would buy it again.
 */
const orderIsActive = (now: Date) =>
  or(eq(orders.status, "processing"), and(eq(orders.status, "placed"), or(isNull(orders.arrivesAt), gt(orders.arrivesAt, now), isNull(orders.purchaseRecordedAt))));

const activeOrder = (now: Date) => and(eq(orders.productId, products.id), orderIsActive(now));

/** The joined row for a suggestion that should be shown: open, product visible, still needing attention, and nothing already ordered for it. */
const shown = (now: Date) =>
  and(
    eq(restockSuggestions.status, "open"),
    isNull(products.archivedAt),
    lte(products.nextCheckAt, now),
    or(isNull(restockSuggestions.snoozedUntil), lte(restockSuggestions.snoozedUntil, now)),
    notExists(db.select({ one: orders.id }).from(orders).where(activeOrder(now))),
  );

async function readSuggestions(now: Date, extra?: SQL): Promise<Suggestion[]> {
  const rows = await db
    .select({ suggestion: restockSuggestions, product: products })
    .from(restockSuggestions)
    .innerJoin(products, eq(products.id, restockSuggestions.productId))
    .where(and(shown(now), extra))
    .orderBy(asc(products.nextCheckAt));

  return rows.flatMap(({ suggestion, product }): Suggestion[] => {
    // A row we can't read (written by an older version) is skipped; the next search replaces it.
    const found = FoundSchema.safeParse(suggestion.found);
    if (!found.success) return [];
    const { pick, alternatives, query, reason } = found.data;
    return [
      {
        usualQuantity: product.normalPurchaseQty,
        id: suggestion.id,
        userId: suggestion.userId,
        productId: product.id,
        name: product.name,
        unit: product.unit,
        brand: product.brand,
        boughtFrom: product.boughtFrom,
        searchedAt: suggestion.searchedAt,
        query,
        pick,
        alternatives,
        reason: reason ?? null,
      },
    ];
  });
}

/** The user's open suggestions, most urgent first. */
export function listSuggestions(userId: string, now: Date = new Date()): Promise<Suggestion[]> {
  return readSuggestions(now, eq(restockSuggestions.userId, userId));
}

/** Everyone's open suggestions for products with auto-buy on: what the auto-buy job considers buying. */
export function listAutoBuySuggestions(now: Date = new Date(), userId?: string): Promise<Suggestion[]> {
  return readSuggestions(now, and(eq(products.autobuyEnabled, true), userId ? eq(restockSuggestions.userId, userId) : undefined));
}

/** One of the user's suggestions, if it is still being shown to them. */
export async function getSuggestion(userId: string, id: string, now: Date = new Date()): Promise<Suggestion | null> {
  return (await readSuggestions(now, and(eq(restockSuggestions.userId, userId), eq(restockSuggestions.id, id))))[0] ?? null;
}

/** How long "Not now" keeps a suggestion, and auto-buy for that product, quiet. */
export const SNOOZE_DAYS = 3;

/** "Not now": hides the suggestion, and holds auto-buy for that product, for a few days. False if it isn't the user's. */
export async function snoozeSuggestion(userId: string, id: string, now: Date = new Date()): Promise<boolean> {
  const updated = await db
    .update(restockSuggestions)
    .set({ snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * 24 * 60 * 60 * 1000), updatedAt: now })
    .where(and(eq(restockSuggestions.id, id), eq(restockSuggestions.userId, userId)))
    .returning({ id: restockSuggestions.id });
  return updated.length > 0;
}

/** Every stored listing of the user's, whether or not it is being shown now, for working out what auto-buy would have done. */
export async function storedListings(userId: string): Promise<Map<string, Suggestion["pick"]>> {
  const rows = await db.select({ productId: restockSuggestions.productId, found: restockSuggestions.found }).from(restockSuggestions).where(eq(restockSuggestions.userId, userId));
  return new Map(rows.flatMap((row) => {
    const found = FoundSchema.safeParse(row.found);
    return found.success ? [[row.productId, found.data.pick] as const] : [];
  }));
}

/** What is already stored for these products, so a run can skip searching them again. */
export async function existingSuggestions(productIds: string[]): Promise<Map<string, { snoozedUntil: Date | null; searchedAt: Date }>> {
  if (productIds.length === 0) return new Map();
  const rows = await db
    .select({ productId: restockSuggestions.productId, snoozedUntil: restockSuggestions.snoozedUntil, searchedAt: restockSuggestions.searchedAt })
    .from(restockSuggestions)
    .where(inArray(restockSuggestions.productId, productIds));
  return new Map(rows.map((row) => [row.productId, { snoozedUntil: row.snoozedUntil, searchedAt: row.searchedAt }]));
}

/**
 * Stores what a run found. A found listing is saved (replacing an older one; a snooze stands). A
 * search that found nothing clears the suggestion, because the listing it showed may be gone, and is
 * remembered on the product so it isn't paid for again on the next run. A failed search changes nothing.
 */
export async function saveFindings(items: RestockItem[], now: Date = new Date()): Promise<{ saved: number; cleared: number }> {
  const foundItems = items.flatMap((item) => (item.status === "found" ? [item] : []));
  const nothingFound = items.filter((item) => item.status === "none").map((item) => item.productId);
  if (foundItems.length > 0) {
    const writes = foundItems.map((item) => {
      const found: Found = { query: item.query, listings: item.listings, pick: item.pick, alternatives: item.alternatives, reason: item.reason };
      return db
        .insert(restockSuggestions)
        .values({ userId: item.userId, productId: item.productId, found, searchedAt: now })
        .onConflictDoUpdate({ target: restockSuggestions.productId, set: { found, searchedAt: now, updatedAt: now } });
    });
    await db.batch(writes as [(typeof writes)[0], ...typeof writes]);
  }
  if (nothingFound.length === 0) return { saved: foundItems.length, cleared: 0 };
  const [cleared] = await db.batch([
    db.delete(restockSuggestions).where(inArray(restockSuggestions.productId, nothingFound)).returning({ id: restockSuggestions.id }),
    db.update(products).set({ restockNoneFoundAt: now }).where(inArray(products.id, nothingFound)),
  ]);
  return { saved: foundItems.length, cleared: cleared.length };
}

/** Removes the suggestions for these products: they have been given up on until the user says otherwise. */
export async function dropSuggestions(productIds: string[]): Promise<void> {
  if (productIds.length > 0) await db.delete(restockSuggestions).where(inArray(restockSuggestions.productId, productIds));
}

/**
 * Removes suggestions for products that no longer need attention (restocked, hidden or deleted
 * data), which also ends a snooze: next time the product runs low it is asked about again.
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


/** Which of these products already have an order in progress or on its way. */
export async function productsWithActiveOrder(productIds: string[], now: Date = new Date()): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  const rows = await db
    .select({ productId: orders.productId })
    .from(orders)
    .where(and(inArray(orders.productId, productIds), orderIsActive(now)));
  return new Set(rows.flatMap((row) => (row.productId ? [row.productId] : [])));
}
