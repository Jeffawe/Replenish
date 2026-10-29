import { describe, expect, it } from "vitest";
import type { PurchasePoint } from "./consumption-rate";
import { predict, type CorrectionPoint, type PredictProduct } from "./predict";

const DAY_MS = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(Date.UTC(2026, 0, 1) + n * DAY_MS);
const buy = (dayNumber: number, quantity = 12): PurchasePoint => ({
  quantity,
  purchasedAt: day(dayNumber),
});
const correction = (
  dayNumber: number,
  remainingQuantity: number,
  estimatedAtTime: number | null = null,
): CorrectionPoint => ({ remainingQuantity, recordedAt: day(dayNumber), estimatedAtTime });

const product: PredictProduct = {
  id: "toilet-paper",
  unit: "rolls",
  normalPurchaseQty: 12,
  fallbackDaysPerPurchase: null,
  lowStockThresholdDays: null,
  typicalLeftoverAtPurchase: null,
};

// 12 rolls every 28 days: rate 12 / 28 = 0.4286/day.
const steady = [buy(0), buy(28), buy(56)];
const steadyLong = [buy(0), buy(28), buy(56), buy(84), buy(112)];

// Recency weighting has its own tests in consumption-rate.test.ts; here it would only blur the worked numbers.
const run = (
  nowDay: number,
  purchases: PurchasePoint[] = steady,
  extra: Partial<Parameters<typeof predict>[0]> = {},
) => predict({ product, purchases, corrections: [], now: day(nowDay), ...extra }, { rate: { recencyHalfLifeDays: Infinity } });

describe("predict: the worked example", () => {
  // 19 days after the last purchase, as in the implementation doc.
  const estimate = run(75);

  it("learns 12 rolls / 28 days", () => {
    expect(estimate.consumptionPerDay).toBeCloseTo(12 / 28, 5);
    expect(estimate.rateSource).toBe("history");
  });

  it("estimates about 4 rolls left", () => {
    expect(estimate.estimatedRemaining).toBeCloseTo(12 - (12 / 28) * 19, 5);
    expect(estimate.estimatedRemaining).toBeCloseTo(3.86, 1);
  });

  it("estimates 9 days until it runs out", () => {
    expect(estimate.daysUntilRunOut).toBeCloseTo(9, 5);
  });

  it("anchors on the latest purchase", () => {
    expect(estimate.anchor).toEqual({ kind: "purchase", at: day(56), quantity: 12, disputed: false });
    expect(estimate.purchaseCount).toBe(3);
  });
});

describe("predict: starting stock", () => {
  it("adds the typical leftover to the purchase", () => {
    const estimate = run(75, steady, {
      product: { ...product, typicalLeftoverAtPurchase: 3 },
    });
    expect(estimate.anchor?.quantity).toBe(15);
    expect(estimate.estimatedRemaining).toBeCloseTo(15 - (12 / 28) * 19, 5);
    expect(estimate.daysUntilRunOut).toBeCloseTo(15 / (12 / 28) - 19, 5);
  });

  it("uses a correction newer than the last purchase as the anchor", () => {
    const estimate = run(75, steady, { corrections: [correction(70, 5)] });
    expect(estimate.anchor).toEqual({ kind: "correction", at: day(70), quantity: 5, disputed: false });
    // The correction also teaches the rate: 7 rolls used in the 14 days since the day-56 purchase.
    expect(estimate.consumptionPerDay).toBeCloseTo((12 + 12 + 7) / (28 + 28 + 14), 5);
    expect(estimate.estimatedRemaining).toBeCloseTo(5 - estimate.consumptionPerDay! * 5, 5);
  });

  it("uses a recent correction before a purchase as the leftover at that purchase", () => {
    // User said 3 left on day 54, so 9 of the day-28 pack were used in 26 days.
    // They bought on day 56 after using a bit more.
    const estimate = run(75, steady, { corrections: [correction(54, 3)] });
    expect(estimate.consumptionPerDay).toBeCloseTo((12 + 9) / (28 + 26), 5);
    expect(estimate.anchor?.kind).toBe("purchase");
    expect(estimate.anchor?.quantity).toBeCloseTo(3 - estimate.consumptionPerDay! * 2 + 12, 5);
  });

  it("ignores a correction too far before the purchase", () => {
    const estimate = run(75, steady, { corrections: [correction(20, 3)] });
    expect(estimate.anchor?.quantity).toBe(12);
  });

  it("sums purchases made on the same day", () => {
    const estimate = run(75, [buy(0), buy(28), buy(56, 6), buy(56, 6)]);
    expect(estimate.anchor?.quantity).toBe(12);
    expect(estimate.purchaseCount).toBe(3);
  });

  it("never reports a negative amount, and flags an overdue item as low", () => {
    const estimate = run(120);
    expect(estimate.estimatedRemaining).toBe(0);
    expect(estimate.daysUntilRunOut).toBe(0);
    expect(estimate.isLow).toBe(true);
  });
});

