import { z } from "zod";
import type { DeliveryAddress } from "@/modules/settings";
import type { Tracking } from "./types";

/**
 * Buying the item from the store through Zinc (https://www.zinc.com): POST /orders with the product
 * link, the delivery address and a price ceiling; Zinc buys it from our Zinc wallet and reports back.
 * An order takes a few seconds to a few minutes to settle, so `place` only starts it and `check` asks
 * how it went. The free sandbox key (zn_test_...) makes believe: nothing is bought.
 */

export type FulfilmentErrorKind =
  | "invalid-address"
  | "unreachable"
  /** Our Zinc wallet is empty (not the user's problem, but they can't be served). */
  | "insufficient-funds"
  | "unavailable"
  | "failed";

/** A problem placing the order. The message is safe to show the user. */
export class FulfilmentError extends Error {
  constructor(
    public readonly kind: FulfilmentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "FulfilmentError";
  }
}

export type ZincOrderState =
  | { state: "pending" }
  | {
      state: "placed";
      /** What the store charged: items, tax and shipping, in cents. */
      totalCents: number;
      merchantOrderId: string | null;
      estimatedDelivery: Date | null;
      tracking: Omit<Tracking, "sentToPaypal">[];
    }
  | { state: "failed"; reason: string };

export interface Fulfilment {
  /** True for the free sandbox key: orders are pretend. */
  readonly sandbox: boolean;
  place(args: { url: string; quantity: number; address: DeliveryAddress; maxPriceCents: number; reference: string }): Promise<{ zincOrderId: string }>;
  check(zincOrderId: string): Promise<ZincOrderState>;
  /**
   * Asks Zinc to stop an order. True if it stopped; false if it won't (Zinc only cancels an order
   * that is still queued; after that it can only be returned to the store) or couldn't be asked.
   */
  cancel(zincOrderId: string): Promise<boolean>;
}

const BASE_URL = "https://api.zinc.com";
const TIMEOUT_MS = 20_000;

/** What Zinc's `error_type` means to the user. */
const FAILURES: Record<string, string> = {
  max_price_exceeded: "The price went up past what we allow",
  out_of_stock: "It's out of stock",
  invalid_variant: "The store needs a size or option we couldn't pick",
  shipping_unavailable: "The store can't deliver to your address",
  invalid_address: "The delivery address wasn't accepted",
  url_unreachable: "The store's page couldn't be opened",
};

const TrackingEntry = z.object({
  id: z.string(),
  carrier: z.string().nullish(),
  tracking_number: z.string(),
  zinc_tracking_url: z.string().nullish(),
  status: z.string().nullish(),
  estimated_delivery_date: z.string().nullish(),
});

const OrderBody = z.object({
  id: z.string().optional(),
  status: z.string(),
  job_result: z
    .object({
      error_type: z.string().nullish(),
      error: z.string().nullish(),
      price_components: z.object({ total: z.number() }).nullish(),
      estimated_delivery: z.string().nullish(),
    })
    .nullish(),
  merchant_order_ids: z.array(z.unknown()).nullish(),
  tracking_numbers: z.array(z.unknown()).nullish(),
});

/** Zinc's answer about an order, as a state. */
export function toOrderState(body: unknown): ZincOrderState {
  const parsed = OrderBody.safeParse(body);
  if (!parsed.success) throw new FulfilmentError("unavailable", "Zinc sent an answer we don't understand");
  const { status, job_result: result, merchant_order_ids: merchantIds, tracking_numbers: trackingList } = parsed.data;

  if (status === "order_failed" || /cancel|fail/i.test(status)) {
    const known = result?.error_type ? FAILURES[result.error_type] : undefined;
    return { state: "failed", reason: known ?? "The store couldn't complete the order" };
  }
  if (status !== "order_placed") return { state: "pending" };

  const total = result?.price_components?.total;
  if (typeof total !== "number") throw new FulfilmentError("unavailable", "Zinc didn't say what the order cost");
  const merchantId = typeof merchantIds?.[0] === "string" ? merchantIds[0] : null;
  const delivery = result?.estimated_delivery ? new Date(result.estimated_delivery) : null;
  const tracking = (trackingList ?? []).flatMap((raw) => {
    const entry = TrackingEntry.safeParse(raw);
    if (!entry.success) return [];
    const { id, carrier, tracking_number, zinc_tracking_url, status: trackingStatus, estimated_delivery_date } = entry.data;
    return [{ id, carrier: carrier ?? null, number: tracking_number, url: zinc_tracking_url ?? null, status: trackingStatus ?? "pending", estimatedDelivery: estimated_delivery_date ?? null }];
  });
  return { state: "placed", totalCents: Math.round(total), merchantOrderId: merchantId, estimatedDelivery: delivery && !Number.isNaN(delivery.getTime()) ? delivery : null, tracking };
}

