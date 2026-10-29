import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { codeLookups, dictionaryBrands, dictionaryCodes, dictionaryItems, dictionaryTerms } from "@/db/schema";
import { storeKey } from "./engine";
import type { CachedLookup, LookupCache } from "./lookup";
import type { DictionaryData } from "./types";

/** Reads and writes the dictionary tables. Nothing in here decides what to learn; see learn.ts and index.ts. */

export type Status = "active" | "pending" | "off";
export type Source = "seed" | "learned" | "manual" | "lookup";

export const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export interface Snapshot {
  items: (typeof dictionaryItems.$inferSelect)[];
  terms: (typeof dictionaryTerms.$inferSelect)[];
  brands: (typeof dictionaryBrands.$inferSelect)[];
  codes: (typeof dictionaryCodes.$inferSelect)[];
}

/** Everything in the dictionary, whatever its status. */
export async function readAll(): Promise<Snapshot> {
  const [items, terms, brands, codes] = await Promise.all([
    db.select().from(dictionaryItems),
    db.select().from(dictionaryTerms),
    db.select().from(dictionaryBrands),
    db.select().from(dictionaryCodes),
  ]);
  return { items, terms, brands, codes };
}

/** The part of the dictionary that is in use: active entries whose item is active too. */
export function activeData({ items, terms, brands, codes }: Snapshot): DictionaryData {
  const live = new Map(items.filter((item) => item.status === "active").map((item) => [item.id, item]));
  return {
    items: [...live.values()].map(({ name, category, unit, consumable }) => ({ name, category, unit, consumable })),
    terms: terms.flatMap((t) => (t.status === "active" && live.has(t.itemId) ? [{ text: t.text, item: live.get(t.itemId)!.name }] : [])),
    brands: brands
      .filter((b) => b.status === "active")
      .map((b) => ({ name: b.name, terms: b.terms, implies: b.impliesItemId ? (live.get(b.impliesItemId)?.name ?? null) : null })),
    codes: codes.flatMap((c) => (c.status === "active" && live.has(c.itemId) ? [{ store: c.store, code: c.code, item: live.get(c.itemId)!.name }] : [])),
  };
}

export async function insertItem(item: { name: string; category: string; unit: string | null; consumable: boolean; source: Source; status: Status; note?: string }) {
  const [row] = await db
    .insert(dictionaryItems)
    .values({ ...item, normalizedName: normalizeName(item.name) })
    .onConflictDoNothing({ target: dictionaryItems.normalizedName })
    .returning();
  if (row) return row;
  const [existing] = await db.select().from(dictionaryItems).where(eq(dictionaryItems.normalizedName, normalizeName(item.name)));
  return existing!;
}

export async function insertTerm(term: { text: string; itemId: string; source: Source; status: Status; evidence?: string[]; conflict?: boolean; note?: string }) {
  await db
    .insert(dictionaryTerms)
    .values(term)
    .onConflictDoNothing({ target: [dictionaryTerms.text, dictionaryTerms.itemId] });
}

export async function insertBrand(brand: { name: string; terms: string[]; impliesItemId: string | null; source: Source; status: Status }) {
  await db
    .insert(dictionaryBrands)
    .values({ ...brand, normalizedName: normalizeName(brand.name) })
    .onConflictDoNothing({ target: dictionaryBrands.normalizedName });
}

export async function insertCode(code: { store: string; code: string; itemId: string; source: Source; status: Status; evidence?: string[]; conflict?: boolean }) {
  await db
    .insert(dictionaryCodes)
    .values({ ...code, store: storeKey(code.store) })
    .onConflictDoNothing({ target: [dictionaryCodes.store, dictionaryCodes.code, dictionaryCodes.itemId] });
}

export async function updateTerm(id: string, patch: Partial<Pick<typeof dictionaryTerms.$inferSelect, "status" | "evidence" | "conflict" | "note">>) {
  await db.update(dictionaryTerms).set({ ...patch, updatedAt: new Date() }).where(eq(dictionaryTerms.id, id));
}

export async function updateCode(id: string, patch: Partial<Pick<typeof dictionaryCodes.$inferSelect, "status" | "evidence" | "conflict">>) {
  await db.update(dictionaryCodes).set(patch).where(eq(dictionaryCodes.id, id));
}

type Kind = "item" | "term" | "brand" | "code";
const TABLES = { item: dictionaryItems, term: dictionaryTerms, brand: dictionaryBrands, code: dictionaryCodes } as const;

/** The one row of `kind` whose id starts with `prefix`, or an explanation of why not. */
export async function findByPrefix(kind: Kind, prefix: string): Promise<{ id: string } | string> {
  const table = TABLES[kind];
  const rows = await db.select({ id: table.id }).from(table).where(sql`${table.id}::text like ${prefix.toLowerCase() + "%"}`).limit(2);
  if (rows.length === 0) return `No ${kind} starts with "${prefix}".`;
  if (rows.length > 1) return `More than one ${kind} starts with "${prefix}"; use more of the id.`;
  return rows[0]!;
}

export async function setStatus(kind: Kind, id: string, status: Status) {
  const table = TABLES[kind];
  await db.update(table).set({ status }).where(eq(table.id, id));
  // Approving an item approves what was learned for it, except wordings or codes that something else also claims.
  if (kind === "item" && status === "active") {
    await db.update(dictionaryTerms).set({ status: "active", updatedAt: new Date() }).where(and(eq(dictionaryTerms.itemId, id), eq(dictionaryTerms.status, "pending"), eq(dictionaryTerms.conflict, false)));
    await db.update(dictionaryCodes).set({ status: "active" }).where(and(eq(dictionaryCodes.itemId, id), eq(dictionaryCodes.status, "pending"), eq(dictionaryCodes.conflict, false)));
  }
}


/** Where Open Food Facts answers are kept (see lookup.ts). */
export const lookupCache: LookupCache = {
  async get(codes) {
    const rows = await db.select().from(codeLookups).where(inArray(codeLookups.code, codes));
    return rows.map(
      (row): CachedLookup => ({
        code: row.code,
        found: row.found,
        lookup: row.found ? { name: row.name, brand: row.brand, categories: row.categories ? row.categories.split(",") : [] } : null,
        checkedAt: row.checkedAt,
      }),
    );
  },
  async put(rows) {
    await db
      .insert(codeLookups)
      .values(rows.map((row) => ({ code: row.code, found: row.found, name: row.lookup?.name ?? null, brand: row.lookup?.brand ?? null, categories: row.lookup?.categories.join(",") ?? null, checkedAt: row.checkedAt })))
      .onConflictDoUpdate({
        target: codeLookups.code,
        set: { found: sql`excluded.found`, name: sql`excluded.name`, brand: sql`excluded.brand`, categories: sql`excluded.categories`, checkedAt: sql`excluded.checked_at` },
      });
  },
};
