import type { Suggestion } from "./suggestions";

/**
 * The second decision: buying a suggested listing. Both ways in end here: the user pressing
 * "Buy for me" on a suggestion, and the check finding a low product that has auto-buy on.
 *
 * NOT BUILT YET. This is the place it plugs in. What the buyer is given is a Suggestion read
 * from the database by id (never a link or price sent by the browser), and it must re-read
 * the product and the user's settings before spending anything: the suggestion is a snapshot,
 * and a product can be edited, hidden or have auto-buy switched off since the search.
 * See "What the next step must do with this" in docs/restock.md for what has to hold.
 */
export type PurchaseStart =
  | { status: "not-built"; message: string };
// The real thing adds its outcomes here, for example { status: "placed", ... } or { status: "refused", reason }.

export async function startPurchase(userId: string, suggestion: Suggestion): Promise<PurchaseStart> {
  void userId;
  void suggestion;
  return { status: "not-built", message: "Buying for you isn't set up yet." };
}
