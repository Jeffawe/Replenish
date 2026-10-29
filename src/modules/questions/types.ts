import type { InventoryEstimate } from "@/core/estimate";

/**
 * How questions work:
 *
 *   facts     what we know about one product right now (from inventory)
 *   kinds     one entry per kind of question: when it applies, how it is
 *             asked, and what each answer changes (kinds.ts)
 *   rules     picks and ranks the questions worth asking (rules.ts)
 *   index.ts  loads the facts and writes answers through inventory
 *
 * Questions are never stored. They are worked out from the facts each time,
 * so one disappears as soon as the data answers it.
 */

export type QuestionKind = "track" | "recheck" | "stock-now" | "lasts-for" | "leftover";

/** What one product looks like to the questions. */
export interface ProductFacts {
  id: string;
  name: string;
  unit: string;
  /** The usual purchase, as the estimate learned it from what is bought. */
  normalPurchaseQty: number;
  /** The user said yes, keep track of this (or it predates the questions). */
  confirmed: boolean;
  fallbackDaysPerPurchase: number | null;
  typicalLeftoverAtPurchase: number | null;
  estimate: Pick<
    InventoryEstimate,
    "estimatedRemaining" | "confidence" | "isLow" | "rateSource" | "purchaseCount" | "anchor" | "typicalLeftover"
  >;
  /** When the user last gave a stock count, if ever. */
  lastCountAt: Date | null;
}

export interface Choice {
  id: string;
  label: string;
}

export interface Question {
  /** `${productId}:${kind}`, unique among the questions asked at once. */
  key: string;
  productId: string;
  productName: string;
  unit: string;
  kind: QuestionKind;
  prompt: string;
  /** A line under the prompt saying why we ask, or what our guess is. */
  hint?: string;
  choices: Choice[];
  /** Also offer a number box (the answer then has choice "number"). */
  numberInput?: { label: string };
  /** Worth flagging: turns the questions button red. */
  important: boolean;
}

/** The user's answer to one question. */
export interface Answer {
  productId: string;
  kind: QuestionKind;
  /** A choice id, or "number" with `number` set. */
  choice: string;
  number?: number;
  /** The user already said yes to "are you sure?" about this number. */
  sure?: boolean;
}

/** What an answer writes. Plain data, so it can be tested without a database. */
export type Change =
  | { type: "confirm" }
  | { type: "archive" }
  | { type: "stock-count"; remaining: number }
  | { type: "usage"; fallbackDaysPerPurchase?: number; typicalLeftoverAtPurchase?: number };
