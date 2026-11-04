// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { ingestPurchaseBatch } from "@/modules/inventory/ingest";
import { correctStockCount, undoAnswer } from "./index";

const DAY = 24 * 60 * 60 * 1000;
const created: string[] = [];
afterAll(async () => {
  if (created.length) await db.delete(users).where(inArray(users.id, created));
});

async function newUser() {
  const [user] = await db.insert(users).values({ email: `correct-test-${randomUUID()}@test.local` }).returning();
  created.push(user.id);
  return user.id;
}

async function buy(userId: string, daysFromNow: number) {
  const result = await ingestPurchaseBatch(
    userId,
    PurchaseBatchSchema.parse({
      source: "receipt",
      status: "approved",
      idempotencyKey: randomUUID(),
      purchasedAt: new Date(Date.now() + daysFromNow * DAY).toISOString(),
      items: [{ productName: "Eggs", quantity: 24, unit: "each" }],
    }),
  );
  const line = result.items[0]!;
  return "productId" in line ? line.productId : "";
}

/** Used up long ago (24 every 20 days, last bought 40 days ago), so running low. */
async function lowProduct(userId: string) {
  await buy(userId, -80);
  await buy(userId, -60);
  return buy(userId, -40);
}

describe("correctStockCount", () => {
  it("recalculates: more on hand than we thought means it is no longer running low, and undo puts it back", async () => {
    const userId = await newUser();
    const productId = await lowProduct(userId);

    const saved = await correctStockCount(userId, productId, 20);
    if (saved.status !== "saved") throw new Error(`expected saved, got ${saved.status}`);
    // 20 left at about 1.2 a day is over two weeks.
    expect(saved.daysUntilRunOut).toBeGreaterThan(10);
    expect(saved.stillNeedsAttention).toBe(false);

    await undoAnswer(userId, productId, saved.undo);
    const back = await correctStockCount(userId, productId, 0);
    if (back.status !== "saved") throw new Error("expected saved");
    expect(back.stillNeedsAttention).toBe(true);
  });

  it("still needs attention when the count is small", async () => {
    const userId = await newUser();
    const productId = await lowProduct(userId);
    const saved = await correctStockCount(userId, productId, 2);
    if (saved.status !== "saved") throw new Error("expected saved");
    expect(saved.daysUntilRunOut).toBeLessThan(3);
    expect(saved.stillNeedsAttention).toBe(true);
  });

  it("asks 'are you sure?' about a number far above the usual, until told it is right", async () => {
    const userId = await newUser();
    const productId = await lowProduct(userId);
    const checked = await correctStockCount(userId, productId, 5000);
    expect(checked.status).toBe("check");
    expect((await correctStockCount(userId, productId, 5000, true)).status).toBe("saved");
  });

  it("is gone for a product that isn't the user's", async () => {
    const userId = await newUser();
    const otherId = await newUser();
    const productId = await lowProduct(otherId);
    expect(await correctStockCount(userId, productId, 3)).toEqual({ status: "gone" });
  });
});
