"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { DialogFrame } from "@/app/questions/dialog-frame";
import { correctStockAction, undoCorrectionAction } from "./actions";

type Result = { kind: "saved"; text: string; correctionId: string } | { kind: "undone" } | null;

const INPUT =
  "w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

/**
 * "Wrong amount?": the user says how much they actually have, and the estimate for that product is
 * worked out again. The result is shown here (so the correction is visibly doing something); the
 * list behind is refreshed when the dialog closes, which may remove the suggestion.
 */
export function CorrectionButton({ productId, name, unit, className }: { productId: string; name: string; unit: string; className: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [check, setCheck] = useState<{ message: string; value: number } | null>(null);
  const [result, setResult] = useState<Result>(null);

  function reset() {
    setAmount("");
    setProblem(null);
    setCheck(null);
  }

  async function send(value: number, sure = false) {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await correctStockAction({ productId, remaining: value, sure });
      if (outcome.status === "saved") {
        setCheck(null);
        const days = outcome.daysUntilRunOut === null ? null : Math.max(0, Math.round(outcome.daysUntilRunOut));
        const timing = days === null ? "" : days === 0 ? " At that rate it runs out today." : ` At that rate it lasts about ${days} ${days === 1 ? "day" : "days"}.`;
        setResult({
          kind: "saved",
          correctionId: outcome.undo.type === "stock-count" ? outcome.undo.correctionId : "",
          text: outcome.stillNeedsAttention
            ? `Thanks, we worked it out again.${timing} It's still running low, so it stays on your list.`
            : `Thanks, we worked it out again.${timing} That's enough for now, so we'll stop suggesting it.`,
        });
      } else if (outcome.status === "check") {
        setCheck({ message: outcome.message, value });
      } else if (outcome.status === "gone") {
        setProblem("We can't find that product any more.");
      } else {
        setProblem("That number didn't work. Please try again.");
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
    if (amount.trim() === "" || !Number.isFinite(value) || value < 0) return setProblem("Enter a number.");
    void send(value);
  }

  async function undo() {
    if (result?.kind !== "saved") return;
    setBusy(true);
    try {
      await undoCorrectionAction(productId, result.correctionId);
      setResult({ kind: "undone" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={className}
      >
        Wrong amount?
      </button>

      <DialogFrame
        ref={dialogRef}
        title={`How much ${name} do you have?`}
        subtitle="If we've got it wrong, tell us. We'll work out when it runs out again."
        onClose={() => {
          const changed = result !== null;
          reset();
          setResult(null);
          if (changed) router.refresh();
        }}
      >
        {result ? (
          <div className="flex flex-col gap-3">
            <p role="status" className="text-sm">
              {result.kind === "saved" ? result.text : "Put back the way it was."}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => dialogRef.current?.close()} className={PRIMARY}>
                Done
              </button>
              {result.kind === "saved" && (
                <button type="button" disabled={busy} onClick={() => void undo()} className={SECONDARY}>
                  Undo
                </button>
              )}
            </div>
          </div>
        ) : check ? (
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
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <span>I have</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className={INPUT}
                  autoFocus
                />
                <span className="text-zinc-500 dark:text-zinc-400">{unit}</span>
              </label>
              <button type="button" disabled={busy} onClick={() => void send(0)} className={SECONDARY}>
                None left
              </button>
            </div>
            {problem && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {problem}
              </p>
            )}
            <div>
              <button type="submit" disabled={busy} className={PRIMARY}>
                Save and recalculate
              </button>
            </div>
          </form>
        )}
      </DialogFrame>
    </>
  );
}
