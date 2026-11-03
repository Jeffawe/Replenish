// Finds the low products and looks each one up online. Buys nothing, asks nothing, stores nothing.
//   npm run restock                       low products now: household goods on Channel3 (one credit each), food on Zinc ($0.01 each, free in the sandbox)
//   npm run restock -- --mock             the same with invented listings (no key, no credits)
//   npm run restock -- --save             also store what it finds, so the dashboard asks the user at their next login
//   npm run restock -- --json             print the RestockReport as JSON (what the next step receives)
//   npm run restock -- --user <user id>   only that account
//   npm run restock -- --limit <n>        search at most n products (default 50)
import { createMockSearch, runRestock, runRestockAndAsk, searchFromEnv } from "../src/modules/restock";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

async function main() {
  const args = process.argv.slice(2);
  const valueOf = (flag: string) => {
    const index = args.indexOf(flag);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      console.error("Usage: npm run restock -- [--mock] [--save] [--json] [--user <user id>] [--limit <n>]");
      process.exit(1);
    }
    return value;
  };
  const userId = valueOf("--user");
  const limit = valueOf("--limit") === undefined ? undefined : Number(valueOf("--limit"));
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    console.error("--limit needs a whole number above 0");
    process.exit(1);
  }

  const mock = args.includes("--mock");
  if (!mock && !process.env.CHANNEL3_API_KEY && !process.env.ZINC_API_KEY) {
    console.error("Set CHANNEL3_API_KEY (household goods) and/or ZINC_API_KEY (food; `npm run zinc:key` adds a free sandbox key) in .env.local, or try --mock.");
    process.exit(1);
  }
  const search = mock ? createMockSearch() : searchFromEnv();

  const asked = args.includes("--save") ? await runRestockAndAsk(search, { userId }, limit) : null;
  const report = asked ?? (await runRestock(search, { userId }, limit));
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`Looked at ${report.checked} due products${report.moreDue ? " (more are due; run again)" : ""}. ${report.items.length + report.skipped.length} low${mock ? " (listings below are MADE UP)" : ""}:`);
  for (const item of report.items) {
    const days = item.estimate.daysUntilRunOut === null ? "?" : item.estimate.daysUntilRunOut.toFixed(1);
    console.log(`\n${item.name}  out in ${days} days, auto-buy ${item.autobuyEnabled ? "on" : "off"}${item.boughtFrom ? `, usually from ${item.boughtFrom}` : ""}  [account ${item.userId.slice(0, 8)}]`);
    console.log(`  searched for "${item.query}"`);
    if (item.status === "error") console.log(`  could not search: ${item.message}`);
    else if (item.status === "none") console.log(item.reason === "no-results" ? "  nothing found" : `  ${item.listings} listings, none usable (in stock, new, same kind of thing)`);
    else {
      const { pick, alternatives } = item;
      const size = pick.packSize === null ? "size not stated" : `${pick.packSize} per pack`;
      console.log(`  best: ${pick.title}${pick.sample ? "   [SAMPLE DATA, not a real offer]" : ""}`);
      console.log(`        ${pick.domain}  ${money(pick.priceCents)} x ${pick.packs} (${size}) = ${money(pick.totalCents)}`);
      console.log(`        ${pick.url}`);
      console.log(`        concerns: ${pick.concerns.length === 0 ? "none" : pick.concerns.join(", ")}`);
      console.log(`  ${alternatives.length} other listings kept${alternatives.length ? `: ${alternatives.map((a) => `${a.domain} ${money(a.priceCents)}`).join(", ")}` : ""}`);
    }
  }
  if (asked) console.log(`\nStored ${asked.saved} suggestions for the dashboard; ${asked.alreadyAsked} low products already had a recent one (not searched again); cleared ${asked.cleared}; forgot ${asked.forgotten} for restocked products.`);
  if (report.skipped.length > 0) console.log(`\n${report.skipped.length} low products were not searched (limit reached): ${report.skipped.map((s) => s.name).join(", ")}`);
  for (const error of report.errors) console.error(`account ${error.userId}: ${error.message}`);
}

main().then(() => process.exit(), (error) => {
  console.error(error);
  process.exit(1);
});
