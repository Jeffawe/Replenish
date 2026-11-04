"use client";

import { useState } from "react";
import { SuggestionCard, type SuggestionView } from "./suggestion-card";

const ARROW =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800";

/**
 * The suggestions one at a time, so a long list doesn't take over the page: previous and next
 * buttons with "2 of 5". With one suggestion there is nothing to flip through.
 */
export function SuggestionCarousel({ suggestions, skipConfirm, maxOrderCents }: { suggestions: SuggestionView[]; skipConfirm: boolean; maxOrderCents: number }) {
  const [index, setIndex] = useState(0);
  // The list shrinks when one is dismissed or fixed; stay on a suggestion that exists.
  const current = Math.min(index, suggestions.length - 1);
  const suggestion = suggestions[current];
  if (!suggestion) return null;

  const step = (by: number) => setIndex((current + by + suggestions.length) % suggestions.length);

  return (
    <section aria-label="Running low" className="flex flex-col gap-2">
      {suggestions.length > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Running low &middot; {current + 1} of {suggestions.length}
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => step(-1)} aria-label="Previous suggestion" className={ARROW}>
              &larr; Previous
            </button>
            <button type="button" onClick={() => step(1)} aria-label="Next suggestion" className={ARROW}>
              Next &rarr;
            </button>
          </div>
        </div>
      )}
      <SuggestionCard key={suggestion.id} suggestion={suggestion} skipConfirm={skipConfirm} maxOrderCents={maxOrderCents} />
    </section>
  );
}
