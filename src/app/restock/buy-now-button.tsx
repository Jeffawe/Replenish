"use client";

import { useState, useTransition } from "react";
import { findForBuyNowAction, type BuyNowSearch } from "./actions";
import { BuyDialog, type SuggestionView } from "./buy-dialog";

/**
 * "Buy now" on a product's card, for a product that isn't about to run out. It looks for a listing
 * (a few seconds), then opens the same "Buy this for you?" step as "Buy for me": the listing, how
 * many packs, every fee, and what is held on PayPal. Always asks first, since nothing told the user
 * this was coming.
 */
export function BuyNowButton({ productId, name, maxOrderCents }: { productId: string; name: string; maxOrderCents: number }) {
  const [pending, startTransition] = useTransition();
  const [found, setFound] = useState<SuggestionView | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const start = () =>
    startTransition(async () => {
      setMessage(null);
      let result: BuyNowSearch;
      try {
        result = await findForBuyNowAction(productId);
      } catch {
        result = { status: "unavailable", message: "Something went wrong. Please try again." };
      }
      if (result.status === "ready") setFound(result.suggestion);
      else setMessage(result.message);
    });

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={start}
        disabled={pending}
        aria-label={`Buy ${name} now`}
        className="w-fit rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {pending ? "Looking for it…" : "Buy now"}
      </button>
      {message && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          {message}
        </p>
      )}
      {found && <BuyDialog suggestion={found} option={0} listing={found.pick} maxOrderCents={maxOrderCents} onClose={() => setFound(null)} allowSkip={false} />}
    </div>
  );
}
