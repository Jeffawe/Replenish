import { describe, expect, it } from "vitest";
import {
  calculateConsumptionRate,
  type LevelObservation,
  type PurchasePoint,
} from "./consumption-rate";

const DAY_MS = 24 * 60 * 60 * 1000;
const start = Date.UTC(2026, 0, 1);
const day = (n: number) => new Date(start + n * DAY_MS);
const buy = (dayNumber: number, quantity = 12): PurchasePoint => ({
  quantity,
  purchasedAt: day(dayNumber),
});
// Tests sit well inside the 12-month window unless they say otherwise.
const at = (n: number) => day(n + 60);
const count = (dayNumber: number, remainingQuantity: number): LevelObservation => ({
  remainingQuantity,
  recordedAt: day(dayNumber),
});

describe("calculateConsumptionRate", () => {
  it("returns no rate for fewer than two purchases", () => {
    expect(calculateConsumptionRate([], at(100)).ratePerDay).toBeNull();
    expect(calculateConsumptionRate([buy(0)], at(100)).ratePerDay).toBeNull();
  });

  it("matches the worked example: 12 rolls every 28 days", () => {
    const result = calculateConsumptionRate([buy(0), buy(28), buy(56), buy(84)], at(84));
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
    expect(result.intervalsUsed).toBe(3);
    expect(result.errorPerDay).toBeCloseTo(0, 5);
  });

  it("leaves the latest purchase out of the quantity", () => {
    // 4 used over 10 days; the 6 is the current pack.
    const result = calculateConsumptionRate([buy(0, 4), buy(10, 6)], at(10));
    expect(result.ratePerDay).toBeCloseTo(0.4, 5);
  });

  it("counts each purchase at its own size", () => {
    const result = calculateConsumptionRate([buy(0, 4), buy(10, 6), buy(25, 6), buy(40, 6)], at(40));
    expect(result.ratePerDay).toBeCloseTo((4 + 6 + 6) / 40, 5);
  });

  it("is independent of input order", () => {
    const ordered = calculateConsumptionRate([buy(0), buy(28), buy(56)], at(56));
    const shuffled = calculateConsumptionRate([buy(56), buy(0), buy(28)], at(56));
    expect(shuffled.ratePerDay).toBe(ordered.ratePerDay);
  });

  it("merges purchases made on the same day instead of dividing by zero", () => {
    const result = calculateConsumptionRate([buy(0, 6), buy(0, 6), buy(28)], at(28));
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
  });

  it("ignores future-dated, non-positive and invalid purchases", () => {
    const result = calculateConsumptionRate(
      [buy(0), buy(28), buy(500), buy(10, 0), buy(12, -3), { quantity: NaN, purchasedAt: day(14) }],
      at(28),
    );
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
    expect(result.intervals).toHaveLength(1);
  });

  it("drops purchases older than the age cap", () => {
    // The first purchase is 380 days before `now`, so only the recent pair counts.
    const result = calculateConsumptionRate([buy(0), buy(300), buy(328)], day(380));
    expect(result.intervals).toHaveLength(1);
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
  });

  it("only uses the most recent window of purchases", () => {
    const old = [buy(0, 100), buy(10, 100)];
    const recent = [buy(20), buy(48), buy(76), buy(104), buy(132), buy(160)];
    const result = calculateConsumptionRate([...old, ...recent], at(160));
    expect(result.intervals).toHaveLength(5);
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
  });

  it("flags a gap that looks like a missing receipt and leaves it out", () => {
    // The day-56 receipt was never uploaded.
    const result = calculateConsumptionRate(
      [buy(0), buy(28), buy(84), buy(112), buy(140)],
      at(140),
    );
    const excluded = result.intervals.filter((i) => i.excluded);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].excluded).toBe("possible-missing-purchase");
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
  });

  it("flags an unusually short gap as a possible early top-up", () => {
    const result = calculateConsumptionRate(
      [buy(0), buy(28), buy(56), buy(61), buy(89), buy(117)],
      at(117),
    );
    const excluded = result.intervals.filter((i) => i.excluded);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].excluded).toBe("possible-early-purchase");
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
  });

  it("does not flag outliers when there are too few intervals to judge", () => {
    // Day-56 receipt missing, but only 2 intervals, so we cannot tell.
    const result = calculateConsumptionRate([buy(0), buy(28), buy(84)], at(84));
    expect(result.intervals.every((i) => i.excluded === null)).toBe(true);
    expect(result.ratePerDay).toBeCloseTo(24 / 84, 5);
  });

  it("reports no error with too few intervals", () => {
    const result = calculateConsumptionRate([buy(0), buy(28), buy(56)], at(56));
    expect(result.errorPerDay).toBeNull();
    expect(result.relativeError).toBeNull();
  });

  it("reports a large error when the user's leftover stock is inconsistent", () => {
    // Buying at 4 left, then 10 left, then 4 left: intervals of 14, 42, 14 days.
    const erratic = calculateConsumptionRate([buy(0), buy(14), buy(56), buy(70)], at(70));
    const steady = calculateConsumptionRate([buy(0), buy(28), buy(56), buy(85)], at(85));
    expect(erratic.relativeError).toBeGreaterThan(0.25);
    expect(steady.relativeError).toBeLessThan(0.05);
  });

  it("shrinks the error as more consistent intervals arrive", () => {
    const few = calculateConsumptionRate([buy(0), buy(27), buy(56), buy(83)], at(83));
    const many = calculateConsumptionRate(
      [buy(0), buy(27), buy(56), buy(83), buy(112), buy(139)],
      at(139),
    );
    expect(many.relativeError!).toBeLessThan(few.relativeError!);
  });

  it("lets a caller override the config", () => {
    const result = calculateConsumptionRate([buy(0), buy(28), buy(56), buy(84)], at(84), {
      windowPurchases: 2,
    });
    expect(result.intervals).toHaveLength(1);
  });
});

