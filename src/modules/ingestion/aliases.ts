import type { IngestResult } from "@/core/purchase-batch";
import { normalizeProductName } from "@/core/product-name";

/** What the user did with each line of a reviewed draft, by how the input worded it. */
export interface Review {
  /** Parallel to the submitted items; null means the line has no wording worth remembering. */
  sources: (string | null)[];
  /** Wordings of the lines the user left out. */
  skipped: string[];
  /** Parallel to `sources`: each line's item code, if the input printed one. */
  codes?: (string | null)[];
  /** The store, which item codes belong to (one shop's code means nothing at another). */
  store?: string | null;
}

/**
 * How an item code is remembered: among the wording aliases, but marked so it
 * can never be mistaken for one, and tied to its store.
 */
export function codeAlias(store: string | null | undefined, code: string): string | null {
  const shop = (store ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return shop ? `#${shop}#${code}` : null;
}

/** Whether a stored alias is an item code rather than a wording. */
export const isCodeAlias = (alias: string) => alias.startsWith("#");

const MIN_LENGTH = 3;

/**
 * What to remember after a reviewed batch was stored:
 * - `aliases`: each stored line's wording, and its item code at that store,
 *   tied to the product it landed on (including a product the line just
 *   created), so it matches on its own next time;
 * - `ignore`: wordings the user left out, so they start unticked next time;
 * - `keep`: wordings the user kept, so an earlier "left out" is forgotten.
 */
export function lessonsFromReview(review: Review, result: IngestResult) {
  const aliases = new Map<string, string>();
  for (const line of result.items) {
    if (line.result === "rejected") continue;
    const source = review.sources[line.index];
    const alias = source ? normalizeProductName(source) : "";
    if (alias.length >= MIN_LENGTH) aliases.set(alias, line.productId);
    // The user's save is the evidence for a code, and the latest save wins: a wrong one is fixed by saving it right once.
    const code = review.codes?.[line.index];
    const coded = code ? codeAlias(review.store, code) : null;
    if (coded) aliases.set(coded, line.productId);
  }

  const normalized = (wordings: (string | null)[]) => [
    ...new Set(wordings.flatMap((w) => (w ? [normalizeProductName(w)] : [])).filter((w) => w.length >= MIN_LENGTH)),
  ];
  const keep = normalized(review.sources);
  return {
    aliases: [...aliases].map(([alias, productId]) => ({ alias, productId })),
    ignore: normalized(review.skipped).filter((wording) => !keep.includes(wording)),
    keep,
  };
}
