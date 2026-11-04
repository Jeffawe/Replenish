// Runs against the real database (npm run test:db), with throwaway users deleted afterwards.
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { orders } from "@/db/schema";
import { ORDERS_PAGE_SIZE } from "./types";
import { listOrdersPage } from "./service";
import { throwawayUsers } from "./test-helpers";

const newUser = throwawayUsers();

const listing = { title: "Toilet Paper", domain: "walmart.com", url: "https://example.com/tp", brand: null, priceCents: 1000, packSize: null, sample: false };

/** `count` orders made on consecutive days ending at `lastDay`, newest has the highest number in its name. */
async function makeOrders(userId: string, count: number, lastDay: string, source: "auto" | "buy-now" = "buy-now") {
  const last = new Date(lastDay).getTime();
  await db.insert(orders).values(
    Array.from({ length: count }, (_, i) => ({
      userId,
      productName: `Item ${i + 1}`,
      source,
      status: "placed",
      listing,
      packs: 1,
      ceilingCents: 1000,
      createdAt: new Date(last - (count - 1 - i) * 60 * 60 * 1000),
    })),
  );
}

describe("listing the user's orders a page at a time", () => {
  it("gives the newest first, ten to a page, and says how many pages there are", async () => {
    const userId = await newUser();
    await makeOrders(userId, 23, "2026-11-20T12:00:00Z");

    const first = await listOrdersPage(userId, { month: null, page: 1 });
    expect(first).toMatchObject({ page: 1, pageCount: 3, total: 23 });
    expect(first.orders).toHaveLength(ORDERS_PAGE_SIZE);
    expect(first.orders[0]!.productName).toBe("Item 23");

    const third = await listOrdersPage(userId, { month: null, page: 3 });
    expect(third.orders.map((order) => order.productName)).toEqual(["Item 3", "Item 2", "Item 1"]);
  });

  it("shows the last page for a page past the end, and an empty first page for no orders", async () => {
    const userId = await newUser();
    expect(await listOrdersPage(userId, { month: null, page: 1 })).toMatchObject({ orders: [], total: 0, pageCount: 1, page: 1, months: [] });
    await makeOrders(userId, 12, "2026-11-20T12:00:00Z");
    expect(await listOrdersPage(userId, { month: null, page: 99 })).toMatchObject({ page: 2, pageCount: 2 });
  });

  it("filters by month (UTC), restarts the pages inside it, and lists the months with their counts", async () => {
    const userId = await newUser();
    await makeOrders(userId, 3, "2026-10-31T23:30:00Z"); // late on the last day of October
    await makeOrders(userId, 12, "2026-11-15T12:00:00Z");
    await makeOrders(userId, 1, "2026-12-01T00:00:00Z"); // the very start of December

    const november = await listOrdersPage(userId, { month: "2026-11", page: 1 });
    expect(november).toMatchObject({ total: 12, pageCount: 2, month: "2026-11" });
    expect(november.orders.every((order) => order.createdAt.startsWith("2026-11"))).toBe(true);

    expect((await listOrdersPage(userId, { month: "2026-10", page: 1 })).total).toBe(3);
    expect((await listOrdersPage(userId, { month: "2026-12", page: 1 })).total).toBe(1);
    expect((await listOrdersPage(userId, { month: "2025-01", page: 1 })).orders).toEqual([]);
    expect(november.months).toEqual([
      { month: "2026-12", count: 1 },
      { month: "2026-11", count: 12 },
      { month: "2026-10", count: 3 },
    ]);
  });

  it("only ever shows the user's own orders, auto-buy and buy-now side by side", async () => {
    const mine = await newUser();
    const theirs = await newUser();
    await makeOrders(mine, 2, "2026-11-20T12:00:00Z", "auto");
    await makeOrders(mine, 1, "2026-11-19T12:00:00Z", "buy-now");
    await makeOrders(theirs, 5, "2026-11-20T12:00:00Z");

    const page = await listOrdersPage(mine, { month: null, page: 1 });
    expect(page.total).toBe(3);
    expect(page.months).toEqual([{ month: "2026-11", count: 3 }]);
    expect(page.orders.map((order) => order.source).sort()).toEqual(["auto", "auto", "buy-now"]);
  });
});
