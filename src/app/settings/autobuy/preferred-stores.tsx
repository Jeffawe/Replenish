"use client";

import { useState } from "react";
import { MAX_PREFERRED_STORES } from "@/modules/settings/client";
import { INPUT } from "../fields";

const ROW_BUTTON = "rounded px-1.5 py-0.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800";

/** The stores the user wants to buy from, most wanted first. Sent with the form as one hidden field. */
export function PreferredStores({ stores: initial, error }: { stores: string[]; error?: string }) {
  const [stores, setStores] = useState(initial);
  const [draft, setDraft] = useState("");

  const add = () => {
    const store = draft.trim();
    if (!store || stores.some((existing) => existing.toLowerCase() === store.toLowerCase())) return setDraft("");
    setStores([...stores, store]);
    setDraft("");
  };
  const move = (index: number, by: number) => {
    const next = [...stores];
    const [store] = next.splice(index, 1);
    next.splice(index + by, 0, store!);
    setStores(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="store-draft" className="text-sm font-medium">
        Stores you prefer, in order
      </label>
      <input type="hidden" name="preferredStores" value={JSON.stringify(stores)} />
      {stores.length > 0 && (
        <ol className="flex flex-col gap-1">
          {stores.map((store, index) => (
            <li key={store} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-1.5 text-sm dark:border-zinc-800">
              <span>
                <span className="mr-2 text-zinc-500 tabular-nums dark:text-zinc-400">{index + 1}.</span>
                {store}
              </span>
              <span className="flex items-center gap-0.5">
                <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${store} up`} className={ROW_BUTTON}>
                  &uarr;
                </button>
                <button type="button" disabled={index === stores.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${store} down`} className={ROW_BUTTON}>
                  &darr;
                </button>
                <button type="button" onClick={() => setStores(stores.filter((other) => other !== store))} aria-label={`Remove ${store}`} className={ROW_BUTTON}>
                  &times;
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {stores.length < MAX_PREFERRED_STORES && (
        <div className="flex items-center gap-2">
          <input
            id="store-draft"
            value={draft}
            maxLength={60}
            placeholder="Walmart"
            aria-describedby="store-draft-help"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter here adds the store rather than saving the whole form.
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            className={INPUT}
          />
          <button type="button" onClick={add} className="shrink-0 rounded-lg border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
            Add
          </button>
        </div>
      )}
      <p id="store-draft-help" className={error ? "text-sm text-rose-700 dark:text-rose-300" : "text-sm text-zinc-500 dark:text-zinc-400"}>
        {error ??
          "We look at these first. With any listed, auto-buy asks you before buying somewhere else. Leave empty for no preference. We can order from Walmart, Amazon, Lowe's, Home Depot, Ace Hardware and a few others; anywhere else we show the link for you to buy it yourself."}
      </p>
    </div>
  );
}
