import { identify } from "./catalog";

/**
 * Turns the rows of a receipt (see layout.ts) into a store, a date, a total
 * and the purchased lines. Plain pattern matching over text, so it is cheap to
 * run and easy to test, and it is the part to improve when a receipt reads
 * wrong. It never throws: what it can't read comes back as null or is left out.
 */

export interface ParsedLine {
  /** The receipt's wording with codes, prices and flags removed ("GV WHL MLK GL"). */
  name: string;
  quantity: number;
  /** A unit the receipt stated, like "lb" for something weighed. Null for a plain count. */
  unit: string | null;
  priceCents: number | null;
}

export interface ParsedReceipt {
  store: string | null;
  date: Date | null;
  currency: string;
  subtotalCents: number | null;
  totalCents: number | null;
  /** What the receipt took off (coupons, instant savings), as a positive amount. Lines are listed at their full price. */
  discountsCents: number;
  /** Whether it reads like a restaurant check (server, table, tip...), not a shop. */
  restaurant: boolean;
  lines: ParsedLine[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 3.98, 3,98 or .98 (some stores drop the zero), not part of a longer number.
const AMOUNT = String.raw`\d{0,5}[.,]\d{2}(?!\d)`;
const AMOUNT_ANYWHERE = new RegExp(String.raw`(?<![\d.,])${AMOUNT}`, "g");
// A price at the end of a row, with an optional minus and the tax flag stores print after it ("3.98 N").
const PRICE_AT_END = new RegExp(
  String.raw`(?<![\d.,])(-?)\s?\$?\s?(${AMOUNT})\s*(-?)\s*[A-Za-z]{0,2}(?:\s*\d{1,2})?$`,
);
// "2 @ 3.49" or a deal like "2 @ 5 for 3.00", optionally followed by the line total.
const COUNT_ROW = new RegExp(
  String.raw`^(?:qty\.?\s*)?(\d{1,3})\s*(?:@|x|\*|at)\s*(?:(\d{1,3})\s*for\s*)?\$?\s*(${AMOUNT})(?:\s*(?:ea|each|/ea))?(?:\s+-?\$?\s?(${AMOUNT})\s*-?\s*[A-Za-z]{0,2}(?:\s*\d{1,2})?)?$`,
  "i",
);
// "1.23 lb @ 2.99/lb  3.68"
const WEIGHT_ROW = /^(\d+(?:\.\d+)?)\s*(lbs?|kg|oz|g)\b.*@/i;

// OCR often misreads one letter of "Subtotal" ("Subbotal").
const SUBTOTAL = String.raw`sub\s*-?\s*[a-z]?otal`;
const SUBTOTAL_ROW = new RegExp(String.raw`^\W*${SUBTOTAL}\b`, "i");
const TOTAL_ROW = new RegExp(
  String.raw`^\W*(${SUBTOTAL}|grand\s+total|total(?!\s+(?:tax|number|items?|savings?))|balance(\s+due)?|amount\s+due)\b`,
  "i",
);
const NOT_A_PRODUCT = new RegExp(
  // Restaurant modifiers ("1 > Lettuce") are part of the dish above, not purchases.
  String.raw`^(?:(?:food|beverage|taxable|taxes?|amount|txtl|totl|chng|id\b|server\b)|s\.?\s*service\s+charge|service(?:\s+charge|\d)|resort\s+tax|aid\b|order\s*#|table\s*:|description\b|payment\b)|^\d{0,2}\s*[>›»]|\b(${SUBTOTAL}|total|net\s+sales|tare(\s+weight)?|tax|vat|gst|hst|balance|change|cash|credit|debit|visa|mastercard|master\s*card|amex|discover|tender|payment|card|approved|auth|terminal|tip|gratuity|items?\s+sold|item\s+count|bottom\s+of\s+basket|bob\s+count|receipt|survey|thank|welcome|cashier|manager|phone|tel|savings?|saved|coupons?|discounts?|promo|rewards?|points|member|bag\s+(fee|charge)|carry-?out)\b|www\.|\.com\b|\b(st|op|tc|te|tr|reg)\s*#`,
  "i",
);

// Words that only a restaurant check prints. Several shops print "TABLE SALT" or "Q-TIP", so these ask for more than the word.
// A shop's name rarely says "grill" or "pizzeria"; a restaurant's often does. Only looked for in the top rows that carry no price (an item can be "KITCHEN TRASH BAGS").
const RESTAURANT_NAME =
  /\b(?:restaurant|ristorante|trattoria|cantina|taqueria|steak\s?house|pizzeria|pizza|grill|grille|bbq|barbecue|tavern|bistro|kitchen|diner|buffet|eatery|caf[eé]|cafe|pho|sushi|burgers?|wings)\b/i;
const RESTAURANT_ROW = new RegExp(
  [
    String.raw`\bgratuity\b`,
    String.raw`\bserver\b`,
    String.raw`\bguests?\b`,
    String.raw`\bdine[\s-]*in\b`,
    String.raw`^\W*serv\s*:`,
    String.raw`\btable\s*(?:#|:|no\.?)?\s*[a-z]?\d+\b`,
    String.raw`(?<![\w-])tip\s*[:=_]`,
    String.raw`^\W*(?:suggested\s+)?tip\W*(?:\$?\s?${AMOUNT})?\W*$`,
  ].join("|"),
  "i",
);

const toCents = (amount: string) => Math.round(Number(amount.replace(",", ".")) * 100);
const lettersIn = (text: string) => (text.match(/\p{L}/gu) ?? []).length;

/** The amount that ends a row, if it ends with one. */
function lastAmount(row: string): number | null {
  const all = row.match(AMOUNT_ANYWHERE);
  return all ? toCents(all[all.length - 1]) : null;
}

export function parseReceipt(rows: string[], now: Date): ParsedReceipt {
  const tidy = rows.map((row) => row.replace(/\s+/g, " ").trim());
  const { subtotalCents, totalCents } = findTotals(tidy);

  // Items are everything above the last subtotal or total (some receipts have a
  // subtotal per section). Tax and payment lines in between are skipped by name.
  const end = tidy.findLastIndex((row) => TOTAL_ROW.test(row) && (lastAmount(row) ?? 0) > 0);
  const itemRows = end === -1 ? tidy : tidy.slice(0, end);

  const store = findStore(tidy);
  const { lines, discountsCents } = findLines(itemRows, { itemNumbers: store === "Costco" });

  return {
    store,
    date: findDate(tidy, now),
    currency: findCurrency(tidy),
    subtotalCents,
    totalCents,
    discountsCents,
    restaurant: tidy.some((row) => RESTAURANT_ROW.test(row)) || tidy.slice(0, 6).some((row) => !row.match(AMOUNT_ANYWHERE) && RESTAURANT_NAME.test(row)),
    lines,
  };
}

function findLines(rows: string[], options: { itemNumbers: boolean }) {
  const lines: ParsedLine[] = [];
  let discountsCents = 0;
  const clean = (text: string) => cleanName(text, options.itemNumbers);
  // A name seen without a price, waiting for the row right below it to supply one.
  let pending: string | null = null;
  // A count row may amend the immediately preceding product, but never across a header or skipped row.
  let canAmendLast = false;
  // Curled receipts occasionally place a price immediately before its name.
  let leadingPrice: number | null = null;

  // A name whose price never came (misread, or printed out of line) is still
  // worth listing when it is clearly something the user restocks.
  const keepIfKnown = (text: string) => {
    const named = clean(text);
    if (named && identify(named.name).item?.consumable) {
      lines.push({ name: named.name, quantity: named.quantity, unit: null, priceCents: null });
    }
  };

  for (const row of rows) {
    const waiting = pending;
    pending = null;
    if (!row) continue;

    const counted = COUNT_ROW.exec(row);
    const weighed = counted ? null : WEIGHT_ROW.exec(row);
    const skipped = !counted && !weighed && NOT_A_PRODUCT.test(row);
    const priced = counted || weighed || skipped ? null : PRICE_AT_END.exec(row);
    const named = priced ? clean(row.slice(0, priced.index)) : null;
    // Rows that complete the name above: a quantity row, or a price on its own.
    const completesAbove = !!(counted || weighed || (priced && !named));
    if (waiting && !completesAbove) keepIfKnown(waiting);

    if (counted || weighed) {
      const amounts = row.match(AMOUNT_ANYWHERE)?.map(toCents) ?? [];
      const count = counted ? Number(counted[1]) : Number(weighed![1]);
      const unitPrice = counted ? toCents(counted[3]) / Number(counted[2] ?? 1) : (amounts[0] ?? null);
      const total = counted
        ? counted[4]
          ? toCents(counted[4])
          : null
        : amounts.length > 1
          ? amounts[amounts.length - 1]
          : null;
      const quantity = weighed ? count : Math.max(count, 1);
      const unit = weighed ? weighed[2].toLowerCase().replace(/^lbs$/, "lb") : null;
      const price = total ?? (unitPrice === null ? null : Math.round(unitPrice * quantity));

      const above = waiting ? clean(waiting) : null;
      if (above) {
        lines.push({ name: above.name, quantity: quantity * above.quantity, unit, priceCents: price });
      } else if (canAmendLast && lines.length > 0) {
        const last = lines[lines.length - 1];
        last.quantity *= quantity;
        last.unit = unit;
        last.priceCents ??= price;
      }
      canAmendLast = false;
      leadingPrice = null;
      continue;
    }
    if (skipped) {
      // A coupon or savings row takes money off the total, so the subtotal check can allow for it.
      const taken = PRICE_AT_END.exec(row);
      if (taken && (taken[1] === "-" || taken[3] === "-")) discountsCents += toCents(taken[2]);
      canAmendLast = false;
      leadingPrice = null;
      continue;
    }

    if (priced) {
      const cents = toCents(priced[2]);
      // Nothing was paid for a $0.00 line (an included side, a kitchen note, a comped item).
      if (cents === 0 && !(priced[1] === "-" || priced[3] === "-") && named) {
        canAmendLast = false;
        leadingPrice = null;
        continue;
      }
      if (priced[1] === "-" || priced[3] === "-") {
        // A void repeats an earlier product with a negative price: remove that purchase.
        // Any other negative row is money taken off (Costco's "instant savings").
        const at = named ? lines.findLastIndex((line) => line.name === named.name && line.priceCents === cents) : -1;
        if (at !== -1) lines.splice(at, 1);
        else discountsCents += cents;
        canAmendLast = false;
        leadingPrice = null;
        continue;
      }
      if (named) {
        lines.push({ name: named.name, quantity: named.quantity, unit: null, priceCents: cents });
        canAmendLast = true;
        leadingPrice = null;
      }
      else {
        // Just a price: it belongs to the name on the row above.
        const above = waiting ? clean(waiting) : null;
        if (above) {
          if (cents === 0) {
            canAmendLast = false;
            leadingPrice = null;
            continue;
          }
          lines.push({ name: above.name, quantity: above.quantity, unit: null, priceCents: cents });
          canAmendLast = true;
          leadingPrice = null;
        } else {
          leadingPrice = cents === 0 ? null : cents;
          canAmendLast = false;
        }
      }
    } else if (lettersIn(row) >= 3) {
      const next = clean(row);
      if (leadingPrice !== null && next) {
        lines.push({ name: next.name, quantity: next.quantity, unit: null, priceCents: leadingPrice });
        leadingPrice = null;
        canAmendLast = true;
      } else {
        pending = row;
        canAmendLast = false;
      }
    }
  }
  if (pending) keepIfKnown(pending);
  return { lines, discountsCents };
}

/**
 * Strips what isn't the product's name: item codes, symbols, the tax flag, a
 * leading "2 x", and a pack size ("12CT", which multiplies the quantity).
 * Null when nothing name-like is left.
 */
function cleanName(text: string, itemNumbers = false): { name: string; quantity: number } | null {
  let rest = text.replace(/[$@*#|_=]+/g, " ");
  // Costco prints its item number first ("E 9462 ORANGES", "6884 AMORE TOV"). Other shops can lead with a brand ("365 OG ..."), so only there.
  if (itemNumbers) rest = rest.replace(/^\s*(?:[A-Za-z]\s+)?\d{3,7}\s+(?=\S)/, "");

  let count = 1;
  let orderCount = false;
  const leading = /^\s*(\d{1,2})\s*x\s+(?=\D)/i.exec(rest);
  if (leading) {
    count = Number(leading[1]);
    rest = rest.slice(leading[0].length);
  } else {
    const plainLeading = /^\s*(\d{1,2})\s+(?=\p{L})/u.exec(rest);
    if (plainLeading) {
      count = Number(plainLeading[1]);
      orderCount = true;
      rest = rest.slice(plainLeading[0].length);
    }
  }

  let pack = 1;
  // "12CT", "6 PK", and ranges like "4-5 COUNT" (the first number is taken).
  rest = rest.replace(/\b(\d{1,3})(?:\s?-\s?\d{1,3})?\s?(?:ct|pk|pack|count|pcs?)\b/i, (_, size: string) => {
    if (!orderCount) pack = Math.min(Number(size), 500);
    return " ";
  });

  const tokens = rest.split(/\s+/).filter(Boolean);
  // Some stores print a one-letter flag before the item code ("E 1234567 KS TP").
  if (tokens.length > 2 && /^[A-Z]$/.test(tokens[0]) && /^\d{5,}$/.test(tokens[1])) tokens.shift();
  const words = tokens.filter((word) => !/^\d{5,}$/.test(word) && !/^[\p{P}\p{S}]+$/u.test(word));
  if (words.length > 1 && /^[A-Z]$/.test(words[words.length - 1])) words.pop();

  const name = words.join(" ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.%)]+$/gu, "");
  if (lettersIn(name) < 2) return null;
  return { name, quantity: count * pack };
}

/** "GV WHL MLK GL" -> "Gv Whl Mlk Gl". Left alone when it already has lowercase. */
export function toDisplayName(name: string): string {
  if (/\p{Ll}/u.test(name)) return name;
  return name.toLowerCase().replace(/(^|[\s(\-/])(\p{L})/gu, (_, before: string, ch: string) => before + ch.toUpperCase());
}

function findTotals(rows: string[]) {
  let subtotalCents: number | null = null;
  let totalCents: number | null = null;
  let taxCents: number | null = null;
  for (const [index, row] of rows.entries()) {
    const amount = lastAmount(row);
    if (/^\W*tax\b/i.test(row) && amount !== null && amount > 0) taxCents = amount;
    if (/^\W*(?:grand\s+)?total\W*$/i.test(row)) {
      const previous = index > 0 ? lastAmount(rows[index - 1]) : null;
      if (previous !== null && previous > 0) totalCents ??= previous;
    }
    if (amount === null || amount <= 0) continue;
    if (SUBTOTAL_ROW.test(row)) subtotalCents = amount;
    else if (
      /^\W*(grand\s+total|total|balance\s+due|amount\s+due)\b/i.test(row) &&
      !/saving|tax|discount|item|tender|coupon|point/i.test(row)
    ) {
      totalCents ??= amount;
    }
  }
  if (
    subtotalCents !== null &&
    taxCents !== null &&
    totalCents !== null &&
    totalCents > subtotalCents + taxCents + Math.max(100, subtotalCents * 0.5)
  ) {
    totalCents = subtotalCents + taxCents;
  }
  return { subtotalCents, totalCents };
}

const CHAINS: [RegExp, string][] = [
  [/wal\W?mart/i, "Walmart"],
  [/\btarget\b/i, "Target"],
  [/costco/i, "Costco"],
  [/sam'?s\s*club/i, "Sam's Club"],
  [/kroger/i, "Kroger"],
  [/\baldi\b/i, "Aldi"],
  [/\blidl\b/i, "Lidl"],
  [/trader\s*joe/i, "Trader Joe's"],
  [/whole\s*foods/i, "Whole Foods"],
  [/safeway/i, "Safeway"],
  [/publix/i, "Publix"],
  [/wegmans/i, "Wegmans"],
  [/meijer/i, "Meijer"],
  [/\bh-?e-?b\b/i, "H-E-B"],
  [/food\s*lion/i, "Food Lion"],
  [/shoprite/i, "ShopRite"],
  [/\bcvs\b/i, "CVS"],
  [/walgreens/i, "Walgreens"],
  [/dollar\s*general/i, "Dollar General"],
  [/family\s*dollar/i, "Family Dollar"],
  [/tesco/i, "Tesco"],
  [/sainsbury/i, "Sainsbury's"],
  [/\bamazon\b/i, "Amazon"],
];

/**
 * A known chain named near the top (read across rows, since a logo like
 * "WHOLE / FOODS / MARKET" often comes out one word per row), else the first
 * row that reads like a name.
 */
function findStore(rows: string[]): string | null {
  const top = rows.slice(0, 20).join("\n");
  const chain = CHAINS.find(([pattern]) => pattern.test(top));
  if (chain) return chain[1];
  for (const row of rows.slice(0, 5)) {
    const compact = row.replace(/\s/g, "");
    const looksLikeName =
      lettersIn(row) >= 3 &&
      lettersIn(row) / compact.length > 0.6 &&
      !/^\d/.test(row) &&
      !NOT_A_PRODUCT.test(row) &&
      !/\d{3}[-. ]\d{3,4}|@|\bst\b|\bave\b|\broad\b|\brd\b/i.test(row);
    if (looksLikeName) return toDisplayName(row.replace(/[^\p{L}\p{N}&'.\- ]/gu, "").trim());
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";

/** UTC midnight of a real calendar date, or null. */
function makeDate(year: number, month: number, day: number, now: Date): Date | null {
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  const real = date.getUTCFullYear() === fullYear && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  const plausible = fullYear >= 2000 && date.getTime() <= now.getTime() + DAY_MS;
  return real && plausible ? date : null;
}

/** Prefer a plausible date printed with a time; policy/footer dates usually have no time. */
function findDate(rows: string[], now: Date): Date | null {
  let first: Date | null = null;
  for (const row of rows) {
    let found: Date | null = null;
    const iso = /(?<!\d)(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(row);
    if (iso) {
      found = makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]), now);
    }

    const numeric = found ? null : /(?<![\d.])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d.])/.exec(row);
    if (!found && numeric) {
      const [a, b, year] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
      found = a > 12 ? makeDate(year, b, a, now) : makeDate(year, a, b, now);
    }

    const monthFirst = found
      ? null
      : (new RegExp(`\\b${MONTH}[.\\s-]+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s+|['’])(\\d{2,4})\\b`, "i").exec(row) ??
        new RegExp(`\\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\\d{1,2})\\s+(\\d{2,4})\\b`, "i").exec(row));
    if (!found && monthFirst) {
      found = makeDate(
        Number(monthFirst[3]),
        MONTHS.indexOf(monthFirst[1].slice(0, 3).toLowerCase()) + 1,
        Number(monthFirst[2]),
        now,
      );
    }
    const dayFirst = found
      ? null
      : new RegExp(`\\b(\\d{1,2})\\s*-?\\s*${MONTH}\\s*-?\\s*,?\\s*(\\d{4})\\b`, "i").exec(row);
    if (!found && dayFirst) {
      found = makeDate(
        Number(dayFirst[3]),
        MONTHS.indexOf(dayFirst[2].slice(0, 3).toLowerCase()) + 1,
        Number(dayFirst[1]),
        now,
      );
    }
    if (!found) continue;
    first ??= found;
    if (/\b\d{1,2}\s*:\s*\d{2}\b/.test(row)) return found;
  }
  return first;
}

function findCurrency(rows: string[]): string {
  const text = rows.join(" ");
  const count = (symbol: string) => text.split(symbol).length - 1;
  const best = [
    { code: "USD", n: count("$") },
    { code: "GBP", n: count("£") },
    { code: "EUR", n: count("€") },
  ].sort((a, b) => b.n - a.n)[0];
  return best.n > 0 ? best.code : "USD";
}
