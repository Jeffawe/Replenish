/**
 * The part of restock a browser component may import: the shapes of a suggestion and the plain-
 * language labels for a listing's concerns. Everything else comes from "@/modules/restock" (server only).
 */
import type { Concern } from "@/core/pick-offer";

export type { Concern } from "@/core/pick-offer";
export type { Suggestion } from "./suggestions";

/** What each concern means to the user, short enough for a tag next to a listing. */
export const CONCERN_LABELS: Record<Concern, string> = {
  "outside-price-range": "Over your price limit",
  "size-unknown": "Pack size not stated",
  "size-differs": "Different pack size than usual",
  "other-brand": "Different brand",
  "other-store": "Not your usual store",
};
