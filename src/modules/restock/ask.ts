import { isAbandoned } from "@/core/abandoned";
import { runLowStockCheck, type CheckOptions } from "./check";
import { findForLowProducts } from "./find";
import { toRestockItem, type RestockReport } from "./report";
import type { ProductSearch } from "./search-types";
import { dropSuggestions, existingSuggestions, forgetStaleSuggestions, productsWithActiveOrder, saveFindings } from "./suggestions";

/** A stored suggestion is searched again after this long, so its price and stock stay recent. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AskReport extends RestockReport {
  /** Suggestions stored or refreshed this run. */
  saved: number;
  /** Open suggestions removed because the new search found nothing. */
  cleared: number;
  /** Suggestions removed because the product no longer needs attention. */
  forgotten: number;
  /** Low products not searched because they already have a recent suggestion, the user said not now, or they are already ordered. */
  alreadyAsked: number;
  /** Low products we've stopped searching for, because they should have run out long ago: the user is asked if they still use them. */
  abandoned: number;
}

/**
 * The first decision, "ask the user": the check, then a search for each low product that has no
 * recent suggestion, then the results stored so the dashboard can show them at the next login.
 * Buys nothing. It is what the scheduled job runs (`?ask=1` on the cron route, `npm run restock --
 * --save`); `runRestock` is the same without storing anything.
 */
export async function runRestockAndAsk(search: ProductSearch, options: CheckOptions = {}, limit?: number): Promise<AskReport> {
  const check = await runLowStockCheck(options);
  const now = check.checkedAt;

  // After the check, which moves forward the date of anything that turned out not to be low.
  const forgotten = await forgetStaleSuggestions(now, options.userId);

  const ids = check.low.map((low) => low.product.id);
  const [existing, ordered] = await Promise.all([existingSuggestions(ids), productsWithActiveOrder(ids, now)]);
  const recently = (at: Date | null | undefined) => at != null && now.getTime() - at.getTime() < REFRESH_AFTER_MS;

  // Long overdue: stop paying to search, and take down what we were showing. The questions ask about it instead.
  const abandoned = check.low.filter((low) => isAbandoned(low.estimate, now));
  await dropSuggestions(abandoned.map((low) => low.product.id));
  const givenUp = new Set(abandoned.map((low) => low.product.id));

  const toSearch = check.low.filter((low) => {
    if (givenUp.has(low.product.id)) return false;
    // Already ordered (in progress or on its way): nothing to find.
    if (ordered.has(low.product.id)) return false;
    // Nothing was found a moment ago: another search would cost a credit to find the same nothing.
    if (recently(low.product.restockNoneFoundAt)) return false;
    const stored = existing.get(low.product.id);
    if (!stored) return true;
    // "Not now": don't spend a search on something the user isn't looking at.
    if (stored.snoozedUntil && stored.snoozedUntil > now) return false;
    return !recently(stored.searchedAt);
  });

  const { results, skipped } = await findForLowProducts(toSearch, search, limit);
  const items = results.map(toRestockItem);
  const { saved, cleared } = await saveFindings(items, now);

  return {
    checkedAt: check.checkedAt,
    checked: check.checked,
    moreDue: check.moreDue,
    items,
    skipped: skipped.map(({ userId, product }) => ({ userId, productId: product.id, name: product.name })),
    errors: check.errors,
    saved,
    cleared,
    forgotten,
    alreadyAsked: check.low.length - toSearch.length - abandoned.length,
    abandoned: abandoned.length,
  };
}
