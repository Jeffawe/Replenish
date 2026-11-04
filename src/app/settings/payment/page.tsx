import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/modules/auth";
import { paymentSetup, paymentsConfigured, paymentsFromEnv } from "@/modules/orders";
import { getDeliveryAddress, getUserSettings } from "@/modules/settings";
import { MUTED } from "../fields";
import { disconnectPaypalAction } from "./actions";
import { DeliveryForm } from "./delivery-form";
import { ConfirmSwitch } from "./confirm-switch";
import { money } from "@/app/orders/format";
import { priceBreakdown, SERVICE_FEE_TERMS, TAX_AND_SHIPPING_ALLOWANCE } from "@/core/order-money";

export const metadata: Metadata = { title: "Payment & delivery · Replenish" };

const BUTTON = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background";
const BUTTON_PLAIN = "rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/** What the message after coming back from PayPal says. */
const NOTES: Record<string, { text: string; good: boolean }> = {
  connected: { text: "PayPal is connected. We can pay for orders now.", good: true },
  "not-approved": { text: "PayPal wasn't approved, so nothing was saved. You can try again.", good: false },
  unavailable: { text: "We couldn't reach PayPal just now. Please try again in a moment.", good: false },
  unconfigured: { text: "PayPal isn't set up on this server yet (the owner needs to add PayPal's client ID and secret).", good: false },
  cancelled: { text: "You cancelled at PayPal, so nothing was saved.", good: false },
  disconnected: { text: "PayPal is disconnected. We can't buy anything for you until you connect it again.", good: true },
};

export default function PaymentPage(props: PageProps<"/settings/payment">) {
  return (
    <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="h-96 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />}>
      <Loaded searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Loaded({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const [setup, address, params, settings] = await Promise.all([paymentSetup(user.id), getDeliveryAddress(user.id), searchParams, getUserSettings(user.id)]);
  const fees = priceBreakdown(2000);
  const note = typeof params.paypal === "string" ? NOTES[params.paypal] : undefined;
  let testMode = false;
  try {
    testMode = paymentsFromEnv().environment === "sandbox";
  } catch {
    // Not configured: the connect button explains it.
  }

  return (
    <div className="flex flex-col gap-10">
      {note && (
        <p
          role="status"
          className={
            "rounded-xl border px-4 py-3 text-sm " +
            (note.good
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
              : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100")
          }
        >
          {note.text}
        </p>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="paypal-heading">
        <h2 id="paypal-heading" className="text-lg font-semibold">
          PayPal
        </h2>
        <p className={MUTED}>
          This is how we pay when we buy something for you, even while you&rsquo;re away. You approve it once at PayPal. We never see your card or password, and you can
          disconnect any time. If an order can&rsquo;t be placed, you&rsquo;re refunded.
        </p>
        {testMode && (
          <p role="note" className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Test mode: PayPal&rsquo;s sandbox, so no real money moves.
          </p>
        )}

        {setup.paypal === "connected" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              <span aria-hidden="true">✓ </span>Connected{setup.payerEmail ? ` as ${setup.payerEmail}` : ""}
            </p>
            <form action={disconnectPaypalAction}>
              <button type="submit" className={BUTTON_PLAIN}>
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {setup.paypal === "reconnect" && (
              <p role="alert" className="text-sm text-amber-900 dark:text-amber-200">
                PayPal stopped letting us charge your account, so please connect it again.
              </p>
            )}
            <form action="/settings/payment/paypal/start" method="post">
              <button type="submit" className={BUTTON}>
                {setup.paypal === "reconnect" ? "Reconnect PayPal" : "Connect PayPal"}
              </button>
            </form>
            {!paymentsConfigured() && <p className={MUTED}>PayPal isn&rsquo;t set up on this server yet.</p>}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="pricing-heading">
        <h2 id="pricing-heading" className="text-lg font-semibold">
          What an order costs
        </h2>
        <ul className={`flex flex-col gap-1.5 ${MUTED}`}>
          <li>The store&rsquo;s price, tax and shipping, exactly as the store charges them.</li>
          <li>A {money(fees.orderingFeeCents)} ordering fee, paid to the service that places the order at the store.</li>
          <li>A Replenish service fee for finding and buying it: {SERVICE_FEE_TERMS}.</li>
        </ul>
        <p className={MUTED}>
          We can&rsquo;t know the tax and shipping until the store has charged them, so we first hold the price plus {Math.round(TAX_AND_SHIPPING_ALLOWANCE * 100)}%, plus the fees, on your PayPal. Whatever isn&rsquo;t used comes back as a refund, and all of it comes back if the order doesn&rsquo;t go through.
        </p>
        <ConfirmSwitch skip={settings.skipBuyConfirm} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="delivery-heading">
        <h2 id="delivery-heading" className="text-lg font-semibold">
          Delivery address
        </h2>
        <p className={MUTED}>Where we send what we buy for you. US addresses only for now. Fields marked <span className="text-rose-600 dark:text-rose-400">*</span> are required.</p>
        {!address && setup.suggestedAddress && (
          <p role="note" className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100">
            We filled this in from the address on your PayPal. Check it
            {setup.suggestedAddress.phone ? "" : ", add a phone number,"} and press Save. We won&rsquo;t use it until you do.
          </p>
        )}
        <DeliveryForm address={address ?? setup.suggestedAddress} saved={address !== null} />
      </section>
    </div>
  );
}
