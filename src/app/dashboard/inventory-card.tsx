import { DEFAULT_PREDICT_CONFIG } from "@/core/predict";
import type { ExcludedReason } from "@/core/consumption-rate";
import type { InventoryItem } from "@/modules/inventory/service";
import type { InventoryEstimate } from "@/core/estimate";
import { EditProductDialog } from "./edit-product-dialog";
import {
  addDays,
  daysBetween,
  formatDate,
  formatDayRange,
  formatDays,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatRate,
} from "@/lib/format";

type Tone = "ok" | "low" | "out" | "unknown";

const TONES: Record<Tone, { pill: string; bar: string }> = {
  ok: {
    pill: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
    bar: "bg-emerald-500",
  },
  low: {
    pill: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    bar: "bg-amber-500",
  },
  out: {
    pill: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200",
    bar: "bg-rose-500",
  },
  unknown: {
    pill: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    bar: "bg-zinc-400",
  },
};

const EXCLUDED_TEXT: Record<ExcludedReason, string> = {
  "possible-missing-purchase": "Ignored: gap looks too long, maybe a missing receipt",
  "possible-early-purchase": "Ignored: bought unusually early",
  "covered-by-correction": "Replaced by your stock count",
  "stock-increased": "Ignored: stock went up with no purchase recorded",
  "unlikely-count": "Ignored: this count looks like a typo next to everything else",
  "too-short": "Ignored: too short to measure reliably",
};

export function getStatus(estimate: InventoryEstimate): { label: string; tone: Tone } {
  if (estimate.estimatedRemaining === null) return { label: "Needs data", tone: "unknown" };
  if (estimate.estimatedRemaining <= 0) return { label: "Likely out", tone: "out" };
  if (estimate.isLow) return { label: "Running low", tone: "low" };
  return { label: "Stocked", tone: "ok" };
}

