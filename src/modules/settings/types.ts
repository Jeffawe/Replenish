import { z } from "zod";
import { dollarsToCents, MIN_AUTOBUY_CONFIDENCE } from "@/core/user-settings";

// Form fields arrive as strings; a blank or missing one means "no answer".
const blankToNull = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;

const optionalNumber = (message: string) =>
  z.preprocess(blankToNull, z.coerce.number({ error: message }).nullable());

/** A dollar amount typed into a form, or blank for "no limit"; kept as dollars until the schema's last step. */
const optionalDollars = (what: string) =>
  optionalNumber("Enter an amount like 12.50").pipe(
    z.number().min(0, "Can't be negative").max(100_000, `${what} is too large`).nullable(),
  );

const FLOOR_PERCENT = Math.round(MIN_AUTOBUY_CONFIDENCE * 100);

/**
 * What the auto-buy settings form submits, turned into the fields the database stores
 * (confidence as 0.8..1, money as cents). A blank confidence or lead time means the default.
 */
export const AutobuySettingsSchema = z
  .object({
    minConfidencePercent: optionalNumber("Enter a percentage").pipe(
      z
        .number()
        .int("Use a whole percentage")
        .min(FLOOR_PERCENT, `We won't buy automatically below ${FLOOR_PERCENT}%`)
        .max(100, "100% is the most")
        .nullable(),
    ),
    minPrice: optionalDollars("That amount"),
    maxPrice: optionalDollars("That amount"),
    monthlyCap: optionalDollars("That amount"),
    leadDays: optionalNumber("Enter a number of days").pipe(
      z.number().int("Use whole days").min(0, "Can't be negative").max(60, "At most 60 days").nullable(),
    ),
  })
  .superRefine((value, ctx) => {
    if (value.minPrice !== null && value.maxPrice !== null && value.minPrice > value.maxPrice) {
      ctx.addIssue({ code: "custom", path: ["maxPrice"], message: "The most can't be less than the least" });
    }
  })
  .transform((value) => ({
    autobuyMinConfidence: (value.minConfidencePercent ?? FLOOR_PERCENT) / 100,
    autobuyMinPriceCents: value.minPrice === null ? null : dollarsToCents(value.minPrice),
    autobuyMaxPriceCents: value.maxPrice === null ? null : dollarsToCents(value.maxPrice),
    autobuyMonthlyCapCents: value.monthlyCap === null ? null : dollarsToCents(value.monthlyCap),
    autobuyLeadDays: value.leadDays ?? 3,
  }));
export type AutobuySettingsInput = z.output<typeof AutobuySettingsSchema>;

/** What the estimates form submits. Blank means "use the default". */
export const EstimateSettingsSchema = z.object({
  lowStockThresholdDays: optionalNumber("Enter a number of days").pipe(
    z.number().int("Use whole days").min(1, "At least 1 day").max(365, "At most 365 days").nullable(),
  ),
});
export type EstimateSettingsInput = z.output<typeof EstimateSettingsSchema>;
