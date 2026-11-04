import { centsToDecimal } from "@/core/order-money";
import { PaymentError, type Payments, type SuggestedAddress } from "./payments";

/**
 * PayPal's REST API (https://developer.paypal.com/api/rest/): saving a user's PayPal once ("vaulting"),
 * charging it later when they aren't there, refunding, and adding tracking.
 *
 *  - Save: POST /v3/vault/setup-tokens -> the user approves at PayPal -> POST /v3/vault/payment-tokens
 *    gives the `vault id` we keep. We never see card or account details.
 *  - Charge: POST /v2/checkout/orders with `payment_source.paypal.vault_id` and intent CAPTURE (the
 *    documented way to charge a saved PayPal without the payer present).
 *  - Refund: POST /v2/payments/captures/{id}/refund. Tracking: POST /v2/checkout/orders/{id}/track.
 *
 * Written from PayPal's documentation and tested with a fake `fetch`; a live sandbox run is what
 * proves it against the real service (`npm run paypal:check` checks the credentials first).
 */

const BASES = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" } as const;
const TIMEOUT_MS = 20_000;
const CURRENCY = "USD";

export interface PayPalOptions {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "live";
  /** For tests. */
  fetch?: typeof fetch;
  /**
   * Adds PayPal's "stored credential" fields (merchant-initiated, unscheduled) to a charge. PayPal's
   * saved-account example doesn't use them; turn this on (PAYPAL_STORED_CREDENTIAL=1) if PayPal asks for them.
   */
  storedCredential?: boolean;
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string }[];
}

/** Carriers PayPal knows by name; anything else is sent as "OTHER" with the carrier's own name. */
const CARRIERS: Record<string, string> = { USPS: "USPS", UPS: "UPS", FEDEX: "FEDEX", DHL: "DHL_API" };

interface PayPalShipping {
  name?: { full_name?: string };
  phone_number?: { country_code?: string; national_number?: string };
  address?: { address_line_1?: string; address_line_2?: string; admin_area_1?: string; admin_area_2?: string; postal_code?: string; country_code?: string };
}

/**
 * The shipping address PayPal holds for a saved account, as the pieces of our delivery form. Only US
 * addresses (we deliver nowhere else); anything PayPal didn't give is left out for the user to fill in.
 */
export function addressFromPaypal(shipping: PayPalShipping | undefined | null): SuggestedAddress | null {
  const address = shipping?.address;
  if (!address || address.country_code !== "US") return null;
  const [firstName, ...rest] = (shipping.name?.full_name ?? "").trim().split(/\s+/).filter(Boolean);
  const digits = `${shipping.phone_number?.country_code ?? ""}${shipping.phone_number?.national_number ?? ""}`.replace(/\D/g, "");
  const phone = /^1?\d{10}$/.test(digits) ? digits.slice(-10) : undefined;
  const found: SuggestedAddress = {
    firstName,
    lastName: rest.join(" ") || undefined,
    line1: address.address_line_1?.trim(),
    line2: address.address_line_2?.trim(),
    city: address.admin_area_2?.trim(),
    state: address.admin_area_1?.trim().toUpperCase(),
    postalCode: address.postal_code?.trim(),
    phone,
  };
  const present = Object.fromEntries(Object.entries(found).filter(([, value]) => value)) as SuggestedAddress;
  return present.line1 ? present : null;
}

/** The issues PayPal gives when a saved permission can't be used any more. */
const RECONNECT = /TOKEN|VAULT|PAYER_ACTION_REQUIRED|PERMISSION|AUTHORIZATION_NOT_ACTIVE|BILLING_AGREEMENT/i;

