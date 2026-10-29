import { afterEach, describe, expect, it } from "vitest";
import { approvalRequired, isApproved } from "./approval";

const original = process.env.REQUIRE_APPROVAL;
afterEach(() => {
  if (original === undefined) delete process.env.REQUIRE_APPROVAL;
  else process.env.REQUIRE_APPROVAL = original;
});

describe("approval", () => {
  it("is off unless REQUIRE_APPROVAL is set, and then everyone counts as approved", () => {
    delete process.env.REQUIRE_APPROVAL;
    expect(approvalRequired()).toBe(false);
    expect(isApproved({ approvedAt: null })).toBe(true);
    process.env.REQUIRE_APPROVAL = "0";
    expect(approvalRequired()).toBe(false);
    process.env.REQUIRE_APPROVAL = "";
    expect(approvalRequired()).toBe(false);
  });

  it("turns on with 1 or true, and then only approved accounts count", () => {
    for (const value of ["1", "true", "TRUE", " 1 "]) {
      process.env.REQUIRE_APPROVAL = value;
      expect(approvalRequired()).toBe(true);
      expect(isApproved({ approvedAt: null })).toBe(false);
      expect(isApproved({ approvedAt: new Date() })).toBe(true);
    }
  });
});
