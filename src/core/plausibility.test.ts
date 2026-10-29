import { describe, expect, it } from "vitest";
import { checkStockCount } from "./plausibility";

const rolls = { unit: "rolls", normalPurchaseQty: 12, estimatedRemaining: 5 };

describe("checking a typed stock count", () => {
  it("lets an ordinary count through", () => {
    expect(checkStockCount(0, rolls)).toBeNull();
    expect(checkStockCount(20, rolls)).toBeNull();
    expect(checkStockCount(36, rolls)).toBeNull();
  });

  it("asks about one far above a usual purchase", () => {
    expect(checkStockCount(200, rolls)).toBe("That's 200 rolls, a lot more than the 12 rolls you usually buy. Is that right?");
  });

  it("judges by our guess when that is the larger, so a stocked-up pantry isn't questioned", () => {
    expect(checkStockCount(100, { ...rolls, estimatedRemaining: 40 })).toBeNull();
  });

  it("has nothing to judge by for a product with no usual amount", () => {
    expect(checkStockCount(500, { unit: "each", normalPurchaseQty: 0, estimatedRemaining: null })).toBeNull();
  });
});
