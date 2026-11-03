// Runs the low-stock check by hand, the same code the cron route runs. Nothing is bought or asked.
//   npm run low                       the products that are low now (and moves the date of due ones that aren't)
//   npm run low -- --sweep            first recalculate every product's check date (fills in new ones)
//   npm run low -- --user <user id>   only that account
import { runLowStockCheck, sweepNextChecks } from "../src/modules/restock";

async function main() {
  const args = process.argv.slice(2);
  const userIndex = args.indexOf("--user");
  const userId = userIndex >= 0 ? args[userIndex + 1] : undefined;
  if (userIndex >= 0 && !userId) {
    console.error("Usage: npm run low -- [--sweep] [--user <user id>]");
    process.exit(1);
  }

  if (args.includes("--sweep")) {
    const swept = await sweepNextChecks({ userId });
    console.log(`Swept ${swept.products} products for ${swept.users} accounts.`);
    for (const error of swept.errors) console.error(`  account ${error.userId}: ${error.message}`);
  }

  const check = await runLowStockCheck({ userId });
  console.log(`Looked at ${check.checked} due products${check.moreDue ? " (more are due; run again)" : ""}. ${check.low.length} low:`);
  for (const { userId: owner, product, estimate } of check.low) {
    const left = estimate.estimatedRemaining === null ? "?" : estimate.estimatedRemaining.toFixed(1);
    const days = estimate.daysUntilRunOut === null ? "?" : estimate.daysUntilRunOut.toFixed(1);
    console.log(
      `  ${product.name}  ${left} ${product.unit} left, out in ${days} days, ${Math.round(estimate.confidence * 100)}% sure (${estimate.rateSource})` +
        `  ${product.confirmedAt ? "confirmed" : "unconfirmed"}, auto-buy ${product.autobuyEnabled ? "on" : "off"}` +
        `${product.boughtFrom ? `, from ${product.boughtFrom}` : ""}  [account ${owner.slice(0, 8)}]`,
    );
  }
  for (const error of check.errors) console.error(`  account ${error.userId}: ${error.message}`);
}

main().then(() => process.exit(), (error) => {
  console.error(error);
  process.exit(1);
});
