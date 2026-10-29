import type { Identifier } from "./engine";

/**
 * How the dictionary grows from what users confirm. Pure: it turns what
 * happened when a receipt was saved into a plan, and decides when a learned
 * entry has earned its place. The database side is in index.ts.
 *
 * Nothing learned is trusted at once. A learned wording starts "pending" and
 * only becomes active once separate receipts confirm it and nothing else
 * contradicts it; a new item always waits for a person.
 */
export const LEARN_CONFIG = {
  /** Separate receipts that must confirm a wording or code before it is used. */
  confirmationsToActivate: 2,
  /** Receipts remembered per entry (its confirmations are counted up to this). */
  maxEvidence: 10,
  /** A wording needs at least this many letters to mean anything. */
  minLetters: 3,
};

/** One saved line, and what the user did with it. */
export interface Observation {
  /** The receipt's idempotency key: separate receipts, not repeated saves of one, make evidence. */
  receipt: string;
  /** How the receipt worded the line. */
  wording: string;
  code?: string;
  store?: string | null;
  /** The user's product the line landed on. */
  productName: string;
  productUnit: string;
  productCategory?: string | null;
  /** The line made that product (nothing matched). */
  productCreated: boolean;
}

export type Plan =
  /** The wording means this item. */
  | { type: "term"; receipt: string; text: string; item: string }
  /** This store's code means this item. */
  | { type: "code"; receipt: string; store: string; code: string; item: string }
  /** A new item (always waits for approval), with the wording that led to it. */
  | { type: "item"; receipt: string; name: string; category: string; unit: string | null; text: string };

/** "GV  Whl MLK, 1/2 gal" -> "gv whl mlk 1/2 gal", without bare numbers (sizes and counts change from line to line). */
export function normalizeWording(wording: string): string {
  return wording
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}%/]+/u)
    .filter((word) => word && /\p{L}/u.test(word))
    .join(" ");
}

const letters = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

/**
 * What to teach the dictionary from saved lines. `identify` is the live
 * dictionary, so only what it doesn't already know is planned.
 */
export function planLearning(observations: Observation[], identify: Identifier, knownItems: ReadonlySet<string>): Plan[] {
  const plans: Plan[] = [];
  for (const o of observations) {
    const text = normalizeWording(o.wording);
    const usable = letters(text) >= LEARN_CONFIG.minLetters;
    const item = identify(o.productName).item;

    if (item?.consumable) {
      if (usable && identify(o.wording).item?.name !== item.name) {
        plans.push({ type: "term", receipt: o.receipt, text, item: item.name });
      }
      if (o.code && o.store && identify(o.wording, { code: o.code, store: o.store }).item?.name !== item.name) {
        plans.push({ type: "code", receipt: o.receipt, store: o.store, code: o.code, item: item.name });
      }
    } else if (!item && o.productCreated && usable) {
      // Nothing in the dictionary knows this thing: propose it, for a person to approve.
      const name = o.productName.trim();
      if (name && !knownItems.has(name.toLowerCase().replace(/\s+/g, " "))) {
        plans.push({
          type: "item",
          receipt: o.receipt,
          name,
          category: o.productCategory?.trim() || "Other",
          unit: o.productUnit.trim().toLowerCase() === "each" ? null : o.productUnit.trim(),
          text,
        });
      }
    }
  }
  return plans;
}

export interface Evidenced {
  status: string;
  evidence: string[];
  conflict: boolean;
}

/**
 * What an entry becomes when `receipt` confirms it again, or null if nothing
 * changes (switched off by a person, or this receipt already counted).
 * `competing`: another item has the same wording or code.
 */
export function confirmEntry(entry: Evidenced, receipt: string, competing: boolean): Evidenced | null {
  if (entry.status === "off" || entry.evidence.includes(receipt)) return null;
  const evidence = [...entry.evidence, receipt].slice(-LEARN_CONFIG.maxEvidence);
  const conflict = entry.conflict || competing;
  const earned = entry.status === "pending" && !conflict && evidence.length >= LEARN_CONFIG.confirmationsToActivate;
  return { status: earned ? "active" : entry.status, evidence, conflict };
}

/** A learned entry seen for the first time. Never active at once. */
export function firstConfirmation(receipt: string, competing: boolean): Evidenced {
  return { status: "pending", evidence: [receipt], conflict: competing };
}