describe("calculateConsumptionRate: learning from corrections", () => {
  const withCounts = (purchases: PurchasePoint[], corrections: LevelObservation[], nowDay: number, extra = {}) =>
    calculateConsumptionRate(purchases, at(nowDay), {}, { corrections, ...extra });

  it("learns from one purchase and one stock count", () => {
    // 12 bought, 7 left 10 days later: 5 used.
    const result = withCounts([buy(0)], [count(10, 7)], 10);
    expect(result.ratePerDay).toBeCloseTo(0.5, 5);
    expect(result.intervals).toHaveLength(1);
    expect(result.intervals[0]).toMatchObject({ kind: "correction", consumed: 5, days: 10 });
  });

  it("chains stretches between consecutive stock counts", () => {
    // 12 -> 7 -> 2, ten days each.
    const result = withCounts([buy(0)], [count(10, 7), count(20, 2)], 20);
    expect(result.ratePerDay).toBeCloseTo(0.5, 5);
    expect(result.intervals).toHaveLength(2);
  });

  it("adds purchases made between two counts", () => {
    // 7 left on day 10, bought 6 on day 15, 2 left on day 20: 7 + 6 - 2 = 11 used.
    const result = withCounts([buy(0), buy(15, 6)], [count(10, 7), count(20, 2)], 20);
    const second = result.intervals.find((i) => i.to.getTime() === day(20).getTime())!;
    expect(second.consumed).toBe(11);
  });

  it("starts the first stretch from the typical leftover plus the purchase", () => {
    // Had 3 at home, bought 12 (15 total), 7 left 10 days later: 8 used.
    const result = withCounts([buy(0)], [count(10, 7)], 10, { typicalLeftoverAtPurchase: 3 });
    expect(result.ratePerDay).toBeCloseTo(0.8, 5);
  });

  it("combines with purchase intervals that fall outside the counted days", () => {
    // Purchases at 0, 28, 56 give two 12-per-28-day intervals; the count covers day 56-66.
    const result = withCounts([buy(0), buy(28), buy(56)], [count(66, 8)], 66);
    expect(result.intervals).toHaveLength(3);
    expect(result.ratePerDay).toBeCloseTo((12 + 12 + 4) / (28 + 28 + 10), 5);
  });

  it("replaces purchase intervals that cover the same days", () => {
    const result = withCounts(
      [buy(0), buy(28), buy(56)],
      [count(5, 10), count(50, 6)],
      56,
    );
    const covered = result.intervals.filter((i) => i.excluded === "covered-by-correction");
    expect(covered).toHaveLength(2);
    // 12 - 10 = 2 over 5 days, then 10 + 12 - 6 = 16 over 45 days.
    expect(result.ratePerDay).toBeCloseTo((2 + 16) / 50, 5);
  });

  it("ignores a stretch that is too short to trust", () => {
    const result = withCounts([buy(0)], [count(10, 7), count(12, 6)], 12);
    const tooShort = result.intervals.filter((i) => i.excluded === "too-short");
    expect(tooShort).toHaveLength(1);
    expect(result.ratePerDay).toBeCloseTo(0.5, 5);
  });

  it("ignores a stretch where stock rose with no purchase to explain it", () => {
    // 7 left, then 9 left ten days later: someone bought or was given some.
    const result = withCounts([buy(0)], [count(10, 7), count(20, 9)], 20);
    const rose = result.intervals.filter((i) => i.excluded === "stock-increased");
    expect(rose).toHaveLength(1);
    expect(result.ratePerDay).toBeCloseTo(0.5, 5);
  });

  it("has nothing to learn from a count that comes before any purchase", () => {
    const result = withCounts([], [count(10, 7)], 10);
    expect(result.ratePerDay).toBeNull();
  });

  it("ignores counts that are invalid or in the future", () => {
    const result = withCounts(
      [buy(0)],
      [count(10, 7), count(500, 1), count(11, -2), { remainingQuantity: NaN, recordedAt: day(12) }],
      10,
    );
    expect(result.intervals).toHaveLength(1);
    expect(result.ratePerDay).toBeCloseTo(0.5, 5);
  });

  it("never flags a stock count that is only a little off as a purchase outlier", () => {
    // Four purchase intervals at 0.43/day; the count says 6 left on day 120, so 0.75/day: unusual, but believable.
    const result = withCounts([buy(0), buy(28), buy(56), buy(84), buy(112)], [count(120, 6)], 120);
    const stretch = result.intervals.find((i) => i.kind === "correction")!;
    expect(stretch.excluded).toBeNull();
  });

  it("leaves out a count that looks mistyped, and keeps the purchase gaps it would have replaced", () => {
    // Steady 0.43/day; then "0 left" 8 days after buying 12 means 1.5/day, 3.5 times the usual rate.
    const purchases = [buy(0), buy(28), buy(56), buy(84), buy(112), buy(140)];
    const result = withCounts(purchases, [count(120, 0)], 140);
    expect(result.intervals.find((i) => i.kind === "correction")!.excluded).toBe("unlikely-count");
    expect(result.intervals.filter((i) => i.excluded === "covered-by-correction")).toHaveLength(0);
    expect(result.ratePerDay).toBeCloseTo(12 / 28, 5);
  });

  it("does not judge a count before there is enough history to judge it by", () => {
    const result = withCounts([buy(0), buy(28)], [count(36, 0)], 36);
    expect(result.intervals.find((i) => i.kind === "correction")!.excluded).toBeNull();
  });

  it("falls back to using everything when outlier flags would leave nothing", () => {
    // Rates of 0.1, 0.1, 5, 5: every interval is far from the median of 2.55.
    const result = calculateConsumptionRate(
      [buy(0), buy(120), buy(240), buy(242.4), buy(244.8)],
      day(250),
    );
    expect(result.ratePerDay).toBeCloseTo(48 / 244.8, 5);
    expect(result.intervals.every((i) => i.excluded === null)).toBe(true);
  });
});

