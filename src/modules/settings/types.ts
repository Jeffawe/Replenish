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

/** The most stores a user can list. */
export const MAX_PREFERRED_STORES = 8;

/** The ranked store list, sent by the form as JSON: tidied, with repeats dropped. */
const PreferredStores = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value ?? [];
    try {
      return value.trim() === "" ? [] : JSON.parse(value);
    } catch {
      return [];
    }
  },
  z
    .array(z.string().trim().min(1).max(60))
    .max(MAX_PREFERRED_STORES, `At most ${MAX_PREFERRED_STORES} stores`)
    .transform((stores) => [...new Map(stores.map((store) => [store.toLowerCase(), store])).values()]),
);

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
    preferredStores: PreferredStores,
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
    preferredStores: value.preferredStores,
  }));
export type AutobuySettingsInput = z.output<typeof AutobuySettingsSchema>;

/** What the estimates form submits. Blank means "use the default". */
export const EstimateSettingsSchema = z.object({
  lowStockThresholdDays: optionalNumber("Enter a number of days").pipe(
    z.number().int("Use whole days").min(1, "At least 1 day").max(365, "At most 365 days").nullable(),
  ),
});
export type EstimateSettingsInput = z.output<typeof EstimateSettingsSchema>;

const requiredText = (what: string, max: number) =>
  z.string({ error: `${what} is required` }).trim().min(1, `${what} is required`).max(max, `${what} is too long`);

/**
 * Where orders are delivered (US addresses only for now). What the Zinc order needs: a name, a
 * street address, and a phone number the carrier can call.
 */
export const DeliveryAddressSchema = z
  .object({
    firstName: requiredText("First name", 50),
    lastName: requiredText("Last name", 50),
    line1: requiredText("Street address", 100),
    line2: z.string().trim().max(100, "That's too long").optional().default(""),
    city: requiredText("City", 60),
    state: z
      .string({ error: "State is required" })
      .trim()
      .regex(/^[A-Za-z]{2}$/, "Use the two-letter state, like CA")
      .transform((value) => value.toUpperCase()),
    postalCode: z
      .string({ error: "ZIP code is required" })
      .trim()
      .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code"),
    phone: z
      .string({ error: "Phone number is required" })
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().regex(/^1?\d{10}$/, "Use a 10-digit US phone number"))
      .transform((digits) => digits.slice(-10)),
  });

export type DeliveryAddress = z.output<typeof DeliveryAddressSchema>;
export type DeliveryAddressInput = z.input<typeof DeliveryAddressSchema>;
