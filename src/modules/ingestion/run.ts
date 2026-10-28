import { z } from "zod";
import type { ProductSummary, PurchaseSummary } from "@/core/purchase-batch";
import { detectPossibleDuplicates } from "./duplicates";
import { toIssues, type ExtractResult, type Extractor, type Issue } from "./types";

/** Everything the runner needs from outside, so it can be tested without a database. */
export interface RunDeps {
  getExtractor(source: string): Extractor | undefined;
  loadProducts(userId: string): Promise<ProductSummary[]>;
  /** Stored purchases within a day of `around`, for spotting duplicates. */
  loadNearby(userId: string, around: Date): Promise<PurchaseSummary[]>;
  now?: () => Date;
}

export type RunOutcome =
  | { ok: true; result: ExtractResult }
  | { ok: false; error: "unknown-source" }
  | { ok: false; error: "invalid-input"; issues: Issue[] };

/**
 * Runs the producer registered for `source` on raw input: validates the
 * input, gives the producer the user's products, and adds duplicate warnings
 * to whatever draft it returns. Stores nothing.
 */
export function createExtractionRunner(deps: RunDeps) {
  return async function extractPurchases(
    source: string,
    rawInput: unknown,
    userId: string,
  ): Promise<RunOutcome> {
    const extractor = deps.getExtractor(source);
    if (!extractor) return { ok: false, error: "unknown-source" };

    const input = extractor.input.safeParse(rawInput);
    if (!input.success) return { ok: false, error: "invalid-input", issues: toIssues(input.error) };

    const products = await deps.loadProducts(userId);
    const result = await extractor.extract(input.data, {
      userId,
      products,
      now: deps.now?.() ?? new Date(),
    });
    if (result.kind !== "draft") return { ok: true, result };

    // Only possible once the producer has given a usable date and key; submit validates the rest.
    const { batch } = result.draft;
    const purchasedAt = z.coerce.date().safeParse(batch.purchasedAt);
    if (purchasedAt.success) {
      const nearby = await deps.loadNearby(userId, purchasedAt.data);
      const warnings = detectPossibleDuplicates(
        {
          purchasedAt: purchasedAt.data,
          store: batch.store,
          idempotencyKey: batch.idempotencyKey,
          items: batch.items,
        },
        products,
        nearby,
      );
      result.draft.warnings = [...result.draft.warnings, ...warnings];
    }
    return { ok: true, result };
  };
}
