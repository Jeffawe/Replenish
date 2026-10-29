import { describe, expect, it } from "vitest";
import { changeFor, selectQuestions, summarize } from "./rules";
import type { ProductFacts } from "./types";

const NOW = new Date("2026-10-28T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

/** A product we know well: checked, learned from history, confident. Nothing to ask. */
const known = (overrides: Partial<ProductFacts> = {}, estimate: Partial<ProductFacts["estimate"]> = {}): ProductFacts => ({
  id: "p-paper",
  name: "Paper Towels",
  unit: "rolls",
  normalPurchaseQty: 6,
  confirmed: true,
  fallbackDaysPerPurchase: null,
  typicalLeftoverAtPurchase: 1,
  lastCountAt: null,
  ...overrides,
  estimate: {
    estimatedRemaining: 4,
    confidence: 0.9,
    isLow: false,
    rateSource: "history",
    purchaseCount: 5,
    anchor: { kind: "purchase", at: daysAgo(10), quantity: 7, disputed: false },
    typicalLeftover: { quantity: 1, source: "answer" },
    ...estimate,
  },
});

/** Just created by a receipt: one purchase, nothing answered yet. */
const fresh = (overrides: Partial<ProductFacts> = {}) =>
  known(
    { id: "p-eggs", name: "Eggs", unit: "each", normalPurchaseQty: 12, confirmed: false, typicalLeftoverAtPurchase: null, ...overrides },
    {
      estimatedRemaining: null,
      confidence: 0,
      rateSource: "none",
      purchaseCount: 1,
      anchor: { kind: "purchase", at: daysAgo(1), quantity: 12, disputed: false },
      typicalLeftover: { quantity: null, source: "none" },
    },
  );

const kindsFor = (facts: ProductFacts, snoozed = new Set<string>()) =>
  selectQuestions([facts], snoozed, NOW).map((q) => q.kind);

describe("which questions are asked", () => {
  it("asks nothing about a product we know well", () => {
    expect(kindsFor(known())).toEqual([]);
  });

  it("asks a new product whether to track it first, then the most useful two others", () => {
    expect(kindsFor(fresh())).toEqual(["track", "stock-now", "lasts-for"]);
  });

  it("asks for a stock count when unsure, but not if one was given recently", () => {
    const unsure = known({}, { confidence: 0.4 });
    expect(kindsFor(unsure)).toEqual(["stock-now"]);
    expect(kindsFor({ ...unsure, lastCountAt: daysAgo(3) })).toEqual([]);
    expect(kindsFor({ ...unsure, lastCountAt: daysAgo(30) })).toEqual(["stock-now"]);
  });

  it("stops asking how long one lasts once purchases have taught us, or once answered", () => {
    expect(kindsFor(known({ confirmed: true }, { rateSource: "none" }))).toEqual(["lasts-for"]);
    expect(kindsFor(known({ fallbackDaysPerPurchase: 14 }, { rateSource: "fallback" }))).toEqual([]);
  });

  it("asks how much is usually left until it is answered or learned from stock counts", () => {
    const unknown = { quantity: null, source: "none" } as const;
    expect(kindsFor(known({ typicalLeftoverAtPurchase: null }, { typicalLeftover: unknown }))).toEqual(["leftover"]);
    expect(kindsFor(known({ typicalLeftoverAtPurchase: null }, { typicalLeftover: { quantity: 2, source: "learned" } }))).toEqual([]);
  });

  it("checks a stock count that looked like a typo, and flags it", () => {
    const disputed = known({ lastCountAt: daysAgo(1) }, { anchor: { kind: "correction", at: daysAgo(1), quantity: 60, disputed: true } });
    const [question] = selectQuestions([disputed], new Set(), NOW);
    expect(question).toMatchObject({ kind: "recheck", important: true });
    expect(question!.prompt).toBe("You told us you had 60 rolls of Paper Towels. Is that right?");
  });

  it("leaves out snoozed questions", () => {
    expect(kindsFor(fresh(), new Set(["p-eggs:stock-now"]))).toEqual(["track", "lasts-for", "leftover"]);
  });
});

describe("what is important", () => {
  it("is a product that is low and that we're unsure about", () => {
    const lowUnsure = known({}, { isLow: true, confidence: 0.3 });
    expect(selectQuestions([lowUnsure], new Set(), NOW)[0]!.important).toBe(true);
    // Unsure but not low, or low but confident enough not to ask: not important.
    expect(selectQuestions([known({}, { confidence: 0.3 })], new Set(), NOW)[0]!.important).toBe(false);
    expect(selectQuestions([known({}, { isLow: true, confidence: 0.55 })], new Set(), NOW)[0]!.important).toBe(false);
  });

  it("comes first, soonest to run out leading, and turns the summary red", () => {
    const milk = known({ id: "p-milk", name: "Milk" }, { isLow: true, confidence: 0.3, estimatedRemaining: 1 });
    const soap = known({ id: "p-soap", name: "Soap" }, { isLow: true, confidence: 0.3, estimatedRemaining: 0 });
    const questions = selectQuestions([fresh(), milk, soap], new Set(), NOW);
    expect(questions.map((q) => q.productName)).toEqual(["Soap", "Milk", "Eggs", "Eggs", "Eggs"]);
    expect(summarize(questions)).toEqual({ products: 3, important: true });
    expect(summarize(selectQuestions([fresh()], new Set(), NOW))).toEqual({ products: 1, important: false });
  });
});

describe("what an answer changes", () => {
  const ask = (facts: ProductFacts, kind: Parameters<typeof changeFor>[1]["kind"], choice: string, number?: number) =>
    changeFor(facts, { productId: facts.id, kind, choice, number }, NOW);

  it("tracks or hides a product", () => {
    expect(ask(fresh(), "track", "yes")).toEqual({ type: "confirm" });
    expect(ask(fresh(), "track", "no")).toEqual({ type: "archive" });
  });

  it("records a stock count from our guess, from none, or from a typed number", () => {
    const unsure = known({}, { confidence: 0.4, estimatedRemaining: 3.96 });
    expect(ask(unsure, "stock-now", "guess")).toEqual({ type: "stock-count", remaining: 4 });
    expect(ask(unsure, "stock-now", "none")).toEqual({ type: "stock-count", remaining: 0 });
    expect(ask(unsure, "stock-now", "number", 2.5)).toEqual({ type: "stock-count", remaining: 2.5 });
    expect(ask(unsure, "stock-now", "number", -1)).toBeNull();
  });

  it("turns the usage answers into the settings the estimate reads", () => {
    expect(ask(fresh(), "lasts-for", "14")).toEqual({ type: "usage", fallbackDaysPerPurchase: 14 });
    expect(ask(fresh(), "leftover", "0.25")).toEqual({ type: "usage", typicalLeftoverAtPurchase: 3 });
  });

  it("rejects an answer to a question we wouldn't ask now, or a choice that isn't offered", () => {
    expect(ask(known(), "stock-now", "none")).toBeNull();
    expect(ask(fresh(), "lasts-for", "9")).toBeNull();
  });
});
