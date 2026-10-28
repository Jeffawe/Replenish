/**
 * Reads the test samples the app keeps (see SAMPLES_DIR, receipt/samples.ts)
 * and says how our drafts held up against what you saved.
 *
 *   npm run samples [-- <folder>] [--replay] [--all]
 *
 * The folder defaults to SAMPLES_DIR. For every receipt you saved, it lists
 * each drafted line as saved as-is, edited, removed (we ticked it, you didn't)
 * or added (we left it unticked, you ticked it), plus store and date changes,
 * then totals. Receipts read but never saved are counted, not scored.
 *
 * --replay also runs today's parser over the stored OCR words and checks the
 * lines it finds against what you saved, so a parser fix can be scored on
 * every kept receipt with no Vision call and no database.
 * --all lists lines that needed no change too.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { groupIntoRows } from "@/modules/ingestion/receipt/layout";
import type { OcrResult } from "@/modules/ingestion/receipt/ocr/types";
import { parseReceipt } from "@/modules/ingestion/receipt/parse";
import { compareDraft, compareParse, type Confirmed, type LineVerdict } from "@/modules/ingestion/receipt/sample-review";
import type { Draft } from "@/modules/ingestion/types";

const args = process.argv.slice(2);
const replay = args.includes("--replay");
const showAll = args.includes("--all");
const root = args.find((arg) => !arg.startsWith("--")) ?? process.env.SAMPLES_DIR;
if (!root || !existsSync(root)) {
  console.error("Usage: npm run samples [-- <samples folder>] [--replay] [--all]   (or set SAMPLES_DIR)");
  process.exit(1);
}

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null);

const totals: Record<LineVerdict, number> = { "as-is": 0, edited: 0, removed: 0, added: 0, "left-out": 0 };
const parseTotals = { found: 0, different: 0, missing: 0, extra: 0 };
let saved = 0;
let unsaved = 0;
let skipped = 0;
let noEdits = 0;

for (const id of readdirSync(resolve(root)).sort()) {
  const folder = join(resolve(root), id);
  const read = readJson<{ readAt: string; kind: "draft" | "skipped"; draft?: Draft; reason?: string }>(join(folder, "draft.json"));
  if (!read) continue;
  if (read.kind === "skipped" || !read.draft) {
    skipped++;
    console.log(`\n===== ${id}  (not turned into a draft: ${read.reason})`);
    continue;
  }
  const confirmed = readJson<Confirmed & { confirmedAt: string }>(join(folder, "confirmed.json"));
  if (!confirmed) {
    unsaved++;
    continue;
  }
  saved++;

  console.log(`\n===== ${id}  ${read.draft.batch.store ?? "(no store)"}  saved ${confirmed.confirmedAt}`);
  const comparison = compareDraft(read.draft, confirmed);
  if (comparison.store) console.log(`  store: ${comparison.store.drafted ?? "none"} -> ${comparison.store.saved ?? "none"}`);
  if (comparison.date) console.log(`  date: ${comparison.date.drafted} -> ${comparison.date.saved}`);
  for (const line of comparison.lines) {
    totals[line.verdict]++;
    if (showAll || (line.verdict !== "as-is" && line.verdict !== "left-out")) {
      console.log(`  ${line.verdict.padEnd(8)} ${JSON.stringify(line.wording)} ${line.changes.join("; ")}`);
    }
  }
  const clean = !comparison.store && !comparison.date && comparison.lines.every((line) => line.verdict === "as-is" || line.verdict === "left-out");
  if (clean) noEdits++;

  if (replay) {
    const ocr = readJson<OcrResult>(join(folder, "ocr.json"));
    if (!ocr) continue;
    console.log("  --- parser replay");
    for (const line of compareParse(parseReceipt(groupIntoRows(ocr.words), new Date(confirmed.batch.purchasedAt)).lines, confirmed)) {
      parseTotals[line.verdict]++;
      if (showAll || line.verdict !== "found") console.log(`  ${line.verdict.padEnd(9)} ${JSON.stringify(line.wording)} ${line.detail ?? ""}`);
    }
  }
}

const lineCount = totals["as-is"] + totals.edited + totals.removed + totals.added + totals["left-out"];
console.log(`\n${saved} saved receipts, ${unsaved} read but not saved, ${skipped} we couldn't draft.`);
if (saved > 0) {
  console.log(`${noEdits} of ${saved} needed no edits at all.`);
  console.log(`Lines (${lineCount}): ${Object.entries(totals).map(([verdict, n]) => `${n} ${verdict}`).join(", ")}.`);
  if (replay) console.log(`Parser replay: ${Object.entries(parseTotals).map(([verdict, n]) => `${n} ${verdict}`).join(", ")}.`);
}
