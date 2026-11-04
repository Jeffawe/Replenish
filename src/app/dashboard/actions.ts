"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { mergeProducts, saveProductEdit } from "@/modules/inventory/service";
import { autoBuySetupProblem } from "@/modules/orders";
import { ProductEditSchema } from "@/modules/inventory/types";
import { platformLimits } from "@/modules/settings";

export type EditProductState = {
  status: "idle" | "saved" | "error";
  message?: string;
  fieldErrors?: Partial<Record<string, string[]>>;
  /** Changes on every successful save so the form can reset itself. */
  savedAt?: number;
};

export async function editProductAction(
  _previous: EditProductState,
  formData: FormData,
): Promise<EditProductState> {
  // Server Functions can be called directly, so identify the user here too.
  const user = await requireUser();

  const parsed = ProductEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Some answers need a look.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  // A product's own limit can be lower than ours, never higher.
  const most = platformLimits().orderCents;
  if (parsed.data.autobuyMaxPriceCents !== null && parsed.data.autobuyMaxPriceCents > most) {
    return { status: "error", message: "Some answers need a look.", fieldErrors: { autobuyMaxPrice: [`The most auto-buy can spend on one order is $${(most / 100).toFixed(2)}.`] } };
  }

  // Switching auto-buy on needs PayPal and an address to buy with; only look when the form asks for it.
  const setupProblem = parsed.data.autobuyEnabled ? await autoBuySetupProblem(user.id) : null;
  const result = await saveProductEdit(user.id, parsed.data, { canEnableAutobuy: setupProblem === null });
  if (result === "not-found") {
    return { status: "error", message: "That product no longer exists." };
  }
  if (result === "autobuy-blocked") {
    return { status: "error", message: `${setupProblem} Nothing was saved.` };
  }
  if (typeof result === "object") {
    return {
      status: "error",
      message: "Some answers need a look.",
      fieldErrors: { name: [`You already have "${result.nameTakenBy}". If they're the same thing, merge them below instead.`] },
    };
  }

  revalidatePath("/dashboard");
  return { status: "saved", savedAt: Date.now() };
}

export type MergeProductsState = { status: "idle" | "error"; message?: string };

/** Merges one product into another (see mergeProducts). On success the merged product is gone, so its dialog closes with it. */
export async function mergeProductsAction(fromId: unknown, intoId: unknown): Promise<MergeProductsState> {
  const user = await requireUser();
  const ids = z.object({ fromId: z.uuid(), intoId: z.uuid() }).safeParse({ fromId, intoId });
  if (!ids.success) return { status: "error", message: "Choose a product to merge into." };

  const result = await mergeProducts(user.id, ids.data.fromId, ids.data.intoId);
  if (result === "not-found") return { status: "error", message: "One of those products no longer exists." };
  if (result === "same") return { status: "error", message: "Choose a different product." };
  if (typeof result === "object") {
    return { status: "error", message: `They're counted differently (${result.unitsDiffer[0]} and ${result.unitsDiffer[1]}), so they can't be merged.` };
  }
  revalidatePath("/dashboard");
  return { status: "idle" };
}
