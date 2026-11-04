"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { correctStockCount, undoAnswer, type CorrectionOutcome } from "@/modules/questions";
import { checkStockCount } from "@/core/plausibility";
import { submitBatch } from "@/modules/ingestion";
import { getProduct } from "@/modules/inventory/repo";
import { buyNow, MOST_PACKS, orderDepsFromEnv, FulfilmentError, PaymentError, type RefusalReason } from "@/modules/orders";
import { snoozeSuggestion } from "@/modules/restock";

/** The answers to "you're low on X; we found this": "buy it for me", "I just bought this", "not now", and "that's not right" (a correction). */

const IdSchema = z.uuid();

export type BuyForMeResult =
  | { status: "started" }
  /** Couldn't start. `fix` says where to go to put it right, when the user can. */
  | { status: "refused"; message: string; fix: "settings" | null };

const NEEDS_SETTINGS: RefusalReason[] = ["no-paypal", "reconnect-paypal", "no-address"];

const BuySchema = z.object({ id: z.uuid(), option: z.number().int().min(0).max(10), packs: z.number().int().min(1).max(MOST_PACKS) });

/** "Buy for me": buys one of the suggestion's listings. The listing is read back from the database by its position in the suggestion; the browser only ever picks from what we stored, and the price is ours. */
export async function buyForMeAction(input: unknown): Promise<BuyForMeResult> {
  // Server Functions can be called directly, so identify the user and check the input here.
  const user = await requireUser();
  const parsed = BuySchema.safeParse(input);
  if (!parsed.success) return { status: "refused", message: `Choose between 1 and ${MOST_PACKS} packs.`, fix: null };
  try {
    const outcome = await buyNow(user.id, parsed.data.id, orderDepsFromEnv(), { option: parsed.data.option, packs: parsed.data.packs });
    revalidatePath("/dashboard");
    revalidatePath("/orders");
    if (outcome.status === "started") return { status: "started" };
    return { status: "refused", message: outcome.message, fix: NEEDS_SETTINGS.includes(outcome.reason) ? "settings" : null };
  } catch (error) {
    // PayPal or Zinc aren't set up on this server.
    if (error instanceof PaymentError || error instanceof FulfilmentError) return { status: "refused", message: "Buying isn't set up on this server yet.", fix: null };
    throw error;
  }
}

/** "Not now": it comes back in a few days if the product is still low. */
export async function snoozeSuggestionAction(id: unknown): Promise<{ snoozed: boolean }> {
  const user = await requireUser();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { snoozed: false };
  const snoozed = await snoozeSuggestion(user.id, parsed.data);
  revalidatePath("/dashboard");
  return { snoozed };
}

const BoughtSchema = z.object({
  productId: z.uuid(),
  quantity: z.number().positive().max(1_000_000),
  /** Made when the dialog opened, so pressing Save twice can't record it twice. */
  key: z.uuid(),
  sure: z.boolean().optional(),
});

export type BoughtItOutcome = { status: "saved" } | { status: "check"; message: string } | { status: "invalid"; message: string };

/**
 * "I just bought this": a purchase the user made themselves, today, recorded like any other purchase
 * (the receiver works out the rest, and the suggestion goes away once the product has stock). A
 * surprising amount gets an "are you sure?", as a stock count does.
 */
export async function boughtItAction(input: unknown): Promise<BoughtItOutcome> {
  const user = await requireUser();
  const parsed = BoughtSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid", message: "Enter how much you bought." };
  const product = await getProduct(user.id, parsed.data.productId);
  if (!product) return { status: "invalid", message: "We can't find that product any more." };
  if (!parsed.data.sure) {
    const message = checkStockCount(parsed.data.quantity, { unit: product.unit, normalPurchaseQty: product.normalPurchaseQty, estimatedRemaining: null });
    if (message) return { status: "check", message };
  }
  const outcome = await submitBatch(user.id, {
    source: "manual",
    idempotencyKey: `bought-${parsed.data.key}`,
    purchasedAt: new Date(),
    items: [{ productId: product.id, productName: product.name, quantity: parsed.data.quantity, unit: product.unit }],
  });
  if (!outcome.ok || outcome.result.status === "rejected") return { status: "invalid", message: "We couldn't save that. Please try again." };
  revalidatePath("/dashboard");
  return { status: "saved" };
}

const CorrectionSchema = z.object({
  productId: z.uuid(),
  remaining: z.number().min(0).max(1_000_000),
  sure: z.boolean().optional(),
});

/**
 * "That's not right: I actually have this much." Records a stock count, which makes the estimate
 * for that product work itself out again; the result says what it is now. It doesn't refresh the
 * page: the dialog shows the result first, and refreshes the list when it closes.
 */
export async function correctStockAction(input: unknown): Promise<CorrectionOutcome | { status: "invalid" }> {
  const user = await requireUser();
  const parsed = CorrectionSchema.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  return correctStockCount(user.id, parsed.data.productId, parsed.data.remaining, parsed.data.sure);
}

/**
 * Takes back a correction made from the dialog. Like the correction itself it doesn't refresh the
 * page (a refresh could reorder the suggestions and reset the open dialog); the dialog refreshes
 * the list when it closes.
 */
export async function undoCorrectionAction(productId: unknown, correctionId: unknown): Promise<void> {
  const user = await requireUser();
  const ids = z.object({ productId: z.uuid(), correctionId: z.uuid() }).safeParse({ productId, correctionId });
  if (!ids.success) return;
  await undoAnswer(user.id, ids.data.productId, { type: "stock-count", correctionId: ids.data.correctionId });
}
