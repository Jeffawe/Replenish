// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { orderFeesCents } from "@/core/order-money";
import { db } from "@/db/client";
import { orders, products, restockSuggestions } from "@/db/schema";
import { getInventory } from "@/modules/inventory/service";
import { listSuggestions, snoozeSuggestion } from "@/modules/restock";
import { saveAutobuySettings } from "@/modules/settings";
import { considerAutoBuy, runAutoBuy } from "./auto";
import { placedAt } from "./fake-fulfilment";
import { cancelOrder, settleOrders } from "./pipeline";
import { previewAutoBuy } from "./preview";
import { getOrder, removePaypal } from "./repo";
import { listOrders } from "./service";
import { confirmProduct, listing, scene, throwawayUsers, type Scene } from "./test-helpers";

const newUser = throwawayUsers();

/** A product with enough regular purchases to be trusted, confirmed, with auto-buy on. */
async function autoScene(options: Parameters<typeof scene>[1] = {}): Promise<Scene> {
  const s = await scene(newUser, { history: 6, ...options });
  await confirmProduct(s.productId);
  await db.update(products).set({ autobuyEnabled: true }).where(eq(products.id, s.productId));
  return s;
}

const settings = (overrides: Record<string, number | null>) => ({
  autobuyMinConfidence: 0.8,
  autobuyMinPriceCents: null,
  autobuyMaxPriceCents: null,
  autobuyMonthlyCapCents: null,
  autobuyLeadDays: 3,
  ...overrides,
});

describe("the test product", () => {
  it("is trusted enough for auto-buy", async () => {
    const s = await autoScene();
    const item = (await getInventory(s.userId)).find((entry) => entry.product.id === s.productId)!;
    expect(item.estimate.confidence).toBeGreaterThanOrEqual(0.8);
    expect(item.estimate.isLow).toBe(true);
  });
});

