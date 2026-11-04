import { FakePayments, PaymentError, type Payments } from "./payments";
import { paypalFromEnv } from "./paypal";
import { zincOrdersFromEnv } from "./fulfilment";
import type { OrderDeps } from "./pipeline";

let fakePayments: FakePayments | null = null;

/** PAYPAL_FAKE=1 pretends to be PayPal, for trying the app without credentials. Never in production. */
const fakeRequested = () => process.env.PAYPAL_FAKE === "1" && process.env.NODE_ENV !== "production";

/** Whether orders can be paid for here: PayPal credentials are set (or the development fake is on). */
export function paymentsConfigured(): boolean {
  return fakeRequested() || Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

/** PayPal (or the development fake). Throws a PaymentError when it isn't set up. */
export function paymentsFromEnv(): Payments {
  if (fakeRequested()) return (fakePayments ??= new FakePayments("sandbox"));
  return paypalFromEnv();
}

/** The PayPal and Zinc to use, from the environment. Throws a PaymentError or FulfilmentError when one isn't set up. */
export function orderDepsFromEnv(): OrderDeps {
  return { payments: paymentsFromEnv(), fulfilment: zincOrdersFromEnv() };
}

export { PaymentError };
