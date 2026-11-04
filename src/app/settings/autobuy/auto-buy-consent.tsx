"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { DialogFrame } from "@/app/questions/dialog-frame";
import { money } from "@/app/orders/format";
import { priceBreakdown, SERVICE_FEE_TERMS, TAX_AND_SHIPPING_ALLOWANCE } from "@/core/order-money";
import type { AutoBuyTerms } from "@/modules/orders/client";

/**
 * Shown every time auto-buy is switched on for a product: it spends money without asking, so the user
 * sees what it does, what it costs and what limits it, then says yes. Cancelling leaves it off.
 */
export const AutoBuyConsent = forwardRef<HTMLDialogElement, { name: string; terms: AutoBuyTerms; onConfirm(): void }>(function AutoBuyConsent({ name, terms, onConfirm }, ref) {
  const fees = priceBreakdown(2000);
  const close = (event: React.MouseEvent<HTMLButtonElement>) => event.currentTarget.closest("dialog")?.close();
  return (
    <DialogFrame ref={ref} title={`Turn on auto-buy for ${name}?`} subtitle="We'd buy it for you when it runs low, without asking first.">
      <div className="flex flex-col gap-4 text-sm">
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">When we buy</h3>
          <p className="text-zinc-600 dark:text-zinc-400">
            Only when it&rsquo;s running low, we&rsquo;re at least {Math.round(terms.minConfidence * 100)}% sure of that, and the listing has nothing unusual about it. Otherwise we ask you, as we do now.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">What it costs</h3>
          <p className="text-zinc-600 dark:text-zinc-400">
            The store&rsquo;s price, tax and shipping, plus on each order a {money(fees.orderingFeeCents)} ordering fee and a Replenish service fee ({SERVICE_FEE_TERMS}). We hold the price plus {Math.round(TAX_AND_SHIPPING_ALLOWANCE * 100)}%, and the fees, on your PayPal, then refund what isn&rsquo;t used.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">Your limits</h3>
          <p className="text-zinc-600 dark:text-zinc-400">
            At most {money(terms.orderCents)} an order, fees included, and {money(terms.monthCents)} a month.{" "}
            <Link href="/settings/autobuy" className="underline underline-offset-2">
              Change them in Settings
            </Link>
            . They can go lower, but not above {money(terms.platformOrderCents)} and {money(terms.platformMonthCents)}.
          </p>
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">Good to know</h3>
          <p className="text-zinc-600 dark:text-zinc-400">
            Everything we buy shows on your Orders page. Once the store has the order it can&rsquo;t be cancelled here, only returned to the store. You can turn auto-buy off any time.
          </p>
        </section>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={PRIMARY}
            onClick={(event) => {
              close(event);
              onConfirm();
            }}
          >
            Turn on auto-buy
          </button>
          <button type="button" className={SECONDARY} onClick={close}>
            Not now
          </button>
        </div>
      </div>
    </DialogFrame>
  );
});