export function createPayPal({ clientId, clientSecret, environment, fetch: fetchImpl = fetch, storedCredential = false }: PayPalOptions): Payments {
  const base = BASES[environment];
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt - Date.now() > 60_000) return token.value;
    let response: Response;
    try {
      response = await fetchImpl(`${base}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PaymentError("unavailable", "Could not reach PayPal");
    }
    if (!response.ok) throw new PaymentError("unavailable", "PayPal refused our client ID and secret");
    const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
    if (!body?.access_token) throw new PaymentError("unavailable", "PayPal sent an answer we don't understand");
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 };
    return token.value;
  }

  /** One call to PayPal. `onError` says what a refusal means for this call. */
  async function call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    { body, requestId, wholeResponse, onError }: { body?: unknown; requestId?: string; wholeResponse?: boolean; onError?: (status: number, issues: string, detail: string) => PaymentError },
  ): Promise<T> {
    for (const attempt of [0, 1]) {
      let response: Response;
      try {
        response = await fetchImpl(`${base}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${await accessToken(attempt === 1)}`,
            "content-type": "application/json",
            ...(requestId ? { "paypal-request-id": requestId } : {}),
            // PayPal's default answer leaves out the payment details, the capture id among them.
            ...(wholeResponse ? { prefer: "return=representation" } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        if (error instanceof PaymentError) throw error;
        throw new PaymentError("unavailable", "Could not reach PayPal");
      }
      // An expired token: get a new one and try once more.
      if (response.status === 401 && attempt === 0) continue;
      if (response.ok) return (response.status === 204 ? {} : await response.json().catch(() => ({}))) as T;

      const failure = (await response.json().catch(() => ({}))) as PayPalErrorBody;
      const issues = (failure.details ?? []).map((detail) => detail.issue).filter(Boolean).join(", ");
      const detail = [failure.name, issues, failure.debug_id ? `debug ${failure.debug_id}` : ""].filter(Boolean).join(" · ");
      console.error(`PayPal ${method} ${path} -> ${response.status}: ${detail || failure.message || "no details"}`);
      if (response.status === 401) throw new PaymentError("unavailable", "PayPal refused our client ID and secret");
      throw onError?.(response.status, issues, detail) ?? new PaymentError("unavailable", `PayPal failed (${response.status})`);
    }
    throw new PaymentError("unavailable", "PayPal failed");
  }

  return {
    environment,

    async startSetup({ returnUrl, cancelUrl, brandName }) {
      const result = await call<{ id: string; links?: { rel: string; href: string }[] }>("POST", "/v3/vault/setup-tokens", {
        requestId: crypto.randomUUID(),
        body: {
          payment_source: {
            paypal: {
              usage_type: "MERCHANT",
              usage_pattern: "IMMEDIATE",
              customer_type: "CONSUMER",
              permit_multiple_payment_tokens: false,
              experience_context: { brand_name: brandName, locale: "en-US", shipping_preference: "GET_FROM_FILE", return_url: returnUrl, cancel_url: cancelUrl },
            },
          },
        },
        onError: () => new PaymentError("unavailable", "PayPal wouldn't start the connection"),
      });
      const approveUrl = result.links?.find((link) => link.rel === "approve")?.href;
      if (!result.id || !approveUrl) throw new PaymentError("unavailable", "PayPal didn't give a page to approve on");
      return { setupTokenId: result.id, approveUrl };
    },

    async finishSetup(setupTokenId) {
      // PayPal sends the user back whether or not they approved, so ask it.
      const setup = await call<{ status?: string; payment_source?: { paypal?: { shipping?: PayPalShipping } } }>("GET", `/v3/vault/setup-tokens/${encodeURIComponent(setupTokenId)}`, {
        onError: () => new PaymentError("reconnect", "PayPal doesn't have an approval from you yet"),
      });
      if (setup.status && setup.status !== "APPROVED") throw new PaymentError("reconnect", "PayPal wasn't approved");
      const saved = await call<{ id?: string; payment_source?: { paypal?: { email_address?: string; shipping?: PayPalShipping } } }>("POST", "/v3/vault/payment-tokens", {
        requestId: `setup-${setupTokenId}`,
        body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
        onError: () => new PaymentError("reconnect", "PayPal wouldn't save your account"),
      });
      if (!saved.id) throw new PaymentError("unavailable", "PayPal didn't give a saved account");
      return {
        vaultId: saved.id,
        payerEmail: saved.payment_source?.paypal?.email_address ?? null,
        // PayPal's docs put the address on the saved account; the approved setup token is checked as well.
        address: addressFromPaypal(saved.payment_source?.paypal?.shipping) ?? addressFromPaypal(setup.payment_source?.paypal?.shipping),
      };
    },

    async forget(vaultId) {
      try {
        await call("DELETE", `/v3/vault/payment-tokens/${encodeURIComponent(vaultId)}`, {});
      } catch {
        // Best effort: the user has disconnected either way, and we no longer keep the reference.
      }
    },

    async charge({ vaultId, amountCents, description, reference }) {
      type PayPalOrder = { id?: string; status?: string; purchase_units?: { payments?: { captures?: { id?: string; status?: string }[] } }[] };
      const first = await call<PayPalOrder>("POST", "/v2/checkout/orders", {
        requestId: `charge-${reference}`,
        wholeResponse: true,
        body: {
          intent: "CAPTURE",
          purchase_units: [{ reference_id: reference, custom_id: reference, description: description.slice(0, 120), amount: { currency_code: CURRENCY, value: centsToDecimal(amountCents) } }],
          payment_source: {
            paypal: {
              vault_id: vaultId,
              ...(storedCredential ? { stored_credential: { payment_initiator: "MERCHANT", payment_type: "UNSCHEDULED", usage: "SUBSEQUENT" } } : {}),
            },
          },
        },
        onError: (status, issues) =>
          RECONNECT.test(issues) || status === 404
            ? new PaymentError("reconnect", "PayPal needs you to connect your account again")
            : status >= 500
              ? new PaymentError("unavailable", "PayPal is having trouble")
              : new PaymentError("declined", "PayPal couldn't take the payment"),
      });
      const captureOf = (found: PayPalOrder) => found.purchase_units?.[0]?.payments?.captures?.[0];
      // An answer with no capture in it may still be a charge: ask for the order before deciding anything.
      const order =
        first.id && first.status !== "PAYER_ACTION_REQUIRED" && !captureOf(first)
          ? await call<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(first.id)}`, { wholeResponse: true }).catch(() => first)
          : first;
      const capture = captureOf(order);
      if (order.status === "PAYER_ACTION_REQUIRED") throw new PaymentError("reconnect", "PayPal needs you to connect your account again");
      if (order.status === "COMPLETED" && order.id && capture?.id && capture.status === "COMPLETED") return { paypalOrderId: order.id, captureId: capture.id };
      if (capture?.status === "DECLINED" || capture?.status === "FAILED" || order.status === "VOIDED") throw new PaymentError("declined", "PayPal didn't complete the payment");
      // Pending, or no clear answer: the money may have been taken, so this must not read as "you
      // weren't charged". The same request id is tried again, and can't charge twice.
      throw new PaymentError("unavailable", "PayPal hasn't confirmed the payment yet");
    },

    async refund({ captureId, amountCents, reference, note }) {
      const refund = await call<{ id?: string }>("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
        requestId: `refund-${reference}`,
        body: { amount: { currency_code: CURRENCY, value: centsToDecimal(amountCents) }, note_to_payer: note.slice(0, 255) },
        onError: (status) => new PaymentError(status >= 500 ? "unavailable" : "declined", "PayPal wouldn't refund the payment"),
      });
      return { refundId: refund.id ?? "" };
    },

    async addTracking({ paypalOrderId, captureId, trackingNumber, carrier }) {
      const known = carrier ? CARRIERS[carrier.toUpperCase().replace(/[^A-Z]/g, "")] : undefined;
      await call("POST", `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/track`, {
        requestId: `track-${captureId}-${trackingNumber}`,
        body: {
          capture_id: captureId,
          tracking_number: trackingNumber,
          carrier: known ?? "OTHER",
          ...(known ? {} : { carrier_name_other: (carrier ?? "Carrier").slice(0, 64) }),
          notify_payer: false,
        },
        onError: () => new PaymentError("unavailable", "PayPal wouldn't take the tracking number"),
      });
    },
  };
}

