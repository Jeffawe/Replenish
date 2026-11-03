import type { Metadata } from "next";
import { Suspense } from "react";
import { requireUser } from "@/modules/auth";
import { getInventory } from "@/modules/inventory/service";
import { getUserSettings } from "@/modules/settings";
import { MUTED } from "../fields";
import { AutobuyForm } from "./autobuy-form";
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
        <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Automatic buying isn&rsquo;t live yet. Your choices are saved and will apply when it is.
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
  const [settings, items] = await Promise.all([getUserSettings(user.id), getInventory(user.id)]);

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
      <AutobuyForm settings={settings} />
      <ProductSwitches rows={rows} minConfidence={settings.autobuyMinConfidence} />
    </>
  );
}
