// Shows what has been ordered, and moves unfinished orders along. Nothing is bought here.
//   npm run orders                       the latest orders for everyone
//   npm run orders -- --settle           first ask Zinc about orders in progress (and refund what is owed)
//   npm run orders -- --user <user id>   only that account
import { desc, eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { orders } from "../src/db/schema";
import { monthlyBudget, orderDepsFromEnv, settleOrders } from "../src/modules/orders";

const money = (cents: number | null) => (cents === null ? "-" : `$${(cents / 100).toFixed(2)}`);

async function main() {
  const args = process.argv.slice(2);
  const userIndex = args.indexOf("--user");
  const userId = userIndex >= 0 ? args[userIndex + 1] : undefined;
  if (userIndex >= 0 && !userId) {
    console.error("Usage: npm run orders -- [--settle] [--user <user id>]");
    process.exit(1);
  }
  if (args.includes("--settle")) {
    const settled = await settleOrders(orderDepsFromEnv(), { userId });
    console.log(`Looked at ${settled.checked} orders.`);
  }
  const budget = await monthlyBudget();
  console.log(`This month, all users: ${money(budget.spentCents)} of ${money(budget.limitCents)} (${budget.plannedUsers} planned users x ${money(budget.perUserCents)}; change it with PLANNED_USERS)\n`);
  const rows = await db.select().from(orders).where(userId ? eq(orders.userId, userId) : undefined).orderBy(desc(orders.createdAt)).limit(30);
  if (rows.length === 0) console.log("No orders yet.");
  for (const row of rows) {
    const tracking = (row.tracking as { carrier: string | null; number: string; status: string }[]).map((t) => `${t.carrier ?? "?"} ${t.number} (${t.status})`).join(", ");
    console.log(
      `${row.createdAt.toISOString().slice(0, 16)}  ${row.status.padEnd(10)} ${row.productName}  [${row.source}]  charged ${money(row.chargedCents)}, cost ${money(row.totalCents)}, refunded ${money(row.refundedCents)} (${row.paymentStatus})` +
        `${row.failureReason ? `\n    ${row.failureReason}` : ""}${tracking ? `\n    tracking: ${tracking}` : ""}  [account ${row.userId.slice(0, 8)}]`,
    );
  }
}

main().then(() => process.exit(), (error) => {
  console.error(error);
  process.exit(1);
});
