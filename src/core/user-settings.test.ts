import { describe, expect, it } from "vitest";
import {
  clampConfidence,
  DEFAULT_USER_SETTINGS,
  dollarsToCents,
  MIN_AUTOBUY_CONFIDENCE,
  priceRangeFor,
  withinRange,
} from "./user-settings";

const none = { autobuyMinPriceCents: null, autobuyMaxPriceCents: null };

describe("defaults", () => {
  it("start at the confidence floor, with no price limits and no cap", () => {
    expect(DEFAULT_USER_SETTINGS.autobuyMinConfidence).toBe(MIN_AUTOBUY_CONFIDENCE);
    expect(DEFAULT_USER_SETTINGS.autobuyMinPriceCents).toBeNull();
    expect(DEFAULT_USER_SETTINGS.autobuyMaxPriceCents).toBeNull();
    expect(DEFAULT_USER_SETTINGS.autobuyMonthlyCapCents).toBeNull();
  });
});

describe("clampConfidence", () => {
  it("never allows less than the floor or more than 100%", () => {
    expect(clampConfidence(0.5)).toBe(0.8);
    expect(clampConfidence(0.9)).toBe(0.9);
    expect(clampConfidence(1.4)).toBe(1);
  });
});

describe("priceRangeFor", () => {
  const user = { autobuyMinPriceCents: 200, autobuyMaxPriceCents: 1000 };

  it("uses the user's range when the product has none", () => {
    expect(priceRangeFor(user, none)).toEqual({ minCents: 200, maxCents: 1000 });
  });

  it("uses the product's own range instead, not mixed with the user's", () => {
    expect(priceRangeFor(user, { autobuyMinPriceCents: 3000, autobuyMaxPriceCents: 5000 })).toEqual({ minCents: 3000, maxCents: 5000 });
    // One side set means the other side is open, not the user's value (which could make an impossible range).
    expect(priceRangeFor(user, { autobuyMinPriceCents: 3000, autobuyMaxPriceCents: null })).toEqual({ minCents: 3000, maxCents: null });
  });

  it("has no limit when neither sets one", () => {
    expect(priceRangeFor(none, none)).toEqual({ minCents: null, maxCents: null });
  });
});

describe("withinRange", () => {
  it("counts both ends as inside", () => {
    const range = { minCents: 200, maxCents: 1000 };
    expect(withinRange(200, range)).toBe(true);
    expect(withinRange(1000, range)).toBe(true);
    expect(withinRange(199, range)).toBe(false);
    expect(withinRange(1001, range)).toBe(false);
  });

  it("ignores a side with no limit", () => {
    expect(withinRange(99999, { minCents: null, maxCents: null })).toBe(true);
    expect(withinRange(50, { minCents: 100, maxCents: null })).toBe(false);
    expect(withinRange(5000, { minCents: null, maxCents: 1000 })).toBe(false);
  });
});

describe("dollarsToCents", () => {
  it("rounds to whole cents", () => {
    expect(dollarsToCents(12.5)).toBe(1250);
    expect(dollarsToCents(0.29)).toBe(29);
    expect(dollarsToCents(4.35)).toBe(435); // 4.35 * 100 is 434.99999999999994 in floating point
  });
});
