import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AutobuySettingsSchema, DeliveryAddressSchema, EstimateSettingsSchema } from "./types";

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

describe("DeliveryAddressSchema", () => {
  const good = { firstName: " Ada ", lastName: "Lovelace", line1: "1 Main St", line2: "", city: "Austin", state: "tx", postalCode: "78701", phone: "(512) 555-0100" };

  it("cleans up a good address: trims, upper-cases the state, keeps ten phone digits", () => {
    expect(DeliveryAddressSchema.parse(good)).toEqual({ ...good, firstName: "Ada", state: "TX", phone: "5125550100" });
    expect(DeliveryAddressSchema.parse({ ...good, phone: "+1 512 555 0100" }).phone).toBe("5125550100");
  });

  it("ignores the extra hidden fields a submitted form carries (Next adds its own)", () => {
    const parsed = DeliveryAddressSchema.parse({ ...good, $ACTION_ID_abc: "", $ACTION_KEY: "k1", $ACTION_REF_1: "" });
    expect(Object.keys(parsed).sort()).toEqual(["city", "firstName", "lastName", "line1", "line2", "phone", "postalCode", "state"]);
  });

  it("says what is wrong, field by field", () => {
    const bad = DeliveryAddressSchema.safeParse({ ...good, firstName: "", state: "Texas", postalCode: "7870", phone: "555" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      const fields = Object.keys(z.flattenError(bad.error).fieldErrors).sort();
      expect(fields).toEqual(["firstName", "phone", "postalCode", "state"]);
    }
  });

  it("allows a ZIP+4 and leaves the second address line optional", () => {
    const withoutLine2 = { firstName: good.firstName, lastName: good.lastName, line1: good.line1, city: good.city, state: good.state, postalCode: good.postalCode, phone: good.phone };
    expect(DeliveryAddressSchema.parse({ ...withoutLine2, postalCode: "78701-1234" }).line2).toBe("");
  });
});

describe("preferred stores", () => {
  it("reads the list, tidied, with repeats dropped and order kept", () => {
    const result = parse({ preferredStores: JSON.stringify([" Walmart ", "Target", "walmart"]) });
    expect(result.data?.preferredStores.map((store) => store.toLowerCase())).toEqual(["walmart", "target"]);
  });

  it("means no preference when blank or unreadable", () => {
    expect(parse({}).data?.preferredStores).toEqual([]);
    expect(parse({ preferredStores: "" }).data?.preferredStores).toEqual([]);
    expect(parse({ preferredStores: "not json" }).data?.preferredStores).toEqual([]);
  });

  it("refuses too many", () => {
    expect(parse({ preferredStores: JSON.stringify(Array.from({ length: 9 }, (_, i) => `Store ${i}`)) }).success).toBe(false);
  });
});
