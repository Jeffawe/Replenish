import { describe, expect, it } from "vitest";
import { normalizeBrands, ProductEditSchema } from "./types";

const productId = "0b0f3d9e-6d0e-4a37-9d0a-3f0f8f6f2a11";
const parse = (fields: Record<string, string>) =>
  ProductEditSchema.safeParse({ productId, unit: "rolls", ...fields });

describe("normalizeBrands", () => {
  it("trims, drops blanks and duplicates, and rejoins with commas", () => {
    expect(normalizeBrands(" Charmin,Quilted Northern , ,charmin ")).toBe("Charmin, Quilted Northern");
  });

  it("returns null when nothing is left", () => {
    expect(normalizeBrands(" , ,")).toBeNull();
    expect(normalizeBrands(null)).toBeNull();
  });
});

describe("ProductEditSchema", () => {
  it("treats blank optional fields as no answer", () => {
    const result = parse({
      category: "",
      brand: "  ",
      remainingNow: "",
      fallbackDaysPerPurchase: "",
      typicalLeftoverAtPurchase: " ",
      lowStockThresholdDays: "",
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      category: null,
      brand: null,
      remainingNow: null,
      fallbackDaysPerPurchase: null,
      typicalLeftoverAtPurchase: null,
      lowStockThresholdDays: null,
    });
  });

  it("parses numbers from form strings", () => {
    const result = parse({
      remainingNow: "3.5",
      fallbackDaysPerPurchase: "28",
      typicalLeftoverAtPurchase: "0",
      lowStockThresholdDays: "10",
    });
    expect(result.data).toMatchObject({
      remainingNow: 3.5,
      fallbackDaysPerPurchase: 28,
      typicalLeftoverAtPurchase: 0,
      lowStockThresholdDays: 10,
    });
  });

  it("keeps zero as a real answer, not a blank", () => {
    expect(parse({ remainingNow: "0" }).data?.remainingNow).toBe(0);
  });

  it("normalizes the brand list", () => {
    expect(parse({ brand: "Charmin, Cottonelle,charmin" }).data?.brand).toBe("Charmin, Cottonelle");
  });

  it("rejects an empty unit", () => {
    expect(parse({ unit: "  " }).success).toBe(false);
  });

  it("rejects negative or non-numeric answers", () => {
    expect(parse({ remainingNow: "-1" }).success).toBe(false);
    expect(parse({ remainingNow: "lots" }).success).toBe(false);
    expect(parse({ typicalLeftoverAtPurchase: "-2" }).success).toBe(false);
  });

  it("rejects fractional or zero day counts", () => {
    expect(parse({ fallbackDaysPerPurchase: "2.5" }).success).toBe(false);
    expect(parse({ lowStockThresholdDays: "0" }).success).toBe(false);
  });

  it("rejects an invalid product id", () => {
    expect(ProductEditSchema.safeParse({ productId: "nope", unit: "rolls" }).success).toBe(false);
  });
});
