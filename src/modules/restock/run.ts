import { runLowStockCheck, type CheckOptions } from "./check";
import type { ProductSearch } from "./search-types";
import { findForLowProducts } from "./find";
import { toRestockItem, type RestockReport } from "./report";

/**
 * The whole step so far: the low-stock check, then a listing found for each low product.
 * Buys and asks nothing; the report is what the next step works from.
 */
export async function runRestock(search: ProductSearch, options: CheckOptions = {}, limit?: number): Promise<RestockReport> {
  const check = await runLowStockCheck(options);
  const { results, skipped } = await findForLowProducts(check.low, search, limit);
  return {
    checkedAt: check.checkedAt,
    checked: check.checked,
    moreDue: check.moreDue,
    items: results.map(toRestockItem),
    skipped: skipped.map(({ userId, product }) => ({ userId, productId: product.id, name: product.name })),
    errors: check.errors,
  };
}
