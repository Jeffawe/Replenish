import { describe, expect, it } from "vitest";
import { normalizeBrands, ProductEditSchema } from "./types";

const productId = "0b0f3d9e-6d0e-4a37-9d0a-3f0f8f6f2a11";
const parse = (fields: Record<string, string>) =>
  ProductEditSchema.safeParse({ productId, name: "Toilet Paper", unit: "rolls", ...fields });

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

  it("needs a name", () => {
    expect(parse({ name: "  " }).success).toBe(false);
  });

  it("matches by name unless told not to, so a form without the switch keeps the default", () => {
    expect(parse({}).data?.matchByName).toBe(true);
    expect(parse({ matchByName: "false" }).data?.matchByName).toBe(false);
    expect(parse({ matchByName: "true" }).data?.matchByName).toBe(true);
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

describe("ProductEditSchema: auto-buy and where it was bought", () => {
  it("reads the switch as a boolean, and leaves it out when the form has none", () => {
    expect(parse({ autobuyEnabled: "true" }).data?.autobuyEnabled).toBe(true);
    expect(parse({ autobuyEnabled: "false" }).data?.autobuyEnabled).toBe(false);
    expect(parse({}).data?.autobuyEnabled).toBeUndefined();
  });

  it("turns the price range in dollars into cents, blank into none", () => {
    expect(parse({ autobuyMinPrice: "2.50", autobuyMaxPrice: "9" }).data).toMatchObject({ autobuyMinPriceCents: 250, autobuyMaxPriceCents: 900 });
    expect(parse({ autobuyMinPrice: "", autobuyMaxPrice: "" }).data).toMatchObject({ autobuyMinPriceCents: null, autobuyMaxPriceCents: null });
  });

  it("refuses a most price below the least price, pointing at the most", () => {
    const result = parse({ autobuyMinPrice: "10", autobuyMaxPrice: "5" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["autobuyMaxPrice"]);
  });

  it("trims the store, keeps blank as blank (to clear it) and leaves it out when missing", () => {
    expect(parse({ boughtFrom: "  Costco " }).data?.boughtFrom).toBe("Costco");
    expect(parse({ boughtFrom: "" }).data?.boughtFrom).toBe("");
    expect(parse({}).data?.boughtFrom).toBeUndefined();
  });
});
