/** Small helpers for showing orders; kept free of anything browser-only so the server and browser agree. */

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "2026-11-08" -> "Nov 8". From the text, not a Date, so the server and the browser can't disagree on the time zone. */
export function shortDate(iso: string): string {
  const [, month, day] = iso.slice(0, 10).split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const name = names[Number(month) - 1];
  return name ? `${name} ${Number(day)}` : iso.slice(0, 10);
}

/** "$12.99 + $2.50 in fees, plus tax and shipping": a listing's price as it will really be charged. */
export function priceWithFees(itemsCents: number, feesCents: number): string {
  return `${money(itemsCents)} + ${money(feesCents)} in fees, plus tax and shipping`;
}

/** What became of the user's money on an order that didn't go ahead, in a sentence. */
export function refundLine(order: { paymentStatus: string; refundedCents: number }): string {
  if (order.paymentStatus === "refunded") return `${money(order.refundedCents)} was refunded to your PayPal.`;
  if (order.paymentStatus === "charged" || order.paymentStatus === "part-refunded") return "We're refunding your payment.";
  if (order.paymentStatus === "unknown") return "If you see a charge on your PayPal for this, tell us and we'll refund it.";
  return "You weren't charged.";
}

/** What a tracking status from a carrier reads like to a person. */
export function trackingStatus(status: string): string {
  const known: Record<string, string> = { pending: "Label created", in_transit: "On its way", out_for_delivery: "Out for delivery", delivered: "Delivered", exception: "Problem with delivery", failure: "Delivery failed" };
  return known[status] ?? status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** "2026-11" -> "November 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split("-");
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = names[Number(number) - 1];
  return name ? `${name} ${year}` : month;
}
