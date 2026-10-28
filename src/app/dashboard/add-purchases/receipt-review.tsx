"use client";

import { useId, useState } from "react";
import type { PurchaseBatchInput } from "@/core/purchase-batch";
import { toDisplayName } from "@/modules/ingestion/receipt/parse";
import type { Draft } from "@/modules/ingestion/types";

export interface ProductOption {
  id: string;
  name: string;
  unit: string;
}

interface Props {
  draft: Draft;
  products: ProductOption[];
  /** Saving is in progress. */
  busy: boolean;
  /** Why the last save failed, if it did. */
  error: string | null;
  /**
   * `review.sources` is how the receipt worded each saved line (parallel to the
   * batch's items); `review.skipped` is the wording of each line left out.
   */
  onConfirm(batch: PurchaseBatchInput, review: { sources: string[]; skipped: string[] }): void;
  onCancel(): void;
}

interface LineState {
  index: number;
  include: boolean;
  /** "" means a new product. */
  productId: string;
  suggestedProductId: string;
  matchedBy: "name" | "alias" | "similar" | null;
  sourceText: string;
  newName: string;
  newUnit: string;
  brand: string;
  /** Why the line started out left out, if it did. */
  excludeReason: string | null;
  quantity: string;
  /** In dollars, as typed. */
  price: string;
}

const INPUT =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";
const NOTE =
  "rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100";

function initialLines(draft: Draft): LineState[] {
  return draft.batch.items.map((item, index) => {
    const info = draft.lines?.[index];
    const sourceText = info?.sourceText ?? item.productName;
    const matched = !!item.productId;
    return {
      index,
      include: !info?.excludeReason,
      productId: item.productId ?? "",
      suggestedProductId: item.productId ?? "",
      matchedBy: info?.matchedBy ?? null,
      sourceText,
      newName: matched ? toDisplayName(sourceText) : item.productName,
      newUnit: matched ? "each" : item.unit,
      brand: item.brand ?? "",
      excludeReason: info?.excludeReason ?? null,
      quantity: String(item.quantity),
      price: item.priceCents == null ? "" : (item.priceCents / 100).toFixed(2),
    };
  });
}