describe("predict: not enough data", () => {
  it("has no estimate without any history", () => {
    const estimate = run(10, []);
    expect(estimate.estimatedRemaining).toBeNull();
    expect(estimate.daysUntilRunOut).toBeNull();
    expect(estimate.confidence).toBe(0);
    expect(estimate.isLow).toBe(false);
  });

  it("has no rate from a single purchase without a fallback", () => {
    const estimate = run(10, [buy(0)]);
    expect(estimate.rateSource).toBe("none");
    expect(estimate.estimatedRemaining).toBeNull();
    expect(estimate.confidence).toBe(0);
  });

  it("uses the fallback for a single purchase, with low confidence", () => {
    const estimate = run(10, [buy(0)], {
      product: { ...product, fallbackDaysPerPurchase: 28 },
    });
    expect(estimate.rateSource).toBe("fallback");
    expect(estimate.consumptionPerDay).toBeCloseTo(12 / 28, 5);
    expect(estimate.daysUntilRunOut).toBeCloseTo(18, 5);
    expect(estimate.confidence).toBeLessThanOrEqual(0.3);
  });
});

describe("predict: learning from corrections", () => {
  it("learns a rate from one purchase and one stock count, with no fallback needed", () => {
    // Bought 12 on day 0, has 7 left on day 10: 5 used in 10 days.
    const estimate = run(10, [buy(0)], { corrections: [correction(10, 7)] });
    expect(estimate.rateSource).toBe("history");
    expect(estimate.consumptionPerDay).toBeCloseTo(0.5, 5);
    expect(estimate.daysUntilRunOut).toBeCloseTo(14, 5);
  });

  it("corrects a rate that purchases alone got wrong", () => {
    // A missing receipt makes the purchases say 12 / 56 = 0.21/day.
    const gap = [buy(0), buy(56)];
    const without = run(70, gap);
    expect(without.consumptionPerDay).toBeCloseTo(12 / 56, 5);
    // The user's counts say otherwise: 12 -> 6 over 14 days, then 6 -> 0 over 14 days.
    const withCounts = run(70, gap, {
      corrections: [correction(14, 6), correction(28, 0)],
    });
    expect(withCounts.consumptionPerDay!).toBeGreaterThan(0.35);
  });
});

describe("predict: low stock", () => {
  it("is low at or below the default 7-day threshold", () => {
    expect(run(75).isLow).toBe(false); // 9 days left
    expect(run(78).isLow).toBe(true); // 6 days left
  });

  it("uses the product's own threshold over the user's, and the user's over the default", () => {
    expect(run(75, steady, { product: { ...product, lowStockThresholdDays: 10 } }).isLow).toBe(true);
    expect(run(75, steady, { userLowStockThresholdDays: 10 }).isLow).toBe(true);
    expect(run(75, steady, { userLowStockThresholdDays: 3 }).isLow).toBe(false);
    expect(
      run(75, steady, {
        product: { ...product, lowStockThresholdDays: 3 },
        userLowStockThresholdDays: 10,
      }).isLow,
    ).toBe(false);
  });
});

