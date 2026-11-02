"use client";

import { useRef, useState } from "react";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { DialogFrame } from "@/app/questions/dialog-frame";
import { approveAction, rejectAction } from "./actions";

export interface PendingLine {
  id: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  brand: string | null;
  /** This line made the product, so "not mine" removes the product too. */
  isNew: boolean;
}

export interface PendingOrder {
  key: string;
  store: string | null;
  /** YYYY-MM-DD: the date it arrives (or arrived). */
  date: string;
  onTheWay: boolean;
  lines: PendingLine[];
}

interface ProductOption {
  id: string;
  name: string;
  unit: string;
}

interface Edit {
  quantity?: string;
  productId?: string;
}

const INPUT =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";
const LINK = "text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400";

const unitKey = (unit: string) => unit.trim().toLowerCase().replace(/s$/, "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function when(order: PendingOrder): string {
  const day = new Date(`${order.date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `${order.onTheWay ? "arriving" : "arrived"} ${day}`;
}

/**
 * Orders that came in by email are already counted in the estimates; this asks
 * the user to make them final. It is a quiet card, never a pop-up: opening it
 * is their choice, ignoring it costs nothing, and the dialog says so.
 */
export function PendingBanner({ orders, products }: { orders: PendingOrder[]; products: ProductOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  // What is waiting for a second tap: "order:<key>" or "line:<id>".
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const itemCount = orders.reduce((total, order) => total + order.lines.length, 0);
  const stores = [...new Set(orders.map((order) => order.store).filter((store): store is string => !!store))];

  const edit = (id: string, change: Edit) => setEdits((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  const say = (key: string, message: string | null) =>
    setMessages((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  async function approve(order: PendingOrder) {
    const changes = [];
    for (const line of order.lines) {
      const change = edits[line.id] ?? {};
      const quantity = change.quantity === undefined ? line.quantity : Number(change.quantity);
      if (!(quantity > 0)) {
        say(order.key, `Enter how many ${line.name} (more than 0).`);
        return;
      }
      changes.push({
        id: line.id,
        ...(quantity !== line.quantity && { quantity }),
        ...(change.productId && change.productId !== line.productId && { productId: change.productId }),
      });
    }

    setBusy(order.key);
    say(order.key, null);
    try {
      const result = await approveAction(changes);
      if (result.problems.length > 0) say(order.key, result.problems.join(" "));
    } catch {
      say(order.key, "We couldn't save that. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(key: string, ids: string[]) {
    setBusy(key);
    setConfirming(null);
    say(key, null);
    try {
      const result = await rejectAction(ids);
      if (result.rejected === 0) say(key, "That was already taken care of.");
    } catch {
      say(key, "We couldn't remove that. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {orders.length > 0 && (
        <section
          aria-label="Orders from your email"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="text-sm">
            <p className="font-medium">Check your recent orders</p>
            <p className="text-zinc-600 dark:text-zinc-400">
              We found {plural(itemCount, "item", "items")} in your email{stores.length > 0 ? ` (${stores.join(", ")})` : ""} and added{" "}
              {itemCount === 1 ? "it" : "them"} to your estimates. A quick look makes {itemCount === 1 ? "it" : "them"} final.
            </p>
          </div>
          <button type="button" onClick={() => dialogRef.current?.showModal()} className={PRIMARY}>
            Review
          </button>
        </section>
      )}

      <DialogFrame ref={dialogRef} title="Recent orders" subtitle="From your email. We're already counting these, so nothing is lost if you skip this.">
        {orders.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm">
              All done. Thanks!
            </p>
            <button type="button" onClick={() => dialogRef.current?.close()} className={PRIMARY + " self-start"}>
              Close
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-6">
            {orders.map((order) => {
              const working = busy === order.key;
              const removingOrder = confirming === `order:${order.key}`;
              return (
                <li key={order.key} className="flex flex-col gap-3">
                  <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                    {order.store ?? "Email order"} &middot; {when(order)}
                  </p>

                  <ul className="flex flex-col gap-3">
                    {order.lines.map((line) => {
                      const change = edits[line.id] ?? {};
                      const others = products.filter((p) => p.id !== line.productId && unitKey(p.unit) === unitKey(line.unit));
                      const removingLine = confirming === `line:${line.id}`;
                      return (
                        <li key={line.id} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                {line.name}
                                {line.isNew && (
                                  <span
                                    title="Not one of your products yet. It's added if you keep it."
                                    className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                                  >
                                    New product
                                  </span>
                                )}
                              </p>
                              {line.brand && <p className="text-xs text-zinc-500 dark:text-zinc-400">{line.brand}</p>}
                            </div>
                            <label className="flex shrink-0 items-center gap-2 text-sm">
                              <span className="sr-only">How many {line.name}</span>
                              <input
                                type="number"
                                inputMode="decimal"
                                min="0"
                                step="any"
                                value={change.quantity ?? String(line.quantity)}
                                onChange={(e) => edit(line.id, { quantity: e.target.value })}
                                className={INPUT + " w-20"}
                              />
                              <span className="text-zinc-500 dark:text-zinc-400">{line.unit}</span>
                            </label>
                          </div>

                          {others.length > 0 && (
                            <details className="text-sm">
                              <summary className={LINK + " cursor-pointer"}>Wrong item?</summary>
                              <label className="mt-2 flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                                This is actually
                                <select
                                  value={change.productId ?? line.productId}
                                  onChange={(e) => edit(line.id, { productId: e.target.value })}
                                  className={INPUT}
                                >
                                  <option value={line.productId}>{line.name} (as read)</option>
                                  {others.map((product) => (
                                    <option key={product.id} value={product.id}>
                                      {product.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </details>
                          )}

                          {order.lines.length > 1 &&
                            (removingLine ? (
                              <p className="flex items-center gap-3 text-sm">
                                Remove {line.name}?
                                <button type="button" disabled={working} onClick={() => void remove(order.key, [line.id])} className="font-medium text-rose-700 dark:text-rose-400">
                                  Yes, remove
                                </button>
                                <button type="button" onClick={() => setConfirming(null)} className={LINK}>
                                  Keep
                                </button>
                              </p>
                            ) : (
                              <button type="button" onClick={() => setConfirming(`line:${line.id}`)} className={LINK + " self-start"}>
                                Not mine
                              </button>
                            ))}
                        </li>
                      );
                    })}
                  </ul>

                  {messages[order.key] && (
                    <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                      {messages[order.key]}
                    </p>
                  )}

                  {removingOrder ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span>
                        Remove {order.lines.length === 1 ? "this item" : `all ${order.lines.length} items`}?
                        {order.lines.some((line) => line.isNew) && " New products it added go too."}
                      </span>
                      <button type="button" disabled={working} onClick={() => void remove(order.key, order.lines.map((line) => line.id))} className={SECONDARY + " text-rose-700 dark:text-rose-400"}>
                        Yes, remove
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className={LINK}>
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button type="button" disabled={working} onClick={() => void approve(order)} className={PRIMARY}>
                        {working ? "Saving…" : "Looks right"}
                      </button>
                      <button type="button" disabled={working} onClick={() => setConfirming(`order:${order.key}`)} className={SECONDARY}>
                        {order.lines.length === 1 ? "Not mine" : "Not my order"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogFrame>
    </>
  );
}
