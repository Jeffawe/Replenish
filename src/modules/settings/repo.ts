import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { products, userSettings } from "@/db/schema";
import { clampConfidence, DEFAULT_USER_SETTINGS, platformLimitsFrom, type PlatformLimits, type UserSettings } from "@/core/user-settings";
import type { AutobuySettingsInput, DeliveryAddress, EstimateSettingsInput } from "./types";

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
    preferredStores: row.preferredStores,
    skipBuyConfirm: row.skipBuyConfirm,
  };
}

export async function saveAutobuySettings(userId: string, input: Omit<AutobuySettingsInput, "preferredStores"> & { preferredStores?: string[] }): Promise<void> {
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

/** Whether "Buy for me" asks for confirmation first. */
export async function saveSkipBuyConfirm(userId: string, skip: boolean): Promise<void> {
  await db
    .insert(userSettings)
    .values({ userId, skipBuyConfirm: skip })
    .onConflictDoUpdate({ target: userSettings.userId, set: { skipBuyConfirm: skip, updatedAt: sql`now()` } });
}

/** The owner's limits on auto-buy, from the environment (see src/core/user-settings.ts). */
export function platformLimits(): PlatformLimits {
  return platformLimitsFrom({ order: process.env.AUTOBUY_MAX_ORDER, month: process.env.AUTOBUY_MAX_MONTH, buyNowOrder: process.env.BUY_NOW_MAX_ORDER, plannedUsers: process.env.PLANNED_USERS });
}

/** The user's delivery address, or null until they have filled in all of it. */
export async function getDeliveryAddress(userId: string): Promise<DeliveryAddress | null> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (!row || !row.shippingFirstName || !row.shippingLastName || !row.shippingLine1 || !row.shippingCity || !row.shippingState || !row.shippingPostalCode || !row.shippingPhone) {
    return null;
  }
  return {
    firstName: row.shippingFirstName,
    lastName: row.shippingLastName,
    line1: row.shippingLine1,
    line2: row.shippingLine2 ?? "",
    city: row.shippingCity,
    state: row.shippingState,
    postalCode: row.shippingPostalCode,
    phone: row.shippingPhone,
  };
}

export async function saveDeliveryAddress(userId: string, address: DeliveryAddress): Promise<void> {
  const columns = {
    shippingFirstName: address.firstName,
    shippingLastName: address.lastName,
    shippingLine1: address.line1,
    shippingLine2: address.line2 === "" ? null : address.line2,
    shippingCity: address.city,
    shippingState: address.state,
    shippingPostalCode: address.postalCode,
    shippingPhone: address.phone,
  };
  await db
    .insert(userSettings)
    .values({ userId, ...columns })
    .onConflictDoUpdate({ target: userSettings.userId, set: { ...columns, updatedAt: sql`now()` } });
}