describe("predict: error range", () => {
  it("collapses to a single day count for perfectly steady buying", () => {
    const estimate = run(131, steadyLong);
    expect(estimate.daysUntilRunOutRange?.earliest).toBeCloseTo(estimate.daysUntilRunOut!, 5);
    expect(estimate.daysUntilRunOutRange?.latest).toBeCloseTo(estimate.daysUntilRunOut!, 5);
  });

  it("widens when buying is erratic, around the central estimate", () => {
    // Buying at 4 left, 10 left, 4 left: intervals of 14, 42, 14 days.
    const erratic = [buy(0), buy(14), buy(56), buy(70)];
    const estimate = run(75, erratic);
    const range = estimate.daysUntilRunOutRange!;
    expect(range.earliest).toBeLessThan(estimate.daysUntilRunOut!);
    expect(range.latest === null || range.latest > estimate.daysUntilRunOut!).toBe(true);
  });

  it("can judge low stock by the earliest plausible date", () => {
    const erratic = [buy(0), buy(14), buy(56), buy(70)];
    const central = run(75, erratic);
    const cautious = predict(
      { product, purchases: erratic, corrections: [], now: day(75) },
      { lowStockUsesEarliestEstimate: true, rate: { recencyHalfLifeDays: Infinity } },
    );
    // Same estimate, but the cautious setting can only ever flag more items, never fewer.
    expect(cautious.daysUntilRunOut).toBe(central.daysUntilRunOut);
    expect(Number(cautious.isLow)).toBeGreaterThanOrEqual(Number(central.isLow));
  });
});

describe("predict: confidence", () => {
  it("is high for long, steady history with a known leftover", () => {
    const estimate = run(131, steadyLong, {
      product: { ...product, typicalLeftoverAtPurchase: 2 },
    });
    expect(estimate.confidence).toBeCloseTo(0.95, 5);
  });

  it("is lower when the leftover is only assumed", () => {
    expect(run(131, steadyLong).confidence).toBeCloseTo(0.85, 5);
  });

  it("clears the 80% auto-buy bar only with enough history", () => {
    expect(run(131, steadyLong).confidence).toBeGreaterThanOrEqual(0.8);
    expect(run(75, steady).confidence).toBeLessThan(0.8); // two intervals
  });

  it("grows with more purchases", () => {
    const two = run(75, [buy(0), buy(28)]).confidence;
    const three = run(75, steady).confidence;
    const five = run(131, steadyLong).confidence;
    expect(two).toBeLessThan(three);
    expect(three).toBeLessThan(five);
  });

  it("is low when buying is inconsistent", () => {
    const erratic = [buy(0), buy(14), buy(56), buy(70)];
    expect(run(75, erratic).confidence).toBeLessThan(0.5);
  });

  it("drops when the item is overdue with no new purchase", () => {
    const onTime = run(131, steadyLong).confidence;
    const overdue = run(160, steadyLong).confidence;
    expect(overdue).toBeLessThan(onTime);
  });

  it("drops when past corrections show the estimates were off", () => {
    // Same count from the user (5 left), but in one case we had predicted 5 and in the other 10.
    const accurate = run(131, steadyLong, { corrections: [correction(100, 5, 5)] });
    const inaccurate = run(131, steadyLong, { corrections: [correction(100, 5, 10)] });
    const factorOf = (e: typeof accurate) =>
      e.confidenceFactors.find((f) => f.label === "Past accuracy")!.value;
    expect(factorOf(accurate)).toBe(1);
    expect(factorOf(inaccurate)).toBeLessThan(0.5);
    expect(inaccurate.confidence).toBeLessThan(accurate.confidence);
  });

  it("is higher right after the user confirms the amount", () => {
    // 12 - 0.43 * 13 days = about 6.4 left, in line with the history.
    const confirmed = run(131, steadyLong, { corrections: [correction(125, 6.4)] });
    expect(confirmed.confidenceFactors.find((f) => f.label === "Starting stock")?.value).toBe(1);
    expect(confirmed.confidence).toBeGreaterThan(run(131, steadyLong).confidence);
  });

  it("trusts a count far from what we expected less, and marks it for a second look", () => {
    // We predicted about 6 left; "20" is more than a whole pack (12) away, so maybe a typo for 2.
    const typo = run(131, steadyLong, { corrections: [correction(125, 20, 6.4)] });
    expect(typo.estimatedRemaining).toBeGreaterThan(15); // still believed: the user is looking at the shelf
    expect(typo.anchor?.disputed).toBe(true);
    expect(typo.confidenceFactors.find((f) => f.label === "Starting stock")?.value).toBeLessThan(1);

    // The same "20" given again, when we now expected about 20, settles it.
    const confirmed = run(131, steadyLong, { corrections: [correction(125, 20, 6.4), correction(128, 19, 18.7)] });
    expect(confirmed.anchor?.disputed).toBe(false);
  });

  it("does not dispute a count that is only somewhat off, or one we had no guess for", () => {
    expect(run(131, steadyLong, { corrections: [correction(125, 2, 6.4)] }).anchor?.disputed).toBe(false);
    expect(run(131, steadyLong, { corrections: [correction(125, 20)] }).anchor?.disputed).toBe(false);
  });

  it("explains itself with a factor per reason, and the confidence is their product", () => {
    const estimate = run(131, steadyLong);
    expect(estimate.confidenceFactors.map((f) => f.label)).toEqual([
      "Purchase history",
      "Consistency",
      "Starting stock",
    ]);
    const product_ = estimate.confidenceFactors.reduce((t, f) => t * f.value, 1);
    expect(estimate.confidence).toBeCloseTo(product_, 10);
  });

  it("notes ignored purchase gaps", () => {
    // Day-56 receipt missing: one gap of 56 days among 4 intervals.
    const estimate = run(160, [buy(0), buy(28), buy(84), buy(112), buy(140)]);
    expect(estimate.confidenceFactors.some((f) => f.label === "Unusual purchases")).toBe(true);
  });
});

