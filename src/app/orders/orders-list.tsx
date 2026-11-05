"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import type { OrdersPage, OrderView } from "@/modules/orders/client";
import { cancelOrderAction, loadOrdersAction, markSeenAction, refreshOrdersAction } from "./actions";
import { money, monthLabel, refundLine, shortDate, trackingStatus } from "./format";
import { MonthFilter, Pager } from "./orders-toolbar";

const POLL_MS = 3000;
/** How often a page with nothing processing looks for new orders (an auto-buy made meanwhile). */
const IDLE_POLL_MS = 20_000;

/** The pill beside each order: where it is. */
function StatusPill({ order }: { order: OrderView }) {
  if (order.status === "processing") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-amber-500" />
        Processing
      </span>
    );
  }
  if (order.status === "placed") {
    return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">✓ Order placed</span>;
  }
  if (order.status === "cancelled") {
    return <span className="rounded-full bg-zinc-200 px-2.5 py-0.5 text-xs font-medium text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200">Cancelled</span>;
  }
  return <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-900 dark:bg-rose-950 dark:text-rose-200">✗ Failed</span>;
}

/** What happened to the user's money, in a sentence. */
function paymentLine(order: OrderView): string | null {
  if (order.status === "processing") return order.chargedCents === null ? "Waiting for PayPal" : `${money(order.chargedCents)} is held for this order, including ${money(order.feesCents)} in fees. Whatever isn't needed comes back.`;
  if (order.status === "placed") {
    const cost = order.totalCents === null ? "" : `Cost ${money(order.totalCents)}: ${money(order.totalCents - order.feesCents)} at the store with tax and shipping, and ${money(order.feesCents)} in fees`;
    const back = order.refundedCents > 0 ? `. We held ${money(order.chargedCents ?? 0)} on PayPal and refunded the unused ${money(order.refundedCents)}` : "";
    return `${cost}${back}.`;
  }
  return refundLine(order);
}

/**
 * Stopping an order. Zinc only cancels one that is still queued, so this is offered while it is
 * processing; if it has gone too far the user is told so. A second press confirms, since it can't be undone.
 */
function CancelButton({ order, onChanged }: { order: OrderView; onChanged(): void }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancel = () =>
    startTransition(async () => {
      const outcome = await cancelOrderAction(order.id);
      setAsking(false);
      if (outcome === "too-late") setMessage("It's too late to cancel: the store is already working on it. If it goes through, you can return it to the store when it arrives.");
      else if (outcome === "unavailable") setMessage("We couldn't reach the store just now. Please try again.");
      onChanged();
    });
  if (message) return <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>;
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="w-fit rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        Cancel order
      </button>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-3 text-sm">
      <span>Cancel this order?</span>
      <button type="button" disabled={pending} onClick={cancel} className="rounded-full border border-rose-300 px-4 py-2 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950">
        {pending ? "Cancelling…" : "Yes, cancel it"}
      </button>
      <button type="button" disabled={pending} onClick={() => setAsking(false)} className="px-2 py-2 text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
        Keep it
      </button>
    </p>
  );
}

