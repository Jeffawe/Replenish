import { describe, expect, it } from "vitest";
import { AutobuySettingsSchema, EstimateSettingsSchema } from "./types";

const parse = (fields: Record<string, string>) => AutobuySettingsSchema.safeParse(fields);

describe("AutobuySettingsSchema", () => {
  it("turns a blank form into the defaults", () => {
    expect(parse({})).toMatchObject({
      success: true,
      data: {
        autobuyMinConfidence: 0.8,
        autobuyMinPriceCents: null,
        autobuyMaxPriceCents: null,
        autobuyMonthlyCapCents: null,
        autobuyLeadDays: 3,
      },
    });
  });

  it("stores confidence as a fraction and money as cents", () => {
    const result = parse({ minConfidencePercent: "90", minPrice: "2", maxPrice: "12.50", monthlyCap: "150", leadDays: "5" });
    expect(result).toMatchObject({
      success: true,
      data: { autobuyMinConfidence: 0.9, autobuyMinPriceCents: 200, autobuyMaxPriceCents: 1250, autobuyMonthlyCapCents: 15000, autobuyLeadDays: 5 },
    });
  });

  it("refuses a confidence below the floor, or above 100%", () => {
    const low = parse({ minConfidencePercent: "79" });
    expect(low.success).toBe(false);
    expect(low.error?.issues[0]?.path).toEqual(["minConfidencePercent"]);
    expect(parse({ minConfidencePercent: "101" }).success).toBe(false);
    expect(parse({ minConfidencePercent: "80" }).success).toBe(true);
  });

  it("refuses a most price below the least price, pointing at the most", () => {
    const result = parse({ minPrice: "10", maxPrice: "5" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["maxPrice"]);
    expect(parse({ minPrice: "5", maxPrice: "5" }).success).toBe(true);
  });

  it("accepts one price limit on its own", () => {
    expect(parse({ maxPrice: "20" })).toMatchObject({ success: true, data: { autobuyMinPriceCents: null, autobuyMaxPriceCents: 2000 } });
  });

  it("refuses negative or nonsense amounts and days", () => {
    expect(parse({ minPrice: "-1" }).success).toBe(false);
    expect(parse({ maxPrice: "lots" }).success).toBe(false);
    expect(parse({ monthlyCap: "-5" }).success).toBe(false);
    expect(parse({ leadDays: "-1" }).success).toBe(false);
    expect(parse({ leadDays: "2.5" }).success).toBe(false);
  });
});

describe("EstimateSettingsSchema", () => {
  it("reads a threshold, and blank as the default", () => {
    expect(EstimateSettingsSchema.parse({ lowStockThresholdDays: "10" })).toEqual({ lowStockThresholdDays: 10 });
    expect(EstimateSettingsSchema.parse({ lowStockThresholdDays: "" })).toEqual({ lowStockThresholdDays: null });
    expect(EstimateSettingsSchema.safeParse({ lowStockThresholdDays: "0" }).success).toBe(false);
  });
});
