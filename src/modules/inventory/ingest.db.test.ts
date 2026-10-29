// Runs against the real database (npm run test:db), using throwaway users that
// are deleted afterwards. The retry and race guarantees live in database
// constraints, so they can only be proven against a real database.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { PurchaseBatchSchema, type PurchaseBatchInput } from "@/core/purchase-batch";
import { db } from "@/db/client";
import { products, purchaseEvents, users } from "@/db/schema";
import { ingestPurchaseBatch, listProductSummaries, listPurchasesNear } from "./ingest";

const createdUsers: string[] = [];

async function newUser() {
  const [user] = await db
    .insert(users)
    .values({ email: `ingest-test-${randomUUID()}@test.local` })
    .returning();
  createdUsers.push(user.id);
  return user.id;
}

afterAll(async () => {
  // Cascades to the users' products and purchases.
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});

const toilet = { productName: "Charmin Toilet Paper", quantity: 12, unit: "rolls", priceCents: 1299 };
const milk = { productName: "Milk", quantity: 1, unit: "gallon", priceCents: 499 };

const batch = (overrides: Partial<PurchaseBatchInput> = {}) =>
  PurchaseBatchSchema.parse({
    source: "receipt",
    idempotencyKey: randomUUID(),
    store: "Walmart",
    purchasedAt: "2026-10-01",
    items: [toilet],
    ...overrides,
  });

const productsOf = (userId: string) => db.select().from(products).where(eq(products.userId, userId));
const eventsOf = (userId: string) =>
  db.select().from(purchaseEvents).where(eq(purchaseEvents.userId, userId));

describe("ingestPurchaseBatch: products", () => {
  it("creates the product from the line and stores the purchase", async () => {
    const userId = await newUser();
    const result = await ingestPurchaseBatch(
      userId,
      batch({ items: [{ ...toilet, brand: "Charmin, Cottonelle,charmin", category: "Household" }] }),
    );

    expect(result.status).toBe("processed");
    expect(result.items[0]).toMatchObject({ index: 0, result: "created", productCreated: true });

    const [product] = await productsOf(userId);
    expect(product).toMatchObject({
      name: "Charmin Toilet Paper",
      normalizedName: "charmin toilet paper",
      unit: "rolls",
      normalPurchaseQty: 12,
      brand: "Charmin, Cottonelle",
      category: "Household",
    });

    const [event] = await eventsOf(userId);
    expect(event).toMatchObject({
      productId: product.id,
      source: "receipt",
      quantity: 12,
      unit: "rolls",
      priceCents: 1299,
      currency: "USD",
      store: "Walmart",
      lineIndex: 0,
    });
    expect(event.purchasedAt).toEqual(new Date("2026-10-01"));
  });

  it("applies later purchases to the same product instead of creating another", async () => {
    const userId = await newUser();
    const first = await ingestPurchaseBatch(userId, batch());
    const second = await ingestPurchaseBatch(
      userId,
      batch({ items: [{ ...toilet, productName: "  CHARMIN   toilet paper " }], purchasedAt: new Date("2026-10-20") }),
    );

    expect(second.items[0]).toMatchObject({ result: "created", productCreated: false });
    expect(second.items[0]).toMatchObject({ productId: (first.items[0] as { productId: string }).productId });
    expect(await productsOf(userId)).toHaveLength(1);
    expect(await eventsOf(userId)).toHaveLength(2);
  });

  it("uses the sender's productId over the name", async () => {
    const userId = await newUser();
    const first = await ingestPurchaseBatch(userId, batch());
    const productId = (first.items[0] as { productId: string }).productId;

    const result = await ingestPurchaseBatch(
      userId,
      batch({ items: [{ ...toilet, productName: "CHRMN ULTRA 12CT", productId }] }),
    );
    expect(result.items[0]).toMatchObject({ result: "created", productId, productCreated: false });
    expect(await productsOf(userId)).toHaveLength(1);
  });

  it("rejects an unknown productId, and one that belongs to another user", async () => {
    const owner = await newUser();
    const other = await newUser();
    const owned = await ingestPurchaseBatch(owner, batch());
    const ownersProductId = (owned.items[0] as { productId: string }).productId;

    for (const productId of [randomUUID(), ownersProductId]) {
      const result = await ingestPurchaseBatch(other, batch({ items: [{ ...toilet, productId }] }));
      expect(result.status).toBe("rejected");
      expect(result.items[0]).toMatchObject({ result: "rejected" });
    }
    expect(await productsOf(other)).toHaveLength(0);
    expect(await eventsOf(other)).toHaveLength(0);
  });

  it("creates one product when a receipt lists the same new item twice", async () => {
    const userId = await newUser();
    const result = await ingestPurchaseBatch(userId, batch({ items: [milk, milk] }));

    expect(result.items.map((i) => i.result)).toEqual(["created", "created"]);
    expect(result.items[0]).toMatchObject({ productCreated: true });
    expect(result.items[1]).toMatchObject({ productCreated: false });
    expect(await productsOf(userId)).toHaveLength(1);
    expect(await eventsOf(userId)).toHaveLength(2);
  });
});

