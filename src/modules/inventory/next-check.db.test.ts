// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { products, users } from "@/db/schema";
import { saveAutobuySettings, saveEstimateSettings } from "@/modules/settings";
import { archiveProduct } from "./checks";
import { ingestPurchaseBatch } from "./ingest";
import { refreshNextCheck } from "./next-check";
import { recordStockCount, undoStockCount } from "./service";

const DAY = 24 * 60 * 60 * 1000;
const createdUsers: string[] = [];
afterAll(async () => {
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});

async function newUser() {
  const [user] = await db.insert(users).values({ email: `next-check-test-${randomUUID()}@test.local` }).returning();
  createdUsers.push(user.id);
  return user.id;
}

/** Buys `quantity` of a product `daysFromNow` days from now (negative = in the past; ahead is an order still on its way, which the receiver only takes as pending). */
async function buy(userId: string, name: string, daysFromNow: number, quantity: number) {
  const result = await ingestPurchaseBatch(
    userId,
    PurchaseBatchSchema.parse({
      source: daysFromNow > 0 ? "email" : "receipt",
      status: daysFromNow > 0 ? "pending" : "approved",
      idempotencyKey: randomUUID(),
      purchasedAt: new Date(Date.now() + daysFromNow * DAY).toISOString(),
      items: [{ productName: name, quantity, unit: "each" }],
    }),
  );
  const line = result.items[0]!;
  return "productId" in line ? line.productId : "";
}

/** Three purchases of 24 twenty days apart: used at 1.2 a day, with 24 bought just now, so about 20 days from running out. */
async function stockedProduct(userId: string, name = "Eggs") {
  await buy(userId, name, -40, 24);
  await buy(userId, name, -20, 24);
  return buy(userId, name, 0, 24);
}

const checkAt = async (productId: string) => (await db.select().from(products).where(eq(products.id, productId)))[0]!.nextCheckAt;
/** Days from now until the product's check date. */
const daysUntilCheck = async (productId: string) => {
  const at = await checkAt(productId);
  return at === null ? null : (at.getTime() - Date.now()) / DAY;
};

describe("when a product is next checked", () => {
  it("is set when a purchase is saved: about 20 days left, low at 7, so in 13 days", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    expect(await daysUntilCheck(productId)).toBeCloseTo(13, 0);
  });

  it("is empty while there isn't enough to predict from", async () => {
    const userId = await newUser();
    const productId = await buy(userId, "Rice", -3, 5);
    expect(await checkAt(productId)).toBeNull();
  });

  it("moves when a stock count says there is much less, and back when it is undone", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    const counted = await recordStockCount(userId, productId, 2);
    if (counted === "not-found") throw new Error("product vanished");
    // 2 left at 1.2 a day is under 2 days: already inside the window, so due right now.
    expect(await daysUntilCheck(productId)).toBeLessThan(0.01);

    await undoStockCount(userId, counted.correctionId);
    expect(await daysUntilCheck(productId)).toBeCloseTo(13, 0);
  });

  it("is cleared when the product is hidden", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    await archiveProduct(userId, productId);
    expect(await checkAt(productId)).toBeNull();
  });

  it("is the arrival date when an order is on its way and lands before the product gets low", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    await buy(userId, "Eggs", 5, 24);
    expect(await daysUntilCheck(productId)).toBeCloseTo(5, 0);
  });

  it("moves with the user's settings: a longer lead time looks further ahead", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    await saveAutobuySettings(userId, { autobuyMinConfidence: 0.8, autobuyMinPriceCents: null, autobuyMaxPriceCents: null, autobuyMonthlyCapCents: null, autobuyLeadDays: 15 });
    await refreshNextCheck(userId);
    expect(await daysUntilCheck(productId)).toBeCloseTo(5, 0);

    await saveEstimateSettings(userId, { lowStockThresholdDays: 18 });
    await refreshNextCheck(userId);
    expect(await daysUntilCheck(productId)).toBeCloseTo(2, 0);
  });
});
