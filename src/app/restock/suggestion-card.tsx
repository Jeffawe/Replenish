"use client";

import { useState, useTransition } from "react";
import { orderFeesCents } from "@/core/order-money";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { formatDate } from "@/lib/format";
import { snoozeSuggestionAction } from "./actions";
import { BuyDialog, BuyMessage, ListingTitle, money, Tags, unusual, useBuy, type Listing, type SuggestionView } from "./buy-dialog";
import { BoughtItButton } from "./bought-it-dialog";
import { CorrectionButton } from "./correction-dialog";

export type { SuggestionView } from "./buy-dialog";

/** The quiet row: visible and easy to reach, but clearly not the main thing on the card. */
const QUIET = "rounded px-1 py-2 text-sm text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400";

/** "walmart.com · $4.99 × 2 packs = $9.98 · 12 per pack", in one line. */
function details(listing: Listing): string {
  const price = listing.packs > 1 ? `${money(listing.priceCents)} × ${listing.packs} packs = ${money(listing.totalCents)}` : money(listing.totalCents);
  return [listing.domain, price, listing.packSize === null ? null : `${listing.packSize} per pack`].filter(Boolean).join(" · ");
}

const orderable = (listing: Listing) => !listing.concerns.includes("not-orderable");

/** The price as it will really be charged, under every listing, so nobody meets the fees for the first time at checkout. */
function FeesLine({ listing }: { listing: Listing }) {
  return <p className="text-xs text-zinc-500 dark:text-zinc-400">+ {money(orderFeesCents(listing.totalCents))} in fees, plus tax and shipping</p>;
}

/**
 * "You're running low on X." One listing and two clear answers (buy it, or say you already did). The
 * rest (other options, a wrong estimate, not now) sits in one quiet row: there when wanted, without
 * competing. Buying asks for confirmation unless the user turned that off, and always for anything unusual.
 */
export function SuggestionCard({ suggestion, skipConfirm, maxOrderCents }: { suggestion: SuggestionView; skipConfirm: boolean; maxOrderCents: number }) {
  const { pick, alternatives } = suggestion;
  const [buying, setBuying] = useState<number | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [pending, startTransition] = useTransition();
  const direct = useBuy(suggestion.id);

  const options = [pick, ...alternatives];
  const chosen = buying === null ? undefined : options[buying];
  const start = (option: number) => {
    const listing = options[option]!;
    if (skipConfirm && !unusual(listing)) direct.buy(option, listing.packs);
    else setBuying(option);
  };
  const notNow = () =>
    startTransition(async () => {
      await snoozeSuggestionAction(suggestion.id);
    });

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <p className="font-medium">You&apos;re running low on {suggestion.name}.</p>

      <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
        <ListingTitle listing={pick} className="text-sm font-medium" />
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{details(pick)}</p>
        {orderable(pick) && <FeesLine listing={pick} />}
        <Tags listing={pick} />
        {suggestion.reason && <p className="text-xs text-zinc-600 dark:text-zinc-400">Why this one: {suggestion.reason}</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {orderable(pick) ? (
          <button type="button" onClick={() => start(0)} disabled={direct.pending} className={PRIMARY}>
            {direct.pending ? "Starting…" : "Buy for me"}
          </button>
        ) : (
          <a href={pick.url} target="_blank" rel="noopener noreferrer" className={PRIMARY}>
            Open at {pick.domain}
          </a>
        )}
        <BoughtItButton productId={suggestion.productId} name={suggestion.name} unit={suggestion.unit} usualQuantity={suggestion.usualQuantity} />
      </div>
      <BuyMessage message={direct.message} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {skipConfirm && orderable(pick) && (
          <button type="button" onClick={() => setBuying(0)} className={QUIET}>
            Choose how many
          </button>
        )}
        {alternatives.length > 0 && (
          <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers(!showOthers)} className={QUIET}>
            {showOthers ? "Hide other options" : alternatives.length === 1 ? "1 other option" : `${alternatives.length} other options`}
          </button>
        )}
        <CorrectionButton productId={suggestion.productId} name={suggestion.name} unit={suggestion.unit} className={QUIET} />
        <button type="button" onClick={notNow} disabled={pending} className={QUIET}>
          Not now
        </button>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">Checked {formatDate(new Date(suggestion.searchedAt))}</span>
      </div>

      {showOthers && (
        <ul className="flex flex-col gap-2">
          {alternatives.map((alternative, index) => (
            <li key={alternative.url} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-sm">
                <ListingTitle listing={alternative} className="" />
                <p className="text-zinc-600 dark:text-zinc-400">{details(alternative)}</p>
                {orderable(alternative) && <FeesLine listing={alternative} />}
                <Tags listing={alternative} />
              </div>
              {orderable(alternative) && (
                <button type="button" onClick={() => start(index + 1)} disabled={direct.pending} className={SECONDARY}>
                  Buy this one
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {chosen && buying !== null && <BuyDialog key={buying} suggestion={suggestion} option={buying} listing={chosen} maxOrderCents={maxOrderCents} onClose={() => setBuying(null)} />}
    </article>
  );
}
