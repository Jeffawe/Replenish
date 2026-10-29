/**
 * The text encoder behind receipt matching (see receipt/similar-wordings.ts).
 *
 *   npm run encoder -- warm                         download the model (about 23 MB) and check it runs
 *   npm run encoder -- try "GV WHL MLK GI" ...      show how close each text is to the user's confirmed wordings
 *
 * `warm` is worth running once on a new machine: the first receipt would
 * otherwise wait for the download. The model is kept in ENCODER_CACHE_DIR if
 * set, otherwise inside node_modules.
 */
import { getDemoUser } from "@/lib/demo-user";
import { listAliases } from "@/modules/inventory/aliases";
import { listProductSummaries } from "@/modules/inventory/ingest";
import { loadDictionary } from "@/modules/dictionary";
import { createModelEmbedder } from "@/modules/ingestion/receipt/encoder-model";
import { createSimilarWordings, ENCODER_CONFIG, type Reference } from "@/modules/ingestion/receipt/similar-wordings";

const [command, ...rest] = process.argv.slice(2);

async function main() {
  const embedder = createModelEmbedder();
  if (command === "warm") {
    const started = Date.now();
    const [vector] = await embedder.embed(["whole milk gallon"]);
    console.log(`Encoder ready: ${vector!.length}-dimension vectors, loaded in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
    return;
  }
  if (command === "try" && rest.length > 0) {
    const user = await getDemoUser();
    const [aliases, products, dictionary] = await Promise.all([listAliases(user.id), listProductSummaries(user.id), loadDictionary()]);
    const names = new Map(products.map((p) => [p.id, p.name]));
    const references: Reference[] = [
      ...aliases.filter((a) => !a.alias.startsWith("#")).map((a): Reference => ({ text: a.alias, target: { kind: "product", productId: a.productId } })),
      ...dictionary.terms.filter((t) => t.text.includes(" ")).map((t): Reference => ({ text: t.text, target: { kind: "item", name: t.item } })),
    ];
    console.log(`${references.length} wordings to compare against (your confirmed wordings and the dictionary's phrases). Suggests at ${ENCODER_CONFIG.minScore}+ with a ${ENCODER_CONFIG.minLead} lead.`);
    const found = await createSimilarWordings(embedder).nearest(rest, references);
    rest.forEach((text, i) => {
      const hit = found[i];
      const target = hit ? (hit.target.kind === "product" ? `your ${names.get(hit.target.productId)}` : `the item ${hit.target.name}`) : null;
      console.log(`${JSON.stringify(text).padEnd(32)} ${hit ? `${hit.score.toFixed(2)} -> ${target} (like "${hit.reference}")` : "nothing close enough"}`);
    });
    return;
  }
  console.log('Usage: npm run encoder -- warm   |   npm run encoder -- try "GV WHL MLK GI" "SOME OTHER LINE"');
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
