import { z } from "zod";

export const InventoryCorrectionInputSchema = z.object({
  productId: z.uuid(),
  remainingQuantity: z.number().nonnegative(),
  estimatedAtTime: z.number().nonnegative().optional(),
  note: z.string().optional(),
});
export type InventoryCorrectionInput = z.infer<typeof InventoryCorrectionInputSchema>;

/**
 * Brands are stored as one comma-separated string for now (v1). Splits,
 * trims, drops blanks and case-insensitive duplicates, and rejoins.
 */
export function normalizeBrands(value: string | null): string | null {
  if (value === null) return null;
  const seen = new Set<string>();
  const brands: string[] = [];
  for (const part of value.split(",")) {
    const brand = part.trim().replace(/\s+/g, " ");
    const key = brand.toLowerCase();
    if (brand && !seen.has(key)) {
      seen.add(key);
      brands.push(brand);
    }
  }
  return brands.length > 0 ? brands.join(", ") : null;
}

// Form fields arrive as strings; a blank or missing one means "no answer".
const blankToNull = (value: unknown) =>
  value === undefined || (typeof value === "string" && value.trim() === "") ? null : value;

const optionalNumber = (message: string) =>
  z.preprocess(blankToNull, z.coerce.number({ error: message }).nullable());

/**
 * What the edit form submits: the product's basic details, plus optional
 * answers to the "help us estimate better" questions. Blank answers become
 * null: for stored settings that clears them, for `remainingNow` it means
 * the user did not give a count.
 */
export const ProductEditSchema = z.object({
  productId: z.uuid(),
  name: z.string().trim().min(1, "Give it a name").max(200, "That is too long"),
  /** Sent as "true"/"false" by a hidden field, so a form without the switch on show keeps the setting. */
  matchByName: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  unit: z.string().trim().min(1, "Enter a unit, like rolls or bottles").max(40),
  category: z.preprocess(blankToNull, z.string().trim().max(60).nullable()),
  brand: z
    .preprocess(blankToNull, z.string().max(200, "That is too long").nullable())
    .transform(normalizeBrands),
  remainingNow: optionalNumber("Enter a number").pipe(
    z.number().min(0, "Can't be negative").max(1_000_000).nullable(),
  ),
  fallbackDaysPerPurchase: optionalNumber("Enter a number of days").pipe(
    z.number().int("Use whole days").min(1, "At least 1 day").max(3650).nullable(),
  ),
  typicalLeftoverAtPurchase: optionalNumber("Enter a number").pipe(
    z.number().min(0, "Can't be negative").max(1_000_000).nullable(),
  ),
  lowStockThresholdDays: optionalNumber("Enter a number of days").pipe(
    z.number().int("Use whole days").min(1, "At least 1 day").max(365).nullable(),
  ),
});
export type ProductEdit = z.output<typeof ProductEditSchema>;
