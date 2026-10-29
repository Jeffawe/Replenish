import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECEIPT_LIMIT,
  effectiveReceiptLimit,
  limitReachedMessage,
  monthStart,
  nextMonthStart,
} from "./receipt-limit";

describe("effectiveReceiptLimit", () => {
  it("prefers the user's own limit, even 0 or a high one", () => {
    expect(effectiveReceiptLimit(50, "10")).toBe(50);
    expect(effectiveReceiptLimit(0, "10")).toBe(0);
  });

  it("falls back to RECEIPT_LIMIT, then to the default", () => {
    expect(effectiveReceiptLimit(null, "25")).toBe(25);
    expect(effectiveReceiptLimit(null, " 25 ")).toBe(25);
    expect(effectiveReceiptLimit(null, undefined)).toBe(DEFAULT_RECEIPT_LIMIT);
  });

  it("ignores values that make no sense instead of locking everyone out", () => {
    for (const bad of ["", "ten", "-3", "2.5", "NaN"]) expect(effectiveReceiptLimit(null, bad)).toBe(DEFAULT_RECEIPT_LIMIT);
    expect(effectiveReceiptLimit(-1, undefined)).toBe(DEFAULT_RECEIPT_LIMIT);
  });
});

describe("months", () => {
  it("run from the 1st 00:00 UTC to the next 1st", () => {
    const now = new Date("2026-10-31T23:59:59Z");
    expect(monthStart(now).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(nextMonthStart(now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("roll over the year", () => {
    expect(nextMonthStart(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("limitReachedMessage", () => {
  it("says how many and when more come", () => {
    expect(limitReachedMessage(10, new Date("2026-10-29T12:00:00Z"))).toBe(
      "You've used all 10 of your receipt photos for this month. You'll get more on November 1.",
    );
  });

  it("doesn't promise more to an account set to 0", () => {
    expect(limitReachedMessage(0, new Date("2026-10-29T12:00:00Z"))).not.toMatch(/get more/);
  });
});
