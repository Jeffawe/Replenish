import { describe, expect, it } from "vitest";
import { autoBuyBlockers, autoBuyDecision, factsFor, type AutoBuyFacts } from "./auto-buy";

const ok: AutoBuyFacts = {
  confirmed: true,
  autobuyEnabled: true,
  confidence: 0.86,
  minConfidence: 0.8,
  withinRange: true,
  concerns: [],
  monthlyCapCents: null,
  spentThisMonthCents: 0,
  chargeCents: 1500,
};

describe("autoBuyBlockers", () => {
  it("has no reasons when everything is fine", () => {
    expect(autoBuyBlockers(ok)).toEqual([]);
  });

  it("says why, in words, for each thing that stops it", () => {
    expect(autoBuyBlockers({ ...ok, autobuyEnabled: false })).toEqual(["Auto-buy is off for this product"]);
    expect(autoBuyBlockers({ ...ok, confirmed: false })).toEqual(["You haven't confirmed you track this product"]);
    expect(autoBuyBlockers({ ...ok, confidence: 0.62 })).toEqual(["We're only 62% sure it's running out, and your minimum is 80%"]);
    expect(autoBuyBlockers({ ...ok, concerns: ["size-unknown", "other-brand"] })).toEqual(["Pack size not stated", "Different brand"]);
  });

  it("names the price limit once, whether it comes from the range or the listing's concern", () => {
    expect(autoBuyBlockers({ ...ok, withinRange: false })).toEqual(["Over your price limit"]);
    expect(autoBuyBlockers({ ...ok, withinRange: false, concerns: ["outside-price-range"] })).toEqual(["Over your price limit"]);
  });

  it("stops at the monthly cap, counting what this order would charge", () => {
    const capped = { ...ok, monthlyCapCents: 5000, spentThisMonthCents: 3600 };
    expect(autoBuyBlockers(capped)).toEqual(["It would go over your $50.00 limit for the month"]);
    expect(autoBuyBlockers({ ...capped, spentThisMonthCents: 3500 })).toEqual([]); // exactly the cap is fine
  });

  it("lists every reason at once", () => {
    expect(autoBuyBlockers({ ...ok, autobuyEnabled: false, confidence: 0.5 })).toHaveLength(2);
  });
});

describe("autoBuyDecision", () => {
  it("explains a purchase in words", () => {
    expect(autoBuyDecision(ok, 998)).toContain("86% sure");
    expect(autoBuyDecision(ok, 998)).toContain("$9.98");
  });
});

describe("autoBuyBlockers: limits added for safety", () => {
  it("holds back after an order went wrong or was cancelled", () => {
    expect(autoBuyBlockers({ ...ok, recentProblem: "failed" })[0]).toContain("didn't go through");
    expect(autoBuyBlockers({ ...ok, recentProblem: "cancelled" })[0]).toContain("cancelled");
    expect(autoBuyBlockers({ ...ok, recentProblem: null })).toEqual([]);
  });

  it("says when our limits stopped it, not the user's", () => {
    expect(autoBuyBlockers({ ...ok, overPlatformOrderCents: 5000 })).toEqual(["It's over the $50.00 most auto-buy can spend on one order"]);
    expect(autoBuyBlockers({ ...ok, monthlyCapCents: 500, monthlyCapIsPlatform: true })).toEqual(["It would go over the $5.00 auto-buy can spend in a month"]);
    expect(autoBuyBlockers({ ...ok, monthlyCapCents: 500, monthlyCapIsPlatform: false })).toEqual(["It would go over your $5.00 limit for the month"]);
  });
});

describe("factsFor: our limits and the user's", () => {
  const product = { confirmedAt: new Date(), autobuyEnabled: true, autobuyMinPriceCents: null, autobuyMaxPriceCents: null, boughtFrom: null, boughtFromByUser: false };
  const settings = { autobuyMinConfidence: 0.8, autobuyMinPriceCents: null, autobuyMaxPriceCents: null, autobuyMonthlyCapCents: null, preferredStores: [] };
  const limits = { orderCents: 3000, monthCents: 10000 };
  const facts = (overrides = {}, totalCents = 1000) => factsFor({ listing: { domain: "walmart.com", totalCents, concerns: [] }, product, confidence: 0.9, settings: { ...settings, ...overrides }, spentThisMonthCents: 0, limits });

  it("uses ours when the user has set nothing", () => {
    expect(facts()).toMatchObject({ wholeOrderLimitCents: 3000, monthlyCapCents: 10000, monthlyCapIsPlatform: true, overPlatformOrderCents: null });
  });

  it("lets the user go lower", () => {
    expect(facts({ autobuyMaxPriceCents: 2000, autobuyMonthlyCapCents: 5000 })).toMatchObject({ wholeOrderLimitCents: 2000, monthlyCapCents: 5000, monthlyCapIsPlatform: false });
  });

  it("never lets a saved limit go higher", () => {
    expect(facts({ autobuyMaxPriceCents: 9000, autobuyMonthlyCapCents: 90000 })).toMatchObject({ wholeOrderLimitCents: 3000, monthlyCapCents: 10000, monthlyCapIsPlatform: true });
  });

  it("flags an order whose items and fees alone are over ours", () => {
    expect(facts({}, 2900).overPlatformOrderCents).toBe(3000);
    expect(facts({}, 2700).overPlatformOrderCents).toBeNull();
  });

  it("holds no more than our limit on PayPal", () => {
    expect(facts({}, 2700).chargeCents).toBe(3000);
  });
});