function Tracking({ order }: { order: OrderView }) {
  if (order.status !== "placed") return null;
  if (order.tracking.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Tracking will show up here once the store ships it.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Shipment tracking">
      {order.tracking.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
          <span>
            <span className="font-medium">{entry.carrier ?? "Carrier"}</span> <span className="text-zinc-600 dark:text-zinc-400">{entry.number}</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-700">{trackingStatus(entry.status)}</span>
            {entry.url && /^https?:\/\//i.test(entry.url) && (
              <a href={entry.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                Track package
              </a>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Why it was bought: auto-buy did it, or the user pressed Buy for me. */
function SourcePill({ order }: { order: OrderView }) {
  return order.source === "auto" ? (
    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-200">Auto-buy</span>
  ) : (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">You asked</span>
  );
}

function OrderCard({ order, isNew, onChanged }: { order: OrderView; isNew: boolean; onChanged(): void }) {
  const { listing } = order;
  const payment = paymentLine(order);
  return (
    <article
      className={"flex flex-col gap-3 rounded-2xl border p-4 " + (isNew ? "border-sky-400 bg-sky-50/50 dark:border-sky-700 dark:bg-sky-950/20" : "border-zinc-200 dark:border-zinc-800")}
      aria-label={`${order.productName} order`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {order.productName}
            {isNew && <span className="rounded-full bg-sky-600 px-2 py-0.5 text-xs font-medium text-white">New</span>}
          </h2>
          <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <SourcePill order={order} />
            {order.source === "auto" ? "Bought for you automatically" : "You asked us to buy this"} &middot; {shortDate(order.createdAt)}
          </p>
        </div>
        <StatusPill order={order} />
      </div>

      <div className="flex flex-col gap-1 rounded-xl bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-800/60">
        <a href={listing.url} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">
          {listing.title}
        </a>
        <p className="text-zinc-600 dark:text-zinc-400">
          {listing.domain} &middot; {order.packs > 1 ? `${order.packs} packs` : "1 pack"}
          {listing.packSize ? ` of ${listing.packSize}` : ""}
        </p>
        {listing.sample && <p className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">Sample listing (testing data)</p>}
      </div>

      {order.status === "processing" && <CancelButton order={order} onChanged={onChanged} />}
      {order.status === "placed" && <p className="text-sm text-zinc-500 dark:text-zinc-400">This has gone through, so it can&rsquo;t be cancelled here. You can return it to the store once it arrives.</p>}
      {order.status === "failed" && order.failureReason && (
        <p role="alert" className="text-sm text-rose-800 dark:text-rose-300">
          {order.failureReason}
        </p>
      )}
      {order.status === "placed" && order.arrivesAt && <p className="text-sm">Expected around {shortDate(order.arrivesAt)}.</p>}
      {payment && <p className="text-sm text-zinc-600 dark:text-zinc-400">{payment}</p>}
      {order.decision && order.source === "auto" && <p className="text-sm text-zinc-500 dark:text-zinc-400">{order.decision}</p>}
      <Tracking order={order} />
    </article>
  );
}

/** Orders that finished and that the user hasn't been shown yet. */
const unseenResults = (orders: OrderView[]) => orders.filter((order) => order.status !== "processing" && !order.seen);

/**
 * The user's orders for the page and month they chose. It keeps itself current: every few seconds
 * while something is processing (that also moves the order along), and quietly every so often and
 * whenever the user comes back to the tab otherwise, so an order the scheduled auto-buy makes while
 * the page is open shows up on its own.
 */
export function OrdersList({ initial }: { initial: OrdersPage }) {
  const [data, setData] = useState(initial);
  // The orders that are new to the user: highlighted here, and counted by the badge on the dashboard until they've been shown.
  const [fresh, setFresh] = useState(() => new Set(unseenResults(initial.orders).map((order) => order.id)));
  const { orders } = data;
  const processing = orders.some((order) => order.status === "processing");

  // Looking at the page is how the user sees how these orders turned out.
  useEffect(() => {
    const ids = unseenResults(initial.orders).map((order) => order.id);
    if (ids.length > 0) void markSeenAction(ids);
  }, [initial]);

  const refresh = async () => {
    try {
      setData(await loadOrdersAction({ month: data.month, page: data.page }));
    } catch {
      // The next poll will catch up.
    }
  };

  // Takes in the latest page: new orders are marked seen (the user is looking at them), and the ones that were processing a moment ago aren't flagged as new (they watched them finish).
  const takeIn = useEffectEvent((latest: OrdersPage) => {
    const known = new Set(data.orders.map((order) => order.id));
    const wasProcessing = new Set(data.orders.filter((order) => order.status === "processing").map((order) => order.id));
    const unseen = unseenResults(latest.orders);
    const arrived = unseen.filter((order) => !wasProcessing.has(order.id) && !known.has(order.id));
    const finished = unseen.filter((order) => wasProcessing.has(order.id));
    if (arrived.length > 0) setFresh((current) => new Set([...current, ...arrived.map((order) => order.id)]));
    const toMark = [...arrived, ...finished].map((order) => order.id);
    if (toMark.length > 0) void markSeenAction(toMark);
    setData(latest);
  });

  useEffect(() => {
    const view = { month: data.month, page: data.page };
    let stopped = false;
    const run = async (settle: boolean) => {
      try {
        const latest = settle ? await refreshOrdersAction(view) : await loadOrdersAction(view);
        if (!stopped) takeIn(latest);
      } catch {
        // Try again next time.
      }
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void run(processing);
    }, processing ? POLL_MS : IDLE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run(processing);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [processing, data.month, data.page]);

  if (data.total === 0) {
    return (
      <div className="flex flex-col gap-4">
        <MonthFilter data={data} />
        <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-10 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          {data.month ? (
            <>
              No orders in {monthLabel(data.month)}.{" "}
              <Link href="/orders" className="underline underline-offset-2">
                Show all months
              </Link>
            </>
          ) : (
            <>
              No orders yet. When something runs low and you press <span className="font-medium">Buy for me</span> (or auto-buy is on), it shows up here.{" "}
              <Link href="/dashboard" className="underline underline-offset-2">
                Back to inventory
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <MonthFilter data={data} />
      <ul className="flex flex-col gap-4">
        {orders.map((order) => (
          <li key={order.id}>
            <OrderCard order={order} isNew={fresh.has(order.id)} onChanged={() => void refresh()} />
          </li>
        ))}
      </ul>
      <Pager data={data} />
    </div>
  );
}
