"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCredentials, requireUser, verifyWithLimit } from "@/modules/auth";
import { disconnectPaypal, paymentsFromEnv } from "@/modules/orders";
import { DeliveryAddressSchema, getDeliveryAddress, saveDeliveryAddress } from "@/modules/settings";
import type { SettingsFormState } from "../actions";

export async function disconnectPaypalAction(): Promise<void> {
  const user = await requireUser();
  let payments = null;
  try {
    payments = paymentsFromEnv();
  } catch {
    // Not configured: there is nothing at PayPal to forget from here.
  }
  await disconnectPaypal(user.id, payments);
  revalidatePath("/settings/payment");
  redirect("/settings/payment?paypal=disconnected");
}

export async function saveDeliveryAddressAction(_previous: SettingsFormState, formData: FormData): Promise<SettingsFormState> {
  const user = await requireUser();
  const parsed = DeliveryAddressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { status: "error", message: "Some answers need a look.", fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }
  // The address decides where things we charge for are sent, so a stolen session or a borrowed phone
  // mustn't be enough to change it. Filling it in for the first time needs nothing extra.
  const saved = await getDeliveryAddress(user.id);
  if (saved && JSON.stringify(saved) !== JSON.stringify({ ...saved, ...parsed.data })) {
    const password = String(formData.get("currentPassword") ?? "").slice(0, 1000);
    const verdict = await verifyWithLimit(user.email, async () => (await checkCredentials(user.email, password)) !== null);
    if (verdict !== "ok") {
      const message = verdict === "locked" ? "Too many tries. Please wait 15 minutes and try again." : "That isn't your password.";
      return { status: "error", message, fieldErrors: { currentPassword: [message] } };
    }
  }
  await saveDeliveryAddress(user.id, parsed.data);
  revalidatePath("/settings/payment");
  return { status: "saved", savedAt: Date.now() };
}
