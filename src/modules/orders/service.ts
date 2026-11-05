import { and, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { products } from "@/db/schema";
import { getSuggestion } from "@/modules/restock";
import { leastOrderCostCents, monthStart } from "@/core/order-money";
import { effectiveLimit, type UserSettings } from "@/core/user-settings";
import { getDeliveryAddress, platformLimits } from "@/modules/settings";
import { PaymentError, type Payments, type SuggestedAddress } from "./payments";
import { advanceOrder, cancelOrder, placeOrder, settleOrders, type OrderDeps, type PlaceOutcome } from "./pipeline";
import { activatePaypal, getPaypalAccount, listActiveOrders, listOrdersPageRows, spentByEveryoneSince, listUnseenResults, listUserOrders, markSeen, orderMonths, removePaypal, savePendingSetup, toView } from "./repo";
import { MOST_PACKS, ORDERS_PAGE_SIZE, type AutoBuyTerms, type OrderOnTheWay, type OrdersPage, type OrdersQuery, type OrderView } from "./types";

/** What the screens call. Each takes the signed-in user's id; nothing here trusts a product or price from the browser. */

/**
 * "Buy for me": buys a suggestion the user is looking at, whatever auto-buy's limits say (they asked,
 * and they can see its tags). They can pick one of the other listings and how many packs. `option` is
 * a position in the suggestion's own list, so the browser can only ever choose from what we stored.
 */
export async function buyNow(userId: string, suggestionId: string, deps: OrderDeps, choice?: { option: number; packs: number }): Promise<PlaceOutcome> {
  const suggestion = await getSuggestion(userId, suggestionId);
  if (!suggestion) return { status: "refused", reason: "not-found", message: "That suggestion is no longer there." };
  const listing = [suggestion.pick, ...suggestion.alternatives][choice?.option ?? 0];
  if (!listing) return { status: "refused", reason: "not-found", message: "That option is no longer there." };
  if (listing.concerns.includes("not-orderable")) return { status: "refused", reason: "not-found", message: `We can't order from ${listing.domain}. You can buy it from the link.` };
  const packs = choice?.packs ?? listing.packs;
  if (!Number.isInteger(packs) || packs < 1 || packs > MOST_PACKS) return { status: "refused", reason: "not-found", message: `Choose between 1 and ${MOST_PACKS} packs.` };
  // A cap on one order, fees included, because it is paid from our Zinc wallet first. It also keeps what Zinc may spend under it.
  const most = (deps.limits ?? platformLimits()).buyNowOrderCents;
  if (leastOrderCostCents(listing.priceCents * packs) > most) return { status: "refused", reason: "over-limit", message: `One order can be at most $${(most / 100).toFixed(2)}, fees included. Choose fewer packs.` };
  return placeOrder({ userId, suggestion, source: "buy-now", decision: "You asked us to buy it.", choice: { listing, packs }, wholeOrderLimitCents: most }, deps);
}

/** Orders being processed or on their way, by product, for the dashboard's cards. */
export async function ordersOnTheWay(userId: string, now: Date = new Date()): Promise<Map<string, OrderOnTheWay>> {
  const rows = await listActiveOrders(userId, now);
  const byProduct = new Map<string, OrderOnTheWay>();
  for (const row of rows) {
    if (row.productId && !byProduct.has(row.productId)) {
      byProduct.set(row.productId, { productId: row.productId, status: row.status as OrderOnTheWay["status"], arrivesAt: row.arrivesAt?.toISOString() ?? null });
    }
  }
  return byProduct;
}

export { cancelOrder };

export async function listOrders(userId: string): Promise<OrderView[]> {
  return (await listUserOrders(userId)).map(toView);
}

/** One page of the user's orders (a page past the end gives the last one), with what the month filter can offer. */
export async function listOrdersPage(userId: string, query: OrdersQuery): Promise<OrdersPage> {
  const first = await listOrdersPageRows(userId, query);
  const { total } = first;
  const pageCount = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const { rows } = page === query.page ? first : await listOrdersPageRows(userId, { month: query.month, page });
  return { orders: rows.map(toView), month: query.month, page, total, pageCount, months: await orderMonths(userId) };
}

/** Moves the user's unfinished orders along, then returns the page of orders they are looking at. The Orders page calls this while anything is processing. */
export async function refreshOrders(userId: string, deps: OrderDeps, query: OrdersQuery = { month: null, page: 1 }): Promise<OrdersPage> {
  await settleOrders(deps, { userId });
  return listOrdersPage(userId, query);
}

/** Orders that finished while the user was away and that they haven't been shown yet. */
export async function unseenOrderResults(userId: string): Promise<OrderView[]> {
  return (await listUnseenResults(userId)).map(toView);
}

export const markOrderResultsSeen = markSeen;

export interface PaymentSetup {
  paypal: "none" | "connected" | "reconnect";
  payerEmail: string | null;
  hasAddress: boolean;
  /** The address PayPal had on file, for filling in the form. Only while the user hasn't saved their own. */
  suggestedAddress: SuggestedAddress | null;
}

const SuggestedAddressSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
});