describe("predict: learning the usual purchase", () => {
  it("is the median of recent purchases, so one odd purchase doesn't move it", () => {
    // Stored as 1 (the first purchase was a single item), but they buy 12 at a time; one 120 is a misread.
    const purchases = [buy(0, 1), buy(28, 12), buy(56, 12), buy(84, 120), buy(112, 12)];
    expect(run(120, purchases, { product: { ...product, normalPurchaseQty: 1 } }).normalPurchaseQty).toBe(12);
  });

  it("is the stored value until there are purchases", () => {
    expect(run(10, []).normalPurchaseQty).toBe(12);
  });
});

describe("predict: learning how much is left when buying", () => {
  // Rate 12 / 28 a day. Counts given 2 days before two purchases: 3 left, then 1 left.
  const counted = [correction(26, 3.86), correction(54, 1.86)];

  it("measures it from stock counts given just before buying", () => {
    const estimate = run(60, steady, { corrections: counted });
    expect(estimate.typicalLeftover.source).toBe("learned");
    expect(estimate.typicalLeftover.quantity).toBeCloseTo(2, 1);
  });

  it("trusts enough measurements over the user's answer, and the answer over a single measurement", () => {
    const answered = { ...product, typicalLeftoverAtPurchase: 6 };
    expect(run(60, steady, { product: answered, corrections: counted }).typicalLeftover.source).toBe("learned");
    expect(run(60, steady, { product: answered, corrections: [counted[1]!] }).typicalLeftover).toEqual({ quantity: 6, source: "answer" });
  });

  it("knows nothing without counts or an answer", () => {
    expect(run(60).typicalLeftover).toEqual({ quantity: null, source: "none" });
  });

  it("ignores a count made too long before buying", () => {
    // Counted on day 10, 18 days before the next purchase: too much could have changed.
    expect(run(60, steady, { corrections: [correction(10, 3)] }).typicalLeftover.source).toBe("none");
  });
});
