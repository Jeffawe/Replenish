import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  finalCostCents,
  monthStart,
  orderFeesCents,
  priceBreakdown,
  refundShouldBeCents,
  serviceFeeCents,
  refundDueCents,
  upfrontChargeCents,
  zincCeilingCents,
} from "./order-money";

describe("the ceiling and what is charged up front", () => {
  it("leaves room for tax and shipping, rounding up", () => {
    expect(zincCeilingCents(1000)).toBe(1300);
    expect(zincCeilingCents(999)).toBe(1299); // 1298.7 rounds up
    expect(zincCeilingCents(3955)).toBeGreaterThan(4900); // the sandbox order that came to $49.00
  });

  it("charges the ceiling plus Zinc's fee and ours", () => {
    expect(upfrontChargeCents(1300, 250)).toBe(1550);
  });
});

describe("once Zinc has bought it", () => {
  it("costs the retailer's total plus the two fees", () => {
    expect(finalCostCents(4900, 250)).toBe(5150);
  });

  it("refunds what the ceiling didn't use, and never a negative amount", () => {
    const charged = upfrontChargeCents(zincCeilingCents(3955), 250);
    expect(refundDueCents(charged, finalCostCents(4900, 250))).toBe(charged - finalCostCents(4900, 250));
    expect(refundDueCents(1000, 5000)).toBe(0);
  });
});

describe("centsToDecimal", () => {
  it("makes the amounts PayPal wants", () => {
    expect(centsToDecimal(1234)).toBe("12.34");
    expect(centsToDecimal(5)).toBe("0.05");
    expect(centsToDecimal(1000)).toBe("10.00");
  });
});

describe("monthStart", () => {
  it("is the first of the month at midnight UTC", () => {
    expect(monthStart(new Date("2026-11-17T15:30:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("zincCeilingCents with a limit on the whole order", () => {
  it("leaves less for tax and shipping, so fees and all it can't pass the limit", () => {
    expect(zincCeilingCents(1000, 1300)).toBe(1075);
    expect(upfrontChargeCents(zincCeilingCents(1000, 1300), orderFeesCents(1000))).toBe(1300);
    expect(zincCeilingCents(1000, 5000)).toBe(1300); // no need to squeeze
    expect(zincCeilingCents(1000)).toBe(1300);
  });
});

describe("refundShouldBeCents", () => {
  it("is everything when the order didn't happen, the unused part when it did, nothing while it's going", () => {
    expect(refundShouldBeCents({ status: "failed", chargedCents: 1000, totalCents: null })).toBe(1000);
    expect(refundShouldBeCents({ status: "cancelled", chargedCents: 1000, totalCents: null })).toBe(1000);
    expect(refundShouldBeCents({ status: "placed", chargedCents: 1000, totalCents: 800 })).toBe(200);
    expect(refundShouldBeCents({ status: "processing", chargedCents: 1000, totalCents: null })).toBe(0);
    expect(refundShouldBeCents({ status: "failed", chargedCents: null, totalCents: null })).toBe(0);
  });
});

describe("priceBreakdown", () => {
  it("adds up, and every screen gets its numbers from here", () => {
    const price = priceBreakdown(1000);
    expect(price.feesCents).toBe(price.orderingFeeCents + price.serviceFeeCents);
    expect(price.leastCents).toBe(1000 + price.feesCents);
    expect(price.heldCents).toBe(1300 + price.feesCents);
  });

  it("holds no more than a limit on the whole order", () => {
    expect(priceBreakdown(1000, 1400).heldCents).toBe(1400);
  });
});

describe("serviceFeeCents", () => {
  it("is 7% of the store price, with a minimum so a small order still covers PayPal's cut", () => {
    expect(serviceFeeCents(500)).toBe(125);
    expect(serviceFeeCents(1300)).toBe(125);
    expect(serviceFeeCents(2000)).toBe(140);
    expect(serviceFeeCents(3000)).toBe(210);
    expect(serviceFeeCents(4500)).toBe(315);
  });

  it("comes to the fees we promised on each size of order", () => {
    expect([500, 1300, 2000, 3000, 4500].map(orderFeesCents)).toEqual([225, 225, 240, 310, 415]);
  });
});
