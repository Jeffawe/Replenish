"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { refreshNextCheck } from "@/modules/inventory/next-check";
import {
  AutobuySettingsSchema,
  EstimateSettingsSchema,
  saveAutobuySettings,
  saveEstimateSettings,
  setProductAutobuy,
} from "@/modules/settings";

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

  const result = await setProductAutobuy(user.id, parsed.data.productId, parsed.data.enabled);
  if (result === "not-found") return { status: "error", message: "That product no longer exists." };
  if (result === "unconfirmed") return { status: "error", message: "Confirm you keep track of this product first." };
  revalidatePath("/settings/autobuy");
  revalidatePath("/dashboard");
  return { status: "saved" };
}
