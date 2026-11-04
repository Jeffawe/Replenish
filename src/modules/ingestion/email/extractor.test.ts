import { describe, expect, it, vi } from "vitest";
import type { ExtractContext } from "../types";
import { createEmailExtractor } from "./extractor";
import type { ReadOrder } from "./reader";
import type { EmailMessage } from "./types";

const message = (from = "Amazon <auto-confirm@amazon.com>"): EmailMessage => ({
  messageId: "m1",
  from,
  subject: "Ordered: milk",
  receivedAt: new Date("2026-11-01T12:00:00Z"),
  text: "",
});

const milk = { id: "11111111-1111-4111-8111-111111111111", name: "Milk", brand: null, category: null, unit: "gallon", normalPurchaseQty: 1, matchByName: true };
const ctx = (products = [milk]): ExtractContext => ({ userId: "u", products, now: new Date("2026-11-01T12:00:00Z") });

const order: ReadOrder = {
  orderId: "111-2222222-3333333",
  arrivesAt: new Date("2026-11-04T00:00:00Z"),
  lines: [
    { name: "milk", quantity: 2 },
    { name: "Dish Soap", quantity: 1, unit: "bottle", brand: "Dawn", priceCents: 399 },
  ],
};

describe("email extractor with the real readers", () => {
  it("turns an Amazon confirmation into a draft", async () => {
    const result = await createEmailExtractor().extract(
      {
        ...message(),
        subject: "Ordered 2 items: Dish Soap",
        text: "Arriving tomorrow\nOrder # 114-0000000-0000001\n",
      },
      ctx(),
    );
    if (result.kind !== "draft") throw new Error(`expected a draft, got: ${JSON.stringify(result)}`);
    expect(result.draft.batch).toMatchObject({
      source: "email",
      store: "Amazon",
      idempotencyKey: "email-amazon-114-0000000-0000001",
      purchasedAt: new Date("2026-11-02T12:00:00Z"),
      items: [{ productName: "Dish Soap", quantity: 2, unit: "bottle" }],
    });
  });

  it("still can't read Walmart", async () => {
    const result = await createEmailExtractor().extract(message("Walmart <orders@walmart.com>"), ctx());
    expect(result).toEqual({ kind: "skipped", reason: "We can't read Walmart order emails yet" });
  });
});

describe("email extractor", () => {
  it("skips a store nothing can read yet, without reading", async () => {
    const read = vi.fn();
    const result = await createEmailExtractor(read, () => false).extract(message(), ctx());
    expect(result).toEqual({ kind: "skipped", reason: "We can't read Amazon order emails yet" });
    expect(read).not.toHaveBeenCalled();
  });

  it("skips mail from a sender that isn't a supported store", async () => {
    const read = vi.fn();
    const result = await createEmailExtractor(read, () => true).extract(message("Bank <alerts@bank.com>"), ctx());
    expect(result.kind).toBe("skipped");
    expect(read).not.toHaveBeenCalled();
  });

  it("skips an email the reader says is not an order", async () => {
    const result = await createEmailExtractor(async () => null, () => true).extract(message(), ctx());
    expect(result).toEqual({ kind: "skipped", reason: "Not an order confirmation we can read" });
  });

  it("builds the batch: keyed by order number, dated by delivery, lines tied to a product only by exact name", async () => {
    const result = await createEmailExtractor(async () => order, () => true).extract(message(), ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    const { batch, lines } = result.draft;

    expect(batch.source).toBe("email");
    expect(batch.store).toBe("Amazon");
    expect(batch.idempotencyKey).toBe("email-amazon-111-2222222-3333333");
    expect(batch.purchasedAt).toEqual(new Date("2026-11-04T00:00:00Z"));

    expect(batch.items[0]).toMatchObject({ productName: "Milk", productId: milk.id, quantity: 2, unit: "gallon", line: 0 });
    expect(batch.items[1]).toMatchObject({ productName: "Dish Soap", quantity: 1, unit: "bottle", brand: "Dawn", priceCents: 399, line: 1 });
    expect(batch.items[1]!.productId).toBeUndefined();
    expect(lines).toEqual([
      { sourceText: "milk", matchedBy: "name" },
      { sourceText: "Dish Soap", matchedBy: null },
    ]);
  });

  it("uses the date the email arrived when it names no delivery date", async () => {
    const result = await createEmailExtractor(async () => ({ ...order, arrivesAt: null }), () => true).extract(message(), ctx());
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.purchasedAt).toEqual(new Date("2026-11-01T12:00:00Z"));
  });

  it("doesn't tie a line to a product the user turned name-matching off for", async () => {
    const result = await createEmailExtractor(async () => order, () => true).extract(message(), ctx([{ ...milk, matchByName: false }]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]!.productId).toBeUndefined();
  });
});

describe("email lines match the way receipt lines do", () => {
  const paper = { id: "22222222-2222-4222-8222-222222222222", name: "Toilet Paper", brand: null, category: null, unit: "rolls", normalPurchaseQty: 12, matchByName: true };
  const reading = (name: string, quantity = 1) => createEmailExtractor(async () => ({ orderId: "114-0000000-0000001", arrivesAt: null, lines: [{ name, quantity }] }), () => true);

  it("ties a long store title to the user's product through the dictionary, and counts the pack", async () => {
    const result = await reading("Charmin Ultra Soft Toilet Paper, 12 Mega Rolls").extract(message(), ctx([paper]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productName: "Toilet Paper", productId: paper.id, quantity: 12, unit: "rolls", brand: "Charmin" });
    expect(result.draft.lines?.[0]?.matchedBy).toBe("name");
  });

  it("names a new product for the item, not the whole title", async () => {
    const result = await reading("Bounty Select-A-Size Paper Towels, 6 Rolls").extract(message(), ctx([]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productName: "Paper Towels", quantity: 6, unit: "rolls", category: "Household" });
  });

  it("uses a wording the user has saved", async () => {
    const extractor = createEmailExtractor(async () => ({ orderId: "114-0000000-0000001", arrivesAt: null, lines: [{ name: "Zorbo Soft Sheets", quantity: 1 }] }), () => true, { loadAliases: async () => [{ alias: "zorbo soft sheets", productId: paper.id }] });
    const result = await extractor.extract(message(), ctx([paper]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productId: paper.id });
    expect(result.draft.lines?.[0]?.matchedBy).toBe("alias");
  });

  it("leaves out what doesn't get used up, and says so when that is everything", async () => {
    const result = await reading("Winter Jacket").extract(message(), ctx([]));
    expect(result).toEqual({ kind: "skipped", reason: "Nothing in this order gets used up" });
  });

  it("leaves out Amazon's own wording for a category that isn't used up, from a real email", async () => {
    expect(await reading("Phone Accessories").extract(message(), ctx([]))).toEqual({ kind: "skipped", reason: "Nothing in this order gets used up" });
  });

  it("keeps a line it doesn't recognise, as the email names it", async () => {
    const result = await reading("Zebra Thing 3000").extract(message(), ctx([]));
    if (result.kind !== "draft") throw new Error("expected a draft");
    expect(result.draft.batch.items[0]).toMatchObject({ productName: "Zebra Thing 3000", quantity: 1, unit: "each" });
  });
});
