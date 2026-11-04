// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_USER_SETTINGS } from "@/core/user-settings";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { products, users } from "@/db/schema";
import { confirmProduct } from "@/modules/inventory/checks";
import { ingestPurchaseBatch } from "@/modules/inventory/ingest";
import { getInventory } from "@/modules/inventory/service";
import { AutobuySettingsSchema } from "./types";
import { getUserSettings, saveAutobuySettings, saveEstimateSettings, setProductAutobuy } from "./repo";

const createdUsers: string[] = [];
afterAll(async () => {
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});

async function newUser() {
  const [user] = await db.insert(users).values({ email: `settings-test-${randomUUID()}@test.local` }).returning();
  createdUsers.push(user.id);
  return user.id;
}

/** A product with enough history to have an estimate: 12 eggs every 10 days. */
async function userWithEggs() {
  const userId = await newUser();
  let productId = "";
  for (const day of ["2026-09-01", "2026-09-11", "2026-09-21", "2026-10-01"]) {
    const result = await ingestPurchaseBatch(
      userId,
      PurchaseBatchSchema.parse({ source: "receipt", idempotencyKey: randomUUID(), purchasedAt: day, items: [{ productName: "Eggs", quantity: 12, unit: "each" }] }),
    );
    const line = result.items[0]!;
    if (line.result === "created") productId = line.productId;
  }
  return { userId, productId };
}

describe("user settings", () => {
  it("are the defaults until the user changes something", async () => {
    expect(await getUserSettings(await newUser())).toEqual(DEFAULT_USER_SETTINGS);
  });

  it("save the auto-buy form and read it back", async () => {
    const userId = await newUser();
    await saveAutobuySettings(
      userId,
      AutobuySettingsSchema.parse({ minConfidencePercent: "90", minPrice: "2", maxPrice: "12.50", monthlyCap: "150", leadDays: "5" }),
    );
    expect(await getUserSettings(userId)).toEqual({
      autobuyMinConfidence: 0.9,
      autobuyMinPriceCents: 200,
      autobuyMaxPriceCents: 1250,
      autobuyMonthlyCapCents: 15000,
      autobuyLeadDays: 5,
      lowStockThresholdDays: null,
      preferredStores: [],
      skipBuyConfirm: false,
    });
  });

  it("keep the two tabs separate: saving one doesn't touch the other", async () => {
    const userId = await newUser();
    await saveAutobuySettings(userId, AutobuySettingsSchema.parse({ minConfidencePercent: "95" }));
    await saveEstimateSettings(userId, { lowStockThresholdDays: 12 });
    expect(await getUserSettings(userId)).toMatchObject({ autobuyMinConfidence: 0.95, lowStockThresholdDays: 12 });

    await saveAutobuySettings(userId, AutobuySettingsSchema.parse({ minConfidencePercent: "85" }));
    expect(await getUserSettings(userId)).toMatchObject({ autobuyMinConfidence: 0.85, lowStockThresholdDays: 12 });
  });
});

describe("the low-stock threshold setting", () => {
  it("decides when a product counts as low", async () => {
    const { userId, productId } = await userWithEggs();
    // A day after the last purchase of 12 (used at 1.2 a day) it is about 9 days from running out:
    // not low at the default of 7 days, low at 365.
    const now = new Date("2026-10-02T12:00:00Z");
    const before = (await getInventory(userId, now)).find((item) => item.product.id === productId)!;
    expect(before.estimate.lowStockThresholdDays).toBe(7);
    expect(before.estimate.isLow).toBe(false);

    await saveEstimateSettings(userId, { lowStockThresholdDays: 365 });
    const after = (await getInventory(userId, now)).find((item) => item.product.id === productId)!;
    expect(after.estimate.lowStockThresholdDays).toBe(365);
    expect(after.estimate.isLow).toBe(true);
  });
});

describe("setProductAutobuy", () => {
  it("won't switch on an unconfirmed product, but will once it is confirmed, and can switch off", async () => {
    const { userId, productId } = await userWithEggs();
    const enabled = async () => (await db.select().from(products).where(eq(products.id, productId)))[0]!.autobuyEnabled;

    expect(await setProductAutobuy(userId, productId, true)).toBe("unconfirmed");
    expect(await enabled()).toBe(false);

    await confirmProduct(userId, productId);
    expect(await setProductAutobuy(userId, productId, true)).toBe("saved");
    expect(await enabled()).toBe(true);
    expect(await setProductAutobuy(userId, productId, false)).toBe("saved");
    expect(await enabled()).toBe(false);
  });

  it("only touches the user's own products", async () => {
    const { productId } = await userWithEggs();
    expect(await setProductAutobuy(await newUser(), productId, false)).toBe("not-found");
  });
});
