import type { ConsumptionRate } from "./consumption-rate";

/** One reason behind the confidence number, so the UI can explain it. */
export interface ConfidenceFactor {
  label: string;
  /** Multiplier (0..1) this factor applies to the confidence. */
  value: number;
  effect: "positive" | "negative" | "neutral";
  detail: string;
}

/** Derived on read from purchase history; never stored. */
export interface InventoryEstimate {
  productId: string;
  unit: string;
  normalPurchaseQty: number;
  /** Null when there is no starting point or no usage rate to project from. */
  estimatedRemaining: number | null;
  consumptionPerDay: number | null;
  /** Standard error of the rate; null when it can't be estimated. */
  consumptionError: number | null;
  /** Where the rate came from: learned from purchases and stock counts, the user's fallback, or unknown. */
  rateSource: "history" | "fallback" | "none";
  /** The full rate calculation, including intervals, for explaining the prediction. */
  rate: ConsumptionRate;
  daysUntilRunOut: number | null;
  /** Range implied by the rate error; `latest` is null when the error is as large as the rate. */
  daysUntilRunOutRange: { earliest: number; latest: number | null } | null;
  confidence: number; // 0..1
  confidenceFactors: ConfidenceFactor[];
  isLow: boolean;
  lowStockThresholdDays: number;
  /** The known stock level the estimate is projected from. */
  anchor: { kind: "purchase" | "correction"; at: Date; quantity: number } | null;
  purchaseCount: number;
}
