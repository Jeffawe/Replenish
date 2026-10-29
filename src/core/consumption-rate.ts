const DAY_MS = 24 * 60 * 60 * 1000;

/** The only fields the rate calculation needs from a purchase event. */
export interface PurchasePoint {
  quantity: number;
  purchasedAt: Date;
}

/** A stock count the user gave us: "I have this much right now". */
export interface LevelObservation {
  remainingQuantity: number;
  recordedAt: Date;
}

/** Extra evidence beyond purchases that the rate can learn from. */
export interface RateEvidence {
  corrections?: LevelObservation[];
  /**
   * Typical amount at home when the user buys more; null or undefined means
   * unknown, which counts as 0. Only used as the starting stock of the stretch
   * leading up to the first correction.
   */
  typicalLeftoverAtPurchase?: number | null;
}

/**
 * Every tunable number in the rate calculation lives here. Change a value and
 * nothing else needs to change.
 */
export interface ConsumptionRateConfig {
  /** Only the most recent N purchases are used (so N - 1 intervals). */
  windowPurchases: number;
  /** Only the most recent N correction stretches are used. */
  windowCorrections: number;
  /** Purchases and corrections older than this, relative to `now`, are ignored. */
  maxAgeDays: number;
  /** Purchases closer together than this count as one (two receipts, two trips). */
  mergeWithinDays: number;
  /**
   * Outlier checks need at least this many intervals, so excluding one still
   * leaves enough to judge consistency.
   */
  minIntervalsForOutlierCheck: number;
  /** An interval rate below this fraction of the median looks like a missing receipt. */
  missingPurchaseRatio: number;
  /** An interval rate above this multiple of the median looks like an early top-up. */
  earlyPurchaseRatio: number;
  /**
   * A stretch measured from the user's stock counts whose rate is this many
   * times above or below the median looks like a mistyped count. Wider than
   * the purchase ratios because a count is usually the better evidence.
   */
  unlikelyCountRatio: number;
  /**
   * A stretch between two stock counts shorter than this is ignored: the
   * user's rounding ("about 3") would dominate the result.
   */
  minCorrectionStretchDays: number;
  /** Below this many intervals the spread is too unreliable to report an error. */
  minIntervalsForError: number;
}

export const DEFAULT_CONSUMPTION_RATE_CONFIG: ConsumptionRateConfig = {
  windowPurchases: 6,
  windowCorrections: 6,
  maxAgeDays: 365,
  mergeWithinDays: 1,
  minIntervalsForOutlierCheck: 4,
  missingPurchaseRatio: 0.6,
  earlyPurchaseRatio: 1.6,
  unlikelyCountRatio: 2.5,
  minCorrectionStretchDays: 5,
  minIntervalsForError: 3,
};

export type ExcludedReason =
  | "possible-missing-purchase"
  | "possible-early-purchase"
  /** A purchase interval replaced by a correction stretch covering the same days. */
  | "covered-by-correction"
  /** Stock went up between two counts with no purchase recorded to explain it. */
  | "stock-increased"
  /** A stock count implying a usage rate far from everything else, so probably a mistake. */
  | "unlikely-count"
  | "too-short";

/** One stretch of time with a known amount used; kept so the UI can explain the rate. */
export interface IntervalObservation {
  /** Where the evidence came from: a gap between purchases, or between stock counts. */
  kind: "purchases" | "correction";
  from: Date;
  to: Date;
  days: number;
  /**
   * Amount used up during the stretch. For purchase intervals this is the
   * quantity bought at `from`, assumed used up by `to`; for correction
   * stretches it is starting stock + bought - ending stock.
   */
  consumed: number;
  ratePerDay: number;
  /** Set when this interval was left out of the rate, and why. */
  excluded: ExcludedReason | null;
}

export interface ConsumptionRate {
  /** Units per day, or null when there is no usable history. */
  ratePerDay: number | null;
  /** Standard error of the rate in units per day, or null when there is too little data. */
  errorPerDay: number | null;
  /** errorPerDay / ratePerDay. */
  relativeError: number | null;
  /** Number of intervals that contributed to the rate. */
  intervalsUsed: number;
  /** Every interval considered, including excluded ones. */
  intervals: IntervalObservation[];
}

const EMPTY: ConsumptionRate = {
  ratePerDay: null,
  errorPerDay: null,
  relativeError: null,
  intervalsUsed: 0,
  intervals: [],
};

