"use client";

import { useState, useTransition } from "react";
import { setProductAutobuyAction } from "../actions";
import { MUTED } from "../fields";

export interface SwitchRow {
  id: string;
  name: string;
  boughtFrom: string | null;
  enabled: boolean;
  confirmed: boolean;
  hasOwnRange: boolean;
  /** Null while there isn't enough history to estimate. */
  confidence: number | null;
}

/** What to tell the user about one product's chances of being bought automatically. */
function note(row: SwitchRow, minConfidence: number): string {
  if (!row.confirmed) return "Confirm you keep track of this first (we'll ask on the dashboard).";
  if (row.confidence === null) return "Not enough purchase history yet.";
  const percent = `${Math.round(row.confidence * 100)}%`;
  if (row.confidence < minConfidence) return `${percent} sure, below your ${Math.round(minConfidence * 100)}%. We'd ask you first.`;
  return `${percent} sure.`;
}

export function ProductSwitches({ rows, minConfidence }: { rows: SwitchRow[]; minConfidence: number }) {
  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">Products</h2>
        <p className={MUTED}>No products yet. Add a receipt and they&rsquo;ll appear here.</p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold">Products</h2>
        <p className={MUTED}>Choose what we may buy without asking. You can also change this in a product&rsquo;s Edit dialog.</p>
      </div>
      <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {rows.map((row) => (
          <ProductSwitch key={row.id} row={row} minConfidence={minConfidence} />
        ))}
      </ul>
    </section>
  );
}

function ProductSwitch({ row, minConfidence }: { row: SwitchRow; minConfidence: number }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = `autobuy-${row.id}`;

  function change(next: boolean) {
    setEnabled(next);
    setProblem(null);
    startTransition(async () => {
      try {
        const result = await setProductAutobuyAction(row.id, next);
        if (result.status === "error") {
          setEnabled(!next);
          setProblem(result.message);
        }
      } catch {
        setEnabled(!next);
        setProblem("That didn't work. Please try again.");
      }
    });
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <input
        id={id}
        type="checkbox"
        checked={enabled}
        disabled={!row.confirmed || pending}
        onChange={(event) => change(event.target.checked)}
        aria-describedby={`${id}-note`}
        className="mt-1 size-4 shrink-0"
      />
      <div className="min-w-0">
        <label htmlFor={id} className="block truncate text-sm font-medium">
          {row.name}
        </label>
        <p id={`${id}-note`} className="text-sm text-zinc-500 dark:text-zinc-400">
          {[row.boughtFrom && `Bought at ${row.boughtFrom}`, row.hasOwnRange && "Own price range", note(row, minConfidence)].filter(Boolean).join(" · ")}
        </p>
        {problem && (
          <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">
            {problem}
          </p>
        )}
      </div>
    </li>
  );
}
