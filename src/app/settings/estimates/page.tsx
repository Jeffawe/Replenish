import type { Metadata } from "next";
import { Suspense } from "react";
import { DEFAULT_PREDICT_CONFIG } from "@/core/predict";
import { requireUser } from "@/modules/auth";
import { getUserSettings } from "@/modules/settings";
import { MUTED } from "../fields";
import { EstimateForm } from "./estimate-form";

export const metadata: Metadata = { title: "Estimate settings · Replenish" };

export default function EstimateSettingsPage() {
  return (
    <section className="flex flex-col gap-4">
      <p className={MUTED}>How we decide a product is running low. Each product can set its own in its Edit dialog.</p>
      <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="h-32 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />}>
        <Loaded />
      </Suspense>
    </section>
  );
}

async function Loaded() {
  const user = await requireUser();
  const settings = await getUserSettings(user.id);
  return <EstimateForm thresholdDays={settings.lowStockThresholdDays} defaultDays={DEFAULT_PREDICT_CONFIG.defaultLowStockThresholdDays} />;
}
