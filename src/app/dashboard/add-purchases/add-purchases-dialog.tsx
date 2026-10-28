"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { PurchaseBatchInput } from "@/core/purchase-batch";
import { extractAction, submitAction } from "@/app/ingest/actions";
import type { Draft } from "@/modules/ingestion/types";
import { prepareReceiptImage } from "./prepare-image";
import { ReceiptReview, type ProductOption } from "./receipt-review";

type View =
  | { name: "menu" }
  | { name: "receipt"; notice?: string; sourceText?: string }
  /** A photo has been chosen and is shown before anything is sent. */
  | { name: "preview"; file: File; url: string }
  | { name: "reading" }
  | { name: "review"; draft: Draft }
  | { name: "done"; headline: string; details: string[] };

/** The ways of adding purchases. Ones that aren't built yet are listed but can't be opened. */
const SOURCES = [
  { id: "receipt", title: "Receipt", description: "Take a photo or upload one", available: true },
  { id: "email", title: "Email", description: "Find orders in your inbox", available: false },
] as const;

const PLUS_BUTTON =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:opacity-90";
const CHOICE =
  "flex w-full flex-col items-start gap-1 rounded-xl border border-zinc-200 px-4 py-4 text-left hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:border-zinc-800 dark:hover:bg-zinc-800";
const SECONDARY = "rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
const PRIMARY = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60";

// Phones and tablets have a camera to open straight from the page; on a laptop the option would just open a file picker.
const noSubscription = () => () => {};
const hasTouch = () => navigator.maxTouchPoints > 0;
const serverHasTouch = () => false;

function PlusIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

/** Shown while the product list loads. */
export function AddPurchasesPlaceholder() {
  return (
    <button type="button" disabled aria-label="Add purchases" className={PLUS_BUTTON + " opacity-60"}>
      <PlusIcon />
    </button>
  );
}

function heading(view: View): { title: string; subtitle: string } {
  switch (view.name) {
    case "menu":
      return { title: "Add purchases", subtitle: "How do you want to add them?" };
    case "preview":
      return { title: "Add a receipt", subtitle: "Make sure the whole receipt is in the photo and easy to read." };
    case "review":
      return { title: "Check your receipt", subtitle: "Here is what we read. Nothing is saved until you confirm." };
    default:
      return { title: "Add a receipt", subtitle: "Take a photo or upload one and we'll add what you bought." };
  }
}

