const DAY_MS = 24 * 60 * 60 * 1000;

/** 3.86 -> "3.9", 12 -> "12", 0.333 -> "0.3". */
export function formatQuantity(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (value < 10) return String(Number(value.toFixed(1)));
  return String(Math.round(value));
}

/** Two decimals, or two significant digits for slow rates: 0.4286 -> "0.43", 0.0219 -> "0.022". */
export function formatRate(value: number): string {
  if (value >= 10) return String(Math.round(value));
  if (value >= 0.1) return value.toFixed(2);
  return String(Number(value.toPrecision(2)));
}

export function formatDays(days: number): string {
  if (days < 1) return "less than a day";
  const rounded = Math.round(days);
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** "6-12 days", or "as soon as 6 days" when the upper end is unbounded; null if there is no real spread. */
export function formatDayRange(earliest: number, latest: number | null): string | null {
  const low = Math.round(earliest);
  if (latest === null) return `could be as soon as ${formatDays(earliest)}`;
  const high = Math.round(latest);
  if (low === high) return null;
  return `likely ${low}–${high} days`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

// Dates are shown in UTC so a purchase never shifts a day between server and viewer.
export function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatPrice(cents: number | null, currency = "USD"): string {
  if (cents === null) return "–";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency });
}

export function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}
