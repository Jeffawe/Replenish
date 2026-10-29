"use client";

import { useState } from "react";
import type { Question, Undo } from "@/modules/questions/client";
import { undoAction } from "./actions";
import { QuestionCard } from "./question-card";

/**
 * Shows the first of `questions`, one at a time. Saving one refreshes the
 * list from the server, so the next question (often about the same product)
 * takes its place. The last answer can be taken back with "Undo".
 */
export function QuestionStepper({ questions, empty }: { questions: Question[]; empty: React.ReactNode }) {
  const [last, setLast] = useState<{ undo: Undo; question: Question } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const current = questions[0];
  const productsLeft = new Set(questions.map((q) => q.productId)).size;

  return (
    <div className="flex flex-col gap-4">
      {last && (
        <div role="status" className="flex items-center justify-between gap-3 rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
          <span>Saved.</span>
          <button
            type="button"
            disabled={undoing}
            onClick={() => {
              setUndoing(true);
              void undoAction(last.question.productId, last.undo).finally(() => {
                setUndoing(false);
                setLast(null);
              });
            }}
            className="font-medium underline-offset-2 hover:underline disabled:opacity-60"
          >
            Undo
          </button>
        </div>
      )}

      {current ? (
        <>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
            {current.productName}
            {current.important && <span className="ml-2 text-rose-600 dark:text-rose-400">Needs a look</span>}
          </p>
          {/* Keyed so a new question starts with a clean card. */}
          <QuestionCard key={current.key} question={current} onSaved={(undo, question) => setLast({ undo, question })} />
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {productsLeft === 1 ? "Last product to check." : `${productsLeft} products to check.`} Answer any you like.
          </p>
        </>
      ) : (
        empty
      )}
    </div>
  );
}
