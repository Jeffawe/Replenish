import { leastOrderCostCents, priceBreakdown } from "./order-money";
import { CONCERN_LABELS, isWantedStore, type Concern, type Wanted } from "./pick-offer";
import { DEFAULT_PLATFORM_LIMITS, effectiveLimit, priceRangeFor, type PlatformLimits, type UserSettings } from "./user-settings";

/**
 * Whether auto-buy may spend money on a listing without asking, and why not. The answer is a list of
 * reasons: empty means go ahead. Every limit falls back to asking the user, so a reason never means
 * "do nothing", only "ask instead" (the suggestion stays on the dashboard with the reason).
 */

/** After an order goes wrong, auto-buy leaves that product to the user for this long instead of charging them again on the next run. */
export const AUTO_RETRY_AFTER_DAYS = 7;

export interface AutoBuyFacts {
  /** The user has confirmed they track this product (a receipt's guess isn't enough to spend on). */
  confirmed: boolean;
  autobuyEnabled: boolean;
  /** The estimate's confidence now, 0 to 1. */
  confidence: number;
  /** The user's minimum confidence (never below the 80% floor). */
  minConfidence: number;
  /** Whether the whole order, fees included, is inside the price range that applies to the product, worked out now. */
  withinRange: boolean;
  /** Anything questionable about the listing (see pick-offer). */
  concerns: Concern[];
  /** The user's cap for the month, or null for none. */
  monthlyCapCents: number | null;
  /** Already spent or committed this calendar month. */
  spentThisMonthCents: number;
  /** What this order would charge. */
  chargeCents: number;
  /** An order for this product went wrong lately, or the user cancelled one: leave it to them. */
  recentProblem?: "failed" | "cancelled" | null;
  /** The whole order would be over the most we let auto-buy spend on one order, in cents. */
  overPlatformOrderCents?: number | null;
  /** `monthlyCapCents` is our limit rather than one the user set. */
  monthlyCapIsPlatform?: boolean;
}

/** What a listing needs to say for these facts to be worked out. */
export interface ListingFacts {
  domain: string;
  totalCents: number;
  concerns: Concern[];
}

/**
 * The facts about buying a listing, from the settings as they are now. A suggestion is a snapshot,
 * so its price and store concerns are worked out again: raising a limit or changing stores takes
 * effect at once, not when the search next runs. Size and brand come from the listing and stand.
 */
export function factsFor(input: {
  listing: ListingFacts;
  product: { confirmedAt: unknown; autobuyEnabled: boolean; autobuyMinPriceCents: number | null; autobuyMaxPriceCents: number | null; boughtFrom: string | null; boughtFromByUser: boolean };
  confidence: number;
  settings: Pick<UserSettings, "autobuyMinConfidence" | "autobuyMinPriceCents" | "autobuyMaxPriceCents" | "autobuyMonthlyCapCents" | "preferredStores">;
  spentThisMonthCents: number;
  recentProblem?: AutoBuyFacts["recentProblem"];
  limits?: Pick<PlatformLimits, "orderCents" | "monthCents">;
}): AutoBuyFacts & { wholeOrderLimitCents: number | null } {
  const { listing, product, settings, limits = DEFAULT_PLATFORM_LIMITS } = input;
  const range = priceRangeFor(settings, product);
  const orderLimit = effectiveLimit(range.maxCents, limits.orderCents);
  const monthLimit = effectiveLimit(settings.autobuyMonthlyCapCents, limits.monthCents);
  const least = leastOrderCostCents(listing.totalCents);
  const wanted: Pick<Wanted, "store" | "storeIsGuess" | "preferredStores"> = { store: product.boughtFrom, storeIsGuess: !product.boughtFromByUser, preferredStores: settings.preferredStores };
  const concerns: Concern[] = [
    ...listing.concerns.filter((concern) => concern !== "outside-price-range" && concern !== "other-store"),
    ...(isWantedStore(wanted, listing.domain) ? [] : ["other-store" as const]),
  ];
  return {
    confirmed: product.confirmedAt !== null,
    autobuyEnabled: product.autobuyEnabled,
    confidence: input.confidence,
    minConfidence: settings.autobuyMinConfidence,
    withinRange: (range.minCents === null || listing.totalCents >= range.minCents) && (range.maxCents === null || least <= range.maxCents),
    concerns,
    monthlyCapCents: monthLimit,
    monthlyCapIsPlatform: settings.autobuyMonthlyCapCents === null || settings.autobuyMonthlyCapCents > limits.monthCents,
    spentThisMonthCents: input.spentThisMonthCents,
    chargeCents: priceBreakdown(listing.totalCents, orderLimit).heldCents,
    recentProblem: input.recentProblem ?? null,
    overPlatformOrderCents: least > limits.orderCents ? limits.orderCents : null,
    wholeOrderLimitCents: orderLimit,
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Why auto-buy can't go ahead, in words for the user. Empty means it can. */
export function autoBuyBlockers(facts: AutoBuyFacts): string[] {
  const reasons: string[] = [];
  if (!facts.autobuyEnabled) reasons.push("Auto-buy is off for this product");
  if (!facts.confirmed) reasons.push("You haven't confirmed you track this product");
  if (facts.recentProblem === "failed") reasons.push("Our last try at buying this didn't go through, so it's waiting for you");
  if (facts.recentProblem === "cancelled") reasons.push("You cancelled an order for this recently, so it's waiting for you");
  if (facts.confidence < facts.minConfidence) {
    reasons.push(`We're only ${percent(facts.confidence)} sure it's running out, and your minimum is ${percent(facts.minConfidence)}`);
  }
  // The price range has its own concern; saying it twice would just repeat it.
  if (!facts.withinRange && !facts.concerns.includes("outside-price-range")) reasons.push(CONCERN_LABELS["outside-price-range"]);
  for (const concern of facts.concerns) reasons.push(CONCERN_LABELS[concern]);
  if (facts.overPlatformOrderCents) reasons.push(`It's over the ${dollars(facts.overPlatformOrderCents)} most auto-buy can spend on one order`);
  if (facts.monthlyCapCents !== null && facts.spentThisMonthCents + facts.chargeCents > facts.monthlyCapCents) {
    reasons.push(facts.monthlyCapIsPlatform ? `It would go over the ${dollars(facts.monthlyCapCents)} auto-buy can spend in a month` : `It would go over your ${dollars(facts.monthlyCapCents)} limit for the month`);
  }
  return reasons;
}

/** What we tell the user when auto-buy went ahead. */
export function autoBuyDecision(facts: Pick<AutoBuyFacts, "confidence" | "minConfidence">, itemsCents: number): string {
  return `Auto-buy: ${percent(facts.confidence)} sure it was running out (your minimum is ${percent(facts.minConfidence)}) and ${dollars(itemsCents)} for the items is inside your limits.`;
}
