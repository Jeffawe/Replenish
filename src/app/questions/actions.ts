"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDemoUser } from "@/lib/demo-user";
import { answerQuestion, snoozeQuestion, undoAnswer, type AnswerOutcome } from "@/modules/questions";

/** The questions' three actions: answer one, take an answer back, and "not now". Each refreshes the dashboard. */

const Kind = z.enum(["track", "recheck", "stock-now", "lasts-for", "leftover"]);

const AnswerSchema = z.object({
  productId: z.uuid(),
  kind: Kind,
  choice: z.string().max(40),
  number: z.number().min(0).max(1_000_000).optional(),
  sure: z.boolean().optional(),
});

const UndoSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("stock-count"), correctionId: z.uuid() }),
  z.object({
    type: z.literal("usage"),
    fallbackDaysPerPurchase: z.number().int().min(1).max(3650).nullable().optional(),
    typicalLeftoverAtPurchase: z.number().min(0).max(1_000_000).nullable().optional(),
  }),
  z.object({ type: z.literal("confirm") }),
  z.object({ type: z.literal("archive") }),
]);

export async function answerAction(answer: unknown): Promise<AnswerOutcome | { status: "invalid" }> {
  // Server Functions can be called directly, so identify the user and check the input here.
  const user = await getDemoUser();
  const parsed = AnswerSchema.safeParse(answer);
  if (!parsed.success) return { status: "invalid" };
  const outcome = await answerQuestion(user.id, parsed.data);
  if (outcome.status === "saved") revalidatePath("/dashboard");
  return outcome;
}

export async function undoAction(productId: unknown, undo: unknown): Promise<void> {
  const user = await getDemoUser();
  const id = z.uuid().safeParse(productId);
  const parsed = UndoSchema.safeParse(undo);
  if (!id.success || !parsed.success) return;
  await undoAnswer(user.id, id.data, parsed.data);
  revalidatePath("/dashboard");
}

export async function snoozeAction(productId: unknown, kind: unknown): Promise<void> {
  const user = await getDemoUser();
  const id = z.uuid().safeParse(productId);
  const parsedKind = Kind.safeParse(kind);
  if (!id.success || !parsedKind.success) return;
  await snoozeQuestion(user.id, id.data, parsedKind.data);
  revalidatePath("/dashboard");
}
