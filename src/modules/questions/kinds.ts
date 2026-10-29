import { formatQuantity } from "@/lib/format";
import type { QuestionConfig } from "./config";
import type { Answer, Change, Choice, ProductFacts, Question, QuestionKind } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One kind of question. Adding a question is adding an entry to KINDS:
 * when it applies, how it is put, whether it is worth flagging, and what
 * each answer changes. Nothing else needs to know about it.
 */
export interface Kind {
  kind: QuestionKind;
  applies(facts: ProductFacts, config: QuestionConfig, now: Date): boolean;
  ask(facts: ProductFacts, config: QuestionConfig): Pick<Question, "prompt" | "hint" | "choices" | "numberInput">;
  important?(facts: ProductFacts, config: QuestionConfig): boolean;
  /** What the answer writes, or null when it isn't a valid answer to this question. */
  change(facts: ProductFacts, answer: Answer, config: QuestionConfig): Change | null;
}

const amount = (value: number, unit: string) => `${formatQuantity(value)} ${unit}`;
const usual = (facts: ProductFacts) => amount(facts.normalPurchaseQty, facts.unit);
/** Our guess, rounded the way it is shown, so "About 4" records 4. */
const guessOf = (facts: ProductFacts) =>
  facts.estimate.estimatedRemaining === null ? null : Number(formatQuantity(facts.estimate.estimatedRemaining));

/** A stock count from a typed number, if it is one. */
function typedCount(answer: Answer): Change | null {
  if (answer.choice !== "number" || answer.number === undefined) return null;
  return Number.isFinite(answer.number) && answer.number >= 0 ? { type: "stock-count", remaining: answer.number } : null;
}

const track: Kind = {
  kind: "track",
  applies: (facts) => !facts.confirmed,
  ask: (facts) => ({
    prompt: `Do you want to keep track of ${facts.name}?`,
    hint: "It came from a receipt. Say no and we'll leave it out next time.",
    choices: [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ],
  }),
  change: (_facts, answer) =>
    answer.choice === "yes" ? { type: "confirm" } : answer.choice === "no" ? { type: "archive" } : null,
};

/** A count that was far from our guess: ask once more, in case it was a typo. */
const recheck: Kind = {
  kind: "recheck",
  applies: (facts) => facts.estimate.anchor?.kind === "correction" && facts.estimate.anchor.disputed,
  important: () => true,
  ask: (facts) => {
    const guess = guessOf(facts);
    return {
      prompt: `You told us you had ${amount(facts.estimate.anchor!.quantity, facts.unit)} of ${facts.name}. Is that right?`,
      hint: "It was a lot different from what we expected, so we're checking.",
      choices: [{ id: "yes", label: guess === null ? "Yes" : `Yes, about ${amount(guess, facts.unit)} now` }],
      numberInput: { label: "No, I have" },
    };
  },
  change: (facts, answer) => {
    const guess = guessOf(facts);
    if (answer.choice === "yes" && guess !== null) return { type: "stock-count", remaining: guess };
    return typedCount(answer);
  },
};

const stockNow: Kind = {
  kind: "stock-now",
  applies: (facts, config, now) => {
    const recent = facts.lastCountAt !== null && now.getTime() - facts.lastCountAt.getTime() < config.freshCountDays * DAY_MS;
    return !recent && facts.estimate.purchaseCount > 0 && facts.estimate.confidence < config.askStockBelowConfidence;
  },
  important: (facts, config) =>
    (facts.estimate.isLow || facts.estimate.estimatedRemaining === 0) &&
    facts.estimate.confidence < config.importantBelowConfidence,
  ask: (facts) => {
    const guess = guessOf(facts);
    const choices: Choice[] = [
      ...(guess !== null && guess > 0 ? [{ id: "guess", label: `About ${amount(guess, facts.unit)}` }] : []),
      { id: "none", label: "None left" },
    ];
    return {
      prompt: `About how much ${facts.name} do you have right now?`,
      hint: guess === null ? "A rough number is fine." : `Our guess is about ${amount(guess, facts.unit)}. A rough number is fine.`,
      choices,
      numberInput: { label: "I have" },
    };
  },
  change: (facts, answer) => {
    const guess = guessOf(facts);
    if (answer.choice === "guess" && guess !== null) return { type: "stock-count", remaining: guess };
    if (answer.choice === "none") return { type: "stock-count", remaining: 0 };
    return typedCount(answer);
  },
};

const lastsFor: Kind = {
  kind: "lasts-for",
  // Only until purchases teach us the real rate.
  applies: (facts) => facts.estimate.rateSource !== "history" && facts.fallbackDaysPerPurchase === null && facts.normalPurchaseQty > 0,
  ask: (facts, config) => ({
    prompt: `How long does ${usual(facts)} of ${facts.name} usually last you?`,
    hint: "Until we've seen you buy it a few times, this is how we guess.",
    choices: config.lastsFor.map(({ days, label }) => ({ id: String(days), label })),
  }),
  change: (_facts, answer, config) => {
    const picked = config.lastsFor.find(({ days }) => String(days) === answer.choice);
    return picked ? { type: "usage", fallbackDaysPerPurchase: picked.days } : null;
  },
};

const leftover: Kind = {
  kind: "leftover",
  applies: (facts) => facts.typicalLeftoverAtPurchase === null && facts.estimate.purchaseCount > 0 && facts.normalPurchaseQty > 0,
  ask: (facts, config) => ({
    prompt: `When you buy more ${facts.name}, how much do you usually still have?`,
    hint: `Compared with the ${usual(facts)} you usually buy.`,
    choices: config.leftover.map(({ share, label }) => ({ id: String(share), label })),
  }),
  change: (facts, answer, config) => {
    const picked = config.leftover.find(({ share }) => String(share) === answer.choice);
    return picked ? { type: "usage", typicalLeftoverAtPurchase: picked.share * facts.normalPurchaseQty } : null;
  },
};

/** In the order they are asked about one product. */
export const KINDS: Kind[] = [track, recheck, stockNow, lastsFor, leftover];
