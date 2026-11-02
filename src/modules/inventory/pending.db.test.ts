// Runs against the real database (npm run test:db), using throwaway users that are deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PurchaseBatchSchema, type PurchaseBatchInput } from "@/core/purchase-batch";
import { PENDING_DAYS } from "@/core/pending";
import { db } from "@/db/client";
import { products, purchaseEvents, rejectedLines, users } from "@/db/schema";
import { ingestPurchaseBatch } from "./ingest";
import { approvePending, isProductConfirmed, listPendingPurchases, listUnconfirmedProductIds, rejectPending } from "./pending";

const createdUsers: string[] = [];

async function newUser() {
  const [user] = await db.insert(users).values({ email: `pending-test-${randomUUID()}@test.local` }).returning();
  createdUsers.push(user.id);
  return user.id;
}

afterAll(async () => {
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const order = (items: PurchaseBatchInput["items"], overrides: Partial<PurchaseBatchInput> = {}) =>
  PurchaseBatchSchema.parse({
    source: "email",
    idempotencyKey: `order-${randomUUID()}`,
    store: "Amazon",
    purchasedAt: inDays(2),
    status: "pending",
    items,
    ...overrides,
  });
const milk = { productName: "Milk", quantity: 1, unit: "gallon" };
const soap = { productName: "Dish Soap", quantity: 2, unit: "bottles" };

const productsOf = (userId: string) => db.select().from(products).where(eq(products.userId, userId));
const eventsOf = (userId: string) => db.select().from(purchaseEvents).where(eq(purchaseEvents.userId, userId));

async function userWithMilk() {
  const userId = await newUser();
  await ingestPurchaseBatch(userId, order([milk], { status: "approved", purchasedAt: new Date("2026-10-01") }));
  return userId;
}

describe("pending purchases: storing", () => {
  it("gives a line for a product the user already had a time limit", async () => {
    const userId = await userWithMilk();
    await ingestPurchaseBatch(userId, order([milk]));
    const [pending] = (await eventsOf(userId)).filter((e) => e.status === "pending");
    const days = (pending.pendingUntil!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(PENDING_DAYS - 0.1);
    expect(days).toBeLessThanOrEqual(PENDING_DAYS);
  });

  it("gives a line that made a product no limit", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([soap]));
    const [pending] = await eventsOf(userId);
    expect(pending).toMatchObject({ status: "pending", pendingUntil: null });
  });

  it("stores approved batches as approved with no deadline", async () => {
    const userId = await userWithMilk();
    expect((await eventsOf(userId))[0]).toMatchObject({ status: "approved", pendingUntil: null });
  });
});

describe("pending purchases: yes", () => {
  it("approves a line and makes the product confirmed", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([soap]));
    const [product] = await productsOf(userId);
    expect(await isProductConfirmed(userId, product.id)).toBe(false);

    const [asked] = await listPendingPurchases(userId);
    expect(asked).toMatchObject({ productName: "Dish Soap", madeProduct: true });

    expect(await approvePending(userId, [{ id: asked.id }])).toMatchObject({ approved: 1, problems: [] });
    expect(await isProductConfirmed(userId, product.id)).toBe(true);
    expect(await listPendingPurchases(userId)).toHaveLength(0);
    expect((await eventsOf(userId))[0]).toMatchObject({ status: "approved", pendingUntil: null });
  });

  it("applies a corrected quantity", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([{ ...soap, quantity: 96 }]));
    const [asked] = await listPendingPurchases(userId);
    await approvePending(userId, [{ id: asked.id, quantity: 6 }]);
    expect((await eventsOf(userId))[0].quantity).toBe(6);
  });

  it("moves a line to another product and drops the product it made", async () => {
    const userId = await userWithMilk();
    await ingestPurchaseBatch(userId, order([{ productName: "Oat Milk", quantity: 1, unit: "gallon" }]));
    const [asked] = await listPendingPurchases(userId);
    const milkProduct = (await productsOf(userId)).find((p) => p.name === "Milk")!;

    expect(await approvePending(userId, [{ id: asked.id, productId: milkProduct.id }])).toMatchObject({ approved: 1 });
    expect((await productsOf(userId)).map((p) => p.name)).toEqual(["Milk"]);
    expect((await eventsOf(userId)).every((e) => e.productId === milkProduct.id)).toBe(true);
  });

  it("won't move a line to a product counted in another unit", async () => {
    const userId = await userWithMilk();
    await ingestPurchaseBatch(userId, order([soap]));
    const [asked] = await listPendingPurchases(userId);
    const milkProduct = (await productsOf(userId)).find((p) => p.name === "Milk")!;

    const result = await approvePending(userId, [{ id: asked.id, productId: milkProduct.id }]);
    expect(result.approved).toBe(0);
    expect(result.problems[0]).toMatch(/gallon/);
    expect(await listPendingPurchases(userId)).toHaveLength(1);
  });

  it("refuses a quantity that isn't positive", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([soap]));
    const [asked] = await listPendingPurchases(userId);
    expect((await approvePending(userId, [{ id: asked.id, quantity: 0 }])).approved).toBe(0);
  });

  it("can't answer for someone else's purchase", async () => {
    const owner = await newUser();
    const other = await newUser();
    await ingestPurchaseBatch(owner, order([soap]));
    const [asked] = await listPendingPurchases(owner);
    expect((await approvePending(other, [{ id: asked.id }])).approved).toBe(0);
    expect((await rejectPending(other, [asked.id])).rejected).toBe(0);
    expect(await eventsOf(owner)).toHaveLength(1);
  });
});

