import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/modules/auth";
import { listOrdersPage, parseOrdersQuery } from "@/modules/orders";
import { OrdersList } from "./orders-list";

export const metadata: Metadata = { title: "Orders · Replenish" };

export default function OrdersPage(props: PageProps<"/orders">) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href="/dashboard" className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
          &larr; Back to inventory
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">What we&rsquo;ve bought for you, and where it is.</p>
      </header>
      <Suspense fallback={<div aria-busy="true" aria-label="Loading orders" className="h-48 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />}>
        <Loaded searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}

async function Loaded({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const page = await listOrdersPage(user.id, parseOrdersQuery(await searchParams));
  // A new key starts the list afresh when the month or page changes.
  return <OrdersList key={`${page.month}-${page.page}`} initial={page} />;
}
