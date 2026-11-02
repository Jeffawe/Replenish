"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { approvePending, rejectPending, type ApproveResult } from "@/modules/inventory/pending";

/** The two answers about orders that arrived by email: "looks right" (with any corrections) and "not mine". */

const EditsSchema = z
  .array(
    z.object({
      id: z.uuid(),
      quantity: z.number().positive().max(1_000_000).optional(),
      productId: z.uuid().optional(),
    }),
  )
  .min(1)
  .max(200);

export async function approveAction(edits: unknown): Promise<ApproveResult | { approved: 0; problems: string[] }> {
  // Server Functions can be called directly, so identify the user and check the input here.
  const user = await requireUser();
  const parsed = EditsSchema.safeParse(edits);
  if (!parsed.success) return { approved: 0, problems: ["Those changes didn't look right. Please check the quantities."] };
  const result = await approvePending(user.id, parsed.data);
  revalidatePath("/dashboard");
  return result;
}

export async function rejectAction(ids: unknown): Promise<{ rejected: number }> {
  const user = await requireUser();
  const parsed = z.array(z.uuid()).min(1).max(200).safeParse(ids);
  if (!parsed.success) return { rejected: 0 };
  const result = await rejectPending(user.id, parsed.data);
  revalidatePath("/dashboard");
  return result;
}