describe("ingestPurchaseBatch: units and rejections", () => {
  it("rejects a unit mismatch but still stores the other lines", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch());

    const result = await ingestPurchaseBatch(
      userId,
      batch({ items: [{ ...toilet, unit: "packs" }, milk] }),
    );
    expect(result.status).toBe("processed");
    expect(result.items[0]).toMatchObject({ index: 0, result: "rejected" });
    expect(result.items[1]).toMatchObject({ index: 1, result: "created" });
    expect((await eventsOf(userId)).filter((e) => e.quantity === 12)).toHaveLength(1);
  });

  it("treats singular and plural units as the same", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch());
    const result = await ingestPurchaseBatch(userId, batch({ items: [{ ...toilet, unit: "Roll" }] }));
    expect(result.items[0]).toMatchObject({ result: "created" });
    // Stored under the product's own spelling.
    expect((await eventsOf(userId)).every((e) => e.unit === "rolls")).toBe(true);
  });

  it("reports a batch with nothing storable as rejected and creates nothing", async () => {
    const userId = await newUser();
    const result = await ingestPurchaseBatch(userId, batch({ items: [{ ...toilet, productId: randomUUID() }] }));
    expect(result.status).toBe("rejected");
    expect(await productsOf(userId)).toHaveLength(0);
  });
});

describe("ingestPurchaseBatch: retries", () => {
  it("stores nothing twice when the same submission is retried", async () => {
    const userId = await newUser();
    const submission = batch({ items: [toilet, milk] });

    const first = await ingestPurchaseBatch(userId, submission);
    const retry = await ingestPurchaseBatch(userId, submission);

    expect(first.status).toBe("processed");
    expect(retry.status).toBe("duplicate");
    expect(retry.items.map((i) => i.result)).toEqual(["duplicate", "duplicate"]);
    // The retry points at the rows the first attempt made.
    expect(retry.items.map((i) => (i as { purchaseEventId: string }).purchaseEventId)).toEqual(
      first.items.map((i) => (i as { purchaseEventId: string }).purchaseEventId),
    );
    expect(await eventsOf(userId)).toHaveLength(2);
    expect(await productsOf(userId)).toHaveLength(2);
  });

  it("keeps a rejected line rejected on retry while the rest stay duplicates", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch());
    const submission = batch({ items: [{ ...toilet, unit: "packs" }, milk] });

    await ingestPurchaseBatch(userId, submission);
    const retry = await ingestPurchaseBatch(userId, submission);
    expect(retry.items.map((i) => i.result)).toEqual(["rejected", "duplicate"]);
    expect(await eventsOf(userId)).toHaveLength(2);
  });

  it("stores each line once when two identical submissions arrive at the same time", async () => {
    const userId = await newUser();
    const submission = batch({ items: [toilet, milk] });

    const [a, b] = await Promise.all([
      ingestPurchaseBatch(userId, submission),
      ingestPurchaseBatch(userId, submission),
    ]);

    expect(await eventsOf(userId)).toHaveLength(2);
    expect(await productsOf(userId)).toHaveLength(2);
    // Between them, each line was created exactly once.
    const created = [...a.items, ...b.items].filter((i) => i.result === "created");
    expect(created).toHaveLength(2);
  });

  it("stores two different submissions with identical content, since spotting those is the sender's job", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch());
    const second = await ingestPurchaseBatch(userId, batch());
    expect(second.status).toBe("processed");
    expect(await eventsOf(userId)).toHaveLength(2);
  });

  it("keeps idempotency keys separate per user", async () => {
    const a = await newUser();
    const b = await newUser();
    const submission = batch();
    expect((await ingestPurchaseBatch(a, submission)).status).toBe("processed");
    expect((await ingestPurchaseBatch(b, submission)).status).toBe("processed");
  });
});

