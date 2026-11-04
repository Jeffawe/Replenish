import type { Concern, PickedOffer } from "@/core/pick-offer";
import type { LowStockCheck } from "./check";
import type { Finding, RestockResult } from "./find";

/**
 * What a restock run hands to the next step: plain data (no database rows, JSON-safe), so the
 * step that buys or asks can be written and tested without this module's insides, and a run
 * can be printed or returned from a route as it is.
 */

/** One store's listing of the product, chosen or kept as an alternative. */
export interface RestockListing {
  title: string;
  brands: string[];
  /** The store: "walmart.com". */
  domain: string;
  /** Where to buy it (Channel3's link to the store's page). */
  url: string;
  imageUrl: string | null;
  /** Channel3's id for the product, the same across stores. */
  channel3Id: string;
  currency: string;
  /** Price of one pack. */
  priceCents: number;
  /** Units in one pack; null when the title doesn't say. */
  packSize: number | null;
  /** Packs to order to get the usual amount. */
  packs: number;
  /** What the order costs: packs times the pack price. */
  totalCents: number;
  /** Whether the whole order fits the price range that applies to this product. */
  withinRange: boolean;
  /** Reasons to ask the user instead of buying. Empty means nothing is questionable. */
  concerns: Concern[];
  /** Invented by a sandbox or a mock, not a real offer. Never show it to the user as one. */
  sample: boolean;
}

/** What the search found for a product. */
export type RestockOutcome =
  | { status: "found"; pick: RestockListing; alternatives: RestockListing[]; reason: string | null }
  /** "no-results": nothing came back. "no-usable-listing": listings came back, but none in stock, new and the same kind of thing. */
  | { status: "none"; reason: "no-results" | "no-usable-listing" }
  | { status: "error"; message: string };

/** A low product and what the search found for it. */
export type RestockItem = {
  userId: string;
  productId: string;
  name: string;
  brand: string | null;
  unit: string;
  /** Where it is usually bought, as the user or a receipt wrote it. */
  boughtFrom: string | null;
  /** Confirmed products are the only ones auto-buy may buy. */
  confirmed: boolean;
  autobuyEnabled: boolean;
  /** How many units one purchase usually is. */
  usualQuantity: number;
  estimate: {
    daysUntilRunOut: number | null;
    estimatedRemaining: number | null;
    confidence: number;
    rateSource: "history" | "fallback" | "none";
  };
  /** What was searched for, and how many store listings came back (before any were dropped). */
  query: string;
  listings: number;
} & RestockOutcome;

export interface RestockReport {
  /** When the low-stock check ran. */
  checkedAt: Date;
  /** How many due products the check looked at. */
  checked: number;
  /** More products were due than one run takes; the next run gets them. */
  moreDue: boolean;
  /** One entry per low product that was searched. */
  items: RestockItem[];
  /** Low products not searched this run because the search limit was reached; they stay low, so the next run gets them. */
  skipped: { userId: string; productId: string; name: string }[];
  /** Accounts the check could not read. */
  errors: LowStockCheck["errors"];
}

function toListing(offer: PickedOffer): RestockListing {
  const { candidate } = offer;
  return {
    title: candidate.title,
    brands: candidate.brands,
    domain: candidate.domain,
    url: candidate.url,
    imageUrl: candidate.imageUrl,
    channel3Id: candidate.id,
    currency: candidate.currency,
    priceCents: candidate.priceCents,
    packSize: offer.packSize,
    packs: offer.packs,
    totalCents: offer.totalCents,
    withinRange: offer.withinRange,
    concerns: offer.concerns,
    sample: candidate.sample === true,
  };
}

function outcomeOf(finding: Finding): RestockOutcome {
  if (finding.status === "found") return { status: "found", pick: toListing(finding.pick), alternatives: finding.alternatives.map(toListing), reason: finding.reason };
  if (finding.status === "none") return { status: "none", reason: finding.reason };
  return { status: "error", message: finding.message };
}

export function toRestockItem({ low, finding }: RestockResult): RestockItem {
  const { userId, product, estimate } = low;
  return {
    userId,
    productId: product.id,
    name: product.name,
    brand: product.brand,
    unit: product.unit,
    boughtFrom: product.boughtFrom,
    confirmed: product.confirmedAt !== null,
    autobuyEnabled: product.autobuyEnabled,
    usualQuantity: estimate.normalPurchaseQty,
    estimate: {
      daysUntilRunOut: estimate.daysUntilRunOut,
      estimatedRemaining: estimate.estimatedRemaining,
      confidence: estimate.confidence,
      rateSource: estimate.rateSource,
    },
    query: finding.query,
    listings: finding.status === "error" ? 0 : finding.listings,
    ...outcomeOf(finding),
  };
}
