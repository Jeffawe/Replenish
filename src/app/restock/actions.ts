"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { dismissSuggestion, getSuggestion, startPurchase } from "@/modules/restock";

/** The two answers to "you're low on X; we found this": "buy it for me" and "not now". */

const IdSchema = z.uuid();

export type BuyForMeResult = { status: "not-built" | "gone"; message: string };

export async function buyForMeAction(id: unknown): Promise<BuyForMeResult> {
  // Server Functions can be called directly, so identify the user and check the input here.
  const user = await requireUser();
  const parsed = IdSchema.safeParse(id);
  // The listing is read back from the database by id; nothing the browser sends decides what is bought.
  const suggestion = parsed.success ? await getSuggestion(user.id, parsed.data) : null;
  if (!suggestion) return { status: "gone", message: "That suggestion is no longer there." };
  const started = await startPurchase(user.id, suggestion);
  revalidatePath("/dashboard");
  return started;
}

export async function dismissSuggestionAction(id: unknown): Promise<{ dismissed: boolean }> {
  const user = await requireUser();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { dismissed: false };
  const dismissed = await dismissSuggestion(user.id, parsed.data);
  revalidatePath("/dashboard");
  return { dismissed };
}
