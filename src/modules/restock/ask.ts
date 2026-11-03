import { runLowStockCheck, type CheckOptions } from "./check";
import { findForLowProducts } from "./find";
import { toRestockItem, type RestockReport } from "./report";
import type { ProductSearch } from "./search-types";
import { existingSuggestions, forgetStaleSuggestions, saveFindings } from "./suggestions";

/** A stored suggestion is searched again after this long, so its price and stock stay recent. */
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export interface AskReport extends RestockReport {
  /** Suggestions stored or refreshed this run. */
  saved: number;
  /** Open suggestions removed because the new search found nothing. */
  cleared: number;
  /** Suggestions removed because the product no longer needs attention. */
  forgotten: number;
  /** Low products not searched because they already have a recent suggestion (or the user said not now). */
  alreadyAsked: number;
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

  const existing = await existingSuggestions(check.low.map((low) => low.product.id));
  const toSearch = check.low.filter((low) => {
    const stored = existing.get(low.product.id);
    if (!stored) return true;
    return stored.status === "open" && now.getTime() - stored.searchedAt.getTime() >= REFRESH_AFTER_MS;
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
    alreadyAsked: check.low.length - toSearch.length,
  };
}
