import type { Metadata } from "next";
import { Suspense } from "react";
import { AddPurchases } from "./add-purchases/add-purchases";
import { AddPurchasesPlaceholder } from "./add-purchases/add-purchases-dialog";
import { logOutAction } from "@/app/auth/actions";
import { Questions } from "@/app/questions/questions";
import { InventoryList } from "./inventory-list";

export const metadata: Metadata = { title: "Inventory · Replenish" };

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            What you have at home, and when it is likely to run out. Most urgent first.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Suspense fallback={null}>
            <Questions />
          </Suspense>
          <Suspense fallback={<AddPurchasesPlaceholder />}>
            <AddPurchases />
          </Suspense>
          <form action={logOutAction}>
            <button type="submit" className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <Suspense fallback={<InventorySkeleton />}>
        <InventoryList />
      </Suspense>
    </main>
  );
}

function InventorySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading inventory" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-56 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
      ))}
    </div>
  );
}
