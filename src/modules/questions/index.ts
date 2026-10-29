/**
 * The server door to the questions, and the one place they are connected to
 * the real database (through inventory). Everything else in this folder is
 * plain functions over plain data. Server actions import from here; browser
 * code imports from ./client.
 */
import { checkStockCount } from "@/core/plausibility";
import {
  archiveProduct,
  confirmProduct,
  listSnoozed,
  restoreProduct,
  saveUsageAnswers,
  snoozeQuestion as storeSnooze,
  unconfirmProduct,
} from "@/modules/inventory/checks";
import { getInventory, recordStockCount, undoStockCount, type InventoryItem } from "@/modules/inventory/service";
import { DEFAULT_QUESTION_CONFIG } from "./config";
import { changeFor, selectQuestions } from "./rules";
import type { Answer, ProductFacts, Question } from "./types";

export type { Answer, Question } from "./types";
export { summarize } from "./rules";

/** How to take an answer back. Plain data, so the browser can hand it back for "Undo". */
export type Undo =
  | { type: "stock-count"; correctionId: string }
  | { type: "usage"; fallbackDaysPerPurchase?: number | null; typicalLeftoverAtPurchase?: number | null }
  | { type: "confirm" }
  | { type: "archive" };

export type AnswerOutcome =
  | { status: "saved"; undo: Undo }
  /** The number looks like a typo: ask "are you sure?" and send it again with `sure`. */
  | { status: "check"; message: string }
  /** Not a question we'd ask about this product any more (already answered elsewhere, say). */
  | { status: "gone" };

function factsOf({ product, estimate, corrections }: InventoryItem): ProductFacts {
  return {
    id: product.id,
    name: product.name,
    unit: product.unit,
    normalPurchaseQty: product.normalPurchaseQty,
    confirmed: product.confirmedAt !== null,
    fallbackDaysPerPurchase: product.fallbackDaysPerPurchase,
    typicalLeftoverAtPurchase: product.typicalLeftoverAtPurchase,
    estimate,
    // Corrections are newest first.
    lastCountAt: corrections[0]?.recordedAt ?? null,
  };
}

/** The questions worth asking the user now, most useful first. */
export async function getQuestions(userId: string): Promise<Question[]> {
  const [inventory, snoozed] = await Promise.all([getInventory(userId), listSnoozed(userId, new Date())]);
  return selectQuestions(inventory.map(factsOf), snoozed, new Date());
}

/** Saves an answer: works out what it changes, double-checks a surprising number, and writes it. */
export async function answerQuestion(userId: string, answer: Answer): Promise<AnswerOutcome> {
  const now = new Date();
  const item = (await getInventory(userId, now)).find((entry) => entry.product.id === answer.productId);
  if (!item) return { status: "gone" };
  const facts = factsOf(item);
  const change = changeFor(facts, answer, now);
  if (!change) return { status: "gone" };

  switch (change.type) {
    case "confirm":
      await confirmProduct(userId, facts.id);
      return { status: "saved", undo: { type: "confirm" } };
    case "archive":
      await archiveProduct(userId, facts.id);
      return { status: "saved", undo: { type: "archive" } };
    case "usage": {
      const answers = {
        ...(change.fallbackDaysPerPurchase !== undefined && { fallbackDaysPerPurchase: change.fallbackDaysPerPurchase }),
        ...(change.typicalLeftoverAtPurchase !== undefined && { typicalLeftoverAtPurchase: change.typicalLeftoverAtPurchase }),
      };
      // Undo puts back exactly the settings this answer replaced.
      const before = {
        ...(answers.fallbackDaysPerPurchase !== undefined && { fallbackDaysPerPurchase: facts.fallbackDaysPerPurchase }),
        ...(answers.typicalLeftoverAtPurchase !== undefined && { typicalLeftoverAtPurchase: facts.typicalLeftoverAtPurchase }),
      };
      await saveUsageAnswers(userId, facts.id, answers);
      return { status: "saved", undo: { type: "usage", ...before } };
    }
    case "stock-count": {
      if (answer.choice === "number" && !answer.sure) {
        const message = checkStockCount(change.remaining, {
          unit: facts.unit,
          normalPurchaseQty: facts.normalPurchaseQty,
          estimatedRemaining: facts.estimate.estimatedRemaining,
        });
        if (message) return { status: "check", message };
      }
      const recorded = await recordStockCount(userId, facts.id, change.remaining);
      if (recorded === "not-found") return { status: "gone" };
      return { status: "saved", undo: { type: "stock-count", correctionId: recorded.correctionId } };
    }
  }
}

/** Takes an answer back ("Undo"). */
export async function undoAnswer(userId: string, productId: string, undo: Undo): Promise<void> {
  switch (undo.type) {
    case "stock-count":
      return undoStockCount(userId, undo.correctionId);
    case "usage": {
      return saveUsageAnswers(userId, productId, {
        ...(undo.fallbackDaysPerPurchase !== undefined && { fallbackDaysPerPurchase: undo.fallbackDaysPerPurchase }),
        ...(undo.typicalLeftoverAtPurchase !== undefined && { typicalLeftoverAtPurchase: undo.typicalLeftoverAtPurchase }),
      });
    }
    case "confirm":
      return unconfirmProduct(userId, productId);
    case "archive":
      return restoreProduct(userId, productId);
  }
}

/** "Not now": that question about that product stays quiet for a while. */
export async function snoozeQuestion(userId: string, productId: string, kind: Question["kind"]): Promise<void> {
  const until = new Date(Date.now() + DEFAULT_QUESTION_CONFIG.snoozeDays * 24 * 60 * 60 * 1000);
  await storeSnooze(userId, productId, kind, until);
}

/** How many questions the occasional check-in shows, and how often (days). */
export const CHECK_IN = {
  questions: DEFAULT_QUESTION_CONFIG.checkInQuestions,
  everyDays: DEFAULT_QUESTION_CONFIG.checkInEveryDays,
};
