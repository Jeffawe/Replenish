"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ORDERS_PAGE_SIZE, type OrdersPage } from "@/modules/orders/client";
import { monthLabel } from "./format";

const LINK = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const LINK_OFF = "rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-400 dark:border-zinc-800 dark:text-zinc-600";

export const ordersHref = (month: string | null, page: number) => {
  const params = new URLSearchParams();
  if (month) params.set("month", month);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/orders?${query}` : "/orders";
};

/** The month filter above the list. Choosing a month starts again at its first page. */
export function MonthFilter({ data }: { data: OrdersPage }) {
  const router = useRouter();
  // Nothing to filter by until there are orders in more than one month.
  if (data.months.length < 2 && !data.month) return null;
  return (
    <div className="flex items-center gap-2 text-sm">
      <label htmlFor="orders-month" className="text-zinc-600 dark:text-zinc-400">
        Month
      </label>
      <select
        id="orders-month"
        value={data.month ?? ""}
        onChange={(event) => router.push(ordersHref(event.target.value || null, 1))}
        className="rounded-lg border border-zinc-300 bg-background px-2 py-1.5 dark:border-zinc-700"
      >
        <option value="">All months</option>
        {data.months.map(({ month, count }) => (
          <option key={month} value={month}>
            {monthLabel(month)} ({count})
          </option>
        ))}
        {/* A month in the address that has no orders still shows as chosen. */}
        {data.month && !data.months.some(({ month }) => month === data.month) && <option value={data.month}>{monthLabel(data.month)} (0)</option>}
      </select>
    </div>
  );
}

/** "Showing 11-20 of 34", with Previous and Next. Hidden when everything fits on one page. */
export function Pager({ data }: { data: OrdersPage }) {
  if (data.total === 0) return null;
  const first = (data.page - 1) * ORDERS_PAGE_SIZE + 1;
  const last = Math.min(data.page * ORDERS_PAGE_SIZE, data.total);
  return (
    <nav aria-label="Pages of orders" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-zinc-600 dark:text-zinc-400">
        Showing {first}&ndash;{last} of {data.total}
        {data.month ? ` in ${monthLabel(data.month)}` : ""}
      </p>
      {data.pageCount > 1 && (
        <div className="flex items-center gap-2">
          {data.page > 1 ? (
            <Link href={ordersHref(data.month, data.page - 1)} className={LINK}>
              &larr; Newer
            </Link>
          ) : (
            <span aria-disabled="true" className={LINK_OFF}>
              &larr; Newer
            </span>
          )}
          <span className="text-zinc-600 dark:text-zinc-400">
            Page {data.page} of {data.pageCount}
          </span>
          {data.page < data.pageCount ? (
            <Link href={ordersHref(data.month, data.page + 1)} className={LINK}>
              Older &rarr;
            </Link>
          ) : (
            <span aria-disabled="true" className={LINK_OFF}>
              Older &rarr;
            </span>
          )}
        </div>
      )}
    </nav>
  );
}
