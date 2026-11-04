import { describe, expect, it } from "vitest";
import { isAbandoned, overdueDays } from "./abandoned";

const now = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
// 12 rolls at 1 a day: lasts 12 days.
const facts = (boughtDaysAgo: number) => ({ anchor: { kind: "purchase" as const, at: daysAgo(boughtDaysAgo), quantity: 12, disputed: false }, consumptionPerDay: 1, usualPackDays: 12 });

describe("isAbandoned", () => {
  it("isn't overdue before the expected run-out", () => {
    expect(overdueDays(facts(5), now)).toBe(0);
    expect(isAbandoned(facts(5), now)).toBe(false);
  });

  it("gives a fast product at least a month", () => {
    expect(overdueDays(facts(40), now)).toBe(28);
    expect(isAbandoned(facts(40), now)).toBe(false);
    expect(isAbandoned(facts(43), now)).toBe(true);
  });

  it("gives a slow product two of its own cycles", () => {
    const slow = { anchor: { kind: "purchase" as const, at: daysAgo(100), quantity: 40, disputed: false }, consumptionPerDay: 1, usualPackDays: 40 };
    expect(isAbandoned(slow, now)).toBe(false);
    expect(isAbandoned({ ...slow, anchor: { ...slow.anchor, at: daysAgo(125) } }, now)).toBe(true);
  });

  it("says nothing with no estimate", () => {
    expect(isAbandoned({ anchor: null, consumptionPerDay: null, usualPackDays: null }, now)).toBe(false);
  });
});
