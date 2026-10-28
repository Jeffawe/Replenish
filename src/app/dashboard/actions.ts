"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDemoUser } from "@/lib/demo-user";
import { saveProductEdit } from "@/modules/inventory/service";
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

  revalidatePath("/dashboard");
  return { status: "saved", savedAt: Date.now() };
}