describe("pending purchases: no", () => {
  it("deletes a line for a product the user already had and keeps the product", async () => {
    const userId = await userWithMilk();
    await ingestPurchaseBatch(userId, order([milk]));
    const [asked] = await listPendingPurchases(userId);
    expect(asked.madeProduct).toBe(false);

    expect(await rejectPending(userId, [asked.id])).toEqual({ rejected: 1 });
    expect(await productsOf(userId)).toHaveLength(1);
    expect(await eventsOf(userId)).toHaveLength(1);
  });

  it("deletes a product that only the rejected line made", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([soap]));
    const [asked] = await listPendingPurchases(userId);
    await rejectPending(userId, [asked.id]);
    expect(await productsOf(userId)).toHaveLength(0);
    expect(await eventsOf(userId)).toHaveLength(0);
  });

  it("keeps a product that has other purchases", async () => {
    const userId = await newUser();
    const first = order([soap]);
    await ingestPurchaseBatch(userId, first);
    const [asked] = await listPendingPurchases(userId);
    await approvePending(userId, [{ id: asked.id }]);
    // A later pending line for it matches the product, so it carries a time limit.
    await ingestPurchaseBatch(userId, order([soap]));
    const [second] = await listPendingPurchases(userId);
    await rejectPending(userId, [second.id]);
    expect(await productsOf(userId)).toHaveLength(1);
  });

  it("doesn't bring the line back when the same order arrives again", async () => {
    const userId = await newUser();
    const same = order([soap, { productName: "Sponges", quantity: 3, unit: "packs" }]);
    await ingestPurchaseBatch(userId, same);
    const asked = await listPendingPurchases(userId);
    const soapLine = asked.find((p) => p.productName === "Dish Soap")!;
    await rejectPending(userId, [soapLine.id]);

    const again = await ingestPurchaseBatch(userId, same);
    expect(again.items.find((i) => i.index === 0)).toMatchObject({ result: "rejected", reason: "You rejected this order earlier" });
    expect(again.items.find((i) => i.index === 1)?.result).toBe("duplicate");
    expect((await productsOf(userId)).map((p) => p.name)).toEqual(["Sponges"]);
    expect(await db.select().from(rejectedLines).where(eq(rejectedLines.userId, userId))).toHaveLength(1);
  });
});

describe("pending purchases: time limit", () => {
  it("stops asking about a limited line once its date has passed", async () => {
    const userId = await userWithMilk();
    await ingestPurchaseBatch(userId, order([milk]));
    expect(await listPendingPurchases(userId)).toHaveLength(1);
    const later = new Date(Date.now() + (PENDING_DAYS + 1) * 86_400_000);
    expect(await listPendingPurchases(userId, later)).toHaveLength(0);
  });
});

describe("pending purchases: questions", () => {
  it("lists a product an unanswered order made, and stops once it is approved", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([soap]));
    const [product] = await productsOf(userId);
    expect((await listUnconfirmedProductIds(userId)).has(product.id)).toBe(true);

    const [asked] = await listPendingPurchases(userId);
    await approvePending(userId, [{ id: asked.id }]);
    expect((await listUnconfirmedProductIds(userId)).has(product.id)).toBe(false);
  });

  it("counts approving a new product as keeping it, so 'keep tracking?' isn't asked again", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, order([soap]));
    expect((await productsOf(userId))[0].confirmedAt).toBeNull();
    const [asked] = await listPendingPurchases(userId);
    await approvePending(userId, [{ id: asked.id }]);
    expect((await productsOf(userId))[0].confirmedAt).not.toBeNull();
  });

  it("doesn't list a product that only had a limited pending line", async () => {
    const userId = await userWithMilk();
    await ingestPurchaseBatch(userId, order([milk]));
    expect((await listUnconfirmedProductIds(userId)).size).toBe(0);
  });
});
