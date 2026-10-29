/**
 * Reads and edits the shared dictionary (what receipt wordings mean). For a
 * person or an agent; see docs/dictionary.md.
 *
 *   npm run dictionary -- seed                       put the starter list in an empty table
 *   npm run dictionary -- list [--pending|--off|--active] [--kind item|term|brand|code] [--find text]
 *   npm run dictionary -- add-item "Blackberries" --category Groceries [--unit carton] [--durable]
 *   npm run dictionary -- add-term "blkbry" --item "Blackberries"
 *   npm run dictionary -- add-brand "Gain" --terms "gain" [--item "Laundry Detergent"]
 *   npm run dictionary -- add-code --store Walmart --code 007874235186 --item Milk
 *   npm run dictionary -- approve <item name | kind id>     (activate: ids are shown by `list`)
 *   npm run dictionary -- off <item name | kind id>         (switch off; never used or re-learned)
 *   npm run dictionary -- export [file.json]
 *   npm run dictionary -- import file.json
 *
 * `approve` and `off` take a kind and an id (the start of one is enough):
 *   npm run dictionary -- approve term 3f2a9c1b      or an item's name:  approve item Blackberries
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  DictionaryError,
  addBrand,
  addCode,
  addItem,
  addTerm,
  exportDictionary,
  importDictionary,
  listEntries,
  seedDictionary,
  setEntryStatus,
  type ListFilter,
} from "@/modules/dictionary";

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

function flag(name: string): string | undefined {
  const at = rest.indexOf(`--${name}`);
  return at === -1 ? undefined : rest[at + 1];
}
const has = (name: string) => rest.includes(`--${name}`);
/** Positional arguments: what isn't a flag or a flag's value. */
function positional(): string[] {
  const valued = new Set(["category", "unit", "item", "terms", "store", "code", "kind", "find"]);
  const out: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i]!.startsWith("--")) {
      if (valued.has(rest[i]!.slice(2))) i++;
    } else out.push(rest[i]!);
  }
  return out;
}
const need = (value: string | undefined, what: string) => {
  if (!value) throw new DictionaryError(`Missing ${what}. See the usage at the top of scripts/dictionary.ts.`);
  return value;
};

async function main() {
  switch (command) {
    case "seed": {
      const done = await seedDictionary();
      console.log(`Starter list is in: ${done.items} items, ${done.terms} wordings, ${done.brands} brands (anything already there was kept).`);
      return;
    }
    case "list": {
      const filter: ListFilter = {
        status: has("pending") ? "pending" : has("off") ? "off" : has("active") ? "active" : undefined,
        kind: flag("kind") as ListFilter["kind"],
        contains: flag("find"),
      };
      const rows = await listEntries(filter);
      for (const row of rows) console.log(`${row.status.padEnd(7)} ${row.kind.padEnd(5)} ${row.id.slice(0, 8)}  ${row.label}  ${row.detail}  [${row.source}]`);
      console.log(`${rows.length} entr${rows.length === 1 ? "y" : "ies"}.`);
      return;
    }
    case "add-item": {
      const item = await addItem({ name: need(positional()[0], "item name"), category: need(flag("category"), "--category"), unit: flag("unit") ?? null, durable: has("durable") });
      console.log(`Added item ${item.name}.`);
      return;
    }
    case "add-term": {
      await addTerm(need(positional()[0], "wording"), need(flag("item"), "--item"));
      console.log("Added.");
      return;
    }
    case "add-brand": {
      await addBrand(need(positional()[0], "brand name"), need(flag("terms"), "--terms").split(","), flag("item"));
      console.log("Added.");
      return;
    }
    case "add-code": {
      await addCode(need(flag("store"), "--store"), need(flag("code"), "--code"), need(flag("item"), "--item"));
      console.log("Added.");
      return;
    }
    case "approve":
    case "off":
    case "on": {
      const [kind, target] = positional();
      if (kind !== "item" && kind !== "term" && kind !== "brand" && kind !== "code") throw new DictionaryError("Say what to change: item, term, brand or code, then its id or (for an item) its name.");
      await setEntryStatus(kind, need(target, "id or name"), command === "off" ? "off" : "active");
      console.log(command === "off" ? "Switched off." : "Active.");
      return;
    }
    case "export": {
      const file = positional()[0];
      const json = JSON.stringify(await exportDictionary(), null, 2);
      if (file) writeFileSync(file, json + "\n");
      else console.log(json);
      return;
    }
    case "import": {
      const done = await importDictionary(JSON.parse(readFileSync(need(positional()[0], "file"), "utf8")));
      console.log(`Read ${done.items} items, ${done.terms} wordings, ${done.brands} brands, ${done.codes} codes (anything already there was kept).`);
      return;
    }
    default:
      console.log("Commands: seed, list, add-item, add-term, add-brand, add-code, approve, off, on, export, import. See the top of scripts/dictionary.ts.");
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error instanceof DictionaryError ? error.message : error);
    process.exit(1);
  },
);