export function ReceiptReview({ draft, products, busy, error, onConfirm, onCancel }: Props) {
  const uid = useId();
  const productsById = new Map(products.map((product) => [product.id, product]));

  const [store, setStore] = useState(draft.batch.store ?? "");
  const [date, setDate] = useState(String(draft.batch.purchasedAt).slice(0, 10));
  const [lines, setLines] = useState(() => initialLines(draft));
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [problems, setProblems] = useState<Record<number, string>>({});
  const [formProblem, setFormProblem] = useState<string | null>(null);

  const update = (index: number, patch: Partial<LineState>) =>
    setLines((current) => current.map((line) => (line.index === index ? { ...line, ...patch } : line)));
  const toggle = (index: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  const selected = lines.filter((line) => line.include).length;
  const generalWarnings = draft.warnings.filter((warning) => warning.lineIndex === undefined);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found: Record<number, string> = {};
    const items: NonNullable<PurchaseBatchInput["items"]> = [];
    const sources: string[] = [];
    const skipped = lines.filter((line) => !line.include).map((line) => line.sourceText);

    for (const line of lines) {
      if (!line.include) continue;
      const product = productsById.get(line.productId);
      const quantity = Number(line.quantity);
      const price = line.price.trim() === "" ? null : Number(line.price);
      const name = product ? product.name : line.newName.trim();
      const unit = product ? product.unit : line.newUnit.trim();

      if (!name) found[line.index] = "Give this a name.";
      else if (!unit) found[line.index] = "Enter a unit, like rolls or bottles.";
      else if (!Number.isFinite(quantity) || quantity <= 0) found[line.index] = "Enter how many.";
      else if (price !== null && (!Number.isFinite(price) || price < 0)) found[line.index] = "Enter a price, or leave it blank.";
      if (found[line.index]) continue;

      items.push({
        productName: name,
        ...(product && { productId: product.id }),
        ...(line.brand.trim() && { brand: line.brand.trim() }),
        quantity,
        unit,
        ...(price !== null && { priceCents: Math.round(price * 100) }),
      });
      sources.push(line.sourceText);
    }

    setProblems(found);
    // Open the rows with a problem so the field to fix is in view.
    setExpanded((current) => new Set([...current, ...Object.keys(found).map(Number)]));
    if (!date) return setFormProblem("Choose the date of the purchase.");
    setFormProblem(Object.keys(found).length > 0 ? "A few lines need a look." : null);
    if (Object.keys(found).length > 0 || items.length === 0) return;

    onConfirm({ ...draft.batch, store: store.trim() || undefined, purchasedAt: date, items }, { sources, skipped });
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 py-4">
        {generalWarnings.map((warning) => (
          <p key={warning.code + warning.message} className={NOTE}>
            {warning.message}
          </p>
        ))}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            aria-label="Store"
            value={store}
            onChange={(e) => setStore(e.target.value)}
            maxLength={120}
            placeholder="Store"
            className={INPUT}
          />
          <input
            aria-label="Date of purchase"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className={INPUT}
          />
        </div>

        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {lines.map((line) => {
            const product = productsById.get(line.productId);
            const name = product ? product.name : line.newName;
            const unit = product ? product.unit : line.newUnit;
            const open = expanded.has(line.index);
            const lineWarnings = draft.warnings.filter((warning) => warning.lineIndex === line.index);
            const fid = (field: string) => `${uid}-${line.index}-${field}`;
            return (
              <li key={line.index} className="px-3 py-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={line.include}
                    onChange={(e) => update(line.index, { include: e.target.checked })}
                    aria-label={`Include ${name}`}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <div className={"min-w-0 flex-1 " + (line.include ? "" : "opacity-50")}>
                    <p className={"line-clamp-2 wrap-break-word text-sm font-medium leading-snug " + (line.include ? "" : "line-through")}>
                      {name || "Unnamed"}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <ProductPill
                        line={line}
                        name={name}
                        product={product}
                        products={products}
                        onChange={(productId) => update(line.index, { productId })}
                      />
                      {line.brand.trim() && (
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">{line.brand.trim()}</span>
                      )}
                    </div>
                    {!line.include && line.excludeReason && (
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{line.excludeReason}</p>
                    )}
                  </div>
                  <div className={"flex shrink-0 items-center gap-1.5 " + (line.include ? "" : "opacity-50")}>
                    <input
                      aria-label={`How many ${name}`}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      value={line.quantity}
                      onChange={(e) => update(line.index, { quantity: e.target.value })}
                      className={INPUT + " w-16 px-2 py-1.5 text-right tabular-nums"}
                    />
                    <span className="hidden max-w-16 truncate text-xs text-zinc-500 sm:inline dark:text-zinc-400">{unit}</span>
                    <button
                      type="button"
                      onClick={() => toggle(line.index)}
                      aria-expanded={open}
                      aria-controls={fid("details")}
                      aria-label={`${open ? "Hide" : "Show"} details for ${name}`}
                      className="rounded-full p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <Chevron open={open} />
                    </button>
                  </div>
                </div>

                {open && (
                  <div id={fid("details")} className="mt-3 grid gap-3 pl-7 sm:grid-cols-2">
                    {product ? (
                      <p className="text-sm text-zinc-500 sm:col-span-2 dark:text-zinc-400">
                        Counted in <span className="font-medium text-foreground">{product.unit}</span>, like the rest of{" "}
                        {product.name}.
                      </p>
                    ) : (
                      <>
                        <Field label="Name" id={fid("name")}>
                          <input
                            id={fid("name")}
                            value={line.newName}
                            onChange={(e) => update(line.index, { newName: e.target.value })}
                            maxLength={200}
                            className={INPUT}
                          />
                        </Field>
                        <Field label="Unit" id={fid("unit")}>
                          <input
                            id={fid("unit")}
                            value={line.newUnit}
                            onChange={(e) => update(line.index, { newUnit: e.target.value })}
                            maxLength={40}
                            className={INPUT}
                          />
                        </Field>
                      </>
                    )}
                    <Field label="Brand" id={fid("brand")}>
                      <input
                        id={fid("brand")}
                        value={line.brand}
                        onChange={(e) => update(line.index, { brand: e.target.value })}
                        maxLength={200}
                        placeholder="Optional"
                        className={INPUT}
                      />
                    </Field>
                    <Field label="Price" id={fid("price")}>
                      <input
                        id={fid("price")}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        value={line.price}
                        onChange={(e) => update(line.index, { price: e.target.value })}
                        placeholder="Optional"
                        className={INPUT}
                      />
                    </Field>
                    <p className="self-end text-xs text-zinc-500 dark:text-zinc-400">
                      Receipt says <span className="font-mono text-foreground">{line.sourceText}</span>
                    </p>
                  </div>
                )}

                {lineWarnings.map((warning) => (
                  <p key={warning.code + warning.message} className="mt-2 pl-7 text-xs text-amber-800 dark:text-amber-200">
                    {warning.message}
                  </p>
                ))}
                {problems[line.index] && (
                  <p role="alert" className="mt-2 pl-7 text-sm text-rose-700 dark:text-rose-300">
                    {problems[line.index]}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {draft.sourceText && (
          <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
            <summary className="cursor-pointer px-4 py-2.5 text-sm text-zinc-600 dark:text-zinc-400">What we read</summary>
            <pre className="overflow-x-auto border-t border-zinc-200 px-4 py-3 font-mono text-xs leading-relaxed dark:border-zinc-800">
              {draft.sourceText}
            </pre>
          </details>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <p role="status" aria-live="polite" className="min-w-0 text-sm text-rose-700 dark:text-rose-300">
          {error ?? formProblem ?? ""}
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || selected === 0}
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
          >
            {busy ? "Saving…" : `Save ${selected} ${selected === 1 ? "item" : "items"}`}
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className={"size-4 transition-transform " + (open ? "rotate-180" : "")}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

/**
 * Says whether the line is tied to a product ("New product", "Matched", "Check
 * match") and lets the user change that: the pill is what you see, and a
 * real select laid invisibly over it is what you tap.
 */
function ProductPill({
  line,
  name,
  product,
  products,
  onChange,
}: {
  line: LineState;
  name: string;
  product: ProductOption | undefined;
  products: ProductOption[];
  onChange(productId: string): void;
}) {
  let label: string;
  let tone: string;
  if (!product) {
    label = "New product";
    tone = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  } else if (line.productId !== line.suggestedProductId) {
    label = "Your pick";
    tone = "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
  } else if (line.matchedBy === "similar") {
    label = "Check match";
    tone = "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100";
  } else {
    label = "Matched";
    tone = "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100";
  }

  return (
    <span className="relative inline-flex rounded-full focus-within:ring-2 focus-within:ring-zinc-400">
      <span className={`inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-xs font-medium ${tone}`}>
        {label}
        <svg aria-hidden viewBox="0 0 20 20" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </span>
      <select
        aria-label={`Product for ${name}`}
        value={line.productId}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        <option value="">New product</option>
        {products.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} ({option.unit})
          </option>
        ))}
      </select>
    </span>
  );
}
