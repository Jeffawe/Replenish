"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DialogFrame } from "@/app/questions/dialog-frame";
import { setSkipBuyConfirmAction } from "@/app/settings/actions";
import { leastOrderCostCents, priceBreakdown } from "@/core/order-money";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { MOST_PACKS } from "@/modules/orders/client";
import { CONCERN_LABELS, type Suggestion } from "@/modules/restock/client";
import { buyForMeAction } from "./actions";

/** The "Buy this for you?" step, shared by the running-low card's Buy for me and every product card's Buy now. */

/** A suggestion as it reaches the browser: the date is already text. */
export type SuggestionView = Omit<Suggestion, "searchedAt"> & { searchedAt: string };
export type Listing = Suggestion["pick"];

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function Tags({ listing }: { listing: Listing }) {
  if (!listing.sample && listing.concerns.length === 0) return null;
  const labels = [...(listing.sample ? ["Sample listing (testing data)"] : []), ...listing.concerns.map((concern) => CONCERN_LABELS[concern])];
  return <p className="text-xs text-amber-800 dark:text-amber-300">{labels.join(" · ")}</p>;
}

export function ListingTitle({ listing, className }: { listing: Listing; className: string }) {
  return (
    <a href={listing.url} target="_blank" rel="noopener noreferrer" className={`underline-offset-2 hover:underline ${className}`}>
      {listing.title}
      <span aria-hidden className="ml-1 text-zinc-400">
        &#8599;
      </span>
      <span className="sr-only"> (opens at {listing.domain})</span>
    </a>
  );
}

/** Buying a listing, from either the confirmation or straight from the card. */
export function useBuy(suggestionId: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; fix: boolean } | null>(null);
  const buy = (option: number, packs: number, dontAskAgain = false) =>
    startTransition(async () => {
      setMessage(null);
      if (dontAskAgain) await setSkipBuyConfirmAction(true);
      const result = await buyForMeAction({ id: suggestionId, option, packs });
      if (result.status === "started") router.push("/orders");
      else setMessage({ text: result.message, fix: result.fix === "settings" });
    });
  return { buy, pending, message };
}

export function BuyMessage({ message }: { message: { text: string; fix: boolean } | null }) {
  if (!message) return null;
  return (
    <p role="status" className="text-sm text-zinc-700 dark:text-zinc-300">
      {message.text}{" "}
      {message.fix && (
        <Link href="/settings/payment" className="font-medium underline underline-offset-2">
          Set it up
        </Link>
      )}
    </p>
  );
}

export const unusual = (listing: Listing) => listing.sample || listing.concerns.length > 0;

/**
 * "Are you sure?", with the real cost: how many, every fee, and what is held on PayPal. Also answers
 * the spec's "How much would you like to buy?". The user can turn it off for ordinary listings.
 */
export function BuyDialog({
  suggestion,
  option,
  listing,
  maxOrderCents,
  onClose,
  allowSkip = true,
}: {
  suggestion: SuggestionView;
  option: number;
  listing: Listing;
  maxOrderCents: number;
  onClose(): void;
  /** Offer "Don't show me this again". Buy now always asks, so it would be a promise we don't keep. */
  allowSkip?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const costOf = (count: number) => leastOrderCostCents(listing.priceCents * count);
  // Start within the cap, if a smaller order fits it.
  const [packs, setPacks] = useState(() => {
    let start = listing.packs;
    while (start > 1 && costOf(start) > maxOrderCents) start--;
    return start;
  });
  const [dontAsk, setDontAsk] = useState(false);
  const { buy, pending, message } = useBuy(suggestion.id);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const price = priceBreakdown(listing.priceCents * packs, maxOrderCents);
  const tooMuch = price.leastCents > maxOrderCents;
  const units = listing.packSize === null ? null : listing.packSize * packs;
  const stepper = "size-8 rounded-lg border border-zinc-300 text-base leading-none hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800";
  const row = "flex justify-between gap-3";

  return (
    <DialogFrame ref={dialogRef} title="Buy this for you?" onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-1">
          <ListingTitle listing={listing} className="font-medium" />
          <p className="text-zinc-600 dark:text-zinc-400">
            {listing.domain} &middot; {money(listing.priceCents)} a pack
          </p>
          <Tags listing={listing} />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">How many?</span>
          <span className="flex items-center gap-2">
            <button type="button" disabled={packs <= 1} onClick={() => setPacks(packs - 1)} aria-label="One pack fewer" className={stepper}>
              &minus;
            </button>
            <span aria-live="polite" className="w-6 text-center font-medium tabular-nums">
              {packs}
            </span>
            <button type="button" disabled={packs >= MOST_PACKS || costOf(packs + 1) > maxOrderCents} onClick={() => setPacks(packs + 1)} aria-label="One pack more" className={stepper}>
              +
            </button>
          </span>
          <span className="text-zinc-600 dark:text-zinc-400">
            {packs === 1 ? "pack" : "packs"}
            {units === null ? "" : ` (${units} ${suggestion.unit})`}
          </span>
        </div>

        <dl className="flex flex-col gap-1 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
          <div className={row}>
            <dt>Store price</dt>
            <dd className="tabular-nums">{money(price.itemsCents)}</dd>
          </div>
          <div className={row}>
            <dt>Ordering fee</dt>
            <dd className="tabular-nums">{money(price.orderingFeeCents)}</dd>
          </div>
          <div className={row}>
            <dt>Replenish service fee</dt>
            <dd className="tabular-nums">{money(price.serviceFeeCents)}</dd>
          </div>
          <div className={row}>
            <dt>Tax and shipping</dt>
            <dd>Set by the store</dd>
          </div>
          <div className={`${row} border-t border-zinc-200 pt-1 font-medium dark:border-zinc-700`}>
            <dt>Before tax and shipping</dt>
            <dd className="tabular-nums">{money(price.leastCents)}</dd>
          </div>
        </dl>
        <p className="text-zinc-600 dark:text-zinc-400">
          We&rsquo;ll hold up to {money(price.heldCents)} on your PayPal and refund whatever isn&rsquo;t used. Prefer to buy it yourself? The link above goes to {listing.domain}, with no fees from us.
        </p>

        {tooMuch && (
          <p role="alert" className="text-rose-700 dark:text-rose-300">
            This is over the {money(maxOrderCents)} most we can buy in one order. You can still buy it yourself from the link above.
          </p>
        )}

        {allowSkip && !unusual(listing) && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={dontAsk} onChange={(event) => setDontAsk(event.target.checked)} className="size-4 shrink-0" />
            <span>Don&rsquo;t show me this again</span>
          </label>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => buy(option, packs, dontAsk)} disabled={pending || tooMuch} className={PRIMARY}>
            {pending ? "Starting…" : "Buy it"}
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()} disabled={pending} className={SECONDARY}>
            Not yet
          </button>
        </div>
        <BuyMessage message={message} />
      </div>
    </DialogFrame>
  );
}
