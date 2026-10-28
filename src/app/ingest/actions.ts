"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDemoUser } from "@/lib/demo-user";
import {
  ExtractionError,
  extractPurchases,
  learnFromReview,
  recordConfirmedSample,
  submitBatch,
  type RunOutcome,
} from "@/modules/ingestion";

/**
 * The two actions the UI uses for every user-driven source, however many
 * there are: ask a producer to read some input into a draft, then submit the
 * draft once the user has reviewed it. Neither knows anything about receipts
 * or any other particular source.
 */

export type ExtractActionOutcome =
  | RunOutcome
  /** The producer couldn't do its job (a service is down or not set up). `message` is safe to show. */
  | { ok: false; error: "failed"; message: string };

/** `source` picks the producer; the form's fields are its raw input. Stores nothing. */
export async function extractAction(source: string, formData: FormData): Promise<ExtractActionOutcome> {
  // Server Functions can be called directly, so identify the user here.
  const user = await getDemoUser();
  try {
    return await extractPurchases(source, Object.fromEntries(formData), user.id);
  } catch (error) {
    if (error instanceof ExtractionError) return { ok: false, error: "failed", message: error.message };
    console.error(`Extracting "${source}" failed`, error);
    return { ok: false, error: "failed", message: "Something went wrong reading that. Please try again." };
  }
}

const ReviewSchema = z.object({
  sources: z.array(z.string().max(200).nullable()).max(200),
  skipped: z.array(z.string().max(200)).max(200),
});

/**
 * Stores a (reviewed) batch. `review`, when given, says how the input worded
 * each submitted line (parallel to the batch's items) and which lines the user
 * left out, so both can be remembered for next time.
 */
export async function submitAction(batch: unknown, review?: { sources: (string | null)[]; skipped: string[] }) {
  const user = await getDemoUser();
  const outcome = await submitBatch(user.id, batch);
  if (!outcome.ok) return outcome;

  const lessons = ReviewSchema.safeParse(review);
  if (lessons.success) {
    try {
      await learnFromReview(user.id, lessons.data, outcome.result);
    } catch (error) {
      // The purchases are stored; failing to remember the lessons must not look like a failed save.
      console.error("Couldn't save what the review taught us", error);
    }
  }
  await recordConfirmedSample(batch, review, outcome.result);
  if (outcome.result.status === "processed") revalidatePath("/dashboard");
  return outcome;
}
