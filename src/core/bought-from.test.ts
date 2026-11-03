import { describe, expect, it } from "vitest";
import { boughtFromAfterEdit, cleanStore } from "./bought-from";

describe("cleanStore", () => {
  it("trims, single-spaces and turns blank into null", () => {
    expect(cleanStore("  Whole   Foods ")).toBe("Whole Foods");
    expect(cleanStore("   ")).toBeNull();
    expect(cleanStore(null)).toBeNull();
  });
});

describe("boughtFromAfterEdit", () => {
  const fromReceipt = { boughtFrom: "Walmart", boughtFromByUser: false };

  it("changes nothing when the form didn't have the field", () => {
    expect(boughtFromAfterEdit(fromReceipt, undefined)).toEqual(fromReceipt);
  });

  it("keeps a receipt's value as the receipt's when saved unchanged", () => {
    expect(boughtFromAfterEdit(fromReceipt, "Walmart")).toEqual(fromReceipt);
    expect(boughtFromAfterEdit(fromReceipt, " walmart ")).toEqual(fromReceipt);
  });

  it("returns only the two fields, even when given a whole product", () => {
    const product = { id: "p1", name: "Milk", ...fromReceipt };
    expect(boughtFromAfterEdit(product, "Walmart")).toEqual(fromReceipt);
  });

  it("makes a typed store the user's own", () => {
    expect(boughtFromAfterEdit(fromReceipt, "Costco")).toEqual({ boughtFrom: "Costco", boughtFromByUser: true });
    expect(boughtFromAfterEdit({ boughtFrom: null, boughtFromByUser: false }, "Target")).toEqual({ boughtFrom: "Target", boughtFromByUser: true });
  });

  it("clears it on blank, so receipts can fill it again", () => {
    expect(boughtFromAfterEdit({ boughtFrom: "Costco", boughtFromByUser: true }, "")).toEqual({ boughtFrom: null, boughtFromByUser: false });
  });
});
