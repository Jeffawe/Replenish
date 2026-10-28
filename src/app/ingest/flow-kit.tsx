import type { ComponentType } from "react";

/**
 * What the "+" dialog and a way of adding purchases (a "flow") share. The
 * dialog shows the menu and the finished screen; everything between choosing a
 * source and finishing is the flow's own, so a new source adds a flow and a
 * line in the dialog's SOURCES map, and nothing else changes.
 */

export interface ProductOption {
  id: string;
  name: string;
  unit: string;
}

/** What the dialog tells a flow it can do, and gives it to work with. */
export interface FlowProps {
  /** The user's products, so a line can be tied to one. */
  products: ProductOption[];
  /** The purchases were saved: the dialog shows its finished screen with these words. */
  onFinished(summary: { headline: string; details: string[] }): void;
  /** Back to the menu of sources. */
  onBack(): void;
  /** Close the dialog without finishing. */
  onClose(): void;
}

export type Flow = ComponentType<FlowProps>;

export const PRIMARY = "rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60";
export const SECONDARY = "rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";
export const CHOICE =
  "flex w-full flex-col items-start gap-1 rounded-xl border border-zinc-200 px-4 py-4 text-left hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:border-zinc-800 dark:hover:bg-zinc-800";

/** The title bar every screen in the dialog starts with. */
export function FlowHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose(): void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
      <div>
        <h2 id="add-purchases-title" className="text-base font-semibold">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="rounded-full px-2 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        &times;
      </button>
    </div>
  );
}
