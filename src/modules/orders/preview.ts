import { isAbandoned } from "@/core/abandoned";
import { AUTO_RETRY_AFTER_DAYS, autoBuyBlockers, factsFor } from "@/core/auto-buy";
import type { InventoryEstimate } from "@/core/estimate";
import { monthStart, orderFeesCents } from "@/core/order-money";
import { needsAttention } from "@/core/next-check";
import { buildItem, type InventoryItem } from "@/modules/inventory/item";
import { getInventory } from "@/modules/inventory/service";
import { storedListings, type Suggestion } from "@/modules/restock";
import { getUserSettings, platformLimits } from "@/modules/settings";
import { recentOrderProblem, spentSince } from "./repo";
import { ordersOnTheWay } from "./service";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_DAYS = 7;

/** What auto-buy would have done about one product, had it been on. */
export type PreviewRow = {
  productId: string;
  name: string;
  /** The day it first needed attention this week. */
  at: string;
  /** The user's own switch: the rest of the row is what would happen with it on, either way. */
  enabled: boolean;
} & (
  | { outcome: "buy"; store: string; title: string; itemsCents: number; feesCents: number; chargeCents: number; sample: boolean; boughtYourselfAt: string | null }
  /** It would have stopped and asked. */
  | { outcome: "ask"; reasons: string[] }
  /** No listing stored yet: it would have searched then, and we don't spend a search to find out. */
  | { outcome: "search" }
);

export interface AutoBuyPreview {
  rows: PreviewRow[];
  /** Tracked products that didn't need anything this week. */
  quiet: number;
  days: number;
}

/** The first day in the past week this product needed attention, going by only what was known that day. */
function firstNeededOn(item: InventoryItem, leadDays: number, threshold: number | null, now: Date): { at: Date; estimate: InventoryEstimate } | null {
  for (let back = WEEK_DAYS; back >= 0; back--) {
    const at = new Date(now.getTime() - back * DAY_MS);
    const known = item.purchases.filter((purchase) => purchase.purchasedAt <= at);
    const counts = item.corrections.filter((count) => count.recordedAt <= at);
    const { estimate } = buildItem(item.product, known, counts, at, threshold);
    if (needsAttention(estimate, leadDays)) return { at, estimate };
  }
  return null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * What auto-buy would have done this past week, so a user can see it before trusting it. Replays each
 * product's history day by day, then applies the same rules auto-buy uses. It looks at every tracked
 * product as if its switch were on. Buys nothing, searches nothing and stores nothing: it costs no
 * credits, and a product with no stored listing just says it would have looked. PayPal and the address
 * are left out on purpose: this is for before they are set up.
 */
export async function previewAutoBuy(userId: string, now: Date = new Date()): Promise<AutoBuyPreview> {
  const [inventory, settings, listings, onTheWay, spentAtStart] = await Promise.all([
    getInventory(userId, now),
    getUserSettings(userId),
    storedListings(userId),
    ordersOnTheWay(userId, now),
    spentSince(userId, monthStart(now)),
  ]);

  const rows: PreviewRow[] = [];
  let quiet = 0;
  let spent = spentAtStart;
  for (const item of inventory) {
    const { product } = item;
    const first = onTheWay.has(product.id) ? null : firstNeededOn(item, settings.autobuyLeadDays, settings.lowStockThresholdDays, now);
    if (!first || isAbandoned(first.estimate, first.at)) {
      quiet++;
      continue;
    }
    const base = { productId: product.id, name: product.name, at: isoDay(first.at), enabled: product.autobuyEnabled };
    const listing: Suggestion["pick"] | undefined = listings.get(product.id);
    if (!listing) {
      rows.push({ ...base, outcome: "search" });
      continue;
    }
    const recentProblem = await recentOrderProblem(product.id, new Date(first.at.getTime() - AUTO_RETRY_AFTER_DAYS * DAY_MS));
    const facts = factsFor({
      listing,
      // As if the switch were on: the user wants to know what turning it on would do.
      product: { ...product, autobuyEnabled: true },
      confidence: first.estimate.confidence,
      settings,
      spentThisMonthCents: spent,
      recentProblem,
      limits: platformLimits(),
    });
    const reasons = autoBuyBlockers(facts);
    if (reasons.length > 0) {
      rows.push({ ...base, outcome: "ask", reasons });
      continue;
    }
    spent += facts.chargeCents;
    const later = item.purchases.find((purchase) => purchase.purchasedAt > first.at && purchase.source !== "agent");
    rows.push({ ...base, outcome: "buy", store: listing.domain, title: listing.title, itemsCents: listing.totalCents, feesCents: orderFeesCents(listing.totalCents), chargeCents: facts.chargeCents, sample: listing.sample, boughtYourselfAt: later ? isoDay(later.purchasedAt) : null });
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return { rows, quiet, days: WEEK_DAYS };
}
