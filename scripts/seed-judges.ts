// Fills the judges' account with a believable history: 4 receipts over 2 months (one every two
// weeks) plus today's, 5 products. It goes through the real receiver (ingestPurchaseBatch),
// the same one a saved receipt uses, so estimates, "bought from" and the low-stock dates are the
// ones the app really works out. It does NOT teach the shared dictionary (these aren't real receipts).
//
//   npm run seed:judges                 show the plan, write nothing
//   npm run seed:judges -- --apply      write it (stops if the account already has products)
//   npm run seed:judges -- --apply --reset   first delete that account's products (and their history)
//
// Only the judges' account is touched.
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { productAliases, products, purchaseEvents, users } from "../src/db/schema";
import { PurchaseBatchSchema, type PurchaseBatchInput } from "../src/core/purchase-batch";
import { normalizeProductName } from "../src/core/product-name";
import { confirmProduct } from "../src/modules/inventory/checks";
import { ingestPurchaseBatch } from "../src/modules/inventory/ingest";
import { saveAliases } from "../src/modules/inventory/aliases";

const JUDGES_EMAIL = "judges@jeffawe.dev";
const STORE = "Walmart";

/** What each product is: its name, unit and brand, and how the receipt printed it. */
const ITEMS = {
  toiletPaper: { name: "Toilet Paper", unit: "pack", category: "Household", brand: "Charmin", printed: "CHARMIN ULTRA SOFT 12CT", priceCents: 1397 },
  toothpaste: { name: "Toothpaste", unit: "tube", category: "Personal Care", brand: "Colgate", printed: "COLGATE TOTAL 4.8OZ", priceCents: 348 },
  groundnuts: { name: "Groundnuts", unit: "bag", category: "Groceries", brand: "Great Value", printed: "GV DRY RSTD PNUT 16OZ", priceCents: 428 },
  soap: { name: "Bar Soap", unit: "pack", category: "Personal Care", brand: "Dove", printed: "DOVE BAR SOAP 6PK", priceCents: 897 },
  dishSoap: { name: "Dish Soap", unit: "jug", category: "Household", brand: "Dawn", printed: "DAWN DISH LIQUID 75OZ", priceCents: 997 },
} as const;
type Key = keyof typeof ITEMS;

/**
 * A shop every two weeks (all Mondays, around lunchtime). The first four are the two months of
 * history; the fifth is today's, where everything was bought again and toilet paper and soap were
 * stocked up (2 packs), so in December some products are still fine while others are low.
 * Worked out by running the estimates over each day: up to about Dec 12, toilet paper and bar soap
 * are fine and toothpaste, dish soap and groundnuts are low; after that only toilet paper (to about
 * Dec 28). Change a date or quantity here and check again.
 */
const RECEIPTS: { key: string; date: string; lines: { item: Key; quantity: number }[] }[] = [
  { key: "r1", date: "2026-09-14T17:20:00Z", lines: [{ item: "toiletPaper", quantity: 1 }, { item: "toothpaste", quantity: 1 }, { item: "groundnuts", quantity: 2 }, { item: "dishSoap", quantity: 1 }] },
  { key: "r2", date: "2026-09-28T16:45:00Z", lines: [{ item: "toothpaste", quantity: 1 }, { item: "soap", quantity: 1 }] },
  { key: "r3", date: "2026-10-12T18:05:00Z", lines: [{ item: "toiletPaper", quantity: 1 }, { item: "toothpaste", quantity: 1 }, { item: "dishSoap", quantity: 1 }] },
  { key: "r4", date: "2026-10-26T17:40:00Z", lines: [{ item: "toothpaste", quantity: 1 }, { item: "soap", quantity: 1 }, { item: "groundnuts", quantity: 1 }] },
  { key: "r5", date: "2026-11-09T16:30:00Z", lines: [{ item: "toiletPaper", quantity: 2 }, { item: "toothpaste", quantity: 1 }, { item: "groundnuts", quantity: 1 }, { item: "soap", quantity: 2 }, { item: "dishSoap", quantity: 1 }] },
];

