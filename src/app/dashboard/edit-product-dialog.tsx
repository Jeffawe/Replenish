"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { normalizeProductName } from "@/core/product-name";
import { formatQuantity } from "@/lib/format";
import { editProductAction, mergeProductsAction, type EditProductState } from "./actions";

export interface EditableProduct {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  brand: string | null;
  normalPurchaseQty: number;
  fallbackDaysPerPurchase: number | null;
  typicalLeftoverAtPurchase: number | null;
  lowStockThresholdDays: number | null;
  matchByName: boolean;
}

interface Props {
  product: EditableProduct;
  /** Our current guess, so the count question can show it. Null when we have none. */
  estimatedRemaining: number | null;
  defaultThresholdDays: number;
  /** Existing categories, offered as suggestions. */
  categories: string[];
  /** The user's other products, to merge this one into. */
  others: { id: string; name: string; unit: string }[];
}

const INPUT =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

const IDLE: EditProductState = { status: "idle" };

export function EditProductDialog({
  product,
  estimatedRemaining,
  defaultThresholdDays,
  categories,
  others,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(editProductAction, IDLE);
  const [name, setName] = useState(product.name);
  const [matchByName, setMatchByName] = useState(product.matchByName);
  const renamed = normalizeProductName(name) !== normalizeProductName(product.name);

  useEffect(() => {
    if (state.status === "saved") dialogRef.current?.close();
  }, [state]);

  const errors = state.fieldErrors ?? {};
  const optionalHasError = ["remainingNow", "fallbackDaysPerPurchase", "typicalLeftoverAtPurchase", "lowStockThresholdDays"].some(
    (field) => errors[field]?.length,
  );
  const titleId = `edit-title-${product.id}`;
  const fid = (name: string) => `${product.id}-${name}`;
  // Ties each input to its label, its hint or error text, and the form field name.
  const fieldProps = (name: string) => ({
    id: fid(name),
    name,
    "aria-describedby": `${fid(name)}-help`,
    "aria-invalid": errors[name]?.length ? true : undefined,
  });
  const guess = estimatedRemaining === null ? null : Number(formatQuantity(estimatedRemaining));

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={`Edit ${product.name}`}
        className="rounded-full border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        Edit
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        // Closing without saving drops an unsaved rename.
        onClose={() => {
          setName(product.name);
          setMatchByName(product.matchByName);
        }}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl bg-white p-0 text-foreground shadow-xl backdrop:bg-black/50 dark:bg-zinc-900"
      >
        <form key={state.savedAt ?? 0} action={formAction} className="flex max-h-[85vh] flex-col">
          <input type="hidden" name="productId" value={product.id} />

          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                Edit {product.name}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Update how we describe this product.</p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              &times;
            </button>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <Field label="Name" id={fid("name")} error={errors.name?.[0]}>
              <input
                {...fieldProps("name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
                className={INPUT}
              />
              <input type="hidden" name="matchByName" value={String(matchByName)} />
              {(renamed || !matchByName) && (
                <div className="mt-1 flex flex-col gap-2 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm dark:bg-zinc-800/60">
                  {renamed && (
                    <p className="text-zinc-600 dark:text-zinc-300">
                      Receipts are matched to your products by name. We&rsquo;ll keep matching{" "}
                      <span className="font-medium text-foreground">&ldquo;{product.name}&rdquo;</span> to this product, so
                      nothing you&rsquo;ve already set up stops working.
                    </p>
                  )}
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={matchByName}
                      onChange={(event) => setMatchByName(event.target.checked)}
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span>
                      <span className="font-medium">Match receipts by {renamed ? "the new name" : "this name"} too</span>
                      <span className="block text-zinc-500 dark:text-zinc-400">
                        Turn off if the name is just for you (like &ldquo;Mom&rsquo;s coffee&rdquo;) and shouldn&rsquo;t catch
                        other receipt lines.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </Field>

            <Field
              label="Unit"
              id={fid("unit")}
              error={errors.unit?.[0]}
              hint="Renaming the unit relabels past purchases. It does not convert amounts."
            >
              <input {...fieldProps("unit")} defaultValue={product.unit} required maxLength={40} className={INPUT} />
            </Field>

            <Field label="Category" id={fid("category")} error={errors.category?.[0]}>
              <input
                {...fieldProps("category")}
                defaultValue={product.category ?? ""}
                list={`categories-${product.id}`}
                maxLength={60}
                className={INPUT}
              />
              <datalist id={`categories-${product.id}`}>
                {categories.map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>

            <Field
              label="Brands"
              id={fid("brand")}
              error={errors.brand?.[0]}
              hint="Separate several brands with commas, like Charmin, Cottonelle."
            >
              <input {...fieldProps("brand")} defaultValue={product.brand ?? ""} maxLength={200} className={INPUT} />
            </Field>

            <details
              open={optionalHasError || undefined}
              className="group rounded-xl border border-zinc-200 dark:border-zinc-800"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    Help us estimate better
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      Optional
                    </span>
                  </span>
                  <span className="block text-sm text-zinc-500 dark:text-zinc-400">
                    A few quick questions. Answer any you like.
                  </span>
                </span>
                <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
                  &#9662;
                </span>
              </summary>

              <div className="flex flex-col gap-5 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Nothing here is required, and you can leave anything blank. Your answers just make our guesses
                  sharper.
                </p>

                <Field
                  label="About how much do you have right now?"
                  id={fid("remainingNow")}
                  error={errors.remainingNow?.[0]}
                  hint={
                    guess === null
                      ? "A rough number is fine."
                      : `Our guess is about ${guess} ${product.unit}. A rough number is fine.`
                  }
                >
                  <div className="flex gap-2">
                    <input
                      ref={countRef}
                      {...fieldProps("remainingNow")}
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min="0"
                      className={INPUT}
                    />
                    <Suffix>{product.unit}</Suffix>
                    {guess !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          if (countRef.current) countRef.current.value = String(guess);
                        }}
                        className="shrink-0 rounded-lg border border-zinc-300 px-3 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        About right
                      </button>
                    )}
                  </div>
                </Field>

                <Field
                  label={`How long does a usual purchase (${formatQuantity(product.normalPurchaseQty)} ${product.unit}) last you?`}
                  id={fid("fallbackDaysPerPurchase")}
                  error={errors.fallbackDaysPerPurchase?.[0]}
                  hint="Helps before we have much purchase history."
                >
                  <div className="flex items-center gap-2">
                    <input
                      {...fieldProps("fallbackDaysPerPurchase")}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      defaultValue={product.fallbackDaysPerPurchase ?? ""}
                      className={INPUT}
                    />
                    <Suffix>days</Suffix>
                  </div>
                </Field>

                <Field
                  label="When you buy more, how much is usually still left?"
                  id={fid("typicalLeftoverAtPurchase")}
                  error={errors.typicalLeftoverAtPurchase?.[0]}
                  hint="If you restock once you're nearly out, enter 0."
                >
                  <div className="flex items-center gap-2">
                    <input
                      {...fieldProps("typicalLeftoverAtPurchase")}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="any"
                      defaultValue={product.typicalLeftoverAtPurchase ?? ""}
                      className={INPUT}
                    />
                    <Suffix>{product.unit}</Suffix>
                  </div>
                </Field>

                <Field
                  label="Call it low when it is about this many days from running out"
                  id={fid("lowStockThresholdDays")}
                  error={errors.lowStockThresholdDays?.[0]}
                  hint={`Leave blank to use the default of ${defaultThresholdDays} days.`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      {...fieldProps("lowStockThresholdDays")}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      placeholder={String(defaultThresholdDays)}
                      defaultValue={product.lowStockThresholdDays ?? ""}
                      className={INPUT}
                    />
                    <Suffix>days</Suffix>
                  </div>
                </Field>
              </div>
            </details>

            {others.length > 0 && <MergeInto product={product} others={others} />}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <p role="status" aria-live="polite" className="text-sm text-rose-700 dark:text-rose-300">
              {state.status === "error" ? state.message : ""}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                className="rounded-lg px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}

function Suffix({ children }: { children: React.ReactNode }) {
  return <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{children}</span>;
}

function Field({
  label,
  id,
  hint,
  error,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {(error || hint) && (
        <p
          id={`${id}-help`}
          className={
            error
              ? "text-sm text-rose-700 dark:text-rose-300"
              : "text-sm text-zinc-500 dark:text-zinc-400"
          }
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/**
 * "This is the same as another product": merges this one into the one chosen.
 * Its purchases and stock counts move over and receipts that matched it match
 * the other from then on. Only products counted in the same unit qualify.
 */
function MergeInto({ product, others }: { product: EditableProduct; others: { id: string; name: string; unit: string }[] }) {
  const uid = useId();
  const [intoId, setIntoId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const unitKey = (unit: string) => unit.trim().toLowerCase().replace(/s$/, "");
  const sorted = [...others].sort((a, b) => a.name.localeCompare(b.name));
  const into = others.find((other) => other.id === intoId);

  async function merge() {
    setBusy(true);
    setProblem(null);
    try {
      const result = await mergeProductsAction(product.id, intoId);
      if (result.status === "error") setProblem(result.message ?? "That didn't work. Please try again.");
      // On success this product is gone and the dashboard redraws without it.
    } catch {
      setProblem("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Same as another product?</summary>
      <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          If a receipt made a new product for something you already track, merge it in. Its purchases and stock counts
          move over, and receipts that matched {product.name} will match the other product from now on.
        </p>
        <label htmlFor={`${uid}-into`} className="text-sm font-medium">
          Merge {product.name} into
        </label>
        <select
          id={`${uid}-into`}
          value={intoId}
          onChange={(event) => {
            setIntoId(event.target.value);
            setConfirming(false);
            setProblem(null);
          }}
          className={INPUT}
        >
          <option value="">Choose a product…</option>
          {sorted.map((other) => (
            <option key={other.id} value={other.id} disabled={unitKey(other.unit) !== unitKey(product.unit)}>
              {other.name}
              {unitKey(other.unit) !== unitKey(product.unit) ? ` (counted in ${other.unit})` : ""}
            </option>
          ))}
        </select>

        {into && !confirming && (
          <div>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Merge…
            </button>
          </div>
        )}

        {into && confirming && (
          <div role="alert" className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm dark:border-amber-900 dark:bg-amber-950">
            <p>
              Merge <span className="font-medium">{product.name}</span> into{" "}
              <span className="font-medium">{into.name}</span>? {product.name} goes away and this can&rsquo;t be undone.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void merge()}
                className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
              >
                {busy ? "Merging…" : `Merge into ${into.name}`}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="rounded-lg px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {problem && <p className="text-sm text-rose-700 dark:text-rose-300">{problem}</p>}
      </div>
    </details>
  );
}
