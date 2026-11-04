import { describe, expect, it, vi } from "vitest";
import { addressFromPaypal, createPayPal } from "./paypal";
import { PaymentError } from "./payments";

interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fake PayPal: answers each request from `answers` (matched by "METHOD /path") and records what it was sent. */
function fakePayPal(answers: Record<string, { status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname;
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers: init?.headers as Record<string, string>, body: typeof init?.body === "string" && init.body.startsWith("{") ? JSON.parse(init.body) : init?.body });
    const answer = path === "/v1/oauth2/token" ? { json: { access_token: "token-1", expires_in: 3600 } } : answers[`${method} ${path}`];
    if (!answer) return new Response(JSON.stringify({ name: "NOT_FOUND" }), { status: 404 });
    return new Response(JSON.stringify(answer.json), { status: answer.status ?? 200 });
  });
  const paypal = createPayPal({ clientId: "client-id", clientSecret: "client-secret", environment: "sandbox", fetch: fetchMock as unknown as typeof fetch });
  return { paypal, calls };
}

describe("signing in to PayPal", () => {
  it("asks for a token with the client ID and secret, once, and reuses it", async () => {
    const { paypal, calls } = fakePayPal({
      "POST /v2/payments/captures/CAP1/refund": { json: { id: "R1" } },
    });
    await paypal.refund({ captureId: "CAP1", amountCents: 100, reference: "a", note: "x" });
    await paypal.refund({ captureId: "CAP1", amountCents: 100, reference: "b", note: "x" });
    const tokenCalls = calls.filter((call) => new URL(call.url).pathname === "/v1/oauth2/token");
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.url.startsWith("https://api-m.sandbox.paypal.com")).toBe(true);
    expect(tokenCalls[0]!.headers.authorization).toBe(`Basic ${Buffer.from("client-id:client-secret").toString("base64")}`);
    expect(tokenCalls[0]!.body).toBe("grant_type=client_credentials");
    expect(calls.find((call) => call.url.includes("/refund"))!.headers.authorization).toBe("Bearer token-1");
  });

  it("uses the live address for live", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: "t", expires_in: 100, id: "R" }), { status: 200 }));
    const live = createPayPal({ clientId: "a", clientSecret: "b", environment: "live", fetch: fetchMock as unknown as typeof fetch });
    await live.refund({ captureId: "C", amountCents: 1, reference: "r", note: "n" });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("https://api-m.paypal.com/v1/oauth2/token");
  });

  it("says so when PayPal refuses the credentials, without repeating them", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 401 }));
    const paypal = createPayPal({ clientId: "client-id", clientSecret: "client-secret", environment: "sandbox", fetch: fetchMock as unknown as typeof fetch });
    const error = (await paypal.refund({ captureId: "C", amountCents: 1, reference: "r", note: "n" }).catch((e: Error) => e)) as PaymentError;
    expect(error).toBeInstanceOf(PaymentError);
    expect(error.kind).toBe("unavailable");
    expect(error.message).not.toContain("client-secret");
  });
});

