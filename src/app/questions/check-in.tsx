"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Question } from "@/modules/questions/client";
import { DialogFrame } from "./dialog-frame";
import { QuestionStepper } from "./question-stepper";

// Kept per browser until there are accounts; then it moves to the user.
const LAST_SHOWN = "replenish:check-in-shown-at";
const DAY_MS = 24 * 60 * 60 * 1000;

function shownRecently(everyDays: number): boolean {
  try {
    const at = Number(localStorage.getItem(LAST_SHOWN));
    return Number.isFinite(at) && Date.now() - at < everyDays * DAY_MS;
  } catch {
    return true; // can't remember, so don't risk showing it every visit
  }
}

function rememberShown() {
  try {
    localStorage.setItem(LAST_SHOWN, String(Date.now()));
  } catch {}
}

// Which products the check-in opened with, once it has opened in this page visit.
let openedWith: string[] | null = null;
const listeners = new Set<() => void>();
const opened = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get: () => openedWith,
  server: () => null,
};
function open(productIds: string[]) {
  openedWith = productIds;
  for (const listener of listeners) listener();
}

/**
 * The occasional check-in: now and then, opening the dashboard shows a few of
 * the most useful questions. Closing it is always fine; whatever isn't
 * answered stays in the questions panel.
 */
export function CheckIn({ questions, count, everyDays }: { questions: Question[]; count: number; everyDays: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // The products picked when it opened; answered questions drop out as the list refreshes.
  const picked = useSyncExternalStore(opened.subscribe, opened.get, opened.server);

  useEffect(() => {
    if (picked !== null || questions.length === 0 || shownRecently(everyDays)) return;
    rememberShown();
    // A few products, not a few questions about one.
    open([...new Set(questions.map((q) => q.productId))].slice(0, count));
  }, [questions, picked, count, everyDays]);

  useEffect(() => {
    if (picked !== null && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [picked]);

  if (picked === null) return null;
  // Every remaining question about a picked product, so answering one moves on to that product's next.
  const remaining = questions.filter((q) => picked.includes(q.productId));
  return (
    <DialogFrame ref={dialogRef} title="Quick check-in" subtitle="A few questions to keep your estimates right. Close this any time.">
      <QuestionStepper questions={remaining} empty={<p className="text-sm">All done. Thanks!</p>} />
    </DialogFrame>
  );
}
