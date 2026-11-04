import { priceWithFees, shortDate } from "@/app/orders/format";
import type { AutoBuyPreview, PreviewRow } from "@/modules/orders";

function Row({ row }: { row: PreviewRow }) {
  return (
    <li className="flex flex-col gap-0.5 border-t border-zinc-100 py-2.5 text-sm first:border-t-0 dark:border-zinc-800">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{row.name}</span>
        <span className="text-zinc-500 dark:text-zinc-400">{shortDate(row.at)}</span>
      </p>
      {row.outcome === "buy" && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Would have bought it at {row.store} for {priceWithFees(row.itemsCents, row.feesCents)}{row.sample ? " (sample listing)" : ""}.
          {row.boughtYourselfAt && ` You bought your own on ${shortDate(row.boughtYourselfAt)}, so check this wouldn't have been one too many.`}
        </p>
      )}
      {row.outcome === "ask" && <p className="text-zinc-600 dark:text-zinc-400">Would have asked you first: {row.reasons.join("; ").toLowerCase()}.</p>}
      {row.outcome === "search" && <p className="text-zinc-600 dark:text-zinc-400">Would have looked for it online. We haven&rsquo;t got a listing for it yet, so we can&rsquo;t say what it would have bought.</p>}
    </li>
  );
}

/** "What auto-buy would have done this week": worked out from purchase history, before anyone trusts it with money. */
export function AutoBuyPreviewPanel({ preview }: { preview: AutoBuyPreview }) {
  const buys = preview.rows.filter((row) => row.outcome === "buy").length;
  return (
    <section aria-labelledby="preview-heading" className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 id="preview-heading" className="text-base font-semibold">
        What auto-buy would have done this week
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        A dry run over the last {preview.days} days with your limits below, as if auto-buy were on for everything you track. Nothing was bought and nothing was searched.
      </p>
      {preview.rows.length === 0 ? (
        <p className="text-sm">Nothing needed buying this week.</p>
      ) : (
        <>
          <p className="text-sm font-medium">
            {buys === 0 ? "It wouldn't have bought anything" : `It would have bought ${buys} ${buys === 1 ? "thing" : "things"}`}, and looked at {preview.rows.length} in all. {preview.quiet} didn&rsquo;t need anything.
          </p>
          <ul>
            {preview.rows.map((row) => (
              <Row key={row.productId} row={row} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
