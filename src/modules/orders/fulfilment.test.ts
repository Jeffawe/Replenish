import { describe, expect, it, vi } from "vitest";
import { createZincOrders, FulfilmentError, toOrderState } from "./fulfilment";

const address = { firstName: "Ada", lastName: "Lovelace", line1: "1 Main St", line2: "Apt 2", city: "Austin", state: "TX", postalCode: "78701", phone: "5125550100" };

// Shaped after what Zinc's sandbox returned.
const placed = {
  id: "z-1",
  status: "order_placed",
  job_result: { success: true, error_type: null, price_components: { subtotal: 3955, tax: 346, shipping: 599, total: 4900 }, estimated_delivery: null },
  merchant_order_ids: ["W50790272"],
  tracking_numbers: [{ id: "t-1", carrier: "USPS", tracking_number: "ZINC_TEST_123456789", zinc_tracking_url: "https://t.17track.net/en#nums=ZP1", status: "pending", estimated_delivery_date: null }],
};

describe("toOrderState", () => {
  it("is pending until Zinc has finished", () => {
    expect(toOrderState({ status: "pending", job_result: null })).toEqual({ state: "pending" });
  });

  it("reads a placed order: the real total, the store's order number and the tracking", () => {
    expect(toOrderState(placed)).toEqual({
      state: "placed",
      totalCents: 4900,
      merchantOrderId: "W50790272",
      estimatedDelivery: null,
      tracking: [{ id: "t-1", carrier: "USPS", number: "ZINC_TEST_123456789", url: "https://t.17track.net/en#nums=ZP1", status: "pending", estimatedDelivery: null }],
    });
  });

  it("explains each way an order fails in words", () => {
    const failed = (error_type: string | null) => toOrderState({ status: "order_failed", job_result: { success: false, error_type } });
    expect(failed("out_of_stock")).toEqual({ state: "failed", reason: "It's out of stock" });
    expect(failed("max_price_exceeded")).toEqual({ state: "failed", reason: "The price went up past what we allow" });
    expect(failed("shipping_unavailable")).toEqual({ state: "failed", reason: "The store can't deliver to your address" });
    expect(failed("something_new")).toEqual({ state: "failed", reason: "The store couldn't complete the order" });
    expect(failed(null).state).toBe("failed");
  });

  it("refuses a placed order that doesn't say what it cost, and an answer that isn't an order", () => {
    expect(() => toOrderState({ status: "order_placed", job_result: {} })).toThrow(FulfilmentError);
    expect(() => toOrderState({ nope: true })).toThrow(FulfilmentError);
  });

  it("skips tracking it can't read", () => {
    const state = toOrderState({ ...placed, tracking_numbers: [{ nope: 1 }, placed.tracking_numbers[0]] });
    expect(state.state === "placed" && state.tracking).toHaveLength(1);
  });
});

describe("createZincOrders", () => {
  it("places an order with the link, address, ceiling and our reference, and returns Zinc's id", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "z-1", status: "pending" }), { status: 201 }));
    const zinc = createZincOrders({ apiKey: "zn_live_secret", fetch: fetchMock as unknown as typeof fetch });
    expect(zinc.sandbox).toBe(false);
    expect(await zinc.place({ url: "https://www.walmart.com/ip/1", quantity: 2, address, maxPriceCents: 3000, reference: "order-1" })).toEqual({ zincOrderId: "z-1" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.zinc.com/orders");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer zn_live_secret");
    expect(JSON.parse(init.body as string)).toEqual({
      products: [{ url: "https://www.walmart.com/ip/1", quantity: 2 }],
      shipping_address: { first_name: "Ada", last_name: "Lovelace", address_line1: "1 Main St", address_line2: "Apt 2", city: "Austin", state: "TX", postal_code: "78701", phone_number: "5125550100", country: "US" },
      max_price: 3000,
      idempotency_key: "order-1",
      metadata: { replenish_order_id: "order-1" },
    });
  });

  it("knows a sandbox key", () => {
    expect(createZincOrders({ apiKey: "zn_test_abc" }).sandbox).toBe(true);
  });

  it("says why an order wasn't accepted, without leaking the key", async () => {
    const respond = (status: number, json: unknown = {}) => createZincOrders({ apiKey: "zn_live_secret", fetch: (async () => new Response(JSON.stringify(json), { status })) as unknown as typeof fetch });
    const args = { url: "https://x.test/p", quantity: 1, address, maxPriceCents: 1000, reference: "r" };
    await expect(respond(402).place(args)).rejects.toMatchObject({ kind: "insufficient-funds" });
    await expect(respond(400, { detail: "invalid address" }).place(args)).rejects.toMatchObject({ kind: "invalid-address" });
    await expect(respond(400, { detail: "url unreachable" }).place(args)).rejects.toMatchObject({ kind: "unreachable" });
    await expect(respond(401).place(args)).rejects.toMatchObject({ kind: "unavailable" });
    await expect(respond(500).place(args)).rejects.toMatchObject({ kind: "unavailable" });

    const down = createZincOrders({ apiKey: "zn_live_secret", fetch: (async () => { throw new Error("boom zn_live_secret"); }) as unknown as typeof fetch });
    const error = (await down.place(args).catch((e: Error) => e)) as Error;
    expect(error.message).toBe("Could not reach Zinc");
  });

  it("finds the order again when Zinc says it already has one with our reference", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "already_exists" } }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orders: [{ id: "other", metadata: {} }, { id: "z-7", metadata: { replenish_order_id: "order-1" } }] }), { status: 200 }));
    const zinc = createZincOrders({ apiKey: "zn_test_x", fetch: fetchMock as unknown as typeof fetch });
    expect(await zinc.place({ url: "https://x.test/p", quantity: 1, address, maxPriceCents: 1000, reference: "order-1" })).toEqual({ zincOrderId: "z-7" });
  });

  it("checks an order", async () => {
    const zinc = createZincOrders({ apiKey: "k", fetch: (async () => new Response(JSON.stringify(placed))) as unknown as typeof fetch });
    expect((await zinc.check("z-1")).state).toBe("placed");
    const missing = createZincOrders({ apiKey: "k", fetch: (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch });
    await expect(missing.check("nope")).rejects.toBeInstanceOf(FulfilmentError);
  });
});
