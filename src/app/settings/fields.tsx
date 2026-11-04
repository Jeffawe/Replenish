import type { ReactNode } from "react";

export const INPUT =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-300 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-500 dark:focus:ring-zinc-700";

export const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";

export function Suffix({ children }: { children: ReactNode }) {
  return <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{children}</span>;
}

/** A labelled input with a hint, or the error in its place. The input needs `id` and `aria-describedby={`${id}-help`}`. */
export function Field({ label, id, hint, error, required, children }: { label: string; id: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-rose-600 dark:text-rose-400">
            *
          </span>
        )}
      </label>
      {children}
      {(error || hint) && (
        <p id={`${id}-help`} className={error ? "text-sm text-rose-700 dark:text-rose-300" : "text-sm text-zinc-500 dark:text-zinc-400"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

/** The save button and its status line, shared by the settings forms. */
export function SaveBar({ pending, status, message }: { pending: boolean; status: "idle" | "saved" | "error"; message?: string }) {
  return (
    <div className="flex items-center gap-3">
      <button type="submit" disabled={pending} className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60">
        {pending ? "Saving…" : "Save changes"}
      </button>
      <p role="status" aria-live="polite" className={status === "error" ? "text-sm text-rose-700 dark:text-rose-300" : MUTED}>
        {status === "saved" ? "Saved." : status === "error" ? message : ""}
      </p>
    </div>
  );
}
