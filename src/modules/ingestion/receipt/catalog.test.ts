import { describe, expect, it } from "vitest";
import { CATALOG_SIZE, identify } from "./catalog";

const itemOf = (text: string) => identify(text).item?.name ?? null;

describe("identify", () => {
  it("finds the item and brand in receipt shorthand", () => {
    expect(identify("GV WHL MLK GL")).toMatchObject({ item: { name: "Milk", consumable: true }, brand: "Great Value" });
    expect(identify("KS TP 30")).toMatchObject({ item: { name: "Toilet Paper", unit: "rolls" }, brand: "Kirkland Signature" });
    expect(identify("MEMBER'S MARK WATER")).toMatchObject({ item: { name: "Water" }, brand: "Member's Mark" });
  });

  it("works out the item from a brand that only makes one thing", () => {
    expect(identify("CHARMIN ULTRA")).toMatchObject({ item: { name: "Toilet Paper" }, brand: "Charmin" });
    expect(identify("BOUNTY SELECT A SIZE")).toMatchObject({ item: { name: "Paper Towels" }, brand: "Bounty" });
  });

  it("reads shredded cheese blends as cheese but not shredded carrots", () => {
    expect(itemOf("365 OG FIESTA SHRED")).toBe("Cheese");
    expect(itemOf("PKG SHREDDED MOZZARELLA LITE")).toBe("Cheese");
    expect(itemOf("R CARROTS SHREDDED 10 OZ")).toBe("Carrots");
  });

  it("reads Gain as laundry detergent", () => {
    expect(identify("GAIN LFE")).toMatchObject({ item: { name: "Laundry Detergent" }, brand: "Gain" });
  });

  it("prefers the item named over what the brand implies", () => {
    expect(identify("BOUNTY NAPKINS")).toMatchObject({ item: { name: "Napkins" }, brand: "Bounty" });
  });

  it("matches singular and plural forms", () => {
    expect(itemOf("EGGS LRG")).toBe("Eggs");
    expect(itemOf("STRAWBERRIES 1LB")).toBe("Strawberries");
    expect(itemOf("TOMATOES 4-5 CEUNT")).toBe("Tomatoes");
    expect(itemOf("ROMA TOMATO")).toBe("Tomatoes");
  });

  it("prefers the longer, more specific term", () => {
    expect(itemOf("ALMOND MILK UNSWT")).toBe("Almond Milk");
    expect(itemOf("PAPER TOWELS")).toBe("Paper Towels");
    expect(itemOf("CHICKEN BREAST BNLS")).toBe("Chicken Breast");
    expect(itemOf("CHICKEN NOODLE SOUP")).toBe("Soup");
    expect(itemOf("GRAPE TOMATO")).toBe("Tomatoes");
    expect(itemOf("CARROTS SHREDDED 10 OZ")).toBe("Carrots");
    expect(itemOf("PEANUT BUTTR")).toBe("Peanut Butter");
    expect(itemOf("FF BS BREAST")).toBe("Chicken Breast");
    expect(itemOf("JACKORGSALSA")).toBe("Salsa");
    expect(itemOf("TIDEOXIPODS")).toBe("Laundry Pods");
    expect(itemOf("PANTENESHAMP")).toBe("Shampoo");
    expect(itemOf("MIXED VEGG")).toBe("Frozen Vegetables");
    expect(itemOf("KS IBU 2X500")).toBe("Pain Reliever");
  });

  it("marks things that don't get used up", () => {
    expect(identify("MAINSTAYS OFFICE CHAIR").item).toMatchObject({ consumable: false, category: "furniture" });
    expect(identify("BATH TOWEL GRY").item).toMatchObject({ consumable: false });
    expect(identify("ONN 32IN TV").item).toMatchObject({ consumable: false, category: "electronics" });
    expect(identify("$25 GIFT CARD").item).toMatchObject({ consumable: false });
  });

  it("marks durable goods seen in mixed retail receipts", () => {
    for (const name of ["ACTION FIGURES", "KIDS SLIPPERS", "CUTIE CAR", "SNORKEL SET", "GRILL COVER"]) {
      expect(identify(name).item?.consumable, name).toBe(false);
    }
  });

  it("gives the receipt's words without the brand's for items it doesn't know", () => {
    expect(identify("GV ZESTY THING")).toEqual({ item: null, brand: "Great Value", withoutBrand: "ZESTY THING" });
  });

  it("knows nothing about gibberish, and matches whole words only", () => {
    expect(identify("TANNED SRONE")).toEqual({ item: null, brand: null, withoutBrand: "TANNED SRONE" });
    expect(identify("GRAVY MIX").brand).toBeNull();
  });

  it("starts with a useful number of everyday items", () => {
    expect(CATALOG_SIZE).toBeGreaterThanOrEqual(150);
  });
});
