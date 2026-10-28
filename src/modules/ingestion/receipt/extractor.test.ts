import { describe, expect, it, vi } from "vitest";
import { PurchaseBatchSchema, type ProductSummary } from "@/core/purchase-batch";
import { ExtractionError, type ExtractContext } from "../types";
import { createReceiptExtractor, type ReceiptDeps } from "./extractor";
import type { OcrWord } from "./ocr/types";

const NOW = new Date("2026-10-21T12:00:00Z");

const product = (id: string, name: string, unit: string): ProductSummary => ({
  id,
  name,
  brand: null,
  category: null,
  unit,
  normalPurchaseQty: 1,
});
const milk = product("p-milk", "Whole Milk", "gallon");
const bananas = product("p-bananas", "Bananas", "each");

const ctx = (products: ProductSummary[] = []): ExtractContext => ({ userId: "u", products, now: NOW });

/** OCR output that lays rows of text out like a receipt: names on the left, prices on the right. */
function ocrOf(rows: ([string] | [string, string])[]): OcrWord[] {
  const words: OcrWord[] = [];
  rows.forEach(([left, right], row) => {
    const cy = 40 + row * 30;
    words.push({ text: left, cx: 40 + left.length * 5, cy, width: left.length * 10, height: 20, angle: 0 });
    if (right) words.push({ text: right, cx: 600, cy, width: right.length * 10, height: 20, angle: 0 });
  });
  return words;
}

const RECEIPT: ([string] | [string, string])[] = [
  ["Walmart"],
  ["WHL MLK", "3.98"],
  ["PAPER TOWELS 6PK", "9.97"],
  ["SUBTOTAL", "13.95"],
  ["TOTAL", "14.80"],
  ["10/20/26"],
];

function setup(words: OcrWord[], aliases: { alias: string; productId: string }[] = [], ignored: string[] = []) {
  const read = vi.fn<ReceiptDeps["ocr"]["read"]>().mockResolvedValue({ text: "", words });
  const extractor = createReceiptExtractor({
    ocr: { read },
    loadAliases: async () => aliases,
    loadIgnored: async () => ignored,
  });
  const photo = (content = "photo") => new File([content], "receipt.jpg", { type: "image/jpeg" });
  return { extractor, read, photo };
}

describe("test samples", () => {
  it("hands the photo, its OCR and the draft to whoever keeps samples", async () => {
    const record = vi.fn<NonNullable<ReceiptDeps["record"]>>().mockResolvedValue();
    const words = ocrOf(RECEIPT);
    const extractor = createReceiptExtractor({
      ocr: { read: async () => ({ text: "", words }) },
      loadAliases: async () => [],
      loadIgnored: async () => [],
      record,
    });

    const result = await extractor.extract({ image: new File(["photo"], "r.jpg", { type: "image/jpeg" }) }, ctx());

    expect(result.kind).toBe("draft");
    const sample = record.mock.calls[0]![0];
    expect(sample.ocr.words).toEqual(words);
    expect(sample.outcome.kind).toBe("draft");
    // The folder it will be kept in is the one the draft's own rawRef names.
    if (result.kind === "draft") expect(result.draft.batch.rawRef).toBe(`receipt-photo:${sample.id}`);
  });

  it("also hands over a photo it couldn't read anything from", async () => {
    const record = vi.fn<NonNullable<ReceiptDeps["record"]>>().mockResolvedValue();
    const extractor = createReceiptExtractor({
      ocr: { read: async () => ({ text: "", words: [] }) },
      loadAliases: async () => [],
      loadIgnored: async () => [],
      record,
    });

    const result = await extractor.extract({ image: new File(["photo"], "r.jpg", { type: "image/jpeg" }) }, ctx());

    expect(result.kind).toBe("skipped");
    expect(record.mock.calls[0]![0].outcome.kind).toBe("skipped");
  });
});

describe("receipt input", () => {
  const { extractor, photo } = setup([]);

  it("takes a photo", () => {
    expect(extractor.input.safeParse({ image: photo() }).success).toBe(true);
  });

  it("rejects anything that isn't a usable image", () => {
    expect(extractor.input.safeParse({ image: "not a file" }).success).toBe(false);
    expect(extractor.input.safeParse({}).success).toBe(false);
    expect(extractor.input.safeParse({ image: new File([], "x.jpg", { type: "image/jpeg" }) }).success).toBe(false);
    expect(extractor.input.safeParse({ image: new File(["x"], "x.pdf", { type: "application/pdf" }) }).success).toBe(false);
  });
});

