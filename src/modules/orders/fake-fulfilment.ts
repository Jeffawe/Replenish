import type { DeliveryAddress } from "@/modules/settings";
import { FulfilmentError, type Fulfilment, type ZincOrderState } from "./fulfilment";

/**
 * Pretends to be Zinc, remembering what it was asked. For tests: an order stays pending until the test
 * sets `result`, and `failNextPlace` makes the next order be refused.
 */
export class FakeFulfilment implements Fulfilment {
  readonly sandbox: boolean;
  placed: { zincOrderId: string; url: string; quantity: number; address: DeliveryAddress; maxPriceCents: number; reference: string }[] = [];
  cancelled: string[] = [];
  result: ZincOrderState = { state: "pending" };
  failNextPlace: FulfilmentError | null = null;
  checkFails = false;
  /** Zinc says the order has gone too far to cancel. */
  cancelRefused = false;

  constructor(sandbox = true) {
    this.sandbox = sandbox;
  }

  async place(args: { url: string; quantity: number; address: DeliveryAddress; maxPriceCents: number; reference: string }) {
    if (this.failNextPlace) {
      const error = this.failNextPlace;
      this.failNextPlace = null;
      throw error;
    }
    // The same reference is the same order, like Zinc's idempotency key.
    const existing = this.placed.find((order) => order.reference === args.reference);
    if (existing) return { zincOrderId: existing.zincOrderId };
    const zincOrderId = `fake-zinc-${this.placed.length + 1}`;
    this.placed.push({ zincOrderId, ...args });
    return { zincOrderId };
  }

  async check() {
    if (this.checkFails) throw new FulfilmentError("unavailable", "Zinc is not answering");
    return this.result;
  }

  async cancel(zincOrderId: string) {
    if (this.cancelRefused) return false;
    this.cancelled.push(zincOrderId);
    return true;
  }
}

/** A finished order as Zinc reports it, for tests. */
export const placedAt = (totalCents: number, tracking = true): ZincOrderState => ({
  state: "placed",
  totalCents,
  merchantOrderId: "W-1001",
  estimatedDelivery: null,
  tracking: tracking ? [{ id: "trk-1", carrier: "USPS", number: "9400100000000000", url: "https://track.test/9400", status: "in_transit", estimatedDelivery: null }] : [],
});
