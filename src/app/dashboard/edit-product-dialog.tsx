"use client";

import { useActionState, useEffect, useRef } from "react";
import { formatQuantity } from "@/lib/format";
import { editProductAction, type EditProductState } from "./actions";

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
}

interface Props {
  product: EditableProduct;
  /** Our current guess, so the count question can show it. Null when we have none. */
  estimatedRemaining: number | null;
  defaultThresholdDays: number;
  /** Existing categories, offered as suggestions. */
  categories: string[];
}

const INPUT =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

const IDLE: EditProductState = { status: "idle" };

export function EditProductDialog({
  product,
  estimatedRemaining,
  defaultThresholdDays,
  categories,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(editProductAction, IDLE);

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
