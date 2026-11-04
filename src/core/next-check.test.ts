import { describe, expect, it } from "vitest";
import { attentionWindowDays, needsAttention, nextCheckAt } from "./next-check";

const now = new Date("2026-11-03T12:00:00Z");
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

const estimate = (daysUntilRunOut: number | null, extra: Partial<{ threshold: number; earliest: number }> = {}) => ({
  daysUntilRunOut,
  daysUntilRunOutRange: extra.earliest === undefined ? null : { earliest: extra.earliest, latest: null },
  lowStockThresholdDays: extra.threshold ?? 7,
});

describe("attentionWindowDays", () => {
  it("is the low-stock threshold, or the lead time when that is longer", () => {
    expect(attentionWindowDays({ lowStockThresholdDays: 7 }, 3)).toBe(7);
    expect(attentionWindowDays({ lowStockThresholdDays: 7 }, 10)).toBe(10);
  });
});

describe("needsAttention", () => {
  it("is true at or inside the window, false outside, false with no estimate", () => {
    expect(needsAttention(estimate(7), 3)).toBe(true);
    expect(needsAttention(estimate(0), 3)).toBe(true);
    expect(needsAttention(estimate(7.5), 3)).toBe(false);
    expect(needsAttention(estimate(null), 3)).toBe(false);
  });

  it("matches the dashboard's own low flag with the default lead time", () => {
    // Same threshold, same comparison as predict's isLow.
    expect(needsAttention(estimate(5, { threshold: 5 }), 3)).toBe(true);
    expect(needsAttention(estimate(5.1, { threshold: 5 }), 3)).toBe(false);
  });

  it("uses the earliest plausible date when configured to", () => {
    const e = estimate(20, { earliest: 6 });
    expect(needsAttention(e, 3)).toBe(false);
    expect(needsAttention(e, 3, { lowStockUsesEarliestEstimate: true })).toBe(true);
  });

  it("looks further ahead when the lead time is longer than the threshold", () => {
    expect(needsAttention(estimate(9), 3)).toBe(false);
    expect(needsAttention(estimate(9), 10)).toBe(true);
  });
});

describe("nextCheckAt", () => {
  it("is the day the product comes inside the window", () => {
    // 20 days left, window 7: look in 13 days.
    expect(nextCheckAt({ estimate: estimate(20), now, leadDays: 3 })).toEqual(days(13));
  });

  it("is now for a product already inside the window or out", () => {
    expect(nextCheckAt({ estimate: estimate(4), now, leadDays: 3 })).toEqual(now);
    expect(nextCheckAt({ estimate: estimate(0), now, leadDays: 3 })).toEqual(now);
  });

  it("moves with the lead time and the threshold", () => {
    expect(nextCheckAt({ estimate: estimate(20), now, leadDays: 12 })).toEqual(days(8));
    expect(nextCheckAt({ estimate: estimate(20, { threshold: 14 }), now, leadDays: 3 })).toEqual(days(6));
  });

  it("follows the earliest plausible date when configured to", () => {
    const e = estimate(20, { earliest: 10 });
    expect(nextCheckAt({ estimate: e, now, leadDays: 3, config: { lowStockUsesEarliestEstimate: true } })).toEqual(days(3));
  });

  it("is null with no estimate and nothing arriving", () => {
    expect(nextCheckAt({ estimate: estimate(null), now, leadDays: 3 })).toBeNull();
  });

  it("is the arrival when an order lands before the product gets low, or when there is no estimate yet", () => {
    expect(nextCheckAt({ estimate: estimate(20), now, leadDays: 3, nextArrival: days(2) })).toEqual(days(2));
    expect(nextCheckAt({ estimate: estimate(null), now, leadDays: 3, nextArrival: days(2) })).toEqual(days(2));
  });

  it("ignores an arrival that is later than the day it gets low", () => {
    expect(nextCheckAt({ estimate: estimate(10), now, leadDays: 3, nextArrival: days(9) })).toEqual(days(3));
  });
});

describe("a product bought more often than the low-stock window", () => {
  const weekly = { daysUntilRunOut: 7, daysUntilRunOutRange: null, lowStockThresholdDays: 7, usualPackDays: 7, thresholdIsDefault: true };

  it("doesn't need attention the moment it is bought", () => {
    expect(attentionWindowDays(weekly, 3)).toBe(3.5);
    expect(needsAttention(weekly, 3)).toBe(false);
    expect(needsAttention({ ...weekly, daysUntilRunOut: 3 }, 3)).toBe(true);
  });

  it("leaves a product that lasts a long time alone", () => {
    expect(attentionWindowDays({ lowStockThresholdDays: 7, usualPackDays: 28, thresholdIsDefault: true }, 3)).toBe(7);
  });

  it("leaves a threshold the user chose as they set it", () => {
    expect(attentionWindowDays({ ...weekly, lowStockThresholdDays: 10, thresholdIsDefault: false }, 3)).toBe(10);
  });

  it("keeps a long lead time under the life of a purchase", () => {
    expect(attentionWindowDays(weekly, 30)).toBe(5.25);
  });
});
