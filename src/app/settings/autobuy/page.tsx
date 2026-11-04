import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/modules/auth";
import { autoBuySetupProblem, autoBuyTerms, previewAutoBuy } from "@/modules/orders";
import { getInventory } from "@/modules/inventory/service";
import { getUserSettings, platformLimits } from "@/modules/settings";
import { money } from "@/app/orders/format";
import { SERVICE_FEE_TERMS, ZINC_FEE_CENTS } from "@/core/order-money";
import { MUTED } from "../fields";
import { AutobuyForm } from "./autobuy-form";
import { AutoBuyPreviewPanel } from "./preview-panel";
import { ProductSwitches, type SwitchRow } from "./product-switches";

export const metadata: Metadata = { title: "Auto-buy settings · Replenish" };

export default function AutobuySettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className={MUTED}>
          When something runs low we look for it online. If auto-buy is on for that product and the purchase fits your limits below, we buy it. Otherwise we ask you
          first. Auto-buy is off for every product until you turn it on.
        </p>
        <p role="note" className="rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
          To buy for you we need PayPal connected and a delivery address.{" "}
          <Link href="/settings/payment" className="font-medium underline underline-offset-2">
            Set them up
          </Link>
          . Everything we buy shows on your{" "}
          <Link href="/orders" className="font-medium underline underline-offset-2">
            Orders
          </Link>{" "}
          page, and you&rsquo;re refunded if an order can&rsquo;t be placed. Each order costs the store&rsquo;s price, tax and shipping, plus{" "}
          {money(ZINC_FEE_CENTS)} ordering fee and our service fee ({SERVICE_FEE_TERMS}).
        </p>
      </section>
      <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="h-96 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />}>
        <Loaded />
      </Suspense>
    </div>
  );
}

async function Loaded() {
  const user = await requireUser();
  const [settings, items, setupProblem, preview] = await Promise.all([getUserSettings(user.id), getInventory(user.id), autoBuySetupProblem(user.id), previewAutoBuy(user.id)]);

  const rows: SwitchRow[] = items
    .map(({ product, estimate }) => ({
      id: product.id,
      name: product.name,
      boughtFrom: product.boughtFrom,
      enabled: product.autobuyEnabled,
      confirmed: product.confirmedAt !== null,
      hasOwnRange: product.autobuyMinPriceCents !== null || product.autobuyMaxPriceCents !== null,
      // Null while there isn't enough history to estimate at all.
      confidence: estimate.estimatedRemaining === null ? null : estimate.confidence,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <AutoBuyPreviewPanel preview={preview} />
      <AutobuyForm settings={settings} limits={platformLimits()} />
      <ProductSwitches rows={rows} minConfidence={settings.autobuyMinConfidence} setupProblem={setupProblem} terms={autoBuyTerms(settings)} />
    </>
  );
}
