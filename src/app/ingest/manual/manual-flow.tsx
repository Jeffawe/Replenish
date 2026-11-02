"use client";

import { useId, useRef, useState } from "react";
import type { PurchaseBatchInput } from "@/core/purchase-batch";
import { submitAction } from "../actions";
import { FlowHeader, PRIMARY, SECONDARY, type FlowProps, type ProductOption } from "../flow-kit";

const INPUT =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

interface Row {
  /** Stable React key; not sent anywhere. */
  key: number;
  /** What the user typed or picked. */
  name: string;
  quantity: string;
  /** Only used when the name isn't one of the user's products. */
  unit: string;
  brand: string;
}

const blankRow = (key: number): Row => ({ key, name: "", quantity: "1", unit: "", brand: "" });

/** Today as the user's calendar shows it (not UTC), in the form a date input uses. */
function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The user's product the typed name refers to, ignoring case and spacing, as the receiver does. */
function findProduct(products: ProductOption[], name: string): ProductOption | undefined {
  const wanted = name.trim().replace(/\s+/g, " ").toLowerCase();
  return wanted ? products.find((product) => product.name.trim().replace(/\s+/g, " ").toLowerCase() === wanted) : undefined;
}

/**
 * Adding purchases by typing them in: one store and date, one or more lines.
 * There is nothing to read, so there is no review step; the form is the
 * review, and it goes straight to the same submitAction the receipt flow uses.
 */
export function ManualFlow({ products, onFinished, onBack, onClose }: FlowProps) {
  const formId = useId();
  const nextKey = useRef(1);
  // Made once when the form opens, so pressing Save twice (or retrying after an error) can't store it twice.
  const [idempotencyKey] = useState(() => `manual-${crypto.randomUUID()}`);
  const [rows, setRows] = useState<Row[]>([blankRow(0)]);
  const [store, setStore] = useState("");
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: number, change: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  /** Problems a user can fix, or null when the batch can be built. */
  function problem(): string | null {
    if (!date) return "Choose the date you bought these.";
    if (date > today()) return "That date is in the future.";
    for (const [index, row] of rows.entries()) {
      const label = `Row ${index + 1}`;
      if (!row.name.trim()) return `${label}: enter what you bought.`;
      const quantity = Number(row.quantity);
      if (!(quantity > 0)) return `${label}: enter how many (more than 0).`;
      if (!findProduct(products, row.name) && !row.unit.trim()) return `${label}: "${row.name.trim()}" is new, so enter a unit, like rolls or bottles.`;
    }
    return null;
  }

  async function save() {
    const found = problem();
    if (found) {
      setError(found);
      return;
    }
    const batch: PurchaseBatchInput = {
      source: "manual",
      idempotencyKey,
      store: store.trim() || undefined,
      purchasedAt: date,
      items: rows.map((row) => {
        const product = findProduct(products, row.name);
        return {
          productName: product ? product.name : row.name.trim(),
          productId: product?.id,
          unit: product ? product.unit : row.unit.trim(),
          quantity: Number(row.quantity),
          brand: row.brand.trim() || undefined,
        };
      }),
    };

    setSaving(true);
    setError(null);
    try {
      const outcome = await submitAction(batch);
      setSaving(false);
      if (!outcome.ok) {
        setError(outcome.issues.slice(0, 2).map((issue) => issue.message).join(" "));
        return;
      }
      const { items, status } = outcome.result;
      const rejected = items.flatMap((item) =>
        item.result === "rejected" ? [`${batch.items[item.index]?.productName ?? "An item"}: ${item.reason}`] : [],
      );
      if (status === "rejected") {
        setError(`Nothing was saved. ${rejected.join(" ")}`);
        return;
      }
      const stored = items.filter((item) => item.result === "created").length;
      onFinished({
        headline: status === "duplicate" ? "This was already saved." : `Saved ${stored} ${stored === 1 ? "item" : "items"}.`,
        details: rejected.map((reason) => `Not saved: ${reason}`),
      });
    } catch {
      setSaving(false);
      setError("We couldn't save that. Please try again.");
    }
  }

  return (
    <>
      <FlowHeader title="Type it in" subtitle="Add what you bought. Nothing else to check." onClose={onClose} />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col gap-4 overflow-y-auto px-5 py-5"
      >
        <datalist id={`${formId}-products`}>
          {products.map((product) => (
            <option key={product.id} value={product.name} />
          ))}
        </datalist>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            When
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Where
            <input
              value={store}
              onChange={(e) => setStore(e.target.value)}
              maxLength={120}
              placeholder="Optional"
              className={INPUT}
            />
          </label>
        </div>

        <ul className="flex flex-col gap-3">
          {rows.map((row, index) => {
            const product = findProduct(products, row.name);
            return (
              <li key={row.key} className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex gap-2">
                  <input
                    aria-label={`Item ${index + 1}`}
                    list={`${formId}-products`}
                    value={row.name}
                    onChange={(e) => update(row.key, { name: e.target.value })}
                    maxLength={200}
                    placeholder="What did you buy? (Milk, Toilet Paper…)"
                    className={INPUT}
                  />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove item ${index + 1}`}
                      onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                      className="rounded-full px-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      &times;
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    How many
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      value={row.quantity}
                      onChange={(e) => update(row.key, { quantity: e.target.value })}
                      className={INPUT}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Unit
                    {product ? (
                      <span className="px-1 py-2 text-sm text-foreground">{product.unit}</span>
                    ) : (
                      <input
                        value={row.unit}
                        onChange={(e) => update(row.key, { unit: e.target.value })}
                        maxLength={40}
                        placeholder={row.name.trim() ? "New: rolls…" : "rolls…"}
                        className={INPUT}
                      />
                    )}
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Brand
                    <input
                      value={row.brand}
                      onChange={(e) => update(row.key, { brand: e.target.value })}
                      maxLength={200}
                      placeholder="Optional"
                      className={INPUT}
                    />
                  </label>
                </div>
                {row.name.trim() && !product && (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">This will be added as a new product.</p>
                )}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={() => setRows((current) => [...current, blankRow(nextKey.current++)])}
          className="self-start text-sm font-medium underline underline-offset-2"
        >
          + Add another item
        </button>

        {error && (
          <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button type="button" onClick={onBack} className={SECONDARY}>
            Back
          </button>
          <button type="submit" disabled={saving} className={PRIMARY}>
            {saving ? "Saving…" : `Save ${rows.length} ${rows.length === 1 ? "item" : "items"}`}
          </button>
        </div>
      </form>
    </>
  );
}
