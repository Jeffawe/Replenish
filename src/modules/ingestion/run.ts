import { z } from "zod";
import type { ProductSummary, PurchaseSummary } from "@/core/purchase-batch";
import { detectAlreadySaved, detectPossibleDuplicates } from "./duplicates";
import { toIssues, type Draft, type ExtractResult, type Extractor, type Issue } from "./types";

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
 * Adds possible-duplicate warnings to a draft (replacing any it already has),
 * by comparing it with purchases already stored around its date. Only possible
 * once the producer has given a usable date; submit validates the rest.
 */
export function createDuplicateChecker(deps: Pick<RunDeps, "loadProducts" | "loadNearby">) {
  return async function withDuplicateWarnings(draft: Draft, userId: string): Promise<Draft> {
    const { batch } = draft;
    const purchasedAt = z.coerce.date().safeParse(batch.purchasedAt);
    const kept = draft.warnings.filter((warning) => warning.code !== "possible-duplicate" && warning.code !== "already-saved");
    if (!purchasedAt.success) return { ...draft, warnings: kept };

    const [products, nearby] = await Promise.all([deps.loadProducts(userId), deps.loadNearby(userId, purchasedAt.data)]);
    const check = { purchasedAt: purchasedAt.data, store: batch.store, idempotencyKey: batch.idempotencyKey, items: batch.items };
    const warnings = [...detectAlreadySaved(check, nearby), ...detectPossibleDuplicates(check, products, nearby)];
    return { ...draft, warnings: [...kept, ...warnings] };
  };
}

/**
 * Runs the producer registered for `source` on raw input: validates the
 * input, gives the producer the user's products, and adds duplicate warnings
 * to whatever draft it returns. Stores nothing.
 */
export function createExtractionRunner(deps: RunDeps) {
  const withDuplicateWarnings = createDuplicateChecker(deps);
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
    return { ok: true, result: { kind: "draft", draft: await withDuplicateWarnings(result.draft, userId) } };
  };
}