/**
 * How fast a product is used, learned from two kinds of evidence:
 *
 *   purchases:   quantity of a finished pack / days it lasted
 *   corrections: (stock at one count + bought since - stock at the next) / days between
 *
 * Correction stretches are exact, so where one covers the same days as a
 * purchase interval it replaces it. The latest purchase is left out of the
 * purchase intervals because it is still being used. Purchase intervals that
 * look like a missing receipt or an early top-up are dropped (once there are
 * enough intervals to tell), and the spread of what remains becomes the error.
 */
export function calculateConsumptionRate(
  purchases: PurchasePoint[],
  now: Date,
  overrides: Partial<ConsumptionRateConfig> = {},
  evidence: RateEvidence = {},
): ConsumptionRate {
  const config = { ...DEFAULT_CONSUMPTION_RATE_CONFIG, ...overrides };

  const allPurchases = cleanPurchases(purchases, now, config.mergeWithinDays, config.maxAgeDays);
  const levels = cleanLevels(evidence.corrections ?? [], now, config.maxAgeDays);

  const intervals = [
    ...purchaseIntervals(allPurchases.slice(-config.windowPurchases)),
    ...correctionStretches(
      allPurchases,
      levels,
      evidence.typicalLeftoverAtPurchase ?? 0,
      config,
    ).slice(-config.windowCorrections),
  ].sort((a, b) => a.from.getTime() - b.from.getTime());
  if (intervals.length === 0) return EMPTY;

  // Before a count's stretch can replace purchase gaps, check it isn't a mistyped number.
  flagUnlikelyCounts(intervals, config);

  // An exact correction stretch replaces any purchase interval over the same days.
  const stretches = intervals.filter((i) => i.kind === "correction" && i.excluded === null);
  for (const interval of intervals) {
    if (
      interval.kind === "purchases" &&
      stretches.some((s) => interval.from < s.to && interval.to > s.from)
    ) {
      interval.excluded = "covered-by-correction";
    }
  }

  flagOutliers(intervals, config);

  const kept = intervals.filter((i) => i.excluded === null);
  if (kept.length === 0) return { ...EMPTY, intervals };

  // Pooled: total used over total days, so long and short intervals count in proportion.
  const totalConsumed = kept.reduce((sum, i) => sum + i.consumed, 0);
  const totalDays = kept.reduce((sum, i) => sum + i.days, 0);
  const ratePerDay = totalConsumed / totalDays;

  let errorPerDay: number | null = null;
  let relativeError: number | null = null;
  if (kept.length >= config.minIntervalsForError) {
    const rates = kept.map((i) => i.ratePerDay);
    const standardError = sampleStdDev(rates) / Math.sqrt(rates.length);
    relativeError = standardError / mean(rates);
    errorPerDay = relativeError * ratePerDay;
  }

  return { ratePerDay, errorPerDay, relativeError, intervalsUsed: kept.length, intervals };
}

/** Each gap between consecutive purchases, assuming the earlier pack was used up. */
function purchaseIntervals(points: PurchasePoint[]): IntervalObservation[] {
  const intervals: IntervalObservation[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const days = (points[i + 1].purchasedAt.getTime() - points[i].purchasedAt.getTime()) / DAY_MS;
    intervals.push({
      kind: "purchases",
      from: points[i].purchasedAt,
      to: points[i + 1].purchasedAt,
      days,
      consumed: points[i].quantity,
      ratePerDay: points[i].quantity / days,
      excluded: null,
    });
  }
  return intervals;
}

/**
 * The stretch ending at each stock count. It starts at the previous count, or
 * for the first count at the latest purchase before it (starting stock =
 * typical leftover + that purchase). Exact, provided every purchase in the
 * stretch was recorded.
 */
function correctionStretches(
  purchases: PurchasePoint[],
  levels: LevelObservation[],
  leftover: number,
  config: ConsumptionRateConfig,
): IntervalObservation[] {
  const stretches: IntervalObservation[] = [];

  levels.forEach((level, k) => {
    let startAt: Date;
    let startStock: number;
    if (k > 0) {
      startAt = levels[k - 1].recordedAt;
      startStock = levels[k - 1].remainingQuantity;
    } else {
      const reference = [...purchases].reverse().find((p) => p.purchasedAt < level.recordedAt);
      if (!reference) return;
      startAt = reference.purchasedAt;
      startStock = leftover + reference.quantity;
    }

    const days = (level.recordedAt.getTime() - startAt.getTime()) / DAY_MS;
    if (days <= 0) return;

    const bought = purchases
      .filter((p) => p.purchasedAt > startAt && p.purchasedAt <= level.recordedAt)
      .reduce((sum, p) => sum + p.quantity, 0);
    const consumed = startStock + bought - level.remainingQuantity;

    stretches.push({
      kind: "correction",
      from: startAt,
      to: level.recordedAt,
      days,
      consumed,
      ratePerDay: consumed / days,
      excluded:
        consumed <= 0
          ? "stock-increased"
          : days < config.minCorrectionStretchDays
            ? "too-short"
            : null,
    });
  });

  return stretches;
}

