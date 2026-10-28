import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { inventoryCorrections, products, purchaseEvents } from "@/db/schema";

export function listProducts(userId: string) {
  return db.select().from(products).where(eq(products.userId, userId));
}

export async function getProduct(userId: string, productId: string) {
  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  return product ?? null;
}

export function listPurchaseEvents(userId: string) {
  return db
    .select()
    .from(purchaseEvents)
    .where(eq(purchaseEvents.userId, userId))
    .orderBy(desc(purchaseEvents.purchasedAt));
}

export function listProductPurchaseEvents(userId: string, productId: string) {
  return db
    .select()
    .from(purchaseEvents)
    .where(and(eq(purchaseEvents.userId, userId), eq(purchaseEvents.productId, productId)))
    .orderBy(desc(purchaseEvents.purchasedAt));
}

export function listCorrections(userId: string) {
  return db
    .select()
    .from(inventoryCorrections)
    .where(eq(inventoryCorrections.userId, userId))
    .orderBy(desc(inventoryCorrections.recordedAt));
}

export function listProductCorrections(userId: string, productId: string) {
  return db
    .select()
    .from(inventoryCorrections)
    .where(
      and(eq(inventoryCorrections.userId, userId), eq(inventoryCorrections.productId, productId)),
    )
    .orderBy(desc(inventoryCorrections.recordedAt));
}
