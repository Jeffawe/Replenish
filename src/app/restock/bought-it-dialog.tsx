"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { OPEN_RECEIPT_UPLOAD, PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { DialogFrame } from "@/app/questions/dialog-frame";
import { boughtItAction } from "./actions";

const INPUT =
  "w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

/**
 * "I just bought this": they got it some other way, so we shouldn't. Type how much, or upload the
 * receipt, which is the ordinary receipt flow (and also picks up whatever else they bought).
 */
export function BoughtItButton({ productId, name, unit, usualQuantity }: { productId: string; name: string; unit: string; usualQuantity: number }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState(String(usualQuantity));
  // A new key each time the dialog opens: pressing Save twice can't record it twice.
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [check, setCheck] = useState<{ message: string; value: number } | null>(null);

  function open() {
    setKey(crypto.randomUUID());
    setAmount(String(usualQuantity));
    setProblem(null);
    setCheck(null);
    dialogRef.current?.showModal();
  }

  async function send(value: number, sure = false) {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await boughtItAction({ productId, quantity: value, key, sure });
      if (outcome.status === "saved") {
        dialogRef.current?.close();
        router.refresh();
      } else if (outcome.status === "check") {
        setCheck({ message: outcome.message, value });
      } else {
        setProblem(outcome.message);
      }
    } catch {
      setProblem("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (amount.trim() === "" || !Number.isFinite(value) || value <= 0) return setProblem("Enter how much you bought.");
    void send(value);
  }

  function uploadReceipt() {
    dialogRef.current?.close();
    window.dispatchEvent(new Event(OPEN_RECEIPT_UPLOAD));
  }

  return (
    <>
      <button type="button" onClick={open} className={SECONDARY}>
        I just bought this
      </button>
      <DialogFrame ref={dialogRef} title={`You bought ${name}?`} subtitle="Tell us how much and we'll stop looking for it.">
        {check ? (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
            <p className="text-sm">{check.message}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void send(check.value, true)} className={PRIMARY}>
                Yes, that&rsquo;s right
              </button>
              <button type="button" disabled={busy} onClick={() => setCheck(null)} className={SECONDARY}>
                Let me fix it
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm">
              <span>I bought</span>
              <input type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} className={INPUT} autoFocus />
              <span className="text-zinc-500 dark:text-zinc-400">{unit}</span>
            </label>
            {problem && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {problem}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={busy} className={PRIMARY}>
                {busy ? "Saving…" : "Save"}
              </button>
              <button type="button" disabled={busy} onClick={uploadReceipt} className={SECONDARY}>
                Upload a receipt instead
              </button>
            </div>
          </form>
        )}
      </DialogFrame>
    </>
  );
}
