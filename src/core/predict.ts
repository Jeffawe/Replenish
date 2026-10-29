import {
  calculateConsumptionRate,
  cleanPurchases,
  DEFAULT_CONSUMPTION_RATE_CONFIG,
  type ConsumptionRate,
  type ConsumptionRateConfig,
  type PurchasePoint,
} from "./consumption-rate";
import type { ConfidenceFactor, InventoryEstimate } from "./estimate";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every tunable number in the prediction lives here (the rate has its own
 * config in consumption-rate.ts). Change a value and nothing else needs to change.
 */
export interface PredictConfig {
  /** Overrides for the consumption-rate calculation. */
  rate: Partial<ConsumptionRateConfig>;
  /** Used when neither the product nor the user sets a low-stock threshold. */
  defaultLowStockThresholdDays: number;
  /** Judge "low" by the earliest plausible run-out date instead of the central estimate. */
  lowStockUsesEarliestEstimate: boolean;
  /**
   * A correction made this many days (or fewer) before a purchase is used as
   * the leftover stock at that purchase, in place of the typical leftover.
   */
  correctionFreshDays: number;

  /** Confidence by number of intervals used (index 0 = one interval, last = that many or more). */
  confidenceByIntervals: number[];
  /** Confidence when the rate comes from the user's "lasts about N days" fallback. */
  fallbackRateConfidence: number;
  /** Confidence lost per unit of relative error: factor = 1 - penalty * relativeError. */
  errorPenalty: number;
  /** Multiplier applied for each interval dropped as a possible missing receipt or top-up. */
  excludedIntervalFactor: number;
  /** Lowest the "overdue" factor can go. */
  overdueFloor: number;
  /** How many recent corrections are used to judge past accuracy. */
  accuracyWindow: number;
  /** Confidence lost per pack-size of average past error: factor = 1 - penalty * averageError. */
  accuracyPenalty: number;
  accuracyFloor: number;
  /**
   * A stock count further than this many usual purchases from what we
   * predicted at the time is "disputed": still used (the user is looking at the
   * shelf), but trusted less until another answer backs it up.
   */
  disputedCountPacks: number;
  /** Starting-stock factors: user-confirmed, disputed (see above), known leftover, or assumed to be 0. */
  startingStockConfirmed: number;
  startingStockDisputed: number;
  startingStockKnown: number;
  startingStockAssumed: number;
}

export const DEFAULT_PREDICT_CONFIG: PredictConfig = {
  rate: {},
  defaultLowStockThresholdDays: 7,
  lowStockUsesEarliestEstimate: false,
  correctionFreshDays: 14,

  confidenceByIntervals: [0.5, 0.7, 0.85, 1],
  fallbackRateConfidence: 0.3,
  errorPenalty: 2,
  excludedIntervalFactor: 0.9,
  overdueFloor: 0.2,
  accuracyWindow: 5,
  accuracyPenalty: 2,
  accuracyFloor: 0.3,
  disputedCountPacks: 1,
  startingStockConfirmed: 1,
  startingStockDisputed: 0.6,
  startingStockKnown: 0.95,
  startingStockAssumed: 0.85,
};

/** The product fields prediction reads. */
export interface PredictProduct {
  id: string;
  unit: string;
  normalPurchaseQty: number;
  fallbackDaysPerPurchase: number | null;
  lowStockThresholdDays: number | null;
  typicalLeftoverAtPurchase: number | null;
}

/** The correction fields prediction reads. */
export interface CorrectionPoint {
  remainingQuantity: number;
  recordedAt: Date;
  /** What we predicted when the user corrected us, if recorded. */
  estimatedAtTime: number | null;
}

export interface PredictInput {
  product: PredictProduct;
  purchases: PurchasePoint[];
  corrections: CorrectionPoint[];
  now: Date;
  /** The user's own low-stock threshold, used when the product has no override. */
  userLowStockThresholdDays?: number;
}

type StartingStock = "confirmed" | "disputed" | "known" | "assumed";

interface Anchor {
  kind: "purchase" | "correction";
  at: Date;
  /** Stock level at `at`. */
  quantity: number;
  startingStock: StartingStock;
  /** Plain-language note on where the stock level came from. */
  detail: string;
}