/** Whether PayPal credentials are in the environment. */
export function paypalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/**
 * PayPal from the environment (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_ENV = sandbox or live).
 * Throws a PaymentError when it isn't set up. Never reads or prints the secret anywhere else.
 */
export function paypalFromEnv(): Payments {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new PaymentError("unavailable", "PayPal isn't set up yet (PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET)");
  const environment = process.env.PAYPAL_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  return createPayPal({ clientId, clientSecret, environment, storedCredential: process.env.PAYPAL_STORED_CREDENTIAL === "1" });
}

/**
 * Whether PayPal accepts our client ID and secret: asks it for a token and says what happened. Charges
 * nothing and never includes the secret in what it returns.
 */
export async function checkPaypalCredentials(fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; environment: "sandbox" | "live"; message: string }> {
  const environment = process.env.PAYPAL_ENV?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId) return { ok: false, environment, message: "PAYPAL_CLIENT_ID is not set in .env.local" };
  if (!clientSecret) return { ok: false, environment, message: "PAYPAL_CLIENT_SECRET is empty: paste the secret after the = in .env.local" };
  try {
    const response = await fetchImpl(`${BASES[environment]}/v1/oauth2/token`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) return { ok: true, environment, message: `PayPal ${environment} accepted the client ID and secret` };
    return {
      ok: false,
      environment,
      message:
        response.status === 401
          ? `PayPal ${environment} refused the client ID and secret. Check they are a pair from the same app, and that PAYPAL_ENV (${environment}) matches the app's mode.`
          : `PayPal ${environment} answered ${response.status}`,
    };
  } catch {
    return { ok: false, environment, message: "Could not reach PayPal" };
  }
}