describe("considerAutoBuy", () => {
  it("buys when everything allows it, and says why", async () => {
    const s = await autoScene();
    const outcome = await considerAutoBuy(s.suggestion, s.deps);
    expect(outcome.status).toBe("ordered");
    const [order] = await listOrders(s.userId);
    expect(order).toMatchObject({ source: "auto", status: "processing" });
    expect(order!.decision).toMatch(/Auto-buy: \d+% sure it was running out/);
    expect(s.payments.charges).toHaveLength(1);
  });

  it("leaves it to the user when auto-buy is off for the product, or it isn't confirmed", async () => {
    const off = await autoScene();
    await db.update(products).set({ autobuyEnabled: false }).where(eq(products.id, off.productId));
    expect(await considerAutoBuy(off.suggestion, off.deps)).toEqual({ status: "asked", reasons: ["Auto-buy is off for this product"] });

    const unconfirmed = await autoScene();
    await db.update(products).set({ confirmedAt: null }).where(eq(products.id, unconfirmed.productId));
    expect(await considerAutoBuy(unconfirmed.suggestion, unconfirmed.deps)).toEqual({ status: "asked", reasons: ["You haven't confirmed you track this product"] });
    expect(off.payments.charges).toEqual([]);
    expect(unconfirmed.payments.charges).toEqual([]);
  });

  it("leaves it to the user when the estimate isn't trusted enough yet", async () => {
    const s = await scene(newUser, { history: 3 });
    await confirmProduct(s.productId);
    await db.update(products).set({ autobuyEnabled: true }).where(eq(products.id, s.productId));
    const outcome = await considerAutoBuy(s.suggestion, s.deps);
    expect(outcome.status).toBe("asked");
    expect(outcome.status === "asked" && outcome.reasons[0]).toMatch(/only \d+% sure it's running out, and your minimum is 80%/);
  });

  it("uses the price limit as it is now, not as it was when the search ran", async () => {
    const s = await autoScene();
    // The listing was $10; the user has since set a $5 limit.
    await saveAutobuySettings(s.userId, settings({ autobuyMaxPriceCents: 500 }));
    expect(await considerAutoBuy(s.suggestion, s.deps)).toEqual({ status: "asked", reasons: ["Over your price limit"] });
  });

  it("stops at the monthly cap, counting what is already spent", async () => {
    const s = await autoScene();
    await saveAutobuySettings(s.userId, settings({ autobuyMonthlyCapCents: 1000 }));
    const outcome = await considerAutoBuy(s.suggestion, s.deps);
    expect(outcome).toEqual({ status: "asked", reasons: ["It would go over your $10.00 limit for the month"] });
  });

  it("leaves it to the user, with the reason, when PayPal isn't connected", async () => {
    const s = await autoScene();
    await removePaypal(s.userId);
    const outcome = await considerAutoBuy(s.suggestion, s.deps);
    expect(outcome).toEqual({ status: "asked", reasons: ["Connect your PayPal first so we can pay for it."] });
    expect(await listSuggestions(s.userId)).toHaveLength(1); // still there for them to deal with
  });

  it("asks about a listing with something questionable, like an unknown pack size", async () => {
    const s = await autoScene();
    const unknownSize = { ...s.suggestion, pick: { ...s.suggestion.pick, concerns: ["size-unknown" as const] } };
    expect(await considerAutoBuy(unknownSize, s.deps)).toEqual({ status: "asked", reasons: ["Pack size not stated"] });
  });
});

describe("considerAutoBuy: other limits", () => {
  it("takes a raised limit at once, without waiting for the listing to be searched again", async () => {
    const s = await autoScene();
    const tagged = { ...s.suggestion, pick: { ...s.suggestion.pick, concerns: ["outside-price-range" as const] } };
    expect((await considerAutoBuy(tagged, s.deps)).status).toBe("ordered");
  });

  it("counts the whole order against the limit, and tells Zinc not to go over it", async () => {
    const s = await autoScene();
    // $10 of items and $2.25 of fees fit $13, but only just: Zinc may spend $10.75 at most, not the usual $13.
    await saveAutobuySettings(s.userId, settings({ autobuyMaxPriceCents: 1300 }));
    expect((await considerAutoBuy(s.suggestion, s.deps)).status).toBe("ordered");
    expect(s.fulfilment.placed[0]!.maxPriceCents).toBe(1075);
    expect(s.payments.charges[0]!.amountCents).toBe(1300);
  });

  it("asks when items and fees alone would be over the limit", async () => {
    const s = await autoScene();
    await saveAutobuySettings(s.userId, settings({ autobuyMaxPriceCents: 1100 }));
    expect(await considerAutoBuy(s.suggestion, s.deps)).toEqual({ status: "asked", reasons: ["Over your price limit"] });
  });

  it("won't go over our limit for one order, whatever the user has set", async () => {
    const s = await autoScene();
    const pricey = { ...s.suggestion, pick: { ...s.suggestion.pick, priceCents: 6000, totalCents: 6000 } };
    const outcome = await considerAutoBuy(pricey, s.deps);
    expect(outcome.status).toBe("asked");
    expect(outcome.status === "asked" && outcome.reasons).toContain("It's over the $50.00 most auto-buy can spend on one order");
  });

  it("squeezes what Zinc may spend so the whole order stays under our limit", async () => {
    const s = await autoScene();
    const nearly = { ...s.suggestion, pick: { ...s.suggestion.pick, priceCents: 4500, totalCents: 4500 } };
    expect((await considerAutoBuy(nearly, s.deps)).status).toBe("ordered");
    expect(s.fulfilment.placed[0]!.maxPriceCents).toBe(5000 - orderFeesCents(4500));
    expect(s.payments.charges[0]!.amountCents).toBe(5000);
  });

  it("stops at our limit for the month when the user has none of their own, and at a higher one they saved before", async () => {
    const s = await autoScene();
    await db.insert(orders).values({ userId: s.userId, productName: "Other", source: "auto", status: "placed", listing: {}, packs: 1, ceilingCents: 19900, chargedCents: 19900, totalCents: 19900 });
    expect(await considerAutoBuy(s.suggestion, s.deps)).toEqual({ status: "asked", reasons: ["It would go over the $200.00 auto-buy can spend in a month"] });
    await saveAutobuySettings(s.userId, settings({ autobuyMonthlyCapCents: 100000 }));
    expect(await considerAutoBuy(s.suggestion, s.deps)).toEqual({ status: "asked", reasons: ["It would go over the $200.00 auto-buy can spend in a month"] });
  });

  it("keeps an order's fees with it", async () => {
    const s = await autoScene();
    const outcome = await considerAutoBuy(s.suggestion, s.deps);
    if (outcome.status !== "ordered") throw new Error("expected an order");
    const [order] = await listOrders(s.userId);
    expect(order!.feesCents).toBe(orderFeesCents(1000));
  });

  it("asks when the user's preferred stores don't include this one, and takes a change at once", async () => {
    const s = await autoScene();
    await saveAutobuySettings(s.userId, { ...settings({}), preferredStores: ["Target"] });
    expect(await considerAutoBuy(s.suggestion, s.deps)).toEqual({ status: "asked", reasons: ["Not your usual store"] });
    await saveAutobuySettings(s.userId, { ...settings({}), preferredStores: ["Target", "Walmart"] });
    expect((await considerAutoBuy(s.suggestion, s.deps)).status).toBe("ordered");
  });

  it("doesn't count a store that only came from a receipt as the user asking for it", async () => {
    const s = await autoScene();
    await db.update(products).set({ boughtFrom: "Costco", boughtFromByUser: false }).where(eq(products.id, s.productId));
    expect((await considerAutoBuy(s.suggestion, s.deps)).status).toBe("ordered");
    const typed = await autoScene();
    await db.update(products).set({ boughtFrom: "Costco", boughtFromByUser: true }).where(eq(products.id, typed.productId));
    expect(await considerAutoBuy(typed.suggestion, typed.deps)).toEqual({ status: "asked", reasons: ["Not your usual store"] });
  });
});

describe("runAutoBuy: when an order goes wrong", () => {
  const search = { search: async () => [listing()] };

  it("charges once, then leaves it to the user instead of charging again on every run", async () => {
    const s = await autoScene();
    await runAutoBuy(search, { userId: s.userId }, s.deps);
    s.fulfilment.result = { state: "failed", reason: "It's out of stock" };
    await settleOrders(s.deps, { userId: s.userId });
    expect(s.payments.charges).toHaveLength(1);

    for (let run = 0; run < 3; run++) {
      const report = await runAutoBuy(search, { userId: s.userId }, s.deps);
      expect(report.ordered).toEqual([]);
      expect(report.asked[0]!.reasons[0]).toContain("didn't go through");
    }
    expect(s.payments.charges).toHaveLength(1);
    expect(await listSuggestions(s.userId)).toHaveLength(1); // still there for them to deal with
  });

  it("doesn't buy again after the user cancelled", async () => {
    const s = await autoScene();
    const first = await runAutoBuy(search, { userId: s.userId }, s.deps);
    expect(await cancelOrder(s.userId, first.ordered[0]!.orderId, s.deps)).toBe("cancelled");
    const next = await runAutoBuy(search, { userId: s.userId }, s.deps);
    expect(next.ordered).toEqual([]);
    expect(next.asked[0]!.reasons[0]).toContain("cancelled");
  });

  it("holds off while the user has said not now", async () => {
    const s = await autoScene();
    await snoozeSuggestion(s.userId, s.suggestion.id);
    expect((await runAutoBuy(search, { userId: s.userId }, s.deps)).ordered).toEqual([]);
    expect(s.payments.charges).toEqual([]);
  });
});

describe("the dry run", () => {
  it("says what it would have bought, spends nothing and searches nothing", async () => {
    const s = await autoScene();
    await db.update(products).set({ autobuyEnabled: false }).where(eq(products.id, s.productId));
    const preview = await previewAutoBuy(s.userId);
    expect(preview.rows).toEqual([expect.objectContaining({ productId: s.productId, outcome: "buy", store: "walmart.com", itemsCents: 1000, enabled: false })]);
    expect(s.payments.charges).toEqual([]);
    expect(await listOrders(s.userId)).toEqual([]);
  });

  it("gives the reason when it would have asked, and uses what it knew at the time", async () => {
    const s = await autoScene();
    await saveAutobuySettings(s.userId, settings({ autobuyMaxPriceCents: 500 }));
    const preview = await previewAutoBuy(s.userId);
    expect(preview.rows[0]).toMatchObject({ outcome: "ask", reasons: ["Over your price limit"] });
  });

  it("says it would have searched when there is no listing, rather than paying to find out", async () => {
    const s = await autoScene();
    await db.delete(restockSuggestions).where(eq(restockSuggestions.productId, s.productId));
    expect((await previewAutoBuy(s.userId)).rows[0]).toMatchObject({ outcome: "search" });
  });
});

describe("runAutoBuy: the scheduled job", () => {
  it("finds the low product, buys it for the user with auto-buy on, and doesn't buy it again", async () => {
    const s = await autoScene();
    // A fresh scene already stored its suggestion; the job searches again only when it is old.
    const search = { search: async () => [listing()] };
    const report = await runAutoBuy(search, { userId: s.userId }, s.deps);
    expect(report.ordered).toEqual([expect.objectContaining({ productId: s.productId, name: "Toilet Paper" })]);

    s.fulfilment.result = placedAt(1100);
    const next = await runAutoBuy(search, { userId: s.userId }, s.deps);
    expect(next.settled).toBeGreaterThan(0);
    expect(next.ordered).toEqual([]);
    expect(s.payments.charges).toHaveLength(1);
    expect((await listOrders(s.userId))[0]).toMatchObject({ status: "placed" });
  });

  it("leaves products with auto-buy off alone, as suggestions", async () => {
    const s = await scene(newUser, { history: 6 });
    await confirmProduct(s.productId);
    const report = await runAutoBuy({ search: async () => [listing()] }, { userId: s.userId }, s.deps);
    expect(report.ordered).toEqual([]);
    expect(report.asked).toEqual([]); // only products with auto-buy on are considered at all
    expect(s.payments.charges).toEqual([]);
    expect(await listSuggestions(s.userId)).toHaveLength(1);
  });

  it("buys what was waiting for PayPal once it is connected", async () => {
    const s = await autoScene({ paypal: false });
    const search = { search: async () => [listing()] };
    const first = await runAutoBuy(search, { userId: s.userId }, s.deps);
    expect(first.ordered).toEqual([]);
    expect(first.asked).toEqual([expect.objectContaining({ productId: s.productId, reasons: ["Connect your PayPal first so we can pay for it."] })]);

    const { activatePaypal } = await import("./repo");
    await activatePaypal(s.userId, "vault-2", "buyer@example.com");
    const second = await runAutoBuy(search, { userId: s.userId }, s.deps);
    expect(second.ordered).toHaveLength(1);
  });

  it("finishes an order that was in flight before it looks for anything new", async () => {
    const s = await autoScene();
    const search = { search: async () => [listing()] };
    await runAutoBuy(search, { userId: s.userId }, s.deps);
    const [order] = await listOrders(s.userId);
    s.fulfilment.result = { state: "failed", reason: "It's out of stock" };
    await settleOrders(s.deps, { userId: s.userId });
    expect((await getOrder(order!.id))!).toMatchObject({ status: "failed", paymentStatus: "refunded" });
  });
});
