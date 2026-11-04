"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { refreshNextCheck } from "@/modules/inventory/next-check";
import { autoBuySetupProblem } from "@/modules/orders";
import {
  AutobuySettingsSchema,
  EstimateSettingsSchema,
  platformLimits,
  saveAutobuySettings,
  saveEstimateSettings,
  saveSkipBuyConfirm,
  setProductAutobuy,
} from "@/modules/settings";

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export type SettingsFormState = {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Changes on every successful save, so the form can show "Saved" again. */
  savedAt?: number;
};

export async function saveAutobuySettingsAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  // Server Functions can be called directly, so identify the user here too.
  const user = await requireUser();
  const parsed = AutobuySettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: "Some answers need a look.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  // Users can lower our limits, never raise them.
  const limits = platformLimits();
  const fieldErrors = {
    ...(parsed.data.autobuyMaxPriceCents !== null && parsed.data.autobuyMaxPriceCents > limits.orderCents ? { maxPrice: [`The most auto-buy can spend on one order is ${dollars(limits.orderCents)}.`] } : {}),
    ...(parsed.data.autobuyMonthlyCapCents !== null && parsed.data.autobuyMonthlyCapCents > limits.monthCents ? { monthlyCap: [`The most auto-buy can spend in a month is ${dollars(limits.monthCents)}.`] } : {}),
  };
  if (Object.keys(fieldErrors).length > 0) return { status: "error", message: "Some answers need a look.", fieldErrors };
  await saveAutobuySettings(user.id, parsed.data);
  // The lead time decides when each of the user's products next needs checking.
  await refreshNextCheck(user.id);
  revalidatePath("/settings/autobuy");
  return { status: "saved", savedAt: Date.now() };
}

export async function saveEstimateSettingsAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const user = await requireUser();
  const parsed = EstimateSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: "Some answers need a look.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  await saveEstimateSettings(user.id, parsed.data);
  // The threshold decides when each of the user's products is low.
  await refreshNextCheck(user.id);
  // The dashboard's "running low" depends on this.
  revalidatePath("/dashboard");
  revalidatePath("/settings/estimates");
  return { status: "saved", savedAt: Date.now() };
}

export type ProductSwitchResult = { status: "saved" } | { status: "error"; message: string };

/** The on/off switch beside a product in the settings list (the same value as in its Edit dialog). */
export async function setProductAutobuyAction(productId: unknown, enabled: unknown): Promise<ProductSwitchResult> {
  const user = await requireUser();
  const parsed = z.object({ productId: z.uuid(), enabled: z.boolean() }).safeParse({ productId, enabled });
  if (!parsed.success) return { status: "error", message: "That didn't work. Please try again." };

  // Switching it off is always allowed; switching it on needs PayPal and an address to buy with.
  if (parsed.data.enabled) {
    const problem = await autoBuySetupProblem(user.id);
    if (problem) return { status: "error", message: problem };
  }
  const result = await setProductAutobuy(user.id, parsed.data.productId, parsed.data.enabled);
  if (result === "not-found") return { status: "error", message: "That product no longer exists." };
  if (result === "unconfirmed") return { status: "error", message: "Confirm you keep track of this product first." };
  revalidatePath("/settings/autobuy");
  revalidatePath("/dashboard");
  return { status: "saved" };
}

/** "Don't show me this again" on Buy for me, and the switch in Settings that turns it back on. */
export async function setSkipBuyConfirmAction(skip: unknown): Promise<void> {
  const user = await requireUser();
  const parsed = z.boolean().safeParse(skip);
  if (!parsed.success) return;
  await saveSkipBuyConfirm(user.id, parsed.data);
  revalidatePath("/dashboard");
  revalidatePath("/settings/payment");
}
