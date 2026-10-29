"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDemoUser } from "@/lib/demo-user";
import { mergeProducts, saveProductEdit } from "@/modules/inventory/service";
import { ProductEditSchema } from "@/modules/inventory/types";

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
  const user = await getDemoUser();

  const parsed = ProductEditSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      status: "error",
      message: "Some answers need a look.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const result = await saveProductEdit(user.id, parsed.data);
  if (result === "not-found") {
    return { status: "error", message: "That product no longer exists." };
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
  const user = await getDemoUser();
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