export function InventoryCard({
  item,
  now,
  categories,
}: {
  item: InventoryItem;
  now: Date;
  categories: string[];
}) {
  const { product, estimate } = item;
  const status = getStatus(estimate);
  const tones = TONES[status.tone];

  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold">{product.name}</h2>
          <p className="truncate text-sm text-zinc-500 dark:text-zinc-400">
            {[product.brand, product.category].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tones.pill}`}>
            {status.label}
          </span>
          <EditProductDialog
            product={{
              id: product.id,
              name: product.name,
              unit: product.unit,
              category: product.category,
              brand: product.brand,
              normalPurchaseQty: product.normalPurchaseQty,
              fallbackDaysPerPurchase: product.fallbackDaysPerPurchase,
              typicalLeftoverAtPurchase: product.typicalLeftoverAtPurchase,
              lowStockThresholdDays: product.lowStockThresholdDays,
            }}
            estimatedRemaining={estimate.estimatedRemaining}
            defaultThresholdDays={DEFAULT_PREDICT_CONFIG.defaultLowStockThresholdDays}
            categories={categories}
          />
        </div>
      </header>

      {estimate.estimatedRemaining === null || estimate.daysUntilRunOut === null ? (
        <NeedsData estimate={estimate} />
      ) : (
        <Prediction estimate={estimate} barClass={tones.bar} now={now} />
      )}

      <Confidence estimate={estimate} />

      <details className="group border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Why this estimate
          <span aria-hidden className="text-zinc-400 transition-transform group-open:rotate-180">
            &#9662;
          </span>
        </summary>
        <Explanation item={item} now={now} />
      </details>
    </article>
  );
}

function NeedsData({ estimate }: { estimate: InventoryEstimate }) {
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      {estimate.purchaseCount === 0
        ? "No purchases recorded yet."
        : "We need a second purchase, or a note on how long one lasts, to learn how fast you use this."}
    </p>
  );
}

function Prediction({
  estimate,
  barClass,
  now,
}: {
  estimate: InventoryEstimate;
  barClass: string;
  now: Date;
}) {
  const remaining = estimate.estimatedRemaining ?? 0;
  const days = estimate.daysUntilRunOut ?? 0;
  const full = Math.max(estimate.anchor?.quantity ?? 0, estimate.normalPurchaseQty);
  const fraction = full > 0 ? Math.min(1, remaining / full) : 0;
  const range = estimate.daysUntilRunOutRange
    ? formatDayRange(estimate.daysUntilRunOutRange.earliest, estimate.daysUntilRunOutRange.latest)
    : null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-3xl font-semibold tracking-tight">
        <span className="text-zinc-400">~</span>
        {formatQuantity(remaining)}{" "}
        <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">
          {estimate.unit} left
        </span>
      </p>
      <div
        role="img"
        aria-label={`About ${Math.round(fraction * 100)}% of the last stock remains`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {days < 1 ? "Runs out today" : <>Runs out in about {formatDays(days)}</>}
        {days >= 1 && <> (around {formatDate(addDays(now, days))})</>}
        {range && <span className="text-zinc-500"> &mdash; {range}</span>}
      </p>
    </div>
  );
}

function Confidence({ estimate }: { estimate: InventoryEstimate }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-zinc-500 dark:text-zinc-400">Confidence</span>
      <div
        role="img"
        aria-label={`Confidence ${formatPercent(estimate.confidence)}`}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      >
        <div
          className="h-full rounded-full bg-zinc-700 dark:bg-zinc-300"
          style={{ width: `${estimate.confidence * 100}%` }}
        />
      </div>
      <span className="w-10 text-right font-medium tabular-nums">
        {formatPercent(estimate.confidence)}
      </span>
    </div>
  );
}

function Explanation({ item, now }: { item: InventoryItem; now: Date }) {
  const { estimate, product } = item;
  const { anchor, rate } = estimate;
  const rateValue = estimate.consumptionPerDay;
  const daysSince = anchor ? daysBetween(anchor.at, now) : 0;

  return (
    <div className="mt-3 flex flex-col gap-5 text-sm">
      <section className="flex flex-col gap-1">
        <h3 className="font-medium">How we got here</h3>
        {rateValue === null ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            No usage rate yet, so there is nothing to project from.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
            <li>
              Usage: {formatRate(rateValue)} {estimate.unit}/day
              {estimate.consumptionError !== null && ` ± ${formatRate(estimate.consumptionError)}`}
              {estimate.rateSource === "fallback" &&
                ` (from your estimate that one purchase lasts about ${product.fallbackDaysPerPurchase} days)`}
            </li>
            {anchor && (
              <>
                <li>
                  Starting point ({anchor.kind === "correction" ? "your count" : "last purchase"},{" "}
                  {formatDate(anchor.at)}): {formatQuantity(anchor.quantity)} {estimate.unit}
                </li>
                <li>
                  Now: {formatQuantity(anchor.quantity)} &minus; {formatRate(rateValue)} &times;{" "}
                  {Math.round(daysSince)} days ={" "}
                  {formatQuantity(estimate.estimatedRemaining ?? 0)} {estimate.unit}
                </li>
              </>
            )}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-medium">Confidence: {formatPercent(estimate.confidence)}</h3>
        <ul className="flex flex-col gap-2">
          {estimate.confidenceFactors.map((factor) => (
            <li key={factor.label} className="flex gap-3">
              <span className="w-12 shrink-0 text-right font-medium tabular-nums text-zinc-700 dark:text-zinc-300">
                &times;{factor.value.toFixed(2)}
              </span>
              <span className="text-zinc-600 dark:text-zinc-400">
                <span className="font-medium text-zinc-800 dark:text-zinc-200">{factor.label}.</span>{" "}
                {factor.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {rate.intervals.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="font-medium">Usage measured</h3>
          <ul className="flex flex-col gap-1 text-zinc-600 dark:text-zinc-400">
            {rate.intervals.map((interval) => (
              <li key={`${interval.kind}-${interval.from.getTime()}`} className={interval.excluded ? "opacity-60" : ""}>
                {interval.kind === "correction" ? "Your counts" : "Purchases"}{" "}
                {formatDate(interval.from)} &rarr; {formatDate(interval.to)}:{" "}
                {formatQuantity(interval.consumed)} {estimate.unit} in {Math.round(interval.days)} days (
                {formatRate(interval.ratePerDay)}/day)
                {interval.excluded && <em> &mdash; {EXCLUDED_TEXT[interval.excluded]}</em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-1">
        <h3 className="font-medium">Purchase history</h3>
        {item.purchases.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">None yet.</p>
        ) : (
          <table className="w-full text-left text-zinc-600 dark:text-zinc-400">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Date</th>
                <th className="py-1 font-medium">Qty</th>
                <th className="py-1 font-medium">Store</th>
                <th className="py-1 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody>
              {item.purchases.slice(0, 8).map((purchase) => (
                <tr key={purchase.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <td className="py-1">{formatDate(purchase.purchasedAt)}</td>
                  <td className="py-1">
                    {formatQuantity(purchase.quantity)} {purchase.unit}
                  </td>
                  <td className="py-1">{purchase.store ?? "–"}</td>
                  <td className="py-1 text-right tabular-nums">
                    {formatPrice(purchase.priceCents, purchase.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
