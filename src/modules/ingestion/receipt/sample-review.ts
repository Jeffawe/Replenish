import type { PurchaseBatchInput } from "@/core/purchase-batch";
import type { Draft } from "../types";
import type { ParsedLine } from "./parse";

/**
 * Compares what we drafted for a receipt with what the user then saved
 * (samples.ts keeps both), which is the closest thing to a verdict on a draft
 * that real use gives. Pure; scripts/review-samples.ts reads the folders.
 */

type Item = NonNullable<PurchaseBatchInput["items"]>[number];

/** What samples.ts writes to confirmed.json that comparing needs. */
export interface Confirmed {
  batch: { store?: string; purchasedAt: string; items: Item[] };
  /** `sources` is parallel to `batch.items`; `skipped` is the wording of each line left out. */
  review?: { sources: (string | null)[]; skipped: string[] };
}

export type LineVerdict =
  /** We ticked it and the user saved it unchanged. */
  | "as-is"
  /** We ticked it and the user saved it, but changed something (see `changes`). */
  | "edited"
  /** We ticked it and the user took it out. */
  | "removed"
  /** We left it unticked and the user took it in. */
  | "added"
  /** We left it unticked and so did the user. */
  | "left-out";

export interface LineComparison {
  wording: string;
  verdict: LineVerdict;
  /** For "edited": what changed, like `name: "Gv Whl Mlk" -> "Milk"`. */
  changes: string[];
}

export interface DraftComparison {
  store: { drafted: string | null; saved: string | null } | null;
  date: { drafted: string; saved: string } | null;
  lines: LineComparison[];
}

const text = (value: string | undefined | null) => (value ?? "").trim().toLowerCase();
const day = (value: unknown) => String(value).slice(0, 10);

/** What differs between a drafted line and the saved one, ignoring case and spacing. */
function changesBetween(drafted: Item, saved: Item): string[] {
  const changes: string[] = [];
  if (text(drafted.productName) !== text(saved.productName)) changes.push(`name: "${drafted.productName}" -> "${saved.productName}"`);
  if (drafted.quantity !== saved.quantity) changes.push(`quantity: ${drafted.quantity} -> ${saved.quantity}`);
  if (text(drafted.unit) !== text(saved.unit)) changes.push(`unit: ${drafted.unit} -> ${saved.unit}`);
  if (text(drafted.brand) !== text(saved.brand)) changes.push(`brand: ${drafted.brand ?? "none"} -> ${saved.brand ?? "none"}`);
  if ((drafted.priceCents ?? null) !== (saved.priceCents ?? null)) changes.push(`price: ${drafted.priceCents ?? "none"} -> ${saved.priceCents ?? "none"}`);
  return changes;
}

export function compareDraft(draft: Draft, confirmed: Confirmed): DraftComparison {
  const drafted = draft.batch.items ?? [];
  const sources = confirmed.review?.sources ?? [];
  // A wording can appear twice on one receipt; each saved line answers one drafted line.
  const unused = sources.map((_, index) => index);

  const lines = drafted.map((item, index): LineComparison => {
    const wording = draft.lines?.[index]?.sourceText ?? item.productName;
    const leftOut = !!draft.lines?.[index]?.excludeReason;
    const at = unused.findIndex((saved) => sources[saved] === wording);
    const savedIndex = at === -1 ? undefined : unused.splice(at, 1)[0];
    const saved = savedIndex === undefined ? undefined : confirmed.batch.items[savedIndex];

    if (!saved) return { wording, verdict: leftOut ? "left-out" : "removed", changes: [] };
    if (leftOut) return { wording, verdict: "added", changes: [] };
    const changes = changesBetween(item, saved);
    return { wording, verdict: changes.length === 0 ? "as-is" : "edited", changes };
  });

  const savedStore = confirmed.batch.store ?? null;
  const draftedStore = draft.batch.store ?? null;
  return {
    store: text(draftedStore) === text(savedStore) ? null : { drafted: draftedStore, saved: savedStore },
    date: day(draft.batch.purchasedAt) === day(confirmed.batch.purchasedAt) ? null : { drafted: day(draft.batch.purchasedAt), saved: day(confirmed.batch.purchasedAt) },
    lines,
  };
}

export type ParseVerdict =
  /** The parser finds this saved line with the same quantity and price. */
  | "found"
  /** Found, but with a different quantity or price. */
  | "different"
  /** The user saved a line the parser doesn't produce. */
  | "missing"
  /** The parser produces a line the user didn't save and didn't leave out (it isn't on the receipt as an item). */
  | "extra";

export interface ParseComparison {
  wording: string;
  verdict: ParseVerdict;
  detail?: string;
}

/**
 * Checks the parser alone (rows to lines) against what the user saved, so a
 * parser change can be scored on every kept receipt without OCR, a database or
 * the dictionary. Lines are tied by the receipt's wording.
 */
export function compareParse(parsed: ParsedLine[], confirmed: Confirmed): ParseComparison[] {
  const sources = confirmed.review?.sources ?? [];
  const skipped = new Set(confirmed.review?.skipped ?? []);
  const unused = [...parsed];
  const results: ParseComparison[] = [];

  sources.forEach((wording, index) => {
    if (wording === null) return;
    const saved = confirmed.batch.items[index];
    const at = unused.findIndex((line) => line.name === wording);
    if (!saved || at === -1) return void results.push({ wording, verdict: "missing" });
    const [line] = unused.splice(at, 1);
    const differences = [
      ...(line!.quantity !== saved.quantity ? [`quantity ${line!.quantity} vs ${saved.quantity}`] : []),
      ...((line!.priceCents ?? null) !== (saved.priceCents ?? null) ? [`price ${line!.priceCents ?? "none"} vs ${saved.priceCents ?? "none"}`] : []),
    ];
    results.push(
      differences.length === 0
        ? { wording, verdict: "found" }
        : { wording, verdict: "different", detail: differences.join(", ") },
    );
  });

  for (const line of unused) if (!skipped.has(line.name)) results.push({ wording: line.name, verdict: "extra" });
  return results;
}