/**
 * Estimates how much of a product the user has left, when it runs out, and how
 * sure we are. Pure: derives everything from the inputs, stores nothing.
 *
 *   remaining(now)  = stock at the anchor - rate * days since the anchor
 *   days until out  = stock at the anchor / rate - days since the anchor
 *
 * The anchor is the latest purchase (leftover + quantity bought) or the latest
 * correction (the number the user gave us), whichever is newer.
 */
export function predict(
  input: PredictInput,
  overrides: Partial<PredictConfig> = {},
): InventoryEstimate {
  const config = { ...DEFAULT_PREDICT_CONFIG, ...overrides };
  const { product, now } = input;
  const mergeWithinDays = {
    ...DEFAULT_CONSUMPTION_RATE_CONFIG,
    ...config.rate,
  }.mergeWithinDays;

  const rate = calculateConsumptionRate(input.purchases, now, config.rate, {
    corrections: input.corrections,
    typicalLeftoverAtPurchase: product.typicalLeftoverAtPurchase,
  });
  const { ratePerDay, source } = resolveRate(rate, product);

  const purchases = cleanPurchases(input.purchases, now, mergeWithinDays);
  const corrections = cleanCorrections(input.corrections, now);
  const anchor = findAnchor(purchases, corrections, ratePerDay, product, config);

  const thresholdDays =
    product.lowStockThresholdDays ??
    input.userLowStockThresholdDays ??
    config.defaultLowStockThresholdDays;

  const base = {
    productId: product.id,
    unit: product.unit,
    normalPurchaseQty: product.normalPurchaseQty,
    rate,
    rateSource: source,
    lowStockThresholdDays: thresholdDays,
    purchaseCount: purchases.length,
    anchor: anchor && {
      kind: anchor.kind,
      at: anchor.at,
      quantity: anchor.quantity,
      disputed: anchor.startingStock === "disputed",
    },
  };

  if (ratePerDay === null) {
    return {
      ...base,
      estimatedRemaining: null,
      consumptionPerDay: null,
      consumptionError: null,
      daysUntilRunOut: null,
      daysUntilRunOutRange: null,
      confidence: 0,
      confidenceFactors: [
        factor(
          "Purchase history",
          0,
          "Not enough purchases to learn a usage rate, and no 'lasts about N days' fallback is set.",
        ),
      ],
      isLow: false,
    };
  }

  const error = source === "history" ? rate.errorPerDay : null;

  // With no known stock level there is nothing to project from.
  if (!anchor) {
    return {
      ...base,
      estimatedRemaining: null,
      consumptionPerDay: ratePerDay,
      consumptionError: error,
      daysUntilRunOut: null,
      daysUntilRunOutRange: null,
      confidence: 0,
      confidenceFactors: [
        factor("Starting stock", 0, "No purchase or correction to start from.", true),
      ],
      isLow: false,
    };
  }

  const daysSince = (now.getTime() - anchor.at.getTime()) / DAY_MS;
  const estimatedRemaining = Math.max(0, anchor.quantity - ratePerDay * daysSince);
  const daysUntil = (r: number) => Math.max(0, anchor.quantity / r - daysSince);
  const daysUntilRunOut = daysUntil(ratePerDay);

  const daysUntilRunOutRange =
    error === null
      ? null
      : {
          earliest: daysUntil(ratePerDay + error),
          latest: ratePerDay - error > 0 ? daysUntil(ratePerDay - error) : null,
        };

  const judgedDays =
    config.lowStockUsesEarliestEstimate && daysUntilRunOutRange
      ? daysUntilRunOutRange.earliest
      : daysUntilRunOut;

  const confidenceFactors = buildConfidenceFactors({
    rate,
    source,
    anchor,
    daysSince,
    ratePerDay,
    product,
    corrections,
    config,
  });
  const confidence = clamp(
    confidenceFactors.reduce((total, f) => total * f.value, 1),
    0,
    1,
  );

  return {
    ...base,
    estimatedRemaining,
    consumptionPerDay: ratePerDay,
    consumptionError: error,
    daysUntilRunOut,
    daysUntilRunOutRange,
    confidence,
    confidenceFactors,
    isLow: judgedDays <= thresholdDays,
  };
}

