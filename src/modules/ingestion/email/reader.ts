import type { EmailMessage } from "./types";

/**
 * How an order email becomes lines. A reader only *reads*: it never stores
 * anything and never matches lines to the user's products (extractor.ts does
 * that), so a new reader is just "email in, order out".
 */

export interface ReadLine {
  /** The item as the email names it. */
  name: string;
  quantity: number;
  /** Defaults to "each" (or the matched product's unit). */
  unit?: string;
  brand?: string;
  priceCents?: number;
}

export interface ReadOrder {
  /** The store's own order number. It identifies the order, so the same order in two emails is stored once. */
  orderId: string;
  /** When it is expected to arrive, if the email says. Estimates count it from that day. */
  arrivesAt: Date | null;
  lines: ReadLine[];
}

export interface OrderReader {
  /** Reads the email, or returns null when it isn't an order confirmation (a shipping notice, an ad). */
  read(message: EmailMessage, store: string): Promise<ReadOrder | null>;
}

/**
 * Readers written for one store, by the store's name (as in retailers.ts).
 * None yet. Add a store's reader here once its emails can be read.
 */
const STORE_READERS: Record<string, OrderReader> = {};

/**
 * A reader that can read any store's email: the place for a language model.
 * Not connected. Connecting one sends the email's text to it, so the privacy
 * wording on the setup page (and in docs/ingestion.md) has to change first.
 */
const ANY_STORE_READER: OrderReader | null = null;

/** Tries the store's own reader first, then the any-store one. Null when nothing can read it. */
export async function readOrder(message: EmailMessage, store: string): Promise<ReadOrder | null> {
  for (const reader of [STORE_READERS[store], ANY_STORE_READER]) {
    if (!reader) continue;
    const order = await reader.read(message, store);
    if (order && order.lines.length > 0) return order;
  }
  return null;
}

/** Whether anything can read this store's emails yet. */
export function canRead(store: string): boolean {
  return Boolean(STORE_READERS[store] ?? ANY_STORE_READER);
}