/** The "+" button and the dialog it opens: pick a way to add, choose a photo, preview it, check what we read, save. */
export function AddPurchasesDialog({ products }: { products: ProductOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  // Bumped whenever the dialog closes, so a slow reply can't land in a dialog the user has moved on from.
  const requestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  const [view, setView] = useState<View>({ name: "menu" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const canUseCamera = useSyncExternalStore(noSubscription, hasTouch, serverHasTouch);

  function releasePreview() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
  }

  function reset() {
    requestRef.current++;
    releasePreview();
    setView({ name: "menu" });
    setSaving(false);
    setSaveError(null);
    setPreviewFailed(false);
  }

  function showPreview(file: File | undefined) {
    if (!file) return;
    releasePreview();
    previewUrlRef.current = URL.createObjectURL(file);
    setPreviewFailed(false);
    setView({ name: "preview", file, url: previewUrlRef.current });
  }

  async function readReceipt(file: File) {
    const request = ++requestRef.current;
    const stale = () => request !== requestRef.current;
    releasePreview();
    setView({ name: "reading" });

    try {
      const form = new FormData();
      form.set("image", await prepareReceiptImage(file));
      const outcome = await extractAction("receipt", form);
      if (stale()) return;

      if (!outcome.ok) {
        const notice =
          outcome.error === "failed"
            ? outcome.message
            : outcome.error === "invalid-input"
              ? (outcome.issues[0]?.message ?? "We couldn't use that file.")
              : "Receipts can't be read right now.";
        setView({ name: "receipt", notice });
      } else if (outcome.result.kind === "skipped") {
        setView({ name: "receipt", notice: outcome.result.reason, sourceText: outcome.result.sourceText });
      } else {
        setSaveError(null);
        setView({ name: "review", draft: outcome.result.draft });
      }
    } catch (error) {
      if (stale()) return;
      setView({
        name: "receipt",
        notice: error instanceof Error ? error.message : "We couldn't send that photo. Please try again.",
      });
    }
  }

  async function save(batch: PurchaseBatchInput, review: { sources: string[]; skipped: string[] }) {
    const request = requestRef.current;
    setSaving(true);
    setSaveError(null);
    try {
      const outcome = await submitAction(batch, review);
      if (request !== requestRef.current) return;
      setSaving(false);

      if (!outcome.ok) {
        setSaveError(outcome.issues.slice(0, 2).map((issue) => issue.message).join(" "));
        return;
      }
      const { items, status } = outcome.result;
      const rejected = items.flatMap((item) =>
        item.result === "rejected" ? [`${batch.items?.[item.index]?.productName ?? "An item"}: ${item.reason}`] : [],
      );
      if (status === "rejected") {
        setSaveError(`Nothing was saved. ${rejected.join(" ")}`);
        return;
      }

      const stored = items.filter((item) => item.result === "created").length;
      const already = items.filter((item) => item.result === "duplicate").length;
      setView({
        name: "done",
        headline:
          status === "duplicate"
            ? "This receipt was already saved."
            : `Saved ${stored} ${stored === 1 ? "item" : "items"}.`,
        details: [
          ...(status !== "duplicate" && already > 0 ? [`${already} ${already === 1 ? "was" : "were"} already saved.`] : []),
          ...rejected.map((reason) => `Not saved: ${reason}`),
        ],
      });
    } catch {
      if (request !== requestRef.current) return;
      setSaving(false);
      setSaveError("We couldn't save that. Please try again.");
    }
  }

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // so choosing the same file again still counts
    showPreview(file);
  }

  const { title, subtitle } = heading(view);

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-label="Add purchases" className={PLUS_BUTTON}>
        <PlusIcon />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="add-purchases-title"
        onClose={reset}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-white p-0 text-foreground shadow-xl backdrop:bg-black/50 dark:bg-zinc-900"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div>
              <h2 id="add-purchases-title" className="text-base font-semibold">
                {title}
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>
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

          {view.name === "menu" && (
            <ul className="flex flex-col gap-3 overflow-y-auto px-5 py-5">
              {SOURCES.map((source) => (
                <li key={source.id}>
                  <button
                    type="button"
                    disabled={!source.available}
                    onClick={() => setView({ name: source.id as "receipt" })}
                    className={CHOICE}
                  >
                    <span className="flex items-center gap-2 text-base font-medium">
                      {source.title}
                      {!source.available && (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                          Coming soon
                        </span>
                      )}
                    </span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">{source.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {view.name === "receipt" && (
            <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
              {view.notice && (
                <p
                  role="alert"
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"
                >
                  {view.notice}
                </p>
              )}

              <div className={canUseCamera ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
                {canUseCamera && (
                  <button type="button" onClick={() => cameraRef.current?.click()} className={CHOICE}>
                    <span className="text-base font-medium">Take a photo</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">Open the camera</span>
                  </button>
                )}
                <button type="button" onClick={() => uploadRef.current?.click()} className={CHOICE}>
                  <span className="text-base font-medium">{canUseCamera ? "Upload a photo" : "Choose a photo"}</span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">From your files or gallery</span>
                </button>
              </div>

              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Lay the receipt flat in good light with the whole thing in frame. It reads best when the text is
                straight and sharp.
              </p>

              {view.sourceText && (
                <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-medium">What we read</summary>
                  <pre className="overflow-x-auto border-t border-zinc-200 px-4 py-3 font-mono text-xs leading-relaxed dark:border-zinc-800">
                    {view.sourceText}
                  </pre>
                </details>
              )}

              <div>
                <button type="button" onClick={() => setView({ name: "menu" })} className="rounded-lg px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
                  &larr; Back
                </button>
              </div>
            </div>
          )}

          {view.name === "preview" && (
            <>
              <div className="flex min-h-0 flex-col items-center gap-3 overflow-y-auto bg-zinc-50 px-5 py-4 dark:bg-zinc-950">
                {previewFailed ? (
                  <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
                    We can&rsquo;t show a preview of this file, but you can still add it.
                  </p>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, which next/image can't optimize
                  <img
                    src={view.url}
                    alt="The receipt you chose"
                    onError={() => setPreviewFailed(true)}
                    className="max-h-[55vh] w-auto max-w-full rounded-lg border border-zinc-200 bg-white object-contain dark:border-zinc-800"
                  />
                )}
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <button type="button" onClick={() => setView({ name: "receipt" })} className={SECONDARY}>
                  {canUseCamera ? "Retake or choose another" : "Choose another"}
                </button>
                <button type="button" onClick={() => void readReceipt(view.file)} className={PRIMARY}>
                  Add
                </button>
              </div>
            </>
          )}

          {view.name === "reading" && (
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 px-5 py-12 text-center">
              <span
                aria-hidden
                className="size-8 animate-spin rounded-full border-2 border-zinc-300 border-t-foreground dark:border-zinc-700"
              />
              <p className="text-sm font-medium">Reading your receipt…</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">This usually takes a few seconds.</p>
            </div>
          )}

          {view.name === "review" && (
            <ReceiptReview
              draft={view.draft}
              products={products}
              busy={saving}
              error={saveError}
              onConfirm={save}
              onCancel={() => dialogRef.current?.close()}
            />
          )}

          {view.name === "done" && (
            <div className="flex flex-col gap-4 px-5 py-6">
              <p role="status" className="text-base font-medium">
                {view.headline}
              </p>
              {view.details.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {view.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={reset} className={SECONDARY}>
                  Add another
                </button>
                <button type="button" onClick={() => dialogRef.current?.close()} className={PRIMARY}>
                  Done
                </button>
              </div>
            </div>
          )}
        </div>

        {/* `capture` asks a phone to open its camera; other devices ignore it. */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pickFile} className="sr-only" tabIndex={-1} aria-hidden />
        <input ref={uploadRef} type="file" accept="image/*" onChange={pickFile} className="sr-only" tabIndex={-1} aria-hidden />
      </dialog>
    </>
  );
}
