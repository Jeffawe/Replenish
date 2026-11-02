import type { OrderReader, ReadOrder } from "./reader";
import type { EmailMessage } from "./types";

/**
 * Reads Amazon's "Ordered: ..." confirmation. Written from a real email, which says only:
 *
 *   Subject: Ordered 1 item: Phone Accessories
 *   Arriving tomorrow
 *   1 item: Phone Accessories
 *   Order # 114-5269025-1661830
 *
 * So the item is whatever Amazon names it (sometimes a category, not a product), the
 * arrival can be relative ("tomorrow", worked out from the order's own date), and there
 * is no price per line (the grand total includes tax and shipping, so it is not used).
 * Shipping notices and ads have no "Ordered" subject and are skipped.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_MS = 24 * 60 * 60 * 1000;

const monthIndex = (name: string): number => MONTHS.indexOf(name.slice(0, 3).toLowerCase());
const utcNoon = (year: number, month: number, day: number) => new Date(Date.UTC(year, month, day, 12));
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** A date as written in a mail header: "30 Sept 2026" or "Sep 30, 2026". Null if it isn't one. */
function writtenDate(line: string): Date | null {
  const dayFirst = /(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(line);
  if (dayFirst && monthIndex(dayFirst[2]!) >= 0) return utcNoon(+dayFirst[3]!, monthIndex(dayFirst[2]!), +dayFirst[1]!);
  const monthFirst = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(line);
  if (monthFirst && monthIndex(monthFirst[1]!) >= 0) return utcNoon(+monthFirst[3]!, monthIndex(monthFirst[1]!), +monthFirst[2]!);
  return null;
}

/** When the order was sent: the original's date when someone forwarded it by hand, else when it reached us. */
function orderDate(message: EmailMessage): Date {
  const header = /-{3,}\s*Forwarded message\s*-{3,}[\s\S]{0,600}?^\s*Date:\s*(.+)$/im.exec(message.text.slice(0, 5000));
  const forwarded = header?.[1] ? writtenDate(header[1]) : null;
  if (forwarded) return forwarded;
  const received = message.receivedAt;
  return utcNoon(received.getUTCFullYear(), received.getUTCMonth(), received.getUTCDate());
}

/** "Arriving tomorrow", "Arriving Thursday, October 2", "Arriving Thursday": the day, or null when none is named. */
export function arrivalDate(text: string, from: Date): Date | null {
  const phrase = /Arriving\s+(?:by\s+)?([^\n\r]{0,60})/i.exec(text)?.[1]?.trim();
  if (!phrase) return null;
  if (/^today\b/i.test(phrase)) return from;
  if (/^tomorrow\b/i.test(phrase)) return addDays(from, 1);

  if (/\d/.test(phrase)) {
    const monthDay = /([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/.exec(phrase.replace(/^[A-Za-z]+day,?\s*/i, ""));
    if (!monthDay || monthIndex(monthDay[1]!) < 0) return null;
    let date = utcNoon(from.getUTCFullYear(), monthIndex(monthDay[1]!), +monthDay[2]!);
    // An order in late December arriving "January 2" means next year.
    if (date.getTime() < from.getTime() - 30 * DAY_MS) date = utcNoon(from.getUTCFullYear() + 1, date.getUTCMonth(), date.getUTCDate());
    return date;
  }

  const weekday = WEEKDAYS.indexOf(phrase.slice(0, 3).toLowerCase());
  if (weekday < 0 || !/^[A-Za-z]+day\b/i.test(phrase)) return null;
  const ahead = (weekday - from.getUTCDay() + 7) % 7 || 7;
  return addDays(from, ahead);
}

/** "3 items: Dish soap" or "Ordered: Dish soap and 2 more items": the count and the title, from the subject or the body. */
function itemSummary(subject: string, text: string): { count: number; title: string } | null {
  const fromSubject = /\bOrdered\s*(?:(\d+)\s+items?)?\s*:\s*(.+)$/i.exec(subject.trim());
  const fromBody = /(?:^|\n)\s*(\d+)\s+items?\s*:\s*([^\n\r]+)/i.exec(text);
  const count = Number(fromSubject?.[1] ?? fromBody?.[1] ?? 1);
  const raw = fromSubject?.[2] ?? fromBody?.[2];
  if (!raw) return null;
  const title = raw
    .replace(/\s+and\s+\d+\s+more\s+items?\.?$/i, "")
    .replace(/^["“'‘]+|["”'’.…]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return title && Number.isFinite(count) && count > 0 ? { count, title } : null;
}

/** The order number: after "Order #" (or "Order number:"), else any number shaped like one (3-7-7 digits). */
function findOrderId(text: string): string | null {
  return (
    /Order\s*(?:#|number|no\.?)?\s*[:#]?\s*(\d{3}-\d{7}-\d{7})/i.exec(text)?.[1] ?? /(?<![\d-])(\d{3}-\d{7}-\d{7})(?![\d-])/.exec(text)?.[1] ?? null
  );
}

export const amazonReader: OrderReader = {
  async read(message: EmailMessage): Promise<ReadOrder | null> {
    // Only the order confirmation ("Ordered: ..."), never a shipping notice or an ad.
    if (!/\bOrdered\b/i.test(message.subject)) return null;
    const orderId = findOrderId(message.text);
    const summary = itemSummary(message.subject, message.text);
    if (!orderId || !summary) return null;

    const sent = orderDate(message);
    return {
      orderId,
      arrivesAt: arrivalDate(message.text, sent),
      lines: [{ name: summary.title, quantity: summary.count }],
    };
  },
};