const batchFor = (receipt: (typeof RECEIPTS)[number]): PurchaseBatchInput => ({
  source: "receipt",
  idempotencyKey: `judges-demo-${receipt.key}`,
  store: STORE,
  purchasedAt: receipt.date,
  items: receipt.lines.map(({ item, quantity }) => {
    const it = ITEMS[item];
    return { productName: it.name, brand: it.brand, category: it.category, quantity, unit: it.unit, priceCents: it.priceCents * quantity };
  }),
});

function printPlan() {
  for (const receipt of RECEIPTS) {
    const total = receipt.lines.reduce((sum, l) => sum + ITEMS[l.item].priceCents * l.quantity, 0);
    console.log(`\n${receipt.date.slice(0, 10)}  ${STORE}  (receipt ${receipt.key}, $${(total / 100).toFixed(2)})`);
    for (const l of receipt.lines) console.log(`   ${l.quantity} x ${ITEMS[l.item].name} (${ITEMS[l.item].unit})  ${ITEMS[l.item].brand}`);
  }
  console.log("\nPer product:");
  for (const key of Object.keys(ITEMS) as Key[]) {
    const bought = RECEIPTS.flatMap((r) => r.lines.filter((l) => l.item === key).map((l) => `${r.date.slice(5, 10)}:${l.quantity}`));
    console.log(`   ${ITEMS[key].name.padEnd(13)} ${bought.join("  ")}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const reset = process.argv.includes("--reset");
  printPlan();

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, JUDGES_EMAIL));
  if (!user) throw new Error(`No account for ${JUDGES_EMAIL}. Create it first.`);
  const existing = await db.select({ name: products.name }).from(products).where(eq(products.userId, user.id));
  console.log(`\nThe judges' account has ${existing.length} product(s) now${existing.length ? `: ${existing.map((p) => p.name).join(", ")}` : ""}.`);

  if (!apply) return console.log("Dry run: nothing written. Add --apply to write it.");
  if (existing.length > 0 && !reset) throw new Error("The account already has products. Use --reset to delete them (and their history) first.");
  if (reset) {
    await db.delete(products).where(eq(products.userId, user.id)); // cascades purchases, aliases, counts
    console.log("Deleted the account's existing products.");
  }

  for (const receipt of RECEIPTS) {
    const batch = PurchaseBatchSchema.parse(batchFor(receipt));
    const outcome = await ingestPurchaseBatch(user.id, batch);
    const rejected = outcome.items.filter((i) => i.result === "rejected");
    if (rejected.length > 0) throw new Error(`Receipt ${receipt.key} had rejected lines: ${JSON.stringify(rejected)}`);
  }

  // The user "tracked" these, so they are confirmed, and the receipts' wordings are remembered.
  const made = await db.select().from(products).where(eq(products.userId, user.id));
  const byName = new Map(made.map((p) => [p.normalizedName, p]));
  const aliases = [];
  for (const it of Object.values(ITEMS)) {
    const product = byName.get(normalizeProductName(it.name));
    if (!product) throw new Error(`${it.name} wasn't created`);
    await confirmProduct(user.id, product.id);
    aliases.push({ alias: normalizeProductName(it.printed), productId: product.id });
  }
  await saveAliases(user.id, aliases);

  // Rows were written today; make them look like they were made when the receipts were: the app
  // reads product and purchase ages in places.
  for (const product of made) {
    const first = await db.select({ at: purchaseEvents.purchasedAt }).from(purchaseEvents).where(eq(purchaseEvents.productId, product.id));
    const earliest = new Date(Math.min(...first.map((r) => r.at.getTime())));
    await db.update(products).set({ createdAt: earliest }).where(eq(products.id, product.id));
  }
  await db.update(purchaseEvents).set({ createdAt: purchaseEvents.purchasedAt }).where(eq(purchaseEvents.userId, user.id));
  await db.update(productAliases).set({ createdAt: new Date(RECEIPTS[0]!.date) }).where(eq(productAliases.userId, user.id));

  console.log(`\nDone: ${RECEIPTS.length} receipts, ${made.length} products for ${JUDGES_EMAIL}.`);
}

main().then(() => process.exit(), (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