export async function paymentSetup(userId: string): Promise<PaymentSetup> {
  const [account, address] = await Promise.all([getPaypalAccount(userId), getDeliveryAddress(userId)]);
  return {
    paypal: !account?.vaultId ? "none" : account.status === "reconnect" ? "reconnect" : "connected",
    payerEmail: account?.payerEmail ?? null,
    hasAddress: address !== null,
    suggestedAddress: address === null ? (SuggestedAddressSchema.safeParse(account?.suggestedAddress).data ?? null) : null,
  };
}

/**
 * Why auto-buy can't be switched on yet, in words for the user, or null when it can: buying needs the
 * user's PayPal to pay and a delivery address for Zinc. (Switching it off is always allowed.)
 */
export async function autoBuySetupProblem(userId: string): Promise<string | null> {
  const setup = await paymentSetup(userId);
  const missing = [setup.paypal === "connected" ? null : setup.paypal === "reconnect" ? "reconnect PayPal" : "connect PayPal", setup.hasAddress ? null : "add a delivery address"].filter(Boolean);
  if (missing.length === 0) return null;
  return `Auto-buy needs you to ${missing.join(" and ")} first, so we can pay and know where to send it (Settings, Payment & delivery).`;
}

/** Whether the user has auto-buy on for something but can't be served yet (no PayPal, or no address): the dashboard says so. */
export async function autoBuyNeedsSetup(userId: string): Promise<{ needed: boolean; setup: PaymentSetup }> {
  const [setup, [row]] = await Promise.all([
    paymentSetup(userId),
    db.select({ n: count() }).from(products).where(and(eq(products.userId, userId), eq(products.autobuyEnabled, true), isNull(products.archivedAt))),
  ]);
  return { needed: (row?.n ?? 0) > 0 && (setup.paypal !== "connected" || !setup.hasAddress), setup };
}

/** Sends the user to PayPal to approve. Returns the page to send them to. */
export async function startPaypalSetup(userId: string, origin: string, payments: Payments): Promise<{ approveUrl: string }> {
  const { setupTokenId, approveUrl } = await payments.startSetup({
    returnUrl: `${origin}/settings/payment/paypal/return`,
    cancelUrl: `${origin}/settings/payment?paypal=cancelled`,
    brandName: "Replenish",
  });
  await savePendingSetup(userId, setupTokenId);
  return { approveUrl };
}

/** The user came back from PayPal: save the account if they approved. */
export async function finishPaypalSetup(userId: string, payments: Payments): Promise<"connected" | "not-approved" | "nothing-pending" | "unavailable"> {
  const account = await getPaypalAccount(userId);
  // Nothing waiting. If they are already connected (they refreshed the page they came back to), say so.
  if (!account?.setupTokenId) return account?.vaultId && account.status === "active" ? "connected" : "nothing-pending";
  try {
    const saved = await payments.finishSetup(account.setupTokenId);
    await activatePaypal(userId, saved.vaultId, saved.payerEmail, saved.address);
    return "connected";
  } catch (error) {
    if (error instanceof PaymentError && error.kind === "reconnect") return "not-approved";
    return "unavailable";
  }
}

/** Forgets the user's PayPal here and asks PayPal to forget it too. Orders already placed are unaffected. */
export async function disconnectPaypal(userId: string, payments: Payments | null): Promise<void> {
  const account = await getPaypalAccount(userId);
  await removePaypal(userId);
  if (account?.vaultId && payments) await payments.forget(account.vaultId);
}

export { advanceOrder };

/** What the "before you turn on auto-buy" screen tells the user, worked out from their settings and our limits. */
export function autoBuyTerms(settings: Pick<UserSettings, "autobuyMaxPriceCents" | "autobuyMonthlyCapCents" | "autobuyMinConfidence">): AutoBuyTerms {
  const limits = platformLimits();
  return {
    minConfidence: settings.autobuyMinConfidence,
    orderCents: effectiveLimit(settings.autobuyMaxPriceCents, limits.orderCents),
    monthCents: effectiveLimit(settings.autobuyMonthlyCapCents, limits.monthCents),
    platformOrderCents: limits.orderCents,
    platformMonthCents: limits.monthCents,
  };
}

/** The month's budget across all users, for the owner: what is spent, and how the limit is worked out. */
export async function monthlyBudget(now: Date = new Date()) {
  const limits = platformLimits();
  return { spentCents: await spentByEveryoneSince(monthStart(now)), limitCents: limits.allUsersMonthCents, plannedUsers: limits.plannedUsers, perUserCents: limits.monthCents };
}