/**
 * Flags stock-count stretches far from the median of all the evidence. A count
 * is normally the best evidence there is, so the bar is wider than for
 * purchases, but people mistype ("20" for "2"), and one bad count must not
 * decide the rate. As with purchases, nothing is flagged without enough
 * intervals to judge by, or when flagging would leave nothing.
 */
function flagUnlikelyCounts(intervals: IntervalObservation[], config: ConsumptionRateConfig): void {
  const candidates = intervals.filter((i) => i.excluded === null);
  if (candidates.length < config.minIntervalsForOutlierCheck) return;

  const typical = median(candidates.map((i) => i.ratePerDay));
  const flagged = candidates.filter(
    (i) =>
      i.kind === "correction" &&
      (i.ratePerDay > typical * config.unlikelyCountRatio || i.ratePerDay < typical / config.unlikelyCountRatio),
  );
  if (flagged.length === candidates.length) return;
  for (const interval of flagged) interval.excluded = "unlikely-count";
}

/**
 * Flags purchase intervals far from the median rate. Correction stretches
 * have their own, wider check (flagUnlikelyCounts), so they are not flagged here. If that would leave nothing, the flags
 * are cleared: when everything disagrees there is no "typical" to judge by.
 */
function flagOutliers(intervals: IntervalObservation[], config: ConsumptionRateConfig): void {
  const candidates = intervals.filter((i) => i.excluded === null);
  if (candidates.length < config.minIntervalsForOutlierCheck) return;

  const typical = median(candidates.map((i) => i.ratePerDay));
  const flagged: IntervalObservation[] = [];
  for (const interval of candidates) {
    if (interval.kind !== "purchases") continue;
    if (interval.ratePerDay < typical * config.missingPurchaseRatio) {
      interval.excluded = "possible-missing-purchase";
      flagged.push(interval);
    } else if (interval.ratePerDay > typical * config.earlyPurchaseRatio) {
      interval.excluded = "possible-early-purchase";
      flagged.push(interval);
    }
  }

  if (flagged.length === candidates.length) {
    for (const interval of flagged) interval.excluded = null;
  }
}

/**
 * Drops unusable purchases (invalid, non-positive, future-dated, older than
 * `maxAgeDays`), merges ones made close together, and returns them oldest first.
 */
export function cleanPurchases(
  purchases: PurchasePoint[],
  now: Date,
  mergeWithinDays: number,
  maxAgeDays = Infinity,
): PurchasePoint[] {
  const oldest = now.getTime() - maxAgeDays * DAY_MS;
  const mergeMs = Math.max(mergeWithinDays * DAY_MS, 1);

  const sorted = purchases
    .filter((p) => {
      const t = p.purchasedAt.getTime();
      return Number.isFinite(t) && Number.isFinite(p.quantity) && p.quantity > 0 && t >= oldest && t <= now.getTime();
    })
    .sort((a, b) => a.purchasedAt.getTime() - b.purchasedAt.getTime());

  const merged: PurchasePoint[] = [];
  for (const p of sorted) {
    const last = merged[merged.length - 1];
    if (last && p.purchasedAt.getTime() - last.purchasedAt.getTime() < mergeMs) {
      last.quantity += p.quantity;
    } else {
      merged.push({ quantity: p.quantity, purchasedAt: p.purchasedAt });
    }
  }
  return merged;
}

/** Valid stock counts within the age cap, oldest first. */
function cleanLevels(levels: LevelObservation[], now: Date, maxAgeDays: number): LevelObservation[] {
  const oldest = now.getTime() - maxAgeDays * DAY_MS;
  return levels
    .filter((l) => {
      const t = l.recordedAt.getTime();
      return Number.isFinite(t) && Number.isFinite(l.remainingQuantity) && l.remainingQuantity >= 0 && t >= oldest && t <= now.getTime();
    })
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleStdDev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}
