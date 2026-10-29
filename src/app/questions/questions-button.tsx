"use client";

import { useRef } from "react";
import type { Question } from "@/modules/questions/client";
import { DialogFrame } from "./dialog-frame";
import { QuestionStepper } from "./question-stepper";

function QuestionIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M7.8 7.9a2.3 2.3 0 1 1 3.2 2.1c-.6.3-1 .8-1 1.4v.4M10 14.4v.1" />
    </svg>
  );
}

/**
 * The questions button beside "+": how many products we have questions about,
 * red when one of them matters. Opens a panel that asks them one at a time.
 * Hidden when there is nothing to ask.
 */
export function QuestionsButton({ questions, products, important }: { questions: Question[]; products: number; important: boolean }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (products === 0) return null;

  const label = `${products} ${products === 1 ? "product" : "products"} with questions${important ? ", some need a look" : ""}`;
  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={label}
        title={label}
        className={
          "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium shadow-sm " +
          (important
            ? "bg-rose-600 text-white hover:bg-rose-700"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700")
        }
      >
        <QuestionIcon />
        {products}
      </button>

      <DialogFrame ref={dialogRef} title="A few quick questions" subtitle="They help us guess better. All optional.">
        <QuestionStepper questions={questions} empty={<p className="text-sm">That&rsquo;s everything for now. Thanks!</p>} />
      </DialogFrame>
    </>
  );
}