/** Prefers the rate learned from history, then the user's fallback. */
function resolveRate(
  rate: ConsumptionRate,
  product: PredictProduct,
): { ratePerDay: number | null; source: InventoryEstimate["rateSource"] } {
  if (rate.ratePerDay !== null) return { ratePerDay: rate.ratePerDay, source: "history" };
  if (
    product.fallbackDaysPerPurchase &&
    product.fallbackDaysPerPurchase > 0 &&
    product.normalPurchaseQty > 0
  ) {
    return {
      ratePerDay: product.normalPurchaseQty / product.fallbackDaysPerPurchase,
      source: "fallback",
    };
  }
  return { ratePerDay: null, source: "none" };
}

function cleanCorrections(corrections: CorrectionPoint[], now: Date): CorrectionPoint[] {
  return corrections
    .filter((c) => {
      const t = c.recordedAt.getTime();
      return Number.isFinite(t) && t <= now.getTime() && Number.isFinite(c.remainingQuantity) && c.remainingQuantity >= 0;
    })
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

/** The newer of the latest purchase and the latest correction. */
function findAnchor(
  purchases: PurchasePoint[],
  corrections: CorrectionPoint[],
  ratePerDay: number | null,
  product: PredictProduct,
  config: PredictConfig,
): Anchor | null {
  const lastPurchase = purchases[purchases.length - 1];
  const lastCorrection = corrections[corrections.length - 1];

  // A correction made after the purchase is the user's own number: it wins,
  // though one far from what we expected may be a typo, so it is trusted less.
  if (lastCorrection && (!lastPurchase || lastCorrection.recordedAt >= lastPurchase.purchasedAt)) {
    const disputed = isDisputed(lastCorrection, product, config);
    return {
      kind: "correction",
      at: lastCorrection.recordedAt,
      quantity: lastCorrection.remainingQuantity,
      startingStock: disputed ? "disputed" : "confirmed",
      detail: disputed
        ? "You told us how much was left, but it was far from what we expected, so we'll check it with you."
        : "You told us how much was left.",
    };
  }
  if (!lastPurchase) return null;

  // Leftover at the purchase: a recent correction before it, else the typical leftover, else 0.
  const before = [...corrections]
    .reverse()
    .find((c) => c.recordedAt < lastPurchase.purchasedAt);
  const daysBefore = before
    ? (lastPurchase.purchasedAt.getTime() - before.recordedAt.getTime()) / DAY_MS
    : null;

  let leftover: number;
  let startingStock: StartingStock;
  let detail: string;
  if (before && daysBefore !== null && daysBefore <= config.correctionFreshDays) {
    leftover = Math.max(0, before.remainingQuantity - (ratePerDay ?? 0) * daysBefore);
    startingStock = "known";
    detail = "Leftover at purchase comes from your recent answer.";
  } else if (product.typicalLeftoverAtPurchase !== null) {
    leftover = product.typicalLeftoverAtPurchase;
    startingStock = "known";
    detail = "Leftover at purchase uses your typical amount left when buying.";
  } else {
    leftover = 0;
    startingStock = "assumed";
    detail = "Assumes nothing was left when you bought it.";
  }

  return {
    kind: "purchase",
    at: lastPurchase.purchasedAt,
    quantity: leftover + lastPurchase.quantity,
    startingStock,
    detail,
  };
}

/** Whether a stock count is far enough from what we predicted at the time that it may be a mistake. */
function isDisputed(correction: CorrectionPoint, product: PredictProduct, config: PredictConfig): boolean {
  if (correction.estimatedAtTime === null || product.normalPurchaseQty <= 0) return false;
  const gap = Math.abs(correction.remainingQuantity - correction.estimatedAtTime);
  return gap > config.disputedCountPacks * product.normalPurchaseQty;
}

interface ConfidenceContext {
  rate: ConsumptionRate;
  source: InventoryEstimate["rateSource"];
  anchor: Anchor;
  daysSince: number;
  ratePerDay: number;
  product: PredictProduct;
  corrections: CorrectionPoint[];
  config: PredictConfig;
}

/** Each factor is a 0..1 multiplier; confidence is their product, so one weak factor drags it down. */
function buildConfidenceFactors(ctx: ConfidenceContext): ConfidenceFactor[] {
  const { rate, source, anchor, daysSince, ratePerDay, product, corrections, config } = ctx;
  const factors: ConfidenceFactor[] = [];

  // 1. How much history the rate is based on.
  if (source === "fallback") {
    factors.push(
      factor(
        "Purchase history",
        config.fallbackRateConfidence,
        "Too few purchases to learn a rate, so this uses your 'lasts about N days' estimate.",
      ),
    );
  } else {
    const table = config.confidenceByIntervals;
    const value = table[Math.min(rate.intervalsUsed, table.length) - 1];
    const counted = rate.intervals.filter((i) => i.kind === "correction" && i.excluded === null).length;
    factors.push(
      factor(
        "Purchase history",
        value,
        `Rate is based on ${rate.intervalsUsed} stretch${rate.intervalsUsed === 1 ? "" : "es"} of time` +
          (counted > 0 ? `, ${counted} of them measured from your own stock counts.` : " between purchases."),
      ),
    );
  }

  // 2. How consistently the user buys (only measurable with enough intervals).
  if (source === "history" && rate.relativeError !== null) {
    const value = clamp(1 - config.errorPenalty * rate.relativeError, 0, 1);
    factors.push(
      factor(
        "Consistency",
        value,
        `Usage varies by about ${Math.round(rate.relativeError * 100)}% between purchases.`,
      ),
    );
  }

  // 3. Purchase gaps dropped as suspicious (not ones simply replaced by a stock count).
  const excluded = rate.intervals.filter(
    (i) => i.excluded === "possible-missing-purchase" || i.excluded === "possible-early-purchase",
  ).length;
  if (source === "history" && excluded > 0) {
    factors.push(
      factor(
        "Unusual purchases",
        config.excludedIntervalFactor ** excluded,
        `${excluded} purchase gap${excluded === 1 ? "" : "s"} looked like a missing receipt or an early top-up and ${excluded === 1 ? "was" : "were"} ignored.`,
      ),
    );
  }

  // 4. Overdue: past the expected run-out with nothing new, so the user probably bought elsewhere.
  const expectedDays = anchor.quantity / ratePerDay;
  const overdueDays = daysSince - expectedDays;
  if (overdueDays > 0) {
    const packDays = product.normalPurchaseQty / ratePerDay;
    factors.push(
      factor(
        "Overdue",
        clamp(1 - overdueDays / packDays, config.overdueFloor, 1),
        `Expected to run out ${Math.round(overdueDays)} days ago with no new purchase or answer recorded.`,
      ),
    );
  }

  // 5. How accurate past estimates were, from the user's corrections.
  const errors = corrections
    .filter((c) => c.estimatedAtTime !== null)
    .slice(-config.accuracyWindow)
    .map((c) => Math.abs(c.estimatedAtTime! - c.remainingQuantity) / product.normalPurchaseQty);
  if (errors.length > 0) {
    const averageError = errors.reduce((a, b) => a + b, 0) / errors.length;
    factors.push(
      factor(
        "Past accuracy",
        clamp(1 - config.accuracyPenalty * averageError, config.accuracyFloor, 1),
        `Past estimates were off by about ${Math.round(averageError * 100)}% of a pack on average.`,
      ),
    );
  }

  // 6. How well we know the stock level the estimate starts from.
  const startingValue = {
    confirmed: config.startingStockConfirmed,
    disputed: config.startingStockDisputed,
    known: config.startingStockKnown,
    assumed: config.startingStockAssumed,
  }[anchor.startingStock];
  factors.push(factor("Starting stock", startingValue, anchor.detail));

  return factors;
}

function factor(
  label: string,
  value: number,
  detail: string,
  neutral = false,
): ConfidenceFactor {
  const effect = neutral ? "neutral" : value >= 0.95 ? "positive" : value >= 0.7 ? "neutral" : "negative";
  return { label, value, effect, detail };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