describe("listProductSummaries", () => {
  it("lists only this user's products, by name, with what a sender needs to match", async () => {
    const mine = await newUser();
    const theirs = await newUser();
    await ingestPurchaseBatch(mine, batch({ items: [{ ...toilet, brand: "Charmin", category: "Household" }, milk] }));
    await ingestPurchaseBatch(theirs, batch({ items: [{ ...toilet, productName: "Someone Else's Item" }] }));

    const list = await listProductSummaries(mine);
    expect(list.map((p) => p.name)).toEqual(["Charmin Toilet Paper", "Milk"]);
    expect(list[0]).toEqual({
      id: expect.any(String),
      name: "Charmin Toilet Paper",
      brand: "Charmin",
      category: "Household",
      unit: "rolls",
      normalPurchaseQty: 12,
      matchByName: true,
    });
  });

  it("returns ids a sender can send back as productId", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch());
    const [product] = await listProductSummaries(userId);

    const result = await ingestPurchaseBatch(
      userId,
      batch({ items: [{ ...toilet, productName: "CHRMN ULTRA 12CT", productId: product.id }] }),
    );
    expect(result.items[0]).toMatchObject({ result: "created", productId: product.id, productCreated: false });
    expect(await productsOf(userId)).toHaveLength(1);
  });
});

describe("listPurchasesNear", () => {
  it("returns this user's purchases within a day either side, with what a sender compares", async () => {
    const mine = await newUser();
    const theirs = await newUser();
    const submission = batch({ idempotencyKey: "near-test-0001", purchasedAt: new Date("2026-10-10T12:00:00Z") });
    await ingestPurchaseBatch(mine, submission);
    await ingestPurchaseBatch(theirs, batch({ purchasedAt: new Date("2026-10-10T12:00:00Z") }));

    const near = await listPurchasesNear(mine, new Date("2026-10-10T00:00:00Z"));
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ store: "Walmart", quantity: 12, idempotencyKey: "near-test-0001" });
    expect(near[0].productId).toEqual(expect.any(String));

    expect(await listPurchasesNear(mine, new Date("2026-10-13T00:00:00Z"))).toHaveLength(0);
  });
});

describe("ingestPurchaseBatch: brands", () => {
  it("stores each purchase's brand and adds new ones to the product", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch({ items: [{ ...milk, brand: "Great Value" }] }));
    await ingestPurchaseBatch(userId, batch({ items: [{ ...milk, brand: "Horizon" }, { ...milk, brand: "great value" }] }));

    const [product] = await productsOf(userId);
    expect(product.brand).toBe("Great Value, Horizon");
    const events = await eventsOf(userId);
    expect(events.map((e) => e.brand).sort()).toEqual(["Great Value", "Horizon", "great value"]);
  });

  it("leaves the product's brands alone for a purchase with none", async () => {
    const userId = await newUser();
    await ingestPurchaseBatch(userId, batch({ items: [{ ...milk, brand: "Great Value" }] }));
    await ingestPurchaseBatch(userId, batch({ items: [milk] }));
    const [product] = await productsOf(userId);
    expect(product.brand).toBe("Great Value");
    expect((await eventsOf(userId)).some((e) => e.brand === null)).toBe(true);
  });
});

describe("ingestPurchaseBatch: saving the same receipt again", () => {
  const eggs = { productName: "Eggs", quantity: 12, unit: "each" };

  it("stores only a line left out the first time, going by the receipt's own line numbers", async () => {
    const userId = await newUser();
    const key = randomUUID();
    // First time: lines 0 (toilet paper) and 2 (milk) of the receipt were ticked; eggs (line 1) was left out.
    await ingestPurchaseBatch(userId, batch({ idempotencyKey: key, items: [{ ...toilet, line: 0 }, { ...milk, line: 2 }] }));
    // Second time the user ticks the eggs too.
    const again = await ingestPurchaseBatch(
      userId,
      batch({ idempotencyKey: key, items: [{ ...toilet, line: 0 }, { ...eggs, line: 1 }, { ...milk, line: 2 }] }),
    );

    expect(again.items.map((item) => item.result)).toEqual(["duplicate", "created", "duplicate"]);
    const lines = (await eventsOf(userId)).map((e) => e.lineIndex).sort();
    expect(lines).toEqual([0, 1, 2]);
  });

  it("rejects a batch that gives two lines the same number", () => {
    expect(() => batch({ items: [{ ...toilet, line: 3 }, { ...milk, line: 3 }] })).toThrow();
  });
});
