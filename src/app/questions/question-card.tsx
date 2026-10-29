"use client";

import { useId, useState } from "react";
import type { Question, Undo } from "@/modules/questions/client";
import { answerAction, snoozeAction } from "./actions";

export const PRIMARY = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60";
export const SECONDARY =
  "rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800";
const INPUT =
  "w-24 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-700";

interface Props {
  question: Question;
  /** Called after a save, with how to take it back. */
  onSaved(undo: Undo, question: Question): void;
}

/**
 * One question: tap a choice, or type a number. A surprising number gets an
 * "are you sure?" before it is saved; "Not now" keeps it quiet for a while.
 */
export function QuestionCard({ question, onSaved }: Props) {
  const uid = useId();
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<{ message: string; value: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(choice: string, value?: number, sure = false) {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await answerAction({ productId: question.productId, kind: question.kind, choice, number: value, sure });
      if (outcome.status === "saved") {
        setCheck(null);
        setNumber("");
        onSaved(outcome.undo, question);
      } else if (outcome.status === "check" && value !== undefined) {
        setCheck({ message: outcome.message, value });
      } else if (outcome.status === "gone") {
        setProblem("This was already answered.");
      } else {
        setProblem("That answer didn't work. Please try again.");
      }
    } catch {
      setProblem("We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function sendNumber(event: React.FormEvent) {
    event.preventDefault();
    const value = Number(number);
    if (number.trim() === "" || !Number.isFinite(value) || value < 0) return setProblem("Enter a number.");
    void send("number", value);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-base font-medium">{question.prompt}</p>
        {question.hint && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{question.hint}</p>}
      </div>

      {check ? (
        <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm">{check.message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void send("number", check.value, true)} className={PRIMARY}>
              Yes, that&rsquo;s right
            </button>
            <button type="button" disabled={busy} onClick={() => setCheck(null)} className={SECONDARY}>
              Let me fix it
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {question.choices.map((choice) => (
              <button key={choice.id} type="button" disabled={busy} onClick={() => void send(choice.id)} className={SECONDARY}>
                {choice.label}
              </button>
            ))}
          </div>

          {question.numberInput && (
            <form onSubmit={sendNumber} className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${uid}-n`} className="text-sm text-zinc-600 dark:text-zinc-400">
                {question.numberInput.label}
              </label>
              <input
                id={`${uid}-n`}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                className={INPUT}
              />
              <span className="text-sm text-zinc-500 dark:text-zinc-400">{question.unit}</span>
              <button type="submit" disabled={busy || number.trim() === ""} className={PRIMARY}>
                Save
              </button>
            </form>
          )}
        </>
      )}

      {problem && <p className="text-sm text-rose-700 dark:text-rose-300">{problem}</p>}

      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void snoozeAction(question.productId, question.kind).finally(() => setBusy(false));
          }}
          className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
