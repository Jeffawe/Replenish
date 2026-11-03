// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { archiveProduct } from "@/modules/inventory/checks";
import { getInventory } from "@/modules/inventory/service";
import { runLowStockCheck, sweepNextChecks } from "./check";
import { DAY, lowProduct, stockedProduct, throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

const daysUntilCheck = async (productId: string) => {
  const at = (await db.select().from(products).where(eq(products.id, productId)))[0]!.nextCheckAt;
  return at === null ? null : (at.getTime() - Date.now()) / DAY;
};

describe("the low-stock check", () => {
  it("lists a low product with its full estimate, and not one that isn't due", async () => {
    const userId = await newUser();
    const healthy = await stockedProduct(userId, "Eggs");
    const low = await lowProduct(userId, "Milk");

    const check = await runLowStockCheck({ userId });
    expect(check.errors).toEqual([]);
    expect(check.checked).toBe(1);
    expect(check.low.map((entry) => entry.product.id)).toEqual([low]);

    const [entry] = check.low;
    expect(entry!.userId).toBe(userId);
    expect(entry!.estimate).toMatchObject({ isLow: true, estimatedRemaining: 0, rateSource: "history" });
    expect(entry!.estimate.consumptionPerDay).toBeCloseTo(1.2, 1);
    expect(check.low.map((e) => e.product.id)).not.toContain(healthy);
  });

  it("agrees with the dashboard's own estimate for the same product", async () => {
    const userId = await newUser();
    await lowProduct(userId, "Milk");
    const now = new Date();
    const [item] = await getInventory(userId, now);
    const check = await runLowStockCheck({ userId, now });
    expect(check.low[0]!.estimate).toEqual(item!.estimate);
  });

  it("moves the date of a due product that turns out not to be low yet, and then skips it", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    await db.update(products).set({ nextCheckAt: new Date(Date.now() - DAY) }).where(eq(products.id, productId));

    const first = await runLowStockCheck({ userId });
    expect(first.checked).toBe(1);
    expect(first.low).toEqual([]);
    expect(await daysUntilCheck(productId)).toBeCloseTo(13, 0);

    expect((await runLowStockCheck({ userId })).checked).toBe(0);
  });

  it("keeps listing a low product until something handles it", async () => {
    const userId = await newUser();
    const productId = await lowProduct(userId, "Milk");
    expect((await runLowStockCheck({ userId })).low.map((e) => e.product.id)).toEqual([productId]);
    expect((await runLowStockCheck({ userId })).low.map((e) => e.product.id)).toEqual([productId]);
  });

  it("leaves out hidden products and other users' products", async () => {
    const userId = await newUser();
    const otherId = await newUser();
    await archiveProduct(userId, await lowProduct(userId, "Milk"));
    const theirs = await lowProduct(otherId, "Milk");

    expect((await runLowStockCheck({ userId })).low).toEqual([]);
    expect((await runLowStockCheck({ userId: otherId })).low.map((e) => e.product.id)).toEqual([theirs]);
  });

  it("stops at its limit and says there is more", async () => {
    const userId = await newUser();
    for (const name of ["Milk", "Eggs", "Rice"]) await lowProduct(userId, name);
    const check = await runLowStockCheck({ userId }, 2);
    expect(check.checked).toBe(2);
    expect(check.moreDue).toBe(true);
    expect((await runLowStockCheck({ userId }, 3)).moreDue).toBe(false);
  });
});

describe("the sweep", () => {
  it("fills in dates that are missing, like for products from before dates existed", async () => {
    const userId = await newUser();
    const productId = await stockedProduct(userId);
    await db.update(products).set({ nextCheckAt: null }).where(eq(products.id, productId));

    const swept = await sweepNextChecks({ userId });
    expect(swept).toMatchObject({ users: 1, products: 1, errors: [] });
    expect(await daysUntilCheck(productId)).toBeCloseTo(13, 0);
  });
});