describe("saving the user's PayPal", () => {
  it("starts a setup for later merchant charges and returns the page to approve on", async () => {
    const { paypal, calls } = fakePayPal({
      "POST /v3/vault/setup-tokens": { json: { id: "SETUP1", links: [{ rel: "self", href: "x" }, { rel: "approve", href: "https://sandbox.paypal.com/agreements/approve?approval_session_id=SETUP1" }] } },
    });
    const result = await paypal.startSetup({ returnUrl: "https://app.test/return", cancelUrl: "https://app.test/cancel", brandName: "Replenish" });
    expect(result).toEqual({ setupTokenId: "SETUP1", approveUrl: "https://sandbox.paypal.com/agreements/approve?approval_session_id=SETUP1" });
    const sent = calls.find((call) => call.url.endsWith("/v3/vault/setup-tokens"))!;
    expect(sent.headers["paypal-request-id"]).toBeTruthy();
    expect(sent.body).toMatchObject({
      payment_source: { paypal: { usage_type: "MERCHANT", customer_type: "CONSUMER", experience_context: { return_url: "https://app.test/return", cancel_url: "https://app.test/cancel", shipping_preference: "GET_FROM_FILE" } } },
    });
  });

  it("checks the user approved, then turns the approval into a saved account", async () => {
    const { paypal, calls } = fakePayPal({
      "GET /v3/vault/setup-tokens/SETUP1": { json: { id: "SETUP1", status: "APPROVED" } },
      "POST /v3/vault/payment-tokens": { json: { id: "vault-9", payment_source: { paypal: { email_address: "buyer@example.com" } } } },
    });
    expect(await paypal.finishSetup("SETUP1")).toEqual({ vaultId: "vault-9", payerEmail: "buyer@example.com", address: null });
    expect(calls.find((call) => call.url.endsWith("/v3/vault/payment-tokens"))!.body).toEqual({ payment_source: { token: { id: "SETUP1", type: "SETUP_TOKEN" } } });
  });

  it("hands back the US shipping address PayPal has on file, in the pieces of our form", async () => {
    const shipping = {
      name: { full_name: "Jane Q Public" },
      phone_number: { country_code: "1", national_number: "4085551234" },
      address: { address_line_1: "123 Main St", address_line_2: "Apt 4", admin_area_2: "San Jose", admin_area_1: "ca", postal_code: "95131", country_code: "US" },
    };
    const { paypal } = fakePayPal({
      "GET /v3/vault/setup-tokens/SETUP1": { json: { id: "SETUP1", status: "APPROVED" } },
      "POST /v3/vault/payment-tokens": { json: { id: "vault-9", payment_source: { paypal: { email_address: "b@example.com", shipping } } } },
    });
    expect((await paypal.finishSetup("SETUP1")).address).toEqual({
      firstName: "Jane",
      lastName: "Q Public",
      line1: "123 Main St",
      line2: "Apt 4",
      city: "San Jose",
      state: "CA",
      postalCode: "95131",
      phone: "4085551234",
    });
  });

  it("also reads the address from the approved setup token if the saved account doesn't carry it", async () => {
    const shipping = { name: { full_name: "Jane Public" }, address: { address_line_1: "1 Main St", admin_area_2: "Austin", admin_area_1: "TX", postal_code: "78701", country_code: "US" } };
    const { paypal } = fakePayPal({
      "GET /v3/vault/setup-tokens/SETUP1": { json: { id: "SETUP1", status: "APPROVED", payment_source: { paypal: { shipping } } } },
      "POST /v3/vault/payment-tokens": { json: { id: "vault-9", payment_source: { paypal: {} } } },
    });
    expect((await paypal.finishSetup("SETUP1")).address).toMatchObject({ line1: "1 Main St", city: "Austin", state: "TX" });
  });

  it("says to connect again when the user didn't approve", async () => {
    const { paypal } = fakePayPal({ "GET /v3/vault/setup-tokens/SETUP1": { json: { id: "SETUP1", status: "PAYER_ACTION_REQUIRED" } } });
    await expect(paypal.finishSetup("SETUP1")).rejects.toMatchObject({ kind: "reconnect" });
  });
});

