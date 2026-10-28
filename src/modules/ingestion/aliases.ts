import type { IngestResult } from "@/core/purchase-batch";
import { normalizeProductName } from "@/modules/inventory/types";

/** What the user did with each line of a reviewed draft, by how the input worded it. */
export interface Review {
  /** Parallel to the submitted items; null means the line has no wording worth remembering. */
  sources: (string | null)[];
  /** Wordings of the lines the user left out. */
  skipped: string[];
}

const MIN_LENGTH = 3;

/**
 * What to remember after a reviewed batch was stored:
 * - `aliases`: each stored line's wording, tied to the product it landed on
 *   (including a product the line just created), so it matches on its own next time;
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
