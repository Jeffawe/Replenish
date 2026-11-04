"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { OrderView } from "@/modules/orders/client";
import { markSeenAction } from "./actions";
import { money, refundLine, shortDate } from "./format";

/** One line per order that finished while the user was away. */
export function OrderResultsBanner({ orders }: { orders: OrderView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const visible = orders.filter((order) => !hidden.has(order.id));
  if (visible.length === 0) return null;

  const dismiss = (ids: string[]) =>
    startTransition(async () => {
      setHidden((current) => new Set([...current, ...ids]));
      await markSeenAction(ids);
      router.refresh();
    });

  return (
    <section aria-label="Your recent orders" className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <ul className="flex flex-col gap-2">
        {visible.map((order) => (
          <li key={order.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            {order.status === "placed" ? (
              <p>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400" aria-label="Success">
                  ✓
                </span>{" "}
                {order.source === "auto" ? "Auto-buy bought" : "We bought"} <span className="font-medium">{order.productName}</span>
                {order.totalCents !== null ? ` for ${money(order.totalCents)}` : ""}
                {order.arrivesAt ? `. Expected around ${shortDate(order.arrivesAt)}.` : "."}
              </p>
            ) : (
              <p>
                <span className="font-semibold text-rose-700 dark:text-rose-400" aria-label="Failed">
                  ✗
                </span>{" "}
                {order.source === "auto" ? "Auto-buy couldn\u2019t buy" : "We couldn\u2019t buy"} <span className="font-medium">{order.productName}</span>. {order.failureReason} {order.paymentStatus === "none" ? "" : refundLine(order)}
              </p>
            )}
            <button type="button" disabled={pending} onClick={() => dismiss([order.id])} className="rounded-lg px-2 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Got it
            </button>
          </li>
        ))}
      </ul>
      <Link href="/orders" className="w-fit text-sm underline underline-offset-2">
        See all orders
      </Link>
    </section>
  );
}
