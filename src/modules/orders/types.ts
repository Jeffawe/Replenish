import { z } from "zod";

/** What was bought: a snapshot of the listing when the order was placed (it comes from a search service, so it is read back through a schema). */
export const ListingSchema = z.object({
  title: z.string(),
  domain: z.string(),
  // Rendered as a link, so only web links are accepted.
  url: z.string().refine((value) => /^https?:\/\//i.test(value), "must be a web link"),
  brand: z.string().nullable(),
  priceCents: z.number(),
  packSize: z.number().nullable(),
  /** Invented by a sandbox or a mock, not a real offer. */
  sample: z.boolean(),
});
export type OrderListing = z.infer<typeof ListingSchema>;

/** One parcel's tracking, as Zinc reports it. */
export const TrackingSchema = z.object({
  id: z.string(),
  carrier: z.string().nullable(),
  number: z.string(),
  /** A page where the parcel can be followed. */
  url: z.string().nullable(),
  /** "pending", "in_transit", "delivered", ... as the carrier reports it. */
  status: z.string(),
  estimatedDelivery: z.string().nullable(),
  /** PayPal has been given this tracking number (so the payment shows it). */
  sentToPaypal: z.boolean().default(false),
});
export type Tracking = z.infer<typeof TrackingSchema>;

export type OrderStatus = "processing" | "placed" | "failed" | "cancelled";
export type PaymentStatus = "none" | "charged" | "refunded" | "part-refunded" | "unknown";
export type OrderSource = "buy-now" | "auto";

/** An order as the screens need it: plain data, dates as text. */
export interface OrderView {
  id: string;
  productId: string | null;
  productName: string;
  source: OrderSource;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  failureReason: string | null;
  decision: string | null;
  listing: OrderListing;
  packs: number;
  /** What PayPal was charged up front, and what it really cost (null until Zinc has bought it). */
  chargedCents: number | null;
  totalCents: number | null;
  refundedCents: number;
  /** Zinc's fee and ours, included in `totalCents`. */
  feesCents: number;
  tracking: Tracking[];
  merchantOrderId: string | null;
  arrivesAt: string | null;
  createdAt: string;
  /** The user has been shown how it turned out. */
  seen: boolean;
}

/** The limits and promises shown before auto-buy is turned on. */
export interface AutoBuyTerms {
  minConfidence: number;
  /** The most for one order and one month, with the user's own limits applied. */
  orderCents: number;
  monthCents: number;
  /** The most they could set them to. */
  platformOrderCents: number;
  platformMonthCents: number;
}

/** An order still being dealt with, as the dashboard's product card shows it. */
export interface OrderOnTheWay {
  productId: string;
  status: "processing" | "placed";
  arrivesAt: string | null;
}

/** The most packs one "Buy for me" can order, as a check on a typo. */
export const MOST_PACKS = 20;

/** Orders shown per page on the Orders screen. */
export const ORDERS_PAGE_SIZE = 10;

/** Which orders the Orders screen asks for: a page, and optionally one month ("2026-11", UTC). */
export interface OrdersQuery {
  month: string | null;
  page: number;
}

/** One page of the user's orders (newest first), and what the filter can offer. */
export interface OrdersPage extends OrdersQuery {
  orders: OrderView[];
  /** Orders matching the month filter, across all pages. */
  total: number;
  pageCount: number;
  /** Months that have orders, newest first, for the filter. */
  months: { month: string; count: number }[];
}
