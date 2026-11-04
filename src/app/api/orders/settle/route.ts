import { checkSecret } from "@/lib/api-access";
import { orderDepsFromEnv, settleOrders } from "@/modules/orders";

/** A run can search and order for many products. Vercel's Hobby plan allows up to 300 seconds. */
export const maxDuration = 300;

/**
 * Moves every unfinished order along: asks Zinc how the ones in progress are doing, refunds what is owed,
 * and keeps tracking up to date. Cron calls it every few minutes with `Authorization: Bearer <CRON_SECRET>`.
 * (`?auto=1` on /api/low-stock/check does this first too, so one schedule is enough if it runs often.)
 */
export async function GET(request: Request) {
  const denied = checkSecret(request, process.env.CRON_SECRET);
  if (denied) return denied;
  const settled = await settleOrders(orderDepsFromEnv());
  return Response.json({ checkedAt: new Date(), ...settled });
}
