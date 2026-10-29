"use client";

import { forwardRef } from "react";

/** The modal frame both the questions panel and the check-in use: a title, an always-visible ×, and the content. */
export const DialogFrame = forwardRef<HTMLDialogElement, { title: string; subtitle?: string; onClose?(): void; children: React.ReactNode }>(
  function DialogFrame({ title, subtitle, onClose, children }, ref) {
    return (
      <dialog
        ref={ref}
        aria-label={title}
        onClose={onClose}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl bg-white p-0 text-foreground shadow-xl backdrop:bg-black/50 dark:bg-zinc-900"
      >
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={(event) => event.currentTarget.closest("dialog")?.close()}
              aria-label="Close"
              className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              &times;
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-5">{children}</div>
        </div>
      </dialog>
    );
  },
);
