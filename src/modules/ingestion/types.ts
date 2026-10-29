import type { z } from "zod";
import type { ProductSummary, PurchaseBatchInput } from "@/core/purchase-batch";

/**
 * How ingestion is organised:
 *
 *   producers  turn one kind of raw input into a draft purchase batch
 *              (an Extractor: receipt/, email/, anything added later)
 *   triggers   decide when a producer runs and what happens to its draft
 *              (a UI action, a scheduled inbox sync)
 *   submit     the single front door that stores a batch (submit.ts)
 *
 * Producers never store anything and never know who triggered them.
 */

/** Something worth the user's attention that did not stop the draft. */
export interface Warning {
  /** Short machine-readable label, e.g. "possible-duplicate". */
  code: string;
  message: string;
  /** The line it is about, when it is about one. */
  lineIndex?: number;
}

/** What a producer knows about one line of its batch that the batch itself can't say. */
export interface DraftLine {
  /** How the input worded the line, before it was cleaned into a product name. */
  sourceText: string;
  /** How the line was tied to an existing product (its `productId` is set), or null if it wasn't. */
  matchedBy: "code" | "name" | "alias" | "similar" | null;
  /** The store's own number for the item (a UPC), when the input printed one. Learned on confirm, like the wording. */
  code?: string;
  /** Set when the line should start out left out of the purchase, saying why. */
  excludeReason?: string;
}

/** A purchase batch ready to be submitted, plus anything the caller should know about it. */
export interface Draft {
  batch: PurchaseBatchInput;
  warnings: Warning[];
  /** One entry per batch item, in order, for a producer that has something to say about its lines. */
  lines?: DraftLine[];
  /** The raw text the producer read, so the user can check it against the draft. */
  sourceText?: string;
  /** What the input says the lines should add up to, so the draft can be checked again after more is added to it. */
  totals?: { subtotalCents: number | null; totalCents: number | null; discountsCents: number };
}

export type ExtractResult =
  | { kind: "draft"; draft: Draft }
  /** The input was fine but holds nothing to record (not an order, unreadable, ...). */
  | { kind: "skipped"; reason: string; sourceText?: string };

/**
 * A producer could not do its job (a service it depends on is down or not
 * set up). The message is written for the user and is safe to show them.
 */
export class ExtractionError extends Error {
  override name = "ExtractionError";
}

/** What the runner hands every producer, so none of them has to fetch it. */
export interface ExtractContext {
  userId: string;
  /** The user's existing products, to match lines against. */
  products: ProductSummary[];
  now: Date;
}

/** A producer. One per way of getting purchases in. */
export interface Extractor<Input = unknown> {
  /** The label sent as `source` on every batch it makes. */
  source: string;
  /** Validates what a trigger passes in (a photo, an email...). */
  input: z.ZodType<Input>;
  extract(input: Input, ctx: ExtractContext): Promise<ExtractResult>;
}

export interface Issue {
  path: string;
  message: string;
}

export function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));
}