export function createZincOrders({ apiKey, fetch: fetchImpl = fetch }: { apiKey: string; fetch?: typeof fetch }): Fulfilment {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    let response: Response;
    try {
      response = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new FulfilmentError("unavailable", "Could not reach Zinc");
    }
    return { status: response.status, json: await response.json().catch(() => ({})) };
  }

  return {
    sandbox: apiKey.startsWith("zn_test_"),

    async place({ url, quantity, address, maxPriceCents, reference }) {
      const { status, json } = await call("POST", "/orders", {
        products: [{ url, quantity }],
        shipping_address: {
          first_name: address.firstName,
          last_name: address.lastName,
          address_line1: address.line1,
          ...(address.line2 ? { address_line2: address.line2 } : {}),
          city: address.city,
          state: address.state,
          postal_code: address.postalCode,
          phone_number: address.phone,
          country: "US",
        },
        max_price: maxPriceCents,
        idempotency_key: reference,
        metadata: { replenish_order_id: reference },
      });
      const detail = JSON.stringify(json).slice(0, 300);
      if (status === 401 || status === 403) throw new FulfilmentError("unavailable", "Zinc refused our API key");
      if (status === 402) throw new FulfilmentError("insufficient-funds", "Our Zinc balance can't cover this order");
      if (status === 409) {
        // We placed this order already (a retry after a crash): find it by the reference we put on it.
        const found = await call("GET", "/orders?limit=50");
        const orders = (found.json as { orders?: { id?: string; metadata?: { replenish_order_id?: string } }[] })?.orders ?? [];
        const existing = orders.find((order) => order.metadata?.replenish_order_id === reference)?.id;
        if (existing) return { zincOrderId: existing };
        throw new FulfilmentError("unavailable", "Zinc has this order but we couldn't find it");
      }
      if (status === 400 || status === 422) {
        if (/address/i.test(detail)) throw new FulfilmentError("invalid-address", "The delivery address wasn't accepted");
        if (/unreachable|url/i.test(detail)) throw new FulfilmentError("unreachable", "The store's page couldn't be opened");
        throw new FulfilmentError("failed", "The order wasn't accepted");
      }
      const id = (json as { id?: string })?.id;
      if (status >= 300 || !id) throw new FulfilmentError("unavailable", `Zinc failed (${status})`);
      return { zincOrderId: id };
    },

    async check(zincOrderId) {
      const { status, json } = await call("GET", `/orders/${encodeURIComponent(zincOrderId)}`);
      if (status === 404) throw new FulfilmentError("unavailable", "Zinc doesn't know this order");
      if (status >= 300) throw new FulfilmentError("unavailable", `Zinc failed (${status})`);
      return toOrderState(json);
    },

    async cancel(zincOrderId) {
      try {
        const { status } = await call("POST", `/orders/${encodeURIComponent(zincOrderId)}/cancel`, {});
        return status < 300;
      } catch {
        return false;
      }
    },
  };
}

/** Zinc from ZINC_API_KEY; throws a FulfilmentError when it isn't set. */
export function zincOrdersFromEnv(): Fulfilment {
  const apiKey = process.env.ZINC_API_KEY;
  if (!apiKey) throw new FulfilmentError("unavailable", "ZINC_API_KEY is not set");
  return createZincOrders({ apiKey });
}
