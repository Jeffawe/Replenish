// Shared by the restock database tests: throwaway users with purchase histories.
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll } from "vitest";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ingestPurchaseBatch } from "@/modules/inventory/ingest";

export const DAY = 24 * 60 * 60 * 1000;

/** Call once at the top of a test file: deletes the users it made when the file is done. */
export function throwawayUsers() {
  const created: string[] = [];
  afterAll(async () => {
    if (created.length) await db.delete(users).where(inArray(users.id, created));
  });
  return async function newUser() {
    const [user] = await db.insert(users).values({ email: `restock-test-${randomUUID()}@test.local` }).returning();
    created.push(user.id);
    return user.id;
  };
}

/** Buys `quantity` of a product `daysFromNow` days from now (negative = in the past). */
export async function buy(userId: string, name: string, daysFromNow: number, quantity: number, extra: { unit?: string; brand?: string; store?: string } = {}) {
  const result = await ingestPurchaseBatch(
    userId,
    PurchaseBatchSchema.parse({
      source: "receipt",
      status: "approved",
      idempotencyKey: randomUUID(),
      purchasedAt: new Date(Date.now() + daysFromNow * DAY).toISOString(),
      ...(extra.store ? { store: extra.store } : {}),
      items: [{ productName: name, quantity, unit: extra.unit ?? "each", ...(extra.brand ? { brand: extra.brand } : {}) }],
    }),
  );
  const line = result.items[0]!;
  return "productId" in line ? line.productId : "";
}

/** Three purchases of `quantity`, twenty days apart, the last one 40 days ago: used up long ago, so low. */
export async function lowProduct(userId: string, name = "Milk", extra: Parameters<typeof buy>[4] = {}, quantity = 24) {
  await buy(userId, name, -80, quantity, extra);
  await buy(userId, name, -60, quantity, extra);
  return buy(userId, name, -40, quantity, extra);
}

/** Three purchases twenty days apart, the last one just now: about 20 days left, not low. */
export async function stockedProduct(userId: string, name = "Eggs") {
  await buy(userId, name, -40, 24);
  await buy(userId, name, -20, 24);
  return buy(userId, name, 0, 24);
}
