import { z } from "zod";

/**
 * The one format every ingestion method (receipt, email, manual, a future
 * retailer API...) sends us. A batch is one receipt or order: a single store
 * and date with one or more lines. Senders do the clever work (reading
 * receipts, matching messy names); the receiver only validates, matches each
 * line to a product, and stores it.
 */

const text = (max: number) => z.string().trim().min(1).max(max);
const DAY_MS = 24 * 60 * 60 * 1000;

export const PurchaseLineSchema = z.object({
  /** Name as the sender has it. Matched to a product ignoring case and spacing. */
  productName: text(200),
  /** If the sender already knows which product this is, name it here. Wins over the name. */
  productId: z.uuid().optional(),
  /** The brand bought this time. Stored on the purchase and added to the product's brands. */
  brand: text(200).optional(),
  /** Only used when the line creates a new product. */
  category: text(60).optional(),
  /** Total units acquired: 2 packs of 12 rolls is 24, not 2. */
  quantity: z.number().positive().max(1_000_000),
  /** The unit the quantity is in. Must match the product's unit if it exists. */
  unit: text(40),
  /** Price paid for the line, in the smallest currency unit. */
  priceCents: z.number().int().nonnegative().optional(),
  /**
   * The line's own number in the source (its row on the receipt), when the
   * sender sends only some of the lines. With the idempotencyKey it says which
   * line this is, so sending the same receipt again with a line that was left
   * out the first time stores just that line. Defaults to the position in `items`.
   */
  line: z.number().int().min(0).max(10_000).optional(),
});

export const PurchaseBatchSchema = z.object({
  /**
   * Short lowercase label for where this came from: "receipt", "email",
   * "manual", "agent", or any new one. New senders need no change on our side.
   */
  source: z
    .string({ error: "source is required" })
    .trim()
    .toLowerCase()
    .regex(/^[a-z][a-z0-9_-]{1,31}$/, "Use 2-32 lowercase letters, digits, - or _"),
  /**
   * Chosen by the sender and reused when it retries the same submission, so a
   * retry can never store a purchase twice. Use anything stable for that
   * submission: an image hash, an email message-id, an order number, or a UUID
   * made when the form opened. It must identify this exact content.
   */
  idempotencyKey: z.string({ error: "idempotencyKey is required" }).trim().min(8).max(200),
  store: text(120).optional(),
  purchasedAt: z.coerce
    .date({ error: "purchasedAt must be a valid date, like 2026-10-20" })
    .refine((date) => date.getTime() <= Date.now() + DAY_MS, "Purchase date is in the future"),
  /** ISO 4217 code. */
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  /** The sender's own pointer to the raw receipt or email. Stored, never interpreted. */
  rawRef: z.string().max(500).optional(),
  /** For source "agent": the replenishment order this purchase came from. */
  orderId: z.uuid().optional(),
  items: z
    .array(PurchaseLineSchema)
    .min(1)
    .max(200)
    .refine((items) => {
      const numbers = items.map((item, index) => item.line ?? index);
      return new Set(numbers).size === numbers.length;
    }, "Two lines have the same line number"),
});

/** What a sender writes (currency may be left out). */
export type PurchaseBatchInput = z.input<typeof PurchaseBatchSchema>;
/** The validated batch the receiver works with. */
export type PurchaseBatch = z.output<typeof PurchaseBatchSchema>;

export type LineResult =
  | {
      index: number;
      result: "created";
      productId: string;
      /** True when this line created the product (nothing matched). */
      productCreated: boolean;
      purchaseEventId: string;
    }
  /** Already stored by an earlier submission with the same idempotencyKey. */
  | { index: number; result: "duplicate"; productId: string; purchaseEventId: string }
  | { index: number; result: "rejected"; reason: string };

export interface IngestResult {
  /** "processed" if any line was stored, "duplicate" if all were already stored, else "rejected". */
  status: "processed" | "duplicate" | "rejected";
  items: LineResult[];
}

/**
 * What a sender sees of each existing product. Fetch these before building a
 * batch so lines can be matched to products the user already has (send the
 * match as `productId`), and unmatched ones left to be created.
 */
export interface ProductSummary {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  unit: string;
  normalPurchaseQty: number;
  /** False when the user asked that lines not be matched to this product by its name (its aliases still count). */
  matchByName?: boolean;
}

/**
 * A stored purchase, as much as a sender needs to spot a likely duplicate
 * (same product, store, day and quantity) before sending.
 */
export interface PurchaseSummary {
  productId: string;
  store: string | null;
  quantity: number;
  purchasedAt: Date;
  idempotencyKey: string | null;
  /** Which line of its submission it was (see PurchaseLineSchema.line), when known. */
  lineIndex?: number | null;
}
