import { checkSecret } from "@/lib/api-access";
import { orderDepsFromEnv, runAutoBuy } from "@/modules/orders";
import { createMockSearch, describeLowProduct, runLowStockCheck, runRestock, runRestockAndAsk, searchFromEnv, sweepNextChecks } from "@/modules/restock";

/** A run can search and order for many products. Vercel's Hobby plan allows up to 300 seconds. */
export const maxDuration = 300;

/**
 * The scheduled low-stock check (cron). It looks only at products whose `next_check_at` has
 * come, recalculates their estimates, and returns the low ones. A scheduler calls it with
 * `Authorization: Bearer <CRON_SECRET>`; Vercel Cron does this by itself when CRON_SECRET is set.
 *
 * `?sweep=1` first recalculates every product's date, for everyone: schedule that one
 * weekly as the safety net (and run it once after a deploy that adds dates).
 *
 * `?auto=1` is the whole job: it settles orders in progress, runs the check, stores suggestions, and
 * BUYS what auto-buy is allowed to (PayPal is charged, Zinc places the order). It returns what it did.
 *
 * `?ask=1` is the same without buying: the check, then a search for each low product that has no recent
 * suggestion, with the results stored so the dashboard can ask the user at their next login. Nothing is bought.
 *
 * `?find=1` also looks each low product up online (household goods on Channel3, food on Zinc;
 * a search costs a credit or a cent) and returns the RestockReport instead of the plain list. `&mock=1` uses invented listings
 * instead; it is refused in production.
 */
export async function GET(request: Request) {
  const denied = checkSecret(request, process.env.CRON_SECRET);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const swept = params.get("sweep") === "1" ? await sweepNextChecks() : null;

  const ask = params.get("ask") === "1";
  const auto = params.get("auto") === "1";
  if (auto || ask || params.get("find") === "1") {
    const mock = params.get("mock") === "1";
    if (mock && process.env.NODE_ENV === "production") return Response.json({ error: "Mock listings are not available in production" }, { status: 400 });
    const search = mock ? createMockSearch() : searchFromEnv();
    if (auto) {
      try {
        return Response.json({ swept, ...(await runAutoBuy(search, {}, orderDepsFromEnv())) });
      } catch (error) {
        // PayPal or Zinc isn't set up on this server: say so rather than half-running.
        if (error instanceof Error && (error.name === "PaymentError" || error.name === "FulfilmentError")) return Response.json({ error: error.message }, { status: 503 });
        throw error;
      }
    }
    const report = ask ? await runRestockAndAsk(search) : await runRestock(search);
    return Response.json({ swept, ...report });
  }

  const check = await runLowStockCheck();
  return Response.json({
    checkedAt: check.checkedAt,
    swept,
    checked: check.checked,
    moreDue: check.moreDue,
    errors: check.errors,
    low: check.low.map(describeLowProduct),
  });
}
