import { checkSecret } from "@/lib/api-access";
import { createMockSearch, describeLowProduct, runLowStockCheck, runRestock, runRestockAndAsk, searchFromEnv, sweepNextChecks } from "@/modules/restock";

/**
 * The scheduled low-stock check (cron). It looks only at products whose `next_check_at` has
 * come, recalculates their estimates, and returns the low ones. A scheduler calls it with
 * `Authorization: Bearer <CRON_SECRET>`; Vercel Cron does this by itself when CRON_SECRET is set.
 *
 * `?sweep=1` first recalculates every product's date, for everyone: schedule that one
 * weekly as the safety net (and run it once after a deploy that adds dates).
 *
 * `?ask=1` is the real scheduled job: the check, then a search for each low product that has no recent
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
  if (ask || params.get("find") === "1") {
    const mock = params.get("mock") === "1";
    if (mock && process.env.NODE_ENV === "production") return Response.json({ error: "Mock listings are not available in production" }, { status: 400 });
    const search = mock ? createMockSearch() : searchFromEnv();
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
