/**
 * Runs receipt photos through the real receipt pipeline (Google Vision OCR,
 * rows, parse, dictionary, matching against the demo user's products) and
 * prints what the review screen would show. Read-only: nothing is stored.
 *
 *   npm run receipt -- path/to/receipt.jpg [more.jpg ...]
 *
 * Each photo is one billable Vision call (the first 1,000 a month are free)
 * the first time, and is then read from .cache/receipt-ocr/ (keyed by the
 * photo's bytes), so changing the parser and re-running costs nothing. Pass
 * --fresh to call Vision again and replace the saved copy. The cache holds
 * the text of real receipts, so it is gitignored; delete the folder when done.
 * Add --rows to also print the rebuilt rows, the first thing to read when a
 * receipt comes out wrong.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { getDefaultUser } from "@/modules/auth/accounts";
import { loadDictionary, lookupProductCodes } from "@/modules/dictionary";
import { createModelEmbedder } from "@/modules/ingestion/receipt/encoder-model";
import { createReceiptExtractor } from "@/modules/ingestion/receipt/extractor";
import { createSimilarWordings } from "@/modules/ingestion/receipt/similar-wordings";
import { createGoogleVisionEngine } from "@/modules/ingestion/receipt/ocr/google-vision";
import type { OcrEngine, OcrResult } from "@/modules/ingestion/receipt/ocr/types";
import { listAliases, listIgnoredWordings } from "@/modules/inventory/aliases";
import { listProductSummaries } from "@/modules/inventory/ingest";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const CACHE_DIR = join(process.cwd(), ".cache", "receipt-ocr");

/** Remembers each photo's OCR result on disk so a photo costs one Vision call, ever. */
function cachedEngine(inner: OcrEngine, fresh: boolean, tally: { calls: number; hits: number }): OcrEngine {
  return {
    async read(image) {
      const file = join(CACHE_DIR, `${createHash("sha256").update(image).digest("hex")}.json`);
      if (!fresh && existsSync(file)) {
        tally.hits++;
        return JSON.parse(readFileSync(file, "utf8")) as OcrResult;
      }
      const result = await inner.read(image);
      tally.calls++;
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(file, JSON.stringify(result));
      return result;
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const showRows = args.includes("--rows");
  const fresh = args.includes("--fresh");
  const paths = args.filter((arg) => !arg.startsWith("--"));
  if (paths.length === 0) {
    console.error("Usage: npm run receipt -- <photo> [more photos] [--rows] [--fresh]");
    process.exit(1);
  }
  const tally = { calls: 0, hits: 0 };

  const user = await getDefaultUser();
  const products = await listProductSummaries(user.id);
  const extractor = createReceiptExtractor({
    ocr: cachedEngine(createGoogleVisionEngine(), fresh, tally),
    loadAliases: listAliases,
    loadIgnored: listIgnoredWordings,
    // The same helpers as the app: the live dictionary, product-code lookups (kept in the database) and the encoder.
    loadDictionary,
    lookup: lookupProductCodes,
    similar: createSimilarWordings(createModelEmbedder()),
  });

  for (const path of paths) {
    const type = TYPES[extname(path).toLowerCase()] ?? "image/jpeg";
    const image = new File([readFileSync(path)], path, { type });
    console.log(`\n===== ${path}`);
    const result = await extractor.extract({ image }, { userId: user.id, products, now: new Date() });
    if (result.kind !== "draft") {
      console.log(result);
      continue;
    }

    const { batch, warnings, lines = [], sourceText } = result.draft;
    if (showRows) console.log(`--- rows\n${sourceText}`);
    console.log(`--- ${batch.store ?? "(no store)"}, ${batch.purchasedAt}, key ${batch.idempotencyKey}`);
    console.log("    [x] ticked   [ ] starts unticked      receipt wording -> product (brand) qty unit price(cents) match");
    batch.items.forEach((item, i) => {
      const line = lines[i];
      console.log(
        line?.excludeReason ? "[ ]" : "[x]",
        JSON.stringify(line?.sourceText ?? "").padEnd(34),
        "->",
        item.productName,
        item.brand ? `(${item.brand})` : "",
        item.quantity,
        item.unit,
        item.priceCents ?? "-",
        line?.matchedBy ?? "new",
        line?.excludeReason ?? "",
      );
    });
    const itemsTotal = batch.items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
    console.log(`--- items add up to ${itemsTotal} cents`);
    for (const warning of warnings) console.log(`--- warning ${warning.code}: ${warning.message}`);
  }
  console.log(`\nVision calls made: ${tally.calls}, read from cache: ${tally.hits}`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
