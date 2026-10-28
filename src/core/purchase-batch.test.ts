import { describe, expect, it } from "vitest";
import { PurchaseBatchSchema } from "./purchase-batch";

const valid = {
  source: "receipt",
  idempotencyKey: "sha256-abcdef123456",
  store: "Walmart",
  purchasedAt: "2026-10-20",
  items: [{ productName: "Charmin Toilet Paper", quantity: 12, unit: "rolls", priceCents: 1299 }],
};
const parse = (overrides: Record<string, unknown>) =>
  PurchaseBatchSchema.safeParse({ ...valid, ...overrides });

describe("PurchaseBatchSchema", () => {
  it("accepts a minimal receipt and fills in the currency", () => {
    const result = parse({});
    expect(result.success).toBe(true);
    expect(result.data?.currency).toBe("USD");
    expect(result.data?.purchasedAt).toEqual(new Date("2026-10-20"));
  });

  it("normalizes the source and currency", () => {
    const result = parse({ source: " Receipt ", currency: "eur" });
    expect(result.data).toMatchObject({ source: "receipt", currency: "EUR" });
  });

  it("accepts any well-formed new source without code changes", () => {
    expect(parse({ source: "retailer-api" }).success).toBe(true);
    expect(parse({ source: "barcode_scan" }).success).toBe(true);
  });

  it("rejects malformed sources", () => {
    expect(parse({ source: "" }).success).toBe(false);
    expect(parse({ source: "has spaces" }).success).toBe(false);
    expect(parse({ source: "1receipt" }).success).toBe(false);
  });

  it("requires an idempotency key of reasonable length", () => {
    expect(parse({ idempotencyKey: undefined }).success).toBe(false);
    expect(parse({ idempotencyKey: "short" }).success).toBe(false);
  });

  it("requires at least one line, and bounds the batch size", () => {
    expect(parse({ items: [] }).success).toBe(false);
    const many = Array.from({ length: 201 }, () => valid.items[0]);
    expect(parse({ items: many }).success).toBe(false);
  });

  it("rejects lines with a missing name, unit or non-positive quantity", () => {
    const line = valid.items[0];
    expect(parse({ items: [{ ...line, productName: " " }] }).success).toBe(false);
    expect(parse({ items: [{ ...line, unit: "" }] }).success).toBe(false);
    expect(parse({ items: [{ ...line, quantity: 0 }] }).success).toBe(false);
    expect(parse({ items: [{ ...line, quantity: -3 }] }).success).toBe(false);
  });

  it("rejects fractional or negative prices", () => {
    const line = valid.items[0];
    expect(parse({ items: [{ ...line, priceCents: 12.5 }] }).success).toBe(false);
    expect(parse({ items: [{ ...line, priceCents: -1 }] }).success).toBe(false);
  });

  it("rejects a purchase date in the future but allows a day of timezone slack", () => {
    const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
    expect(parse({ purchasedAt: inDays(10) }).success).toBe(false);
    expect(parse({ purchasedAt: inDays(0.5) }).success).toBe(true);
  });

  it("rejects an unparseable date", () => {
    expect(parse({ purchasedAt: "last tuesday" }).success).toBe(false);
    expect(parse({ purchasedAt: undefined }).success).toBe(false);
  });

  it("rejects a malformed product id", () => {
    const line = valid.items[0];
    expect(parse({ items: [{ ...line, productId: "not-a-uuid" }] }).success).toBe(false);
  });
});
