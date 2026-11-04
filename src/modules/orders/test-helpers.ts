// Shared by the orders database tests: a throwaway user with a low product, a stored suggestion, PayPal and an address.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll } from "vitest";
import { PurchaseBatchSchema } from "@/core/purchase-batch";
import type { Candidate } from "@/core/pick-offer";
import { db } from "@/db/client";
import { products, users } from "@/db/schema";
import { ingestPurchaseBatch } from "@/modules/inventory/ingest";
import { listSuggestions, runRestockAndAsk, type ProductSearch, type Suggestion } from "@/modules/restock";
import { saveDeliveryAddress } from "@/modules/settings";
import { FakeFulfilment } from "./fake-fulfilment";
import { FakePayments } from "./payments";
import type { OrderDeps } from "./pipeline";
import { activatePaypal } from "./repo";

export const DAY = 24 * 60 * 60 * 1000;

export function throwawayUsers() {
  const created: string[] = [];
  afterAll(async () => {
    if (created.length) await db.delete(users).where(inArray(users.id, created));
  });
  return async function newUser() {
    const [user] = await db.insert(users).values({ email: `orders-test-${randomUUID()}@test.local` }).returning();
    created.push(user.id);
    return user.id;
  };
}

export const ADDRESS = { firstName: "Ada", lastName: "Lovelace", line1: "1 Main St", line2: "", city: "Austin", state: "TX", postalCode: "78701", phone: "5125550100" };

async function buy(userId: string, name: string, daysFromNow: number, quantity: number, unit: string) {
  const result = await ingestPurchaseBatch(
    userId,
    PurchaseBatchSchema.parse({
      source: "receipt",
      status: "approved",
      idempotencyKey: randomUUID(),
      purchasedAt: new Date(Date.now() + daysFromNow * DAY).toISOString(),
      items: [{ productName: name, quantity, unit }],
    }),
  );
  const line = result.items[0]!;
  return "productId" in line ? line.productId : "";
}

/** A listing, in the shape the search gives. */
export const listing = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "p1",
  title: "Charmin Toilet Paper 12 Rolls",
  brands: ["Charmin"],
  imageUrl: null,
  url: "https://www.walmart.com/ip/charmin-12",
  domain: "walmart.com",
  department: null,
  priceCents: 1000,
  currency: "USD",
  inStock: true,
  condition: "new",
  ...overrides,
});

export interface Scene {
  userId: string;
  productId: string;
  suggestion: Suggestion;
  payments: FakePayments;
  fulfilment: FakeFulfilment;
  deps: OrderDeps;
}

/**
 * A user who is low on Toilet Paper (12 a purchase) with a stored suggestion for a $10 12-pack,
 * who has connected PayPal and given an address. `history` is how many past purchases there are
 * (more means a more confident estimate); they were 20 days apart and the last was 18 days ago.
 */
export async function scene(newUser: () => Promise<string>, options: { paypal?: boolean; address?: boolean; history?: number; sample?: boolean } = {}): Promise<Scene> {
  const { paypal = true, address = true, history = 3, sample = false } = options;
  const userId = await newUser();
  let productId = "";
  // Bought every 20 days, the last one 18 days ago: about to run out, which is what auto-buy is for.
  for (let i = history; i >= 1; i--) productId = await buy(userId, "Toilet Paper", -(18 + 20 * (i - 1)), 12, "rolls");
  if (paypal) await activatePaypal(userId, "vault-1", "buyer@example.com");
  if (address) await saveDeliveryAddress(userId, ADDRESS);

  const search: ProductSearch = { search: async () => [listing({ ...(sample ? { sample: true } : {}) })] };
  await runRestockAndAsk(search, { userId });
  const [suggestion] = await listSuggestions(userId);
  if (!suggestion) throw new Error("the scene should have a suggestion");

  const payments = new FakePayments("sandbox");
  const fulfilment = new FakeFulfilment(true);
  return { userId, productId, suggestion, payments, fulfilment, deps: { payments, fulfilment } };
}

export const confirmProduct = (productId: string) => db.update(products).set({ confirmedAt: new Date() }).where(eq(products.id, productId));
