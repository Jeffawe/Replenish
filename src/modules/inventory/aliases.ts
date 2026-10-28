import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { ignoredWordings, productAliases } from "@/db/schema";

export interface AliasInput {
  /** Already normalized (see normalizeProductName). */
  alias: string;
  productId: string;
}

export async function listAliases(userId: string): Promise<AliasInput[]> {
  return db
    .select({ alias: productAliases.alias, productId: productAliases.productId })
    .from(productAliases)
    .where(eq(productAliases.userId, userId));
}

/** Remembers each wording for its product. A wording seen before moves to the product it was just confirmed for. */
export async function saveAliases(userId: string, aliases: AliasInput[]): Promise<void> {
  if (aliases.length === 0) return;
  await db
    .insert(productAliases)
    .values(aliases.map(({ alias, productId }) => ({ userId, alias, productId })))
    .onConflictDoUpdate({
      target: [productAliases.userId, productAliases.alias],
      set: { productId: sql`excluded.product_id` },
    });
}

/** Wordings (normalized) the user left out of a reviewed receipt. */
export async function listIgnoredWordings(userId: string): Promise<string[]> {
  const rows = await db
    .select({ wording: ignoredWordings.wording })
    .from(ignoredWordings)
    .where(eq(ignoredWordings.userId, userId));
  return rows.map((row) => row.wording);
}

/** Remembers that these wordings were left out, and forgets the ones that were kept this time. */
export async function updateIgnoredWordings(userId: string, ignore: string[], keep: string[]): Promise<void> {
  const writes = [
    ...(ignore.length > 0
      ? [
          db
            .insert(ignoredWordings)
            .values(ignore.map((wording) => ({ userId, wording })))
            .onConflictDoNothing({ target: [ignoredWordings.userId, ignoredWordings.wording] }),
        ]
      : []),
    ...(keep.length > 0
      ? [
          db
            .delete(ignoredWordings)
            .where(and(eq(ignoredWordings.userId, userId), inArray(ignoredWordings.wording, keep))),
        ]
      : []),
  ];
  if (writes.length > 0) await db.batch(writes as [(typeof writes)[0], ...typeof writes]);
}
