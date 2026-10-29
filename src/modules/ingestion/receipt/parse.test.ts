import { describe, expect, it } from "vitest";
import { parseReceipt, toDisplayName } from "./parse";

const NOW = new Date("2026-10-21T12:00:00Z");

// Rows as layout.ts rebuilds them from a photo; the wording is modelled on real store receipts.
const WALMART = [
  "Walmart",
  "Save money. Live better.",
  "(555) 123-4567",
  "MANAGER JANE DOE",
  "123 MAIN ST",
  "ANYTOWN ST 12345",
  "ST# 5260 OP# 00001234 TE# 04 TR# 05012",
  "GV WHL MLK GL  003120045678 F  3.98 N",
  "CHARMIN ULTRA 12CT  003700012345  18.97 N",
  "BANANAS",
  "2.34 lb @ 0.58 /lb  1.36 N",
  "EGGS LRG 18CT 060383 F 4.28 N",
  "SUBTOTAL 28.59",
  "TAX 1 6.5000 % 0.47",
  "TOTAL 29.06",
  "VISA TEND 29.06",
  "CHANGE DUE 0.00",
  "# ITEMS SOLD 4",
  "10/20/26 14:32:07",
];

describe("parseReceipt: a Walmart-style receipt", () => {
  const receipt = parseReceipt(WALMART, NOW);

  it("finds the lines and their item codes, ignoring flags, headers and everything below the subtotal", () => {
    expect(receipt.lines).toEqual([
      { name: "GV WHL MLK GL", quantity: 1, unit: null, priceCents: 398, code: "003120045678" },
      { name: "CHARMIN ULTRA", quantity: 12, unit: null, priceCents: 1897, code: "003700012345" },
      { name: "BANANAS", quantity: 2.34, unit: "lb", priceCents: 136 },
      { name: "EGGS LRG", quantity: 18, unit: null, priceCents: 428, code: "060383" },
    ]);
  });

  it("finds the store, date and totals", () => {
    expect(receipt.store).toBe("Walmart");
    expect(receipt.date?.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    expect(receipt.subtotalCents).toBe(2859);
    expect(receipt.totalCents).toBe(2906);
    expect(receipt.currency).toBe("USD");
  });
});

describe("parseReceipt: other layouts", () => {
  it("reads a Costco-style receipt: leading member flag, item numbers, and an instant-savings line", () => {
    const receipt = parseReceipt(
      [
        "COSTCO WHOLESALE",
        "Member 111892345678",
        "E 1234567 KS TP 30CT 19.99 A",
        "E 7654321 ORG EGGS 24CT 8.49 A",
        "/ 7654321 1.50-",
        "SUBTOTAL 28.48",
        "TAX 0.00",
        "**** TOTAL 28.48",
      ],
      NOW,
    );
    expect(receipt.store).toBe("Costco");
    expect(receipt.lines).toEqual([
      { name: "KS TP", quantity: 30, unit: null, priceCents: 1999, code: "1234567" },
      { name: "ORG EGGS", quantity: 24, unit: null, priceCents: 849, code: "7654321" },
    ]);
    expect(receipt.totalCents).toBe(2848);
  });

  it("applies a '2 @ 3.49' row to the item above it", () => {
    const receipt = parseReceipt(["KRAFT MAC CHEESE 7.25OZ  6.98 T", "2 @ 3.49", "TOTAL 6.98"], NOW);
    expect(receipt.lines).toEqual([
      { name: "KRAFT MAC CHEESE 7.25OZ", quantity: 2, unit: null, priceCents: 698 },
    ]);
  });

  it("takes the name from above when the quantity row carries the price", () => {
    const receipt = parseReceipt(["ORANGE JUICE", "3 @ $2.50  7.50", "TOTAL 7.50"], NOW);
    expect(receipt.lines).toEqual([{ name: "ORANGE JUICE", quantity: 3, unit: null, priceCents: 750 }]);
  });

  it("reads a leading '2 x' as a count", () => {
    const receipt = parseReceipt(["2 x PAPER TOWELS 6PK  11.98", "TOTAL 11.98"], NOW);
    expect(receipt.lines).toEqual([{ name: "PAPER TOWELS", quantity: 12, unit: null, priceCents: 1198 }]);
  });

  it("reads plain restaurant counts without treating a dish's piece count as purchase quantity", () => {
    const receipt = parseReceipt(["3 Pupusa Queso 12.00", "1 Reg 12pc Falafel 9.50", "TOTAL 21.50"], NOW);
    expect(receipt.lines).toEqual([
      { name: "Pupusa Queso", quantity: 3, unit: null, priceCents: 1200 },
      { name: "Reg Falafel", quantity: 1, unit: null, priceCents: 950 },
    ]);
  });

  it("attaches a lone price row to the name above", () => {
    const receipt = parseReceipt(["ALMOND MILK UNSWEETENED", "3.49 F", "TOTAL 3.49"], NOW);
    expect(receipt.lines).toEqual([
      { name: "ALMOND MILK UNSWEETENED", quantity: 1, unit: null, priceCents: 349 },
    ]);
  });

  it("skips discounts, coupons and bag fees", () => {
    const receipt = parseReceipt(
      ["COFFEE 12OZ  9.99", "COUPON  -1.00", "STORE DISCOUNT 0.50-", "BAG FEE 0.10", "TOTAL 8.99"],
      NOW,
    );
    expect(receipt.lines.map((l) => l.name)).toEqual(["COFFEE 12OZ"]);
  });

  it("still finds lines when there is no subtotal or total", () => {
    const receipt = parseReceipt(["MILK  3.50", "BREAD  2.25"], NOW);
    expect(receipt.lines.map((l) => l.name)).toEqual(["MILK", "BREAD"]);
    expect(receipt.totalCents).toBeNull();
  });

  it("doesn't treat a store called 'Total Wine' as the total", () => {
    const receipt = parseReceipt(["TOTAL WINE & MORE", "CHARDONNAY  12.99", "TOTAL 12.99"], NOW);
    expect(receipt.lines.map((l) => l.name)).toEqual(["CHARDONNAY"]);
    expect(receipt.totalCents).toBe(1299);
  });

  it("finds nothing in text that isn't a receipt", () => {
    const receipt = parseReceipt(["Hello there", "this is a picture of my cat"], NOW);
    expect(receipt.lines).toEqual([]);
  });

  it("returns nothing for no rows at all", () => {
    expect(parseReceipt([], NOW)).toMatchObject({ lines: [], store: null, date: null, totalCents: null });
  });

  it("reads the currency from the symbol", () => {
    expect(parseReceipt(["TESCO", "MILK 4PT  £1.45", "TOTAL £1.45"], NOW).currency).toBe("GBP");
  });
});

describe("parseReceipt: harder receipts", () => {
  it("reads items below a first subtotal when another total follows", () => {
    const receipt = parseReceipt(
      ["MILK  3.50", "Subtotal  3.50", "CAT FOOD  10.00", "Subtotal  13.50", "TAX  0.80", "Total  14.30"],
      NOW,
    );
    expect(receipt.lines.map((l) => l.name)).toEqual(["MILK", "CAT FOOD"]);
    expect(receipt.subtotalCents).toBe(1350);
    expect(receipt.totalCents).toBe(1430);
  });

  it("reads a count range as the first number", () => {
    const receipt = parseReceipt(["ONIONS 4-5 COUNT  3.00", "TOTAL 3.00"], NOW);
    expect(receipt.lines).toEqual([{ name: "ONIONS", quantity: 4, unit: null, priceCents: 300 }]);
  });

  it("keeps a known item whose price couldn't be read, and drops an unknown one", () => {
    const receipt = parseReceipt(["TOMATOES 4-5 CEUNT", "ZORBLAX THING", "BREAD  2.25", "TOTAL 2.25"], NOW);
    expect(receipt.lines).toEqual([
      { name: "TOMATOES 4-5 CEUNT", quantity: 1, unit: null, priceCents: null },
      { name: "BREAD", quantity: 1, unit: null, priceCents: 225 },
    ]);
  });

  it("keeps a known item without a price at the very end", () => {
    expect(parseReceipt(["BREAD  2.25", "EGGS"], NOW).lines.map((l) => l.name)).toEqual(["BREAD", "EGGS"]);
  });

  it("reads a Whole Foods-style receipt: logo over several rows, deals, weights and tare lines", () => {
    const receipt = parseReceipt(
      [
        "WHOLE",
        "FOODS",
        "MARKET",
        "270 Greenwich Street",
        "CV LIMES",
        "2 @ 5 for $ 3.00  $ 1.20 F",
        "HASS AVOCADOS",
        "2 @ $ 1.49 EACH  $ 2.98 F",
        "CV BANANA",
        "1.85 lb @ $ 0.49 / lb  $ 0.91 F",
        "Tare Weight 0.01lb",
        "FRIEN SOUR CREAM  $ 1.69 F",
        "Subtotal :  $ 6.78",
        "Net Sales :  $ 6.78",
        "Tax / Fee :  $ 0.10",
        "Total :  $ 6.88",
      ],
      NOW,
    );
    expect(receipt.store).toBe("Whole Foods");
    expect(receipt.lines).toEqual([
      { name: "CV LIMES", quantity: 2, unit: null, priceCents: 120 },
      { name: "HASS AVOCADOS", quantity: 2, unit: null, priceCents: 298 },
      { name: "CV BANANA", quantity: 1.85, unit: "lb", priceCents: 91 },
      { name: "FRIEN SOUR CREAM", quantity: 1, unit: null, priceCents: 169 },
    ]);
    expect(receipt.totalCents).toBe(688);
  });

  it("prices a deal without a line total from the deal", () => {
    const receipt = parseReceipt(["LIMES", "2 @ 5 for 3.00", "TOTAL 1.20"], NOW);
    expect(receipt.lines).toEqual([{ name: "LIMES", quantity: 2, unit: null, priceCents: 120 }]);
  });

  it("recognizes a misread 'Subtotal' and doesn't list it as an item", () => {
    const receipt = parseReceipt(["CAT FOOD  10.00", "Subbotal  $ 120.00", "Total  125.00"], NOW);
    expect(receipt.lines.map((l) => l.name)).toEqual(["CAT FOOD"]);
    expect(receipt.subtotalCents).toBe(12000);
  });

  it("reads prices printed without a leading zero, and the quantity rows that use them", () => {
    const receipt = parseReceipt(
      [
        "TURKEY FRANK 4222281210  .88 FS",
        "WINCO NOODLES 7055280303  1.68 FS",
        "2 @ .84",
        "DM SPAG SAUCE 2400052363  .71 FS",
        "SUBTOTAL  3.27",
        "TOTAL  3.27",
      ],
      NOW,
    );
    expect(receipt.lines).toEqual([
      { name: "TURKEY FRANK", quantity: 1, unit: null, priceCents: 88, code: "4222281210" },
      { name: "WINCO NOODLES", quantity: 2, unit: null, priceCents: 168, code: "7055280303" },
      { name: "DM SPAG SAUCE", quantity: 1, unit: null, priceCents: 71, code: "2400052363" },
    ]);
    expect(receipt.subtotalCents).toBe(327);
  });

  it("doesn't read restaurant modifiers as purchases", () => {
    const receipt = parseReceipt(
      ["1 MOOYAH Burger  $ 4.99", "3 > MOOYAH Sauce", "1 > Lettuce", "1 > Fried Onion Strings", "1 Regular Fries  $ 3.29", "Net Total : $ 8.28"],
      NOW,
    );
    expect(receipt.lines.map((l) => l.name)).toEqual(["MOOYAH Burger", "Regular Fries"]);
  });

  it("ignores a zero balance after the payment", () => {
    const receipt = parseReceipt(["MILK  3.50", "TOTAL  3.50", "CASH  5.00", "BALANCE DUE  0.00"], NOW);
    expect(receipt.lines.map((l) => l.name)).toEqual(["MILK"]);
  });

  it("stops at the real total instead of treating Costco payment details as products", () => {
    const receipt = parseReceipt(
      [
        "COSTCO WHOLESALE",
        "AAA 32 PK  15.99 A",
        "SUBTOTAL  15.99",
        "**** TOTAL  17.00",
        "APPROVED - Purchase",
        "AMOUNT $ 17.00",
        "TOTAL TAX  1.01",
        "TOTAL NUMBER OF ITEMS SOLD - 1",
      ],
      NOW,
    );
    expect(receipt.lines).toEqual([{ name: "AAA", quantity: 32, unit: null, priceCents: 1599 }]);
  });

  it("reads Walmart prices followed by numeric status flags", () => {
    const receipt = parseReceipt(
      ["TATER TOTS 001312000026 F 2.96 0", "EGGS 6CTO 007874212709 F 0.90 01", "SUBTOTAL 3.86"],
      NOW,
    );
    expect(receipt.lines).toEqual([
      { name: "TATER TOTS", quantity: 1, unit: null, priceCents: 296, code: "001312000026" },
      { name: "EGGS 6CTO", quantity: 1, unit: null, priceCents: 90, code: "007874212709" },
    ]);
  });

  it("does not attach a quantity row to Costco's bottom-of-basket heading", () => {
    const receipt = parseReceipt(
      ["TIDEOXIPODS 24.49", "******** BOB Count 5 ********", "6 @ 8.99", "WOODBRG MERL 53.94", "TOTAL 78.43"],
      NOW,
    );
    expect(receipt.lines).toEqual([
      { name: "TIDEOXIPODS", quantity: 1, unit: null, priceCents: 2449 },
      { name: "WOODBRG MERL", quantity: 1, unit: null, priceCents: 5394 },
    ]);
  });

  it("drops restaurant category summaries", () => {
    const receipt = parseReceipt(["1 ICED TEA $ 4.50", "FOOD : $ 4.50", "BEVERAGE : $ 4.50", "TOTAL $ 4.50"], NOW);
    expect(receipt.lines).toEqual([{ name: "ICED TEA", quantity: 1, unit: null, priceCents: 450 }]);
  });

  it("drops payment, tax, footer, and standalone modifier rows", () => {
    const receipt = parseReceipt(
      ["Coffee 3.50", "Reg", "0.00", "No Beverage 0.00", "FOOD 3.50", "TAXABLE 3.50", "AID A0000000031010 3.50", "TXTL .25", "TOTL 3.75", "TOTAL 3.75"],
      NOW,
    );
    expect(receipt.lines).toEqual([{ name: "Coffee", quantity: 1, unit: null, priceCents: 350 }]);
  });

  it("uses a numeric detail row's price for the following description", () => {
    const receipt = parseReceipt(
      ["Item Qty Price Total", "Description", "100027 1 5.25 5.25", "PARIS", "100026 1 4.95 4.95", "LE CLASSIQUE", "Subtotal 10.20"],
      NOW,
    );
    expect(receipt.lines).toEqual([
      { name: "PARIS", quantity: 1, unit: null, priceCents: 525 },
      { name: "LE CLASSIQUE", quantity: 1, unit: null, priceCents: 495 },
    ]);
  });

  it("attaches a price printed immediately above its product on a curled receipt", () => {
    const receipt = parseReceipt(["$ 4.99", "1 MOOYAH Burger", "TOTAL 4.99"], NOW);
    expect(receipt.lines).toEqual([{ name: "MOOYAH Burger", quantity: 1, unit: null, priceCents: 499 }]);
  });

  it("removes an earlier product when a matching void row follows", () => {
    const receipt = parseReceipt(
      ["HRI CL CHS 003120506000 F 5.88 0", "HRI CL CHS 003120506000 F 5.88 0", "VOIDED ENTRY", "HRI CL CHS 003120506000 F 5.88-0", "TOTAL 5.88"],
      NOW,
    );
    expect(receipt.lines).toEqual([{ name: "HRI CL CHS", quantity: 1, unit: null, priceCents: 588, code: "003120506000" }]);
  });

  it("recovers a total whose amount was rebuilt on the preceding row", () => {
    expect(parseReceipt(["MILK 3.50", "SUBTOTAL 3.50", "3.78", "TOTAL"], NOW).totalCents).toBe(378);
  });

  it("repairs an implausible OCR prefix on total using subtotal and tax", () => {
    expect(parseReceipt(["MILK 327.75", "SUBTOTAL 327.75", "TAX 15.20", "TOTAL 11342.95"], NOW).totalCents).toBe(34295);
  });
});

describe("parseReceipt: general rules", () => {
  it("drops $0.00 lines, including a zero printed above the name", () => {
    const receipt = parseReceipt(
      ["Pulled Pork Sandwich  $ 8.50", "$ 0.00", "1 * Reg", "No Beverage  0.00", "Fountain Soda  2.25", "Total  10.75"],
      NOW,
    );
    expect(receipt.lines.map((l) => l.name)).toEqual(["Pulled Pork Sandwich", "Fountain Soda"]);
  });

  it("totals what coupons and Costco-style instant savings took off", () => {
    const receipt = parseReceipt(
      [
        "COSTCO WHOLESALE",
        "E 1234567 KS TP 30CT 19.99 A",
        "0000291633 / 975605  3.10 - A",
        "E 7654321 ORG EGGS 8.49 A",
        "COUPON  -1.00",
        "SUBTOTAL 24.38",
        "TOTAL 24.38",
      ],
      NOW,
    );
    expect(receipt.discountsCents).toBe(410);
    expect(receipt.lines.map((l) => l.priceCents)).toEqual([1999, 849]);
  });

  it("removes a 3-4 digit Costco item number, but not a leading brand number elsewhere", () => {
    const costco = parseReceipt(["COSTCO", "E 9462 ORANGES 12.99 A", "6884 AMORE TOV 9.99 A", "TOTAL 22.98"], NOW);
    expect(costco.lines.map((l) => l.name)).toEqual(["ORANGES", "AMORE TOV"]);
    const wholeFoods = parseReceipt(["WHOLE FOODS MARKET", "365 BALSAMIC VINEGAR $ 2.99 F", "TOTAL 2.99"], NOW);
    expect(wholeFoods.lines.map((l) => l.name)).toEqual(["365 BALSAMIC VINEGAR"]);
  });

  it("recognizes a restaurant check from its server, table or tip rows, or its name", () => {
    const restaurant = (...rows: string[]) => parseReceipt(rows, NOW).restaurant;
    expect(restaurant("Sam's Place", "Table 12 Guests 2", "Burger 12.00", "Total 12.00")).toBe(true);
    expect(restaurant("Joe's Diner", "Server: Pat", "Eggs 6.00", "Total 6.00")).toBe(true);
    expect(restaurant("Bayside Grill", "Fish 20.00", "Tip: ____", "Total 20.00")).toBe(true);
    expect(restaurant("Casa Chan Restaurant", "Tacos 9.00", "Total 9.00")).toBe(true);
  });

  it("doesn't take a shop for a restaurant", () => {
    const restaurant = (...rows: string[]) => parseReceipt(rows, NOW).restaurant;
    expect(restaurant("Walmart", "TABLE SALT 1.29", "Q-TIPS 2.50", "SERVE SPOON 3.00", "TOTAL 6.79")).toBe(false);
    expect(restaurant("COSTCO WHOLESALE", "KS KITCHEN TRASH BAGS 18.99", "TOTAL 18.99")).toBe(false);
  });
});

describe("parseReceipt: dates", () => {
  const dateOf = (...rows: string[]) => parseReceipt(rows, NOW).date?.toISOString().slice(0, 10) ?? null;

  it("reads the common formats", () => {
    expect(dateOf("10/20/2026 2:14 PM")).toBe("2026-10-20");
    expect(dateOf("Date: 2026-10-19")).toBe("2026-10-19");
    expect(dateOf("Oct 18, 2026")).toBe("2026-10-18");
    expect(dateOf("18 October 2026")).toBe("2026-10-18");
    expect(dateOf("TUE JANUARY 30, 2018")).toBe("2018-01-30");
    expect(dateOf("13 - Jul - 2018 8:53:47P")).toBe("2018-07-13");
    expect(dateOf("Aug08 19 07:33 PM")).toBe("2019-08-08");
    expect(dateOf("# 04 MAR.19'17 REG0001")).toBe("2017-03-19");
  });

  it("reads day/month when the first number can't be a month", () => {
    expect(dateOf("20.10.2026")).toBe("2026-10-20");
    expect(dateOf("13/05/26")).toBe("2026-05-13");
  });

  it("rejects dates that are impossible or in the future", () => {
    expect(dateOf("02/30/26")).toBeNull();
    expect(dateOf("12/25/26")).toBeNull();
  });

  it("falls through to a later row when an earlier one is not a date", () => {
    expect(dateOf("99/99/99", "10/20/26")).toBe("2026-10-20");
  });

  it("prefers a transaction date with a time over an earlier policy date", () => {
    expect(dateOf("Returns accepted after 9/15/2020.", "908 6387 02/10/2021 07:10 PM")).toBe("2021-02-10");
  });
});

describe("parseReceipt: stores", () => {
  it("falls back to the first row that reads like a name", () => {
    const receipt = parseReceipt(["FRESH MARKET FOODS", "1200 OAK AVE", "MILK 3.50", "TOTAL 3.50"], NOW);
    expect(receipt.store).toBe("Fresh Market Foods");
  });

  it("is null when nothing looks like a name", () => {
    expect(parseReceipt(["123 MAIN ST", "(555) 123-4567"], NOW).store).toBeNull();
  });

  it("finds a known chain after noisy text at the top of a photo", () => {
    const noise = Array.from({ length: 9 }, (_, index) => `noise ${index}`);
    expect(parseReceipt([...noise, "Walmart", "MILK 3.50", "TOTAL 3.50"], NOW).store).toBe("Walmart");
  });
});

describe("toDisplayName", () => {
  it("title-cases shouting and leaves mixed case alone", () => {
    expect(toDisplayName("GV WHL MLK GL")).toBe("Gv Whl Mlk Gl");
    expect(toDisplayName("Charmin Ultra")).toBe("Charmin Ultra");
    expect(toDisplayName("M&M'S PEANUT")).toBe("M&m's Peanut");
  });
});
