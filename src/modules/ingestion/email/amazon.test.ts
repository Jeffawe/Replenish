import { describe, expect, it } from "vitest";
import { amazonReader, arrivalDate } from "./amazon";
import type { EmailMessage } from "./types";

// The structure of a real Amazon confirmation (name, city and order number changed).
const REAL_BODY = `---------- Forwarded message ---------
From: Amazon.com <auto-confirm@amazon.com>
Date: Wed, 30 Sept 2026 at 11:37
Subject: Ordered 1 item: Phone Accessories
To: <someone@gmail.com>

Amazon logo\tYour Orders\tYour Account
Sam, your Phone Accessories are confirmed!
View or edit order
Completed
Ordered
Pending
Shipped
Pending
Out for delivery
Pending
Delivered
Arriving tomorrow

1 item: Phone Accessories
Sam - SOMEWHERE, NY
Order # 114-0000000-0000001

Grand Total:\t$7.61
`;

const mail = (overrides: Partial<EmailMessage> = {}): EmailMessage => ({
  messageId: "m1",
  from: "Amazon.com <auto-confirm@amazon.com>",
  subject: "Fwd: Ordered 1 item: Phone Accessories",
  receivedAt: new Date("2026-11-02T04:34:00Z"),
  text: REAL_BODY,
  ...overrides,
});

describe("amazonReader", () => {
  it("reads the real confirmation: order number, the item, and 'arriving tomorrow' from the original's date", async () => {
    const order = await amazonReader.read(mail(), "Amazon");
    expect(order).toEqual({
      orderId: "114-0000000-0000001",
      arrivesAt: new Date("2026-10-01T12:00:00Z"),
      lines: [{ name: "Phone Accessories", quantity: 1 }],
    });
  });

  it("uses the day it reached us when it wasn't forwarded by hand (a Gmail filter)", async () => {
    const text = REAL_BODY.replace(/-{3,} Forwarded message -{3,}[\s\S]*?To: <[^>]*>\n/, "");
    const order = await amazonReader.read(mail({ subject: "Ordered 1 item: Phone Accessories", text }), "Amazon");
    expect(order?.arrivesAt).toEqual(new Date("2026-11-03T12:00:00Z"));
  });

  it("reads the count from 'N items' and the title from the older 'Ordered: ...' subject", async () => {
    const text = "Arriving today\nOrder # 111-2222222-3333333\n";
    const several = await amazonReader.read(mail({ subject: "Ordered 3 items: Dish Soap", text }), "Amazon");
    expect(several?.lines).toEqual([{ name: "Dish Soap", quantity: 3 }]);

    const older = await amazonReader.read(mail({ subject: 'Ordered: "Paper Towels, 12 Rolls" and 2 more items', text }), "Amazon");
    expect(older?.lines).toEqual([{ name: "Paper Towels, 12 Rolls", quantity: 1 }]);
    expect(older?.arrivesAt).toEqual(new Date("2026-11-02T12:00:00Z"));
  });

  it("leaves the arrival empty when the email names none", async () => {
    const order = await amazonReader.read(mail({ text: "Order # 111-2222222-3333333\n" }), "Amazon");
    expect(order?.arrivesAt).toBeNull();
  });

  it("finds the order number however it is labelled, or by its shape alone", async () => {
    for (const label of ["Order #: 111-2222222-3333333", "Order number: 111-2222222-3333333", "Order #\n111-2222222-3333333", "Your order 111-2222222-3333333 is confirmed"]) {
      const order = await amazonReader.read(mail({ text: `Arriving today\n${label}\n` }), "Amazon");
      expect(order?.orderId).toBe("111-2222222-3333333");
    }
  });

  it("finds the order number when Amazon hides an invisible character before it", async () => {
    // The real email prints "Order # <U+202B>114-...": a right-to-left mark that \s does not match.
    const order = await amazonReader.read(mail({ text: "Arriving tomorrow\n1 item: Phone Accessories\nOrder # \u202b111-2222222-3333333\n" }), "Amazon");
    expect(order?.orderId).toBe("111-2222222-3333333");
  });

  it("ignores anything that isn't an order confirmation", async () => {
    expect(await amazonReader.read(mail({ subject: "Shipped: Phone Accessories" }), "Amazon")).toBeNull();
    expect(await amazonReader.read(mail({ subject: "Prime Big Deal Days is Oct 6-7" }), "Amazon")).toBeNull();
    expect(await amazonReader.read(mail({ text: "Arriving tomorrow\n1 item: Phone Accessories" }), "Amazon")).toBeNull();
  });
});

describe("arrivalDate", () => {
  const from = new Date("2026-10-01T12:00:00Z"); // a Thursday

  it("works out today, tomorrow, a weekday, and a written date", () => {
    expect(arrivalDate("Arriving today", from)).toEqual(from);
    expect(arrivalDate("Arriving tomorrow", from)).toEqual(new Date("2026-10-02T12:00:00Z"));
    expect(arrivalDate("Arriving Monday", from)).toEqual(new Date("2026-10-05T12:00:00Z"));
    expect(arrivalDate("Arriving Thursday", from)).toEqual(new Date("2026-10-08T12:00:00Z"));
    expect(arrivalDate("Arriving Saturday, October 3", from)).toEqual(new Date("2026-10-03T12:00:00Z"));
    expect(arrivalDate("Arriving by Sat, Oct 3 - Mon, Oct 5", from)).toEqual(new Date("2026-10-03T12:00:00Z"));
  });

  it("rolls into the next year, and gives up on what it can't read", () => {
    expect(arrivalDate("Arriving January 2", new Date("2026-12-29T12:00:00Z"))).toEqual(new Date("2027-01-02T12:00:00Z"));
    expect(arrivalDate("Arriving soon", from)).toBeNull();
    expect(arrivalDate("Nothing about it", from)).toBeNull();
  });
});
