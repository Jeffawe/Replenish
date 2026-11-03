"use client";

import { useState, useTransition } from "react";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { CONCERN_LABELS, type Suggestion } from "@/modules/restock/client";
import { buyForMeAction, dismissSuggestionAction } from "./actions";

/** A suggestion as it reaches the browser: the date is already text. */
type View = Omit<Suggestion, "searchedAt"> & { searchedAt: string };
type Listing = Suggestion["pick"];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "$4.99 x 2 packs = $9.98", or just "$4.99" for one pack. */
function priceText(listing: Listing): string {
  return listing.packs > 1 ? `${money(listing.priceCents)} × ${listing.packs} packs = ${money(listing.totalCents)}` : money(listing.totalCents);
}

function sizeText(listing: Listing): string | null {
  return listing.packSize === null ? null : `${listing.packSize} per pack`;
}

function Tags({ listing }: { listing: Listing }) {
  if (!listing.sample && listing.concerns.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {listing.sample && (
        <li className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Sample listing (testing data)
        </li>
      )}
      {listing.concerns.map((concern) => (
        <li key={concern} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {CONCERN_LABELS[concern]}
        </li>
      ))}
    </ul>
  );
}

export function SuggestionCard({ suggestion }: { suggestion: View }) {
  const { pick, alternatives } = suggestion;
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const buyForMe = () =>
    startTransition(async () => {
      const result = await buyForMeAction(suggestion.id);
      setMessage(result.message);
    });
  const notNow = () =>
    startTransition(async () => {
      await dismissSuggestionAction(suggestion.id);
    });

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="text-sm">
        <p className="font-medium">You&apos;re running low on {suggestion.name}.</p>
        <p className="text-zinc-600 dark:text-zinc-400">We checked on {suggestion.searchedAt} and found:</p>
      </div>

      <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <a href={pick.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline-offset-2 hover:underline">
          {pick.title}
        </a>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {pick.domain} &middot; {priceText(pick)}
          {sizeText(pick) && <> &middot; {sizeText(pick)}</>}
        </p>
        <Tags listing={pick} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a href={pick.url} target="_blank" rel="noopener noreferrer" className={PRIMARY}>
          Open at {pick.domain}
        </a>
        <button type="button" onClick={buyForMe} disabled={pending} className={SECONDARY}>
          Buy for me
        </button>
        <button type="button" onClick={notNow} disabled={pending} className="rounded-lg px-2 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-800">
          Not now
        </button>
      </div>
      {message && (
        <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
          {message}
        </p>
      )}

      {alternatives.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
            {alternatives.length === 1 ? "1 other option" : `${alternatives.length} other options`}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {alternatives.map((alternative) => (
              <li key={alternative.url} className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <a href={alternative.url} target="_blank" rel="noopener noreferrer" className="font-medium underline-offset-2 hover:underline">
                  {alternative.title}
                </a>
                <p className="text-zinc-600 dark:text-zinc-400">
                  {alternative.domain} &middot; {priceText(alternative)}
                  {sizeText(alternative) && <> &middot; {sizeText(alternative)}</>}
                </p>
                <Tags listing={alternative} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
