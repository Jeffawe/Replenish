"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { DialogFrame } from "@/app/questions/dialog-frame";
import { setSkipBuyConfirmAction } from "@/app/settings/actions";
import { leastOrderCostCents, orderFeesCents, priceBreakdown } from "@/core/order-money";
import { PRIMARY, SECONDARY } from "@/app/ingest/flow-kit";
import { MOST_PACKS } from "@/modules/orders/client";
import { CONCERN_LABELS, type Suggestion } from "@/modules/restock/client";
import { buyForMeAction, snoozeSuggestionAction } from "./actions";
import { BoughtItButton } from "./bought-it-dialog";
import { CorrectionButton } from "./correction-dialog";

/** A suggestion as it reaches the browser: the date is already text. */
export type SuggestionView = Omit<Suggestion, "searchedAt"> & { searchedAt: string };
type Listing = Suggestion["pick"];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** The quiet row: visible and easy to reach, but clearly not the main thing on the card. */
const QUIET = "rounded px-1 py-0.5 text-sm text-zinc-600 underline-offset-2 hover:underline disabled:opacity-50 dark:text-zinc-400";

/** "walmart.com · $4.99 × 2 packs = $9.98 · 12 per pack", in one line. */
function details(listing: Listing): string {
  const price = listing.packs > 1 ? `${money(listing.priceCents)} × ${listing.packs} packs = ${money(listing.totalCents)}` : money(listing.totalCents);
  return [listing.domain, price, listing.packSize === null ? null : `${listing.packSize} per pack`].filter(Boolean).join(" · ");
}

function Tags({ listing }: { listing: Listing }) {
  if (!listing.sample && listing.concerns.length === 0) return null;
  const labels = [...(listing.sample ? ["Sample listing (testing data)"] : []), ...listing.concerns.map((concern) => CONCERN_LABELS[concern])];
  return <p className="text-xs text-amber-800 dark:text-amber-300">{labels.join(" · ")}</p>;
}

function ListingTitle({ listing, className }: { listing: Listing; className: string }) {
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
function useBuy(suggestionId: string) {
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

function BuyMessage({ message }: { message: { text: string; fix: boolean } | null }) {
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

const orderable = (listing: Listing) => !listing.concerns.includes("not-orderable");
const unusual = (listing: Listing) => listing.sample || listing.concerns.length > 0;

/**
 * "Are you sure?", with the real cost: how many, every fee, and what is held on PayPal. Also answers
 * the spec's "How much would you like to buy?". The user can turn it off for ordinary listings.
 */
function BuyDialog({ suggestion, option, listing, maxOrderCents, onClose }: { suggestion: SuggestionView; option: number; listing: Listing; maxOrderCents: number; onClose(): void }) {
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

        {!unusual(listing) && (
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
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">Checked {suggestion.searchedAt}</span>
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
