import { z } from "zod";
import { PurchaseBatchSchema, type PurchaseBatchInput } from "@/core/purchase-batch";
import type { Draft } from "./types";

/**
 * Checks a draft the browser sends back (to add a second photo to it). It is
 * the user's own draft, but a server action can be called with anything.
 * The batch is checked, not rewritten, so it stays exactly as it was sent.
 */
export const DraftSchema: z.ZodType<Draft> = z.object({
  batch: z.custom<PurchaseBatchInput>((value) => PurchaseBatchSchema.safeParse(value).success),
  warnings: z
    .array(z.object({ code: z.string().max(60), message: z.string().max(1000), lineIndex: z.number().int().min(0).optional() }))
    .max(200),
  lines: z
    .array(
      z.object({
        sourceText: z.string().max(300),
        matchedBy: z.enum(["code", "name", "alias", "similar"]).nullable(),
        code: z.string().regex(/^\d{3,14}$/).optional(),
        excludeReason: z.string().max(300).optional(),
      }),
    )
    .max(200)
    .optional(),
  sourceText: z.string().max(100_000).optional(),
  totals: z
    .object({
      subtotalCents: z.number().int().nullable(),
      totalCents: z.number().int().nullable(),
      discountsCents: z.number().int(),
    })
    .optional(),
});
