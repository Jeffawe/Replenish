"use client";

import { useRef, useState } from "react";
import { CHOICE, FlowHeader, PRIMARY, SECONDARY, type Flow, type ProductOption } from "@/app/ingest/flow-kit";
import { ReceiptFlow } from "@/app/ingest/receipt/receipt-flow";

/**
 * The ways of adding purchases. To add one, write a flow (see flow-kit.tsx)
 * and list it here; a source with no flow yet shows as "Coming soon".
 */
const SOURCES: { id: string; title: string; description: string; flow?: Flow }[] = [
  { id: "receipt", title: "Receipt", description: "Take a photo or upload one", flow: ReceiptFlow },
  { id: "email", title: "Email", description: "Find orders in your inbox" },
];

type View =
  | { name: "menu" }
  /** The chosen source's flow runs until it finishes. */
  | { name: "flow"; flow: Flow }
  | { name: "done"; headline: string; details: string[] };

const PLUS_BUTTON =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:opacity-90";

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

/** The "+" button and the dialog it opens: pick a way to add, let its flow run, show that it's done. */
export function AddPurchasesDialog({ products }: { products: ProductOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>({ name: "menu" });
  const close = () => dialogRef.current?.close();

  return (
    <>
      <button type="button" onClick={() => dialogRef.current?.showModal()} aria-label="Add purchases" className={PLUS_BUTTON}>
        <PlusIcon />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="add-purchases-title"
        // Closing by any route starts the next opening from the menu, and drops a flow mid-way.
        onClose={() => setView({ name: "menu" })}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-2xl bg-white p-0 text-foreground shadow-xl backdrop:bg-black/50 dark:bg-zinc-900"
      >
        <div className="flex max-h-[85vh] flex-col">
          {view.name === "menu" && (
            <>
              <FlowHeader title="Add purchases" subtitle="How do you want to add them?" onClose={close} />
              <ul className="flex flex-col gap-3 overflow-y-auto px-5 py-5">
                {SOURCES.map((source) => (
                  <li key={source.id}>
                    <button
                      type="button"
                      disabled={!source.flow}
                      onClick={() => source.flow && setView({ name: "flow", flow: source.flow })}
                      className={CHOICE}
                    >
                      <span className="flex items-center gap-2 text-base font-medium">
                        {source.title}
                        {!source.flow && (
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
            </>
          )}

          {view.name === "flow" && (
            <view.flow
              products={products}
              onFinished={(summary) => setView({ name: "done", ...summary })}
              onBack={() => setView({ name: "menu" })}
              onClose={close}
            />
          )}

          {view.name === "done" && (
            <>
              <FlowHeader title="Add purchases" onClose={close} />
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
                  <button type="button" onClick={() => setView({ name: "menu" })} className={SECONDARY}>
                    Add another
                  </button>
                  <button type="button" onClick={close} className={PRIMARY}>
                    Done
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
