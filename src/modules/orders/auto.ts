import { AUTO_RETRY_AFTER_DAYS, autoBuyBlockers, autoBuyDecision, factsFor } from "@/core/auto-buy";
import { monthStart } from "@/core/order-money";
import type { UserSettings } from "@/core/user-settings";
import { getInventory, type InventoryItem } from "@/modules/inventory/service";
import { listAutoBuySuggestions, runRestockAndAsk, type AskReport, type ProductSearch, type Suggestion } from "@/modules/restock";
import type { CheckOptions } from "@/modules/restock";
import { getUserSettings, platformLimits } from "@/modules/settings";
import { placeOrder, settleOrders, type OrderDeps } from "./pipeline";
import { recentOrderProblem, spentSince } from "./repo";

export type AutoBuyOutcome =
  | { status: "ordered"; orderId: string }
  /** Left as a suggestion for the user to decide; `reasons` say why we didn't buy. */
  | { status: "asked"; reasons: string[] };

/**
 * Decides whether auto-buy may buy one suggestion, from fresh data (the suggestion is a snapshot made
 * when the search ran: the estimate, the settings and the price range may all have changed since).
 * Anything that stops it leaves the suggestion for the user, with the reasons.
 */
export async function considerAutoBuy(suggestion: Suggestion, deps: OrderDeps, now: Date = new Date(), loaded?: AccountData): Promise<AutoBuyOutcome> {
  const { userId, pick } = suggestion;
  const { settings, inventory } = loaded ?? (await loadAccount(userId, now));
  const [spent, recentProblem] = await Promise.all([
    // Read fresh each time: the order before this one in the same run counts.
    spentSince(userId, monthStart(now)),
    recentOrderProblem(suggestion.productId, new Date(now.getTime() - AUTO_RETRY_AFTER_DAYS * 24 * 60 * 60 * 1000)),
  ]);
  const item = inventory.find((entry) => entry.product.id === suggestion.productId);
  if (!item) return { status: "asked", reasons: ["That product isn't being tracked any more"] };

  const facts = factsFor({ listing: pick, product: item.product, confidence: item.estimate.confidence, settings, spentThisMonthCents: spent, recentProblem, limits: platformLimits() });
  const reasons = autoBuyBlockers(facts);
  if (reasons.length > 0) return { status: "asked", reasons };

  const placed = await placeOrder({ userId, suggestion, source: "auto", decision: [autoBuyDecision(facts, pick.totalCents), suggestion.reason].filter(Boolean).join(" "), wholeOrderLimitCents: facts.wholeOrderLimitCents }, deps);
  return placed.status === "started" ? { status: "ordered", orderId: placed.orderId } : { status: "asked", reasons: [placed.message] };
}

/** What deciding about one user's suggestions needs. Read once per user per run. */
export interface AccountData {
  settings: UserSettings;
  inventory: InventoryItem[];
}

async function loadAccount(userId: string, now: Date): Promise<AccountData> {
  const [settings, inventory] = await Promise.all([getUserSettings(userId), getInventory(userId, now)]);
  return { settings, inventory };
}

export interface AutoBuyReport {
  ask: AskReport;
  /** Orders started this run. */
  ordered: { userId: string; productId: string; name: string; orderId: string }[];
  /** Suggestions auto-buy looked at and left for the user, with why. */
  asked: { userId: string; productId: string; name: string; reasons: string[] }[];
  /** How many in-flight orders were moved along first. */
  settled: number;
}

/**
 * The scheduled job: finish what is in flight, find the low products and store suggestions, then buy
 * the ones auto-buy is allowed to. Everything else stays a suggestion the user sees at their next login.
 */
export async function runAutoBuy(search: ProductSearch, options: CheckOptions, deps: OrderDeps, limit?: number): Promise<AutoBuyReport> {
  const settled = (await settleOrders(deps, { userId: options.userId })).checked;
  const ask = await runRestockAndAsk(search, options, limit);

  const now = ask.checkedAt;
  const report: AutoBuyReport = { ask, ordered: [], asked: [], settled };
  // Every open suggestion for a product with auto-buy on, not only the new ones: one kept from before
  // may be allowed now (the user connected PayPal, or raised a limit).
  const accounts = new Map<string, Promise<AccountData>>();
  for (const suggestion of await listAutoBuySuggestions(now, options.userId)) {
    if (!accounts.has(suggestion.userId)) accounts.set(suggestion.userId, loadAccount(suggestion.userId, now));
    const outcome = await considerAutoBuy(suggestion, deps, now, await accounts.get(suggestion.userId)!);
    const base = { userId: suggestion.userId, productId: suggestion.productId, name: suggestion.name };
    if (outcome.status === "ordered") report.ordered.push({ ...base, orderId: outcome.orderId });
    else report.asked.push({ ...base, reasons: outcome.reasons });
  }
  return report;
}