describe("receipt producer", () => {
  it("builds a draft with the store, date, currency and lines", async () => {
    const { extractor, photo } = setup(ocrOf(RECEIPT), [{ alias: "paper towels", productId: "p-milk" }]);
    const result = await extractor.extract({ image: photo() }, ctx([milk]));

    expect(result.kind).toBe("draft");
    if (result.kind !== "draft") return;
    const { batch, lines, sourceText } = result.draft;
    expect(batch).toMatchObject({ source: "receipt", store: "Walmart", purchasedAt: "2026-10-20", currency: "USD" });
    expect(batch.items).toEqual([
      { productName: "Whole Milk", productId: "p-milk", quantity: 1, unit: "gallon", priceCents: 398 },
      // Matched by the alias the user taught us; the 6PK multiplies the quantity.
      { productName: "Whole Milk", productId: "p-milk", quantity: 6, unit: "gallon", priceCents: 997 },
    ]);
    expect(lines).toEqual([
      { sourceText: "WHL MLK", matchedBy: "similar" },
      { sourceText: "PAPER TOWELS", matchedBy: "alias" },
    ]);
    expect(sourceText).toContain("WHL MLK  3.98");
  });

  it("names a new product for the item, with the dictionary's category and unit", async () => {
    const { extractor, photo } = setup(ocrOf(RECEIPT));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[1]).toEqual({
      productName: "Paper Towels",
      category: "Household",
      quantity: 6,
      unit: "rolls",
      priceCents: 997,
    });
    expect(result.draft.lines?.[1]).toEqual({ sourceText: "PAPER TOWELS", matchedBy: null });
  });

  it("separates the brand from the item, and keeps the receipt's wording for unknown items", async () => {
    const rows: ([string] | [string, string])[] = [
      ["GV WHL MLK GL", "3.98"],
      ["CHARMIN ULTRA 12CT", "18.97"],
      ["GV ZESTY THING", "2.00"],
      ["TOTAL", "24.95"],
    ];
    const { extractor, photo } = setup(ocrOf(rows));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items).toEqual([
      { productName: "Milk", brand: "Great Value", category: "Groceries", quantity: 1, unit: "gallon", priceCents: 398 },
      { productName: "Toilet Paper", brand: "Charmin", category: "Household", quantity: 12, unit: "rolls", priceCents: 1897 },
      { productName: "Zesty Thing", brand: "Great Value", quantity: 1, unit: "each", priceCents: 200 },
    ]);
  });

  it("keeps prepared dishes intact instead of reducing them to grocery ingredients", async () => {
    const { extractor, photo } = setup(ocrOf([
      ["Chicken Marsala", "18.00"],
      ["Nutella Coconut Pancakes", "12.00"],
      ["Root Beer", "3.00"],
      ["TOTAL", "33.00"],
    ]));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items.map((item) => item.productName)).toEqual([
      "Chicken Marsala",
      "Nutella Coconut Pancakes",
      "Soda",
    ]);
    expect(result.draft.batch.items.slice(0, 2).map((item) => item.unit)).toEqual(["each", "each"]);
  });

  it("starts every line of a restaurant check unticked, and doesn't turn a meal into a grocery product", async () => {
    const { extractor, photo } = setup(
      ocrOf([["Bayside Grill"], ["Table 4 Guests 2"], ["Coffee", "2.50"], ["Chicken Marsala", "18.00"], ["TOTAL", "20.50"]]),
    );
    const coffee = product("p-coffee", "Coffee", "bag");
    const result = await extractor.extract({ image: photo() }, ctx([coffee]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items).toEqual([
      { productName: "Coffee", quantity: 1, unit: "each", priceCents: 250 },
      { productName: "Chicken Marsala", quantity: 1, unit: "each", priceCents: 1800 },
    ]);
    expect(result.draft.lines?.every((l) => l.matchedBy === null && l.excludeReason?.includes("restaurant"))).toBe(true);
    expect(result.draft.warnings.map((w) => w.code)).toContain("restaurant-receipt");
  });

  it("allows for discounts when checking the items against the subtotal", async () => {
    const rows: ([string] | [string, string])[] = [
      ["COSTCO WHOLESALE"],
      ["WHL MLK", "10.00"],
      ["0000291633 / 975605", "3.00 - A"],
      ["SUBTOTAL", "7.00"],
      ["TOTAL", "7.00"],
    ];
    const { extractor, photo } = setup(ocrOf(rows));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.warnings.map((w) => w.code)).not.toContain("total-mismatch");
  });

  it("doesn't repeat a brand as the item when the line is only a brand", async () => {
    const { extractor, photo } = setup(ocrOf([["GREAT VALUE", "2.84"], ["GAIN LFE", "6.97"], ["TOTAL", "9.81"]]));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    const [bare, gain] = result.draft.batch.items;
    expect(bare).toMatchObject({ productName: "Great Value", priceCents: 284 });
    expect(bare).not.toHaveProperty("brand");
    expect(gain).toMatchObject({ productName: "Laundry Detergent", brand: "Gain" });
  });

  it("ties the item to the user's product of that name, keeping the brand for the purchase", async () => {
    const plainMilk = product("p-plain", "Milk", "gallon");
    const { extractor, photo } = setup(ocrOf([["GV WHL MLK GL", "3.98"], ["TOTAL", "3.98"]]));
    const result = await extractor.extract({ image: photo() }, ctx([plainMilk]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productId: "p-plain", brand: "Great Value" });
    expect(result.draft.lines?.[0].matchedBy).toBe("name");
  });

  it("starts things that don't get used up, and wordings left out before, unticked", async () => {
    const rows: ([string] | [string, string])[] = [
      ["MAINSTAYS OFFICE CHAIR", "49.00"],
      ["MYSTERY SNACK", "2.00"],
      ["EGGS 12CT", "3.00"],
      ["TOTAL", "54.00"],
    ];
    const { extractor, photo } = setup(ocrOf(rows), [], ["mystery snack"]);
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.lines?.map((line) => line.excludeReason)).toEqual([
      "Looks like furniture, which doesn't need restocking.",
      "You left this out last time.",
      undefined,
    ]);
  });

  it("produces a batch the front door accepts", async () => {
    const { extractor, photo } = setup(ocrOf(RECEIPT));
    // Product ids are UUIDs in the real world, and the batch schema checks.
    const realMilk = product("6f1f4d3e-8a43-4c2c-9a52-2f6a7a1b0c11", "Whole Milk", "gallon");
    const result = await extractor.extract({ image: photo() }, ctx([realMilk]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productId: realMilk.id });
    expect(PurchaseBatchSchema.safeParse(result.draft.batch).error).toBeUndefined();
  });

  it("keys the receipt by store, date and total, so another photo of it gets the same key", async () => {
    const first = await setup(ocrOf(RECEIPT)).extractor.extract({ image: setup([]).photo("one") }, ctx());
    // Different bytes, and a slightly different misread of a name.
    const second = await setup(ocrOf(RECEIPT.map((row) => (row[0] === "WHL MLK" ? ["WHL MILK", "3.98"] : row)) as typeof RECEIPT)).extractor.extract(
      { image: setup([]).photo("two") },
      ctx(),
    );
    if (first.kind !== "draft" || second.kind !== "draft") throw new Error("expected drafts");
    expect(first.draft.batch.idempotencyKey).toBe(second.draft.batch.idempotencyKey);
    expect(first.draft.batch.rawRef).not.toBe(second.draft.batch.rawRef);
  });

  it("gives different receipts different keys", async () => {
    const other = RECEIPT.map((row) => (row[0] === "TOTAL" ? ["TOTAL", "15.00"] : row)) as typeof RECEIPT;
    const a = await setup(ocrOf(RECEIPT)).extractor.extract({ image: setup([]).photo() }, ctx());
    const b = await setup(ocrOf(other)).extractor.extract({ image: setup([]).photo() }, ctx());
    if (a.kind !== "draft" || b.kind !== "draft") throw new Error("expected drafts");
    expect(a.draft.batch.idempotencyKey).not.toBe(b.draft.batch.idempotencyKey);
  });

  it("falls back to the photo for the key when no total can be read", async () => {
    const noTotal = RECEIPT.filter((row) => row[0] !== "TOTAL" && row[0] !== "SUBTOTAL");
    const { extractor, photo } = setup(ocrOf(noTotal));
    const a = await extractor.extract({ image: photo("one") }, ctx());
    const b = await extractor.extract({ image: photo("two") }, ctx());
    if (a.kind !== "draft" || b.kind !== "draft") throw new Error("expected drafts");
    expect(a.draft.batch.idempotencyKey).not.toBe(b.draft.batch.idempotencyKey);
  });

  it("uses today and warns when the date can't be read", async () => {
    const { extractor, photo } = setup(ocrOf(RECEIPT.filter((row) => row[0] !== "10/20/26")));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.purchasedAt).toBe("2026-10-21");
    expect(result.draft.warnings.map((w) => w.code)).toContain("date-missing");
  });

  it("warns when the items add up to less than the subtotal", async () => {
    const missing = RECEIPT.filter((row) => row[0] !== "PAPER TOWELS 6PK");
    const { extractor, photo } = setup(ocrOf(missing));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.warnings).toContainEqual(
      expect.objectContaining({ code: "total-mismatch", message: expect.stringContaining("$3.98") }),
    );
  });

  it("warns when duplicate or junk lines make the items exceed the subtotal", async () => {
    const duplicate: ([string] | [string, string])[] = [
      ["MILK", "3.50"],
      ["MILK", "3.50"],
      ["SUBTOTAL", "3.50"],
      ["TOTAL", "3.50"],
    ];
    const { extractor, photo } = setup(ocrOf(duplicate));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.warnings).toContainEqual(
      expect.objectContaining({ code: "total-mismatch", message: expect.stringContaining("duplicate") }),
    );
  });

  it("does not warn when the items add up", async () => {
    const { extractor, photo } = setup(ocrOf(RECEIPT));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.warnings.map((w) => w.code)).not.toContain("total-mismatch");
  });

  it("doesn't trust a weight as a count for a product counted in units", async () => {
    const weighed: ([string] | [string, string])[] = [
      ["Walmart"],
      ["BANANAS"],
      ["2.34 lb @ 0.58 /lb", "1.36"],
      ["TOTAL", "1.36"],
    ];
    const { extractor, photo } = setup(ocrOf(weighed));
    const result = await extractor.extract({ image: photo() }, ctx([bananas]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productId: "p-bananas", quantity: 1, unit: "each" });
    expect(result.draft.warnings).toContainEqual(expect.objectContaining({ code: "check-quantity", lineIndex: 0 }));
  });

  it("keeps a weight as the quantity for a new product", async () => {
    const weighed: ([string] | [string, string])[] = [["BANANAS"], ["2.34 lb @ 0.58 /lb", "1.36"], ["TOTAL", "1.36"]];
    const { extractor, photo } = setup(ocrOf(weighed));
    const result = await extractor.extract({ image: photo() }, ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ quantity: 2.34, unit: "lb" });
  });

  it("skips a photo with no text, and a photo of text with no items, saying why", async () => {
    const blank = await setup([]).extractor.extract({ image: setup([]).photo() }, ctx());
    expect(blank).toMatchObject({ kind: "skipped", reason: expect.stringContaining("couldn't find any text") });

    const cat = await setup(ocrOf([["Hello there"], ["a picture of my cat"]])).extractor.extract(
      { image: setup([]).photo() },
      ctx(),
    );
    expect(cat).toMatchObject({
      kind: "skipped",
      reason: expect.stringContaining("couldn't find any items"),
      sourceText: "Hello there\na picture of my cat",
    });
  });

  it("lets a failing OCR service's error through for the trigger to report", async () => {
    const extractor = createReceiptExtractor({
      ocr: { read: async () => Promise.reject(new ExtractionError("Google is down")) },
      loadAliases: async () => [],
      loadIgnored: async () => [],
    });
    await expect(extractor.extract({ image: new File(["x"], "r.jpg", { type: "image/jpeg" }) }, ctx())).rejects.toThrow(
      "Google is down",
    );
  });
});
