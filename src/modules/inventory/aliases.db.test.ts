// Runs against the real database (npm run test:db), using throwaway users that are deleted afterwards.
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { listAliases, listIgnoredWordings, saveAliases, updateIgnoredWordings } from "./aliases";
import { ingestPurchaseBatch } from "./ingest";

const createdUsers: string[] = [];

async function newUserWithProducts(...names: string[]) {
  const [user] = await db
    .insert(users)
    .values({ email: `alias-test-${randomUUID()}@test.local` })
    .returning();
  createdUsers.push(user.id);

  const result = await ingestPurchaseBatch(
    user.id,
    PurchaseBatchSchema.parse({
      source: "manual",
      idempotencyKey: randomUUID(),
      purchasedAt: "2026-10-01",
      items: names.map((productName) => ({ productName, quantity: 1, unit: "each" })),
    }),
  );
  const ids = result.items.map((item) => (item.result === "rejected" ? "" : item.productId));
  return { userId: user.id, ids };
}

afterAll(async () => {
  // Cascades to the users' products and aliases.
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});

describe("aliases", () => {
  it("stores and lists a user's aliases", async () => {
    const { userId, ids } = await newUserWithProducts("Whole Milk", "Eggs");
    await saveAliases(userId, [
      { alias: "gv whl mlk gl", productId: ids[0] },
      { alias: "eggs lrg", productId: ids[1] },
    ]);
    const stored = await listAliases(userId);
    expect(stored).toHaveLength(2);
    expect(stored).toContainEqual({ alias: "gv whl mlk gl", productId: ids[0] });
  });

  it("moves an alias to the product it was last confirmed for, without duplicating it", async () => {
    const { userId, ids } = await newUserWithProducts("Whole Milk", "Almond Milk");
    await saveAliases(userId, [{ alias: "milk gal", productId: ids[0] }]);
    await saveAliases(userId, [{ alias: "milk gal", productId: ids[1] }]);
    expect(await listAliases(userId)).toEqual([{ alias: "milk gal", productId: ids[1] }]);
  });

  it("keeps each user's aliases to themselves", async () => {
    const a = await newUserWithProducts("Milk");
    const b = await newUserWithProducts("Milk");
    await saveAliases(a.userId, [{ alias: "mlk", productId: a.ids[0] }]);
    await saveAliases(b.userId, [{ alias: "mlk", productId: b.ids[0] }]);
    expect(await listAliases(a.userId)).toEqual([{ alias: "mlk", productId: a.ids[0] }]);
    expect(await listAliases(b.userId)).toEqual([{ alias: "mlk", productId: b.ids[0] }]);
  });

  it("does nothing for an empty list", async () => {
    const { userId } = await newUserWithProducts("Milk");
    await saveAliases(userId, []);
    expect(await listAliases(userId)).toEqual([]);
  });
});

describe("ignored wordings", () => {
  it("remembers wordings left out, once each, and forgets ones kept later", async () => {
    const { userId } = await newUserWithProducts("Milk");
    await updateIgnoredWordings(userId, ["office chair", "gift card"], []);
    await updateIgnoredWordings(userId, ["office chair"], ["gift card"]);
    expect(await listIgnoredWordings(userId)).toEqual(["office chair"]);
  });

  it("does nothing when there is nothing to change", async () => {
    const { userId } = await newUserWithProducts("Milk");
    await updateIgnoredWordings(userId, [], []);
    expect(await listIgnoredWordings(userId)).toEqual([]);
  });
});
