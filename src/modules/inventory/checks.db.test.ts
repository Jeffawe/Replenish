// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { inventoryCorrections, products, users } from "@/db/schema";
import { listIgnoredWordings, saveAliases } from "./aliases";
import { archiveProduct, confirmProduct, listSnoozed, restoreProduct, saveUsageAnswers, snoozeQuestion } from "./checks";
import { ingestPurchaseBatch, listProductSummaries } from "./ingest";
import { getInventory, recordStockCount, undoStockCount } from "./service";

const createdUsers: string[] = [];
afterAll(async () => {
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});

/** A user with one product, Eggs, created by a receipt. */
async function setup() {
  const [user] = await db.insert(users).values({ email: `checks-test-${randomUUID()}@test.local` }).returning();
  createdUsers.push(user.id);
  const buy = (day: string) =>
    ingestPurchaseBatch(
      user.id,
      PurchaseBatchSchema.parse({
        source: "receipt",
        idempotencyKey: randomUUID(),
        purchasedAt: day,
        items: [{ productName: "Eggs", quantity: 12, unit: "each" }],
      }),
    );
  const result = await buy("2026-10-01");
  const productId = result.items[0]!.result === "created" ? result.items[0]!.productId : "";
  const product = async () => (await db.select().from(products).where(eq(products.id, productId)))[0]!;
  return { userId: user.id, productId, buy, product };
}

describe("product checks", () => {
  it("starts a product from a receipt unchecked, and confirming it checks it", async () => {
    const { userId, productId, product } = await setup();
    expect((await product()).confirmedAt).toBeNull();
    await confirmProduct(userId, productId);
    expect((await product()).confirmedAt).not.toBeNull();
  });

  it("hides a product the user doesn't want, and unticks its wordings next time", async () => {
    const { userId, productId } = await setup();
    await saveAliases(userId, [{ alias: "lg brn eggs", productId }]);
    await archiveProduct(userId, productId);

    expect(await listProductSummaries(userId)).toEqual([]);
    expect((await getInventory(userId)).map((item) => item.product.id)).not.toContain(productId);
    expect((await listIgnoredWordings(userId)).sort()).toEqual(["eggs", "lg brn eggs"]);
  });

  it("can take back hiding a product", async () => {
    const { userId, productId } = await setup();
    await archiveProduct(userId, productId);
    await restoreProduct(userId, productId);
    expect((await listProductSummaries(userId)).map((p) => p.id)).toEqual([productId]);
    expect(await listIgnoredWordings(userId)).toEqual([]);
  });

  it("brings a hidden product back when it is bought again", async () => {
    const { userId, productId, buy, product } = await setup();
    await archiveProduct(userId, productId);
    await buy("2026-10-10");
    expect((await product()).archivedAt).toBeNull();
  });

  it("saves only the usage answers given", async () => {
    const { userId, productId, product } = await setup();
    await saveUsageAnswers(userId, productId, { fallbackDaysPerPurchase: 14 });
    await saveUsageAnswers(userId, productId, { typicalLeftoverAtPurchase: 2 });
    expect(await product()).toMatchObject({ fallbackDaysPerPurchase: 14, typicalLeftoverAtPurchase: 2 });
  });

  it("records a stock count with our guess at the time, and can take it back", async () => {
    const { userId, productId } = await setup();
    await saveUsageAnswers(userId, productId, { fallbackDaysPerPurchase: 14 });
    const recorded = await recordStockCount(userId, productId, 4);
    if (recorded === "not-found") throw new Error("product not found");

    const [row] = await db.select().from(inventoryCorrections).where(eq(inventoryCorrections.id, recorded.correctionId));
    expect(row).toMatchObject({ remainingQuantity: 4 });
    expect(row!.estimatedAtTime).not.toBeNull();

    await undoStockCount(userId, recorded.correctionId);
    expect(await db.select().from(inventoryCorrections).where(eq(inventoryCorrections.productId, productId))).toEqual([]);
  });

  it("keeps a snoozed question quiet until its time, and a second snooze moves it", async () => {
    const { userId, productId } = await setup();
    const now = new Date("2026-10-20T12:00:00Z");
    await snoozeQuestion(userId, productId, "stock-now", new Date("2026-10-27T12:00:00Z"));
    expect(await listSnoozed(userId, now)).toEqual(new Set([`${productId}:stock-now`]));
    expect(await listSnoozed(userId, new Date("2026-10-28T12:00:00Z"))).toEqual(new Set());

    await snoozeQuestion(userId, productId, "stock-now", new Date("2026-11-30T12:00:00Z"));
    expect(await listSnoozed(userId, new Date("2026-11-01T12:00:00Z"))).toEqual(new Set([`${productId}:stock-now`]));
  });
});
