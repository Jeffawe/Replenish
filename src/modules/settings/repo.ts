import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { products, userSettings } from "@/db/schema";
import { clampConfidence, DEFAULT_USER_SETTINGS, type UserSettings } from "@/core/user-settings";
import type { AutobuySettingsInput, EstimateSettingsInput } from "./types";

/** The user's settings; anything they have never changed is the default. */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (!row) return DEFAULT_USER_SETTINGS;
  return {
    autobuyMinConfidence: clampConfidence(row.autobuyMinConfidence),
    autobuyMinPriceCents: row.autobuyMinPriceCents,
    autobuyMaxPriceCents: row.autobuyMaxPriceCents,
    autobuyMonthlyCapCents: row.autobuyMonthlyCapCents,
    autobuyLeadDays: row.autobuyLeadDays,
    lowStockThresholdDays: row.lowStockThresholdDays,
  };
}

export async function saveAutobuySettings(userId: string, input: AutobuySettingsInput): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, ...input })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...input, updatedAt: sql`now()` } });
}

export async function saveEstimateSettings(userId: string, input: EstimateSettingsInput): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, ...input })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...input, updatedAt: sql`now()` } });
}

/**
 * Turns auto-buy on or off for one product. It can only go on for a product the
 * user has confirmed they track (a receipt's guess isn't enough to spend money on).
 */
export async function setProductAutobuy(
  userId: string,
  productId: string,
  enabled: boolean,
): Promise<"saved" | "not-found" | "unconfirmed"> {
  const [product] = await db
    .select({ confirmedAt: products.confirmedAt })
    .from(products)
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  if (!product) return "not-found";
  if (enabled && product.confirmedAt === null) return "unconfirmed";
  await db
    .update(products)
    .set({ autobuyEnabled: enabled })
    .where(and(eq(products.id, productId), eq(products.userId, userId)));
  return "saved";
}
