import { requireUser } from "@/modules/auth";
import { autoBuyNeedsSetup, unseenOrderResults } from "@/modules/orders";
import Link from "next/link";
import { OrderResultsBanner } from "./order-results-banner";

/** How orders turned out while the user was away: a ✓ or a ✗ for each, until they say they've seen it. Loaded with the dashboard. */
export async function OrderResults() {
  const user = await requireUser();
  const results = await unseenOrderResults(user.id);
  if (results.length === 0) return null;
  return <OrderResultsBanner orders={results} />;
}

/** Auto-buy is on for something, but PayPal or the delivery address is missing, so it can only ask for now. */
export async function PaymentNotice() {
  const user = await requireUser();
  const { needed, setup } = await autoBuyNeedsSetup(user.id);
  if (!needed) return null;
  const missing = [setup.paypal === "none" ? "connect PayPal" : setup.paypal === "reconnect" ? "reconnect PayPal" : null, setup.hasAddress ? null : "add a delivery address"].filter(Boolean).join(" and ");
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30" aria-label="Finish setting up auto-buy">
      <div className="text-sm">
        <p className="font-medium">Auto-buy needs one more step</p>
        <p className="text-zinc-700 dark:text-zinc-300">
          You have auto-buy on, but we can&rsquo;t buy anything until you {missing}. Until then we&rsquo;ll just ask you.
        </p>
      </div>
      <Link href="/settings/payment" className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background">
        Set up
      </Link>
    </section>
  );
}
