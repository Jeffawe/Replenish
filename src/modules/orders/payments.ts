/**
 * Taking money from the user's PayPal and giving it back. PayPal is one implementation (paypal.ts);
 * the interface lets the order pipeline be tested, and run in development, without calling it.
 *
 * How an order uses it: the user's PayPal is charged up front for the most the order could cost,
 * Zinc then buys the item, and whatever wasn't needed is refunded (all of it, if the purchase fails).
 */

export type PaymentErrorKind =
  /** PayPal refused to take the money (declined, restricted, not enough funds). */
  | "declined"
  /** The saved PayPal permission no longer works; the user has to connect PayPal again. */
  | "reconnect"
  /** PayPal (or our credentials for it) isn't working right now. */
  | "unavailable";

/** A payment problem. The message is safe to show or log; it never contains a key or a secret. */
export class PaymentError extends Error {
  constructor(
    public readonly kind: PaymentErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/**
 * A delivery address PayPal knows for the user, used only to fill in the form for them to check.
 * Any part can be missing (PayPal gives a phone number only when the merchant account allows it).
 */
export interface SuggestedAddress {
  firstName?: string;
  lastName?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
}

export interface Payments {
  /** Whether this is PayPal's sandbox (test money) or the real thing. */
  readonly environment: "sandbox" | "live";

  /** Starts saving the user's PayPal. Send them to `approveUrl`; they come back to `returnUrl` (or `cancelUrl`). */
  startSetup(args: { returnUrl: string; cancelUrl: string; brandName: string }): Promise<{ setupTokenId: string; approveUrl: string }>;

  /**
   * After they approved: turns the approval into a saved payment method. Throws "reconnect" if they didn't approve.
   * `address` is the US shipping address they have on file at PayPal, when PayPal gave one.
   */
  finishSetup(setupTokenId: string): Promise<{ vaultId: string; payerEmail: string | null; address: SuggestedAddress | null }>;

  /** Asks PayPal to forget a saved account (when the user disconnects). Best effort: it never throws. */
  forget(vaultId: string): Promise<void>;

  /** Charges the saved PayPal now. `reference` is our order id and makes a retry safe (it can't charge twice). */
  charge(args: { vaultId: string; amountCents: number; description: string; reference: string }): Promise<{ paypalOrderId: string; captureId: string }>;

  /** Gives money back from a charge. `reference` makes a retry safe. */
  refund(args: { captureId: string; amountCents: number; reference: string; note: string }): Promise<{ refundId: string }>;

  /** Puts the parcel's tracking number on the payment in PayPal. */
  addTracking(args: { paypalOrderId: string; captureId: string; trackingNumber: string; carrier: string | null }): Promise<void>;
}

/**
 * Pretends to be PayPal, remembering what it was asked. For tests, and for running the app without
 * PayPal credentials in development (PAYPAL_FAKE=1). Set `failNextCharge` to make the next charge fail.
 */
export class FakePayments implements Payments {
  readonly environment: "sandbox" | "live";
  charges: { vaultId: string; amountCents: number; reference: string; captureId: string }[] = [];
  refunds: { captureId: string; amountCents: number; reference: string }[] = [];
  tracking: { paypalOrderId: string; trackingNumber: string; carrier: string | null }[] = [];
  failNextCharge: PaymentError | null = null;
  failNextRefund = false;
  setups = 0;

  constructor(environment: "sandbox" | "live" = "sandbox") {
    this.environment = environment;
  }

  async startSetup({ returnUrl }: { returnUrl: string; cancelUrl: string; brandName: string }) {
    this.setups++;
    const setupTokenId = `fake-setup-${this.setups}`;
    // There is no PayPal page to visit: "approving" is going straight back.
    return { setupTokenId, approveUrl: returnUrl };
  }

  async finishSetup(setupTokenId: string): ReturnType<Payments["finishSetup"]> {
    // Like PayPal, an address with no phone number.
    return {
      vaultId: `fake-vault-${setupTokenId}`,
      payerEmail: "buyer@sandbox.example",
      address: { firstName: "Test", lastName: "Buyer", line1: "1 Main St", city: "San Jose", state: "CA", postalCode: "95131" },
    };
  }

  forgotten: string[] = [];

  async forget(vaultId: string) {
    this.forgotten.push(vaultId);
  }

  async charge({ vaultId, amountCents, reference }: { vaultId: string; amountCents: number; description: string; reference: string }) {
    if (this.failNextCharge) {
      const error = this.failNextCharge;
      this.failNextCharge = null;
      throw error;
    }
    // A retry with the same reference is the same charge.
    const existing = this.charges.find((charge) => charge.reference === reference);
    if (existing) return { paypalOrderId: `fake-order-${existing.reference}`, captureId: existing.captureId };
    const captureId = `fake-capture-${this.charges.length + 1}`;
    this.charges.push({ vaultId, amountCents, reference, captureId });
    return { paypalOrderId: `fake-order-${reference}`, captureId };
  }

  async refund({ captureId, amountCents, reference }: { captureId: string; amountCents: number; reference: string; note: string }) {
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new PaymentError("unavailable", "PayPal is not answering");
    }
    const existing = this.refunds.find((refund) => refund.reference === reference);
    if (!existing) this.refunds.push({ captureId, amountCents, reference });
    return { refundId: `fake-refund-${reference}` };
  }

  async addTracking({ paypalOrderId, trackingNumber, carrier }: { paypalOrderId: string; captureId: string; trackingNumber: string; carrier: string | null }) {
    this.tracking.push({ paypalOrderId, trackingNumber, carrier });
  }
}