describe("charging the saved account", () => {
  const completed = { id: "PO1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED" }] } }] };

  it("charges the saved account right away, in dollars, and returns the capture", async () => {
    const { paypal, calls } = fakePayPal({ "POST /v2/checkout/orders": { json: completed } });
    const result = await paypal.charge({ vaultId: "vault-9", amountCents: 1234, description: "Toilet Paper", reference: "order-1" });
    expect(result).toEqual({ paypalOrderId: "PO1", captureId: "CAP1" });
    const sent = calls.find((call) => call.url.endsWith("/v2/checkout/orders"))!;
    expect(sent.headers["paypal-request-id"]).toBe("charge-order-1");
    expect(sent.body).toEqual({
      intent: "CAPTURE",
      purchase_units: [{ reference_id: "order-1", custom_id: "order-1", description: "Toilet Paper", amount: { currency_code: "USD", value: "12.34" } }],
      payment_source: { paypal: { vault_id: "vault-9" } },
    });
  });

  it("asks for the whole answer, and looks the order up if the capture still isn't in it", async () => {
    const minimal = fakePayPal({ "POST /v2/checkout/orders": { json: { id: "PO1", status: "COMPLETED" } }, "GET /v2/checkout/orders/PO1": { json: completed } });
    await expect(minimal.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).resolves.toEqual({ paypalOrderId: "PO1", captureId: "CAP1" });
    expect(minimal.calls.find((call) => call.method === "POST" && call.url.endsWith("/v2/checkout/orders"))!.headers.prefer).toBe("return=representation");
  });

  it("doesn't call a charge it can't confirm a decline", async () => {
    const unclear = fakePayPal({ "POST /v2/checkout/orders": { json: { id: "PO1", status: "COMPLETED" } } });
    await expect(unclear.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("can add PayPal's stored-credential fields when asked to", async () => {
    const calls: unknown[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "t", expires_in: 100 }));
      calls.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify(completed));
    });
    const paypal = createPayPal({ clientId: "a", clientSecret: "b", environment: "sandbox", storedCredential: true, fetch: fetchMock as unknown as typeof fetch });
    await paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" });
    expect(calls[0]).toMatchObject({ payment_source: { paypal: { vault_id: "v", stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } } } });
  });

  it("tells a decline from a lost permission from PayPal being down", async () => {
    const decline = fakePayPal({ "POST /v2/checkout/orders": { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "INSTRUMENT_DECLINED" }] } } });
    await expect(decline.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "declined" });

    const gone = fakePayPal({ "POST /v2/checkout/orders": { status: 422, json: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "PAYMENT_TOKEN_NOT_FOUND" }] } } });
    await expect(gone.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "reconnect" });

    const down = fakePayPal({ "POST /v2/checkout/orders": { status: 503, json: {} } });
    await expect(down.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("doesn't call it paid unless PayPal completed the capture", async () => {
    const pending = fakePayPal({ "POST /v2/checkout/orders": { json: { id: "PO1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "PENDING" }] } }] } } });
    // Pending isn't a decline: the money may have moved, so it must never read as "you weren't charged".
    await expect(pending.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "unavailable" });
    const refused = fakePayPal({ "POST /v2/checkout/orders": { json: { id: "PO1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "DECLINED" }] } }] } } });
    await expect(refused.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "declined" });
    const action = fakePayPal({ "POST /v2/checkout/orders": { json: { id: "PO1", status: "PAYER_ACTION_REQUIRED" } } });
    await expect(action.paypal.charge({ vaultId: "v", amountCents: 100, description: "x", reference: "r" })).rejects.toMatchObject({ kind: "reconnect" });
  });
});

describe("forgetting a saved account", () => {
  it("asks PayPal to delete it, and never throws if PayPal won't", async () => {
    const { paypal, calls } = fakePayPal({ "DELETE /v3/vault/payment-tokens/vault-9": { status: 204, json: {} } });
    await paypal.forget("vault-9");
    expect(calls.find((call) => call.method === "DELETE")!.url).toBe("https://api-m.sandbox.paypal.com/v3/vault/payment-tokens/vault-9");
    const refused = fakePayPal({ "DELETE /v3/vault/payment-tokens/vault-9": { status: 500, json: {} } });
    await expect(refused.paypal.forget("vault-9")).resolves.toBeUndefined();
  });
});

describe("refunds and tracking", () => {
  it("refunds part of a capture, and a retry with the same reference is the same request", async () => {
    const { paypal, calls } = fakePayPal({ "POST /v2/payments/captures/CAP1/refund": { json: { id: "RF1" } } });
    expect(await paypal.refund({ captureId: "CAP1", amountCents: 575, reference: "order-1", note: "Unused part of your order" })).toEqual({ refundId: "RF1" });
    const sent = calls.find((call) => call.url.endsWith("/refund"))!;
    expect(sent.headers["paypal-request-id"]).toBe("refund-order-1");
    expect(sent.body).toEqual({ amount: { currency_code: "USD", value: "5.75" }, note_to_payer: "Unused part of your order" });
  });

  it("adds a tracking number to the payment, naming the carrier PayPal knows or 'OTHER'", async () => {
    const { paypal, calls } = fakePayPal({ "POST /v2/checkout/orders/PO1/track": { json: {} } });
    await paypal.addTracking({ paypalOrderId: "PO1", captureId: "CAP1", trackingNumber: "ZINC123", carrier: "USPS" });
    await paypal.addTracking({ paypalOrderId: "PO1", captureId: "CAP1", trackingNumber: "ABC", carrier: "Local Courier" });
    const sent = calls.filter((call) => call.url.endsWith("/track"));
    expect(sent[0]!.body).toEqual({ capture_id: "CAP1", tracking_number: "ZINC123", carrier: "USPS", notify_payer: false });
    expect(sent[1]!.body).toEqual({ capture_id: "CAP1", tracking_number: "ABC", carrier: "OTHER", carrier_name_other: "Local Courier", notify_payer: false });
  });
});

describe("addressFromPaypal", () => {
  const us = { address_line_1: "1 Main St", admin_area_2: "Austin", admin_area_1: "TX", postal_code: "78701", country_code: "US" };

  it("leaves out what PayPal didn't give, like a phone number", () => {
    expect(addressFromPaypal({ name: { full_name: "Jane Public" }, address: us })).toEqual({
      firstName: "Jane",
      lastName: "Public",
      line1: "1 Main St",
      city: "Austin",
      state: "TX",
      postalCode: "78701",
    });
  });

  it("ignores a phone number that isn't a 10-digit US one", () => {
    expect(addressFromPaypal({ phone_number: { country_code: "44", national_number: "2079460000" }, address: us })!.phone).toBeUndefined();
  });

  it("gives nothing for an address outside the US, or with no street", () => {
    expect(addressFromPaypal({ address: { ...us, country_code: "GB" } })).toBeNull();
    expect(addressFromPaypal({ address: { ...us, address_line_1: undefined } })).toBeNull();
    expect(addressFromPaypal(undefined)).toBeNull();
  });
});
