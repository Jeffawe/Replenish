// Recreates the demo user's products and history. Dates are relative to today.
// Run with: npm run db:seed
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import {
  inventoryCorrections,
  products,
  purchaseEvents,
  users,
  type NewPurchaseEventRow,
} from "../src/db/schema";
import { normalizeProductName } from "../src/core/product-name";

const DEMO_USER_EMAIL = "demo@replenish.local";
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

interface SeedPurchase {
  daysAgo: number;
  quantity: number;
  priceCents: number;
  store: string;
  source?: "receipt" | "email" | "manual";
}

interface SeedProduct {
  name: string;
  brand: string;
  category: string;
  unit: string;
  normalPurchaseQty: number;
  fallbackDaysPerPurchase?: number;
  typicalLeftoverAtPurchase?: number;
  purchases: SeedPurchase[];
  corrections?: { daysAgo: number; remaining: number; estimatedAtTime?: number }[];
}

const seed: SeedProduct[] = [
  {
    // Steady 28-day cycle, last bought 19 days ago: the worked example from the doc.
    name: "Toilet Paper",
    brand: "Charmin",
    category: "Household",
    unit: "rolls",
    normalPurchaseQty: 12,
    typicalLeftoverAtPurchase: 2,
    purchases: [
      { daysAgo: 131, quantity: 12, priceCents: 1299, store: "Walmart" },
      { daysAgo: 103, quantity: 12, priceCents: 1349, store: "Target" },
      { daysAgo: 75, quantity: 12, priceCents: 1299, store: "Walmart", source: "email" },
      { daysAgo: 47, quantity: 12, priceCents: 1429, store: "Amazon", source: "email" },
      { daysAgo: 19, quantity: 12, priceCents: 1299, store: "Walmart" },
    ],
  },
  {
    // Weekly buyer, 5 days since the last gallon: low, and confident.
    name: "Milk",
    brand: "Great Value",
    category: "Groceries",
    unit: "gallon",
    normalPurchaseQty: 1,
    typicalLeftoverAtPurchase: 0,
    purchases: [
      { daysAgo: 40, quantity: 1, priceCents: 499, store: "Walmart" },
      { daysAgo: 34, quantity: 1, priceCents: 499, store: "Walmart" },
      { daysAgo: 26, quantity: 1, priceCents: 479, store: "Walmart" },
      { daysAgo: 20, quantity: 1, priceCents: 499, store: "Walmart" },
      { daysAgo: 12, quantity: 1, priceCents: 499, store: "Walmart" },
      { daysAgo: 5, quantity: 1, priceCents: 519, store: "Walmart" },
    ],
  },
  {
    // Three purchases and one stock count from the user.
    name: "Laundry Detergent",
    brand: "Tide",
    category: "Household",
    unit: "bottle",
    normalPurchaseQty: 1,
    purchases: [
      { daysAgo: 120, quantity: 1, priceCents: 1999, store: "Target" },
      { daysAgo: 75, quantity: 1, priceCents: 1999, store: "Target", source: "email" },
      { daysAgo: 30, quantity: 1, priceCents: 1899, store: "Walmart" },
    ],
    corrections: [{ daysAgo: 6, remaining: 0.5, estimatedAtTime: 0.55 }],
  },
  {
    // One purchase, so the rate comes from the "lasts about 30 days" fallback.
    name: "Paper Towels",
    brand: "Bounty",
    category: "Household",
    unit: "rolls",
    normalPurchaseQty: 8,
    fallbackDaysPerPurchase: 30,
    purchases: [{ daysAgo: 10, quantity: 8, priceCents: 1599, store: "Amazon", source: "email" }],
  },
  {
    // Irregular buying (14, 42, 14 day gaps): low confidence, wide range.
    name: "Dish Soap",
    brand: "Dawn",
    category: "Household",
    unit: "bottle",
    normalPurchaseQty: 1,
    purchases: [
      { daysAgo: 73, quantity: 1, priceCents: 449, store: "Target" },
      { daysAgo: 59, quantity: 1, priceCents: 449, store: "Target" },
      { daysAgo: 17, quantity: 1, priceCents: 479, store: "Walmart" },
      { daysAgo: 3, quantity: 1, priceCents: 449, store: "Target", source: "manual" },
    ],
  },
  {
    // One purchase and no fallback: not enough to predict anything.
    name: "Coffee",
    brand: "Lavazza",
    category: "Groceries",
    unit: "bag",
    normalPurchaseQty: 1,
    purchases: [{ daysAgo: 6, quantity: 1, priceCents: 1299, store: "Amazon", source: "email" }],
  },
];

async function main() {
  await db
    .insert(users)
    .values({ email: DEMO_USER_EMAIL, name: "Demo User" })
    .onConflictDoNothing({ target: users.email });
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_USER_EMAIL));

  // Cascades to the demo user's purchase events and corrections.
  await db.delete(products).where(eq(products.userId, user.id));

  for (const item of seed) {
    const [product] = await db
      .insert(products)
      .values({
        userId: user.id,
        name: item.name,
        normalizedName: normalizeProductName(item.name),
        brand: item.brand,
        category: item.category,
        unit: item.unit,
        normalPurchaseQty: item.normalPurchaseQty,
        fallbackDaysPerPurchase: item.fallbackDaysPerPurchase ?? null,
        typicalLeftoverAtPurchase: item.typicalLeftoverAtPurchase ?? null,
      })
      .returning({ id: products.id });

    const events: NewPurchaseEventRow[] = item.purchases.map((p) => ({
      userId: user.id,
      productId: product.id,
      source: p.source ?? "receipt",
      quantity: p.quantity,
      unit: item.unit,
      priceCents: p.priceCents,
      store: p.store,
      purchasedAt: daysAgo(p.daysAgo),
    }));
    await db.insert(purchaseEvents).values(events);

    if (item.corrections?.length) {
      await db.insert(inventoryCorrections).values(
        item.corrections.map((c) => ({
          userId: user.id,
          productId: product.id,
          remainingQuantity: c.remaining,
          estimatedAtTime: c.estimatedAtTime ?? null,
          recordedAt: daysAgo(c.daysAgo),
        })),
      );
    }
  }

  console.log(`Seeded ${seed.length} products for ${DEMO_USER_EMAIL}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
