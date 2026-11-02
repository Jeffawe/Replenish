import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireUser } from "@/modules/auth";
import { getEmailSetup } from "@/modules/ingestion";
import { CheckAgain, CopyField, StopAndDelete } from "./email-controls";

export const metadata: Metadata = { title: "Orders by email · Replenish" };

// The only store we read so far, and the one Gmail filter that finds its order emails.
const FILTER = "from:auto-confirm@amazon.com";

const MUTED = "text-sm text-zinc-600 dark:text-zinc-400";
const H2 = "text-base font-semibold";

function when(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

function what(entry: { outcome: string; reason: string | null; retailer: string | null; itemCount: number | null }): string {
  if (entry.outcome === "accepted") {
    const count = entry.itemCount ?? 0;
    return `Added ${count} ${count === 1 ? "item" : "items"} from ${entry.retailer ?? "an order"}. Waiting for your OK.`;
  }
  if (entry.outcome === "verification") return "Gmail's confirmation code (shown above).";
  return `Skipped. ${entry.reason ?? ""}`.trim();
}

export default function EmailOrdersPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href="/dashboard" className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
          &larr; Back to inventory
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Orders by email</h1>
        <p className={MUTED}>
          Online stores like Amazon don&rsquo;t give you a receipt to photograph. Instead, have your email forward their order confirmations to a
          private address, and we&rsquo;ll add what you bought.
        </p>
      </header>

      <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="h-40 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />}>
        <EmailSetup />
      </Suspense>
    </main>
  );
}

/** Everything that depends on the signed-in user, kept out of the page's static shell. */
async function EmailSetup() {
  const user = await requireUser();
  const setup = await getEmailSetup(user.id);

  if (!setup.address) {
    return (
      <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
        Email orders aren&rsquo;t switched on for this server yet.
      </p>
    );
  }

  return (
    <>
      <section className="flex flex-col gap-3">
        <h2 className={H2}>1. Your private address</h2>
        <p className={MUTED}>It&rsquo;s made just for you and can&rsquo;t be guessed. Don&rsquo;t share it.</p>
        <CopyField value={setup.address} label="Your private address" />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={H2}>2. Tell Gmail to forward</h2>
        <ol className={MUTED + " flex list-decimal flex-col gap-2 pl-5"}>
          <li>In Gmail, open Settings &rarr; See all settings &rarr; Forwarding and POP/IMAP &rarr; Add a forwarding address, and paste the address above.</li>
          <li>Gmail sends it a confirmation code. It appears just below. Enter it in Gmail.</li>
          <li>Settings &rarr; Filters and Blocked Addresses &rarr; Create a new filter. Paste this in the &ldquo;From&rdquo; box:</li>
        </ol>
        <CopyField value={FILTER} label="Gmail filter" />
        <p className={MUTED}>Then choose &ldquo;Forward it to&rdquo; your private address and create the filter.</p>

        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-zinc-100 px-4 py-3 text-sm dark:bg-zinc-800">
          {setup.confirmationCode ? (
            <span>
              Gmail&rsquo;s confirmation code: <span className="font-mono text-base font-semibold">{setup.confirmationCode}</span>
            </span>
          ) : (
            <>
              <span>Waiting for Gmail&rsquo;s confirmation code&hellip;</span>
              <CheckAgain />
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={H2}>What we do with your email</h2>
        <ul className={MUTED + " flex list-disc flex-col gap-2 pl-5"}>
          <li>
            <strong className="text-foreground">We only see what you forward.</strong> We never get your password or access to your inbox. The
            filter is yours: you can see it, change it or switch it off in Gmail any time.
          </li>
          <li>
            <strong className="text-foreground">Only store emails are read.</strong> Anything that isn&rsquo;t from Amazon is dropped as soon as it
            arrives and isn&rsquo;t read.
          </li>
          <li>
            <strong className="text-foreground">We keep the items, not the email.</strong> We keep what you bought, how many, and the date. The
            email&rsquo;s text, your address and payment details aren&rsquo;t saved.
          </li>
          <li>
            <strong className="text-foreground">It passes through two services on the way.</strong> The email is received by Cloudflare, which
            forwards it to our server. It&rsquo;s read there and not stored.
          </li>
          <li>
            <strong className="text-foreground">You decide.</strong> Orders we add count in your estimates straight away. You&rsquo;ll be asked to
            confirm each one on the inventory page, and you can fix or remove it.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={H2}>What we received</h2>
        {setup.log.length === 0 ? (
          <p className={MUTED}>Nothing yet. Each email that reaches your address shows up here, with what we did with it. It never shows the email itself.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {setup.log.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:justify-between sm:gap-4">
                <span>{what(entry)}</span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{when(entry.receivedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={H2}>Stop</h2>
        <p className={MUTED}>Done with this, or the address got out? Get a new one and clear the list.</p>
        <StopAndDelete />
      </section>
    </>
  );
}
