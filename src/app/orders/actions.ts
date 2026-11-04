"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/modules/auth";
import { cancelOrder, FulfilmentError, listOrdersPage, markOrderResultsSeen, orderDepsFromEnv, parseOrdersQuery, PaymentError, refreshOrders, type CancelOutcome } from "@/modules/orders";
import type { OrdersPage } from "@/modules/orders/client";

/** The page the browser is looking at, read back safely (it comes from the browser). */
function queryFrom(input: unknown) {
  const { month, page } = (typeof input === "object" && input !== null ? input : {}) as { month?: unknown; page?: unknown };
  return parseOrdersQuery({ month, page: String(page) });
}

/**
 * Moves the user's unfinished orders along (asking Zinc how they are doing) and returns the page of
 * orders they are looking at. The Orders page calls this every few seconds while anything is processing.
 * If PayPal or Zinc aren't set up on this server it just returns the orders as they are.
 */
export async function refreshOrdersAction(input?: unknown): Promise<OrdersPage> {
  const user = await requireUser();
  const query = queryFrom(input);
  try {
    return await refreshOrders(user.id, orderDepsFromEnv(), query);
  } catch {
    return listOrdersPage(user.id, query);
  }
}

/** Just reads the page, without asking anyone how orders are doing: cheap enough to call every little while to catch new orders (like an auto-buy made while the page was open). */
export async function loadOrdersAction(input?: unknown): Promise<OrdersPage> {
  const user = await requireUser();
  return listOrdersPage(user.id, queryFrom(input));
}

/** "Got it": the user has seen how these orders turned out (all of them when no ids are given). */
export async function markSeenAction(ids?: unknown): Promise<void> {
  const user = await requireUser();
  const parsed = z.array(z.uuid()).max(100).optional().safeParse(ids);
  if (!parsed.success) return;
  await markOrderResultsSeen(user.id, parsed.data);
}

/** The user stops an order. It says "too-late" when Zinc has gone too far to cancel. */
export async function cancelOrderAction(id: unknown): Promise<CancelOutcome | "unavailable"> {
  const user = await requireUser();
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return "not-found";
  try {
    const outcome = await cancelOrder(user.id, parsed.data, orderDepsFromEnv());
    revalidatePath("/dashboard");
    revalidatePath("/orders");
    return outcome;
  } catch (error) {
    if (error instanceof PaymentError || error instanceof FulfilmentError) return "unavailable";
    throw error;
  }
}
