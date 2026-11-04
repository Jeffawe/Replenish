// Tries the AI's choice of listing on a real search. Uses one Channel3 credit and one Gemini call; stores and buys nothing.
//   npm run ai:pick -- "Toilet Paper" --unit rolls --qty 12 --brand Charmin
import { channel3FromEnv, listingReviewerFromEnv } from "../src/modules/restock";
import { canOrderFrom, pickOffers, type Wanted } from "../src/core/pick-offer";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const name = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
  if (!name) throw new Error('Say what to look for: npm run ai:pick -- "Toilet Paper" --unit rolls --qty 12 --brand Charmin');
  const brand = flag("--brand");
  const wanted: Wanted = { name, unit: flag("--unit") ?? "each", category: "Household", brands: brand ? [brand] : [], store: null, quantity: Number(flag("--qty") ?? 1), range: { minCents: null, maxCents: null }, canOrderFrom };
  const show = (label: string, picks: ReturnType<typeof pickOffers>) => {
    console.log(`\n${label}`);
    for (const { candidate: c, packSize, packs, totalCents, concerns } of picks.slice(0, 5)) console.log(`  ${c.title.slice(0, 70)} | ${c.domain} | $${(c.priceCents / 100).toFixed(2)} | ${packSize ?? "?"} per pack x ${packs} = $${(totalCents / 100).toFixed(2)} | ${concerns.join(", ") || "no concerns"}`);
  };
  const found = await channel3FromEnv().search(brand ? `${brand} ${name}` : name, { category: "Household" });
  const ruled = pickOffers(found, wanted);
  console.log(`${found.length} listings; ${ruled.filter((p) => !p.concerns.includes("not-orderable")).length} from stores we can order from.`);
  show("The rules' choice:", ruled);
  const reviewer = listingReviewerFromEnv();
  if (!reviewer) throw new Error("Set GEMINI_API_KEY in .env.local to see the AI's choice.");
  const reviewed = await reviewer.review(wanted, ruled);
  if (!reviewed) throw new Error("The AI gave no usable answer; see the message above.");
  show("After the AI:", reviewed.picks);
  console.log(`\nWhy: ${reviewed.reason ?? "(it chose none)"}`);
}

main().then(() => process.exit(), (error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
