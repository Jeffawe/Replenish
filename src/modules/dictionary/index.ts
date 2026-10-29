/**
 * The server door to the dictionary: the live table of what receipt wordings
 * mean, how it grows from what users confirm, and the edits a person or an
 * agent makes by hand. Everything that reads or writes it goes through here;
 * the pure matcher and the starter list are in ./client. See
 * docs/dictionary.md for how to use and add to it.
 */
import { storeKey } from "./engine";
import { confirmEntry, firstConfirmation, planLearning, type Observation } from "./learn";
import { seedData } from "./seed";
import {
  activeData,
  findByPrefix,
  insertBrand,
  insertCode,
  insertItem,
  insertTerm,
  lookupCache,
  normalizeName,
  readAll,
  setStatus as storeStatus,
  updateCode,
  updateTerm,
  type Snapshot,
  type Source,
  type Status,
} from "./store";
import { createIdentifier } from "./engine";
import { createLookup } from "./lookup";
import type { DictionaryData } from "./types";

export type { Observation } from "./learn";

/**
 * What Open Food Facts says about product codes (UPCs), asked once per code and kept.
 * Set LOOKUP=off to turn it off.
 */
const lookup = createLookup({ cache: lookupCache });
export const lookupProductCodes: typeof lookup = (codes) => (process.env.LOOKUP === "off" ? Promise.resolve(new Map()) : lookup(codes));
export { normalizeWording } from "./learn";

/** Something a person asked for that can't be done, with a message that says why. */
export class DictionaryError extends Error {
  override name = "DictionaryError";
}

// The live dictionary is read on every receipt, so it is kept for a short while.
const KEEP_MS = 30_000;
let kept: { at: number; data: DictionaryData } | null = null;
const forgetKept = () => {
  kept = null;
};

/** What the matcher uses: the active part of the dictionary. With nothing in the table yet, the starter list. */
export async function loadDictionary(): Promise<DictionaryData> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.data;
  const snapshot = await readAll();
  const data = snapshot.items.length === 0 ? seedData() : activeData(snapshot);
  kept = { at: Date.now(), data };
  return data;
}

/** Puts the starter list into the table. Safe to repeat: what is already there is left as it is. */
export async function seedDictionary(): Promise<{ items: number; terms: number; brands: number }> {
  const seed = seedData();
  const ids = new Map<string, string>();
  for (const item of seed.items) {
    const row = await insertItem({ ...item, source: "seed", status: "active" });
    ids.set(item.name, row.id);
  }
  for (const term of seed.terms) await insertTerm({ text: term.text, itemId: ids.get(term.item)!, source: "seed", status: "active" });
  for (const brand of seed.brands) {
    await insertBrand({ name: brand.name, terms: brand.terms, impliesItemId: brand.implies ? (ids.get(brand.implies) ?? null) : null, source: "seed", status: "active" });
  }
  forgetKept();
  return { items: seed.items.length, terms: seed.terms.length, brands: seed.brands.length };
}

/**
 * Teaches the dictionary from saved lines (see learn.ts for the rules): new
 * wordings and codes start pending and are activated by separate receipts;
 * new items wait for approval. Never throws into a save: the caller logs.
 */
export async function learnFromSave(observations: Observation[]): Promise<{ proposed: number }> {
  if (observations.length === 0) return { proposed: 0 };
  const snapshot = await readAll();
  if (snapshot.items.length === 0) return { proposed: 0 }; // nothing seeded yet: nothing to teach
  const identify = createIdentifier(activeData(snapshot));
  const knownItems = new Set(snapshot.items.map((item) => item.normalizedName));
  const plans = planLearning(observations, identify, knownItems);

  const byName = new Map(snapshot.items.map((item) => [item.normalizedName, item]));
  let proposed = 0;
  for (const plan of plans) {
    let item = byName.get(normalizeName(plan.type === "item" ? plan.name : plan.item));
    if (plan.type === "item") {
      if (!item) {
        item = await insertItem({ name: plan.name, category: plan.category, unit: plan.unit, consumable: true, source: "learned", status: "pending", note: "Proposed from a saved receipt line." });
        byName.set(item.normalizedName, item);
        proposed++;
      }
    }
    if (!item || item.status === "off") continue;
    const itemActive = item.status === "active";

    if (plan.type === "code") {
      const store = storeKey(plan.store);
      const same = snapshot.codes.filter((c) => c.store === store && c.code === plan.code);
      const existing = same.find((c) => c.itemId === item!.id);
      const competing = same.some((c) => c.itemId !== item!.id && c.status !== "off");
      if (existing) {
        const next = confirmEntry(existing, plan.receipt, competing);
        if (next) await updateCode(existing.id, { ...next, status: (itemActive ? next.status : "pending") as Status });
      } else {
        const first = firstConfirmation(plan.receipt, competing);
        await insertCode({ store, code: plan.code, itemId: item.id, source: "learned", ...first, status: first.status as Status });
      }
    } else {
      const text = plan.text;
      const same = snapshot.terms.filter((t) => t.text === text);
      const existing = same.find((t) => t.itemId === item!.id);
      const competing = same.some((t) => t.itemId !== item!.id && t.status !== "off");
      if (existing) {
        const next = confirmEntry(existing, plan.receipt, competing);
        if (next) await updateTerm(existing.id, { ...next, status: (itemActive ? next.status : "pending") as Status });
      } else {
        const first = firstConfirmation(plan.receipt, competing);
        await insertTerm({ text, itemId: item.id, source: "learned", ...first, status: first.status as Status });
      }
    }
  }
  forgetKept();
  return { proposed };
}

// ---- Editing by a person or an agent (see scripts/dictionary.ts) ----

export async function addItem(input: { name: string; category: string; unit?: string | null; durable?: boolean }) {
  const name = input.name.trim();
  if (!name || !input.category.trim()) throw new DictionaryError("An item needs a name and a category.");
  const row = await insertItem({ name, category: input.category.trim(), unit: input.unit ?? null, consumable: !input.durable, source: "manual", status: "active" });
  if (row.status !== "active") await storeStatus("item", row.id, "active");
  forgetKept();
  return row;
}

async function itemNamed(name: string) {
  const { items } = await readAll();
  const item = items.find((i) => i.normalizedName === normalizeName(name));
  if (!item) throw new DictionaryError(`There is no item called "${name}". Add it first.`);
  return item;
}

export async function addTerm(text: string, itemName: string, note?: string) {
  const item = await itemNamed(itemName);
  const clean = text.trim().toLowerCase();
  if (!clean) throw new DictionaryError("A term can't be empty.");
  await insertTerm({ text: clean, itemId: item.id, source: "manual", status: "active", note });
  // Adding by hand also reactivates a term that was switched off or still pending.
  const [existing] = (await readAll()).terms.filter((t) => t.text === clean && t.itemId === item.id);
  if (existing && existing.status !== "active") await updateTerm(existing.id, { status: "active", conflict: false });
  forgetKept();
}

export async function addBrand(name: string, brandTerms: string[], impliesItem?: string) {
  const implies = impliesItem ? (await itemNamed(impliesItem)).id : null;
  await insertBrand({ name: name.trim(), terms: brandTerms.map((t) => t.trim().toLowerCase()).filter(Boolean), impliesItemId: implies, source: "manual", status: "active" });
  forgetKept();
}

export async function addCode(store: string, code: string, itemName: string) {
  const item = await itemNamed(itemName);
  await insertCode({ store, code: code.trim(), itemId: item.id, source: "manual", status: "active" });
  forgetKept();
}

/** Sets an entry's status. `target` is an id (or the start of one), or an item's name. */
export async function setEntryStatus(kind: "item" | "term" | "brand" | "code", target: string, status: Status) {
  let id: string;
  if (kind === "item" && !/^[0-9a-f-]{4,}$/i.test(target)) {
    id = (await itemNamed(target)).id;
  } else {
    const found = await findByPrefix(kind, target);
    if (typeof found === "string") throw new DictionaryError(found);
    id = found.id;
  }
  await storeStatus(kind, id, status);
  forgetKept();
}

export interface ListFilter {
  status?: Status;
  kind?: "item" | "term" | "brand" | "code";
  /** Part of a name, wording or code. */
  contains?: string;
}

export interface Listed {
  kind: "item" | "term" | "brand" | "code";
  id: string;
  label: string;
  detail: string;
  status: Status;
  source: Source;
}

/** What is in the dictionary, for reading. Pending entries are the review queue. */
export async function listEntries(filter: ListFilter = {}): Promise<Listed[]> {
  const snapshot: Snapshot = await readAll();
  const itemName = new Map(snapshot.items.map((i) => [i.id, i.name]));
  const rows: Listed[] = [
    ...snapshot.items.map((i): Listed => ({ kind: "item", id: i.id, label: i.name, detail: `${i.category}${i.unit ? `, ${i.unit}` : ""}${i.consumable ? "" : ", not used up"}${i.note ? ` (${i.note})` : ""}`, status: i.status as Status, source: i.source as Source })),
    ...snapshot.terms.map((t): Listed => ({ kind: "term", id: t.id, label: `"${t.text}"`, detail: `means ${itemName.get(t.itemId)}${t.evidence.length ? `, confirmed on ${t.evidence.length} receipt(s)` : ""}${t.conflict ? ", ALSO CONFIRMED FOR ANOTHER ITEM" : ""}`, status: t.status as Status, source: t.source as Source })),
    ...snapshot.brands.map((b): Listed => ({ kind: "brand", id: b.id, label: b.name, detail: `${b.terms.join(", ")}${b.impliesItemId ? ` -> ${itemName.get(b.impliesItemId)}` : ""}`, status: b.status as Status, source: b.source as Source })),
    ...snapshot.codes.map((c): Listed => ({ kind: "code", id: c.id, label: `${c.store} ${c.code}`, detail: `means ${itemName.get(c.itemId)}${c.evidence.length ? `, confirmed on ${c.evidence.length} receipt(s)` : ""}${c.conflict ? ", ALSO CONFIRMED FOR ANOTHER ITEM" : ""}`, status: c.status as Status, source: c.source as Source })),
  ];
  const needle = filter.contains?.toLowerCase();
  return rows.filter(
    (row) =>
      (!filter.status || row.status === filter.status) &&
      (!filter.kind || row.kind === filter.kind) &&
      (!needle || `${row.label} ${row.detail}`.toLowerCase().includes(needle)),
  );
}

/** The whole dictionary as plain data, for backing up or editing in bulk. */
export async function exportDictionary() {
  const snapshot = await readAll();
  const itemName = new Map(snapshot.items.map((i) => [i.id, i.name]));
  return {
    items: snapshot.items.map(({ name, category, unit, consumable, status }) => ({ name, category, unit, consumable, status })),
    terms: snapshot.terms.map((t) => ({ text: t.text, item: itemName.get(t.itemId)!, status: t.status })),
    brands: snapshot.brands.map((b) => ({ name: b.name, terms: b.terms, implies: b.impliesItemId ? (itemName.get(b.impliesItemId) ?? null) : null, status: b.status })),
    codes: snapshot.codes.map((c) => ({ store: c.store, code: c.code, item: itemName.get(c.itemId)!, status: c.status })),
  };
}

type Exported = Awaited<ReturnType<typeof exportDictionary>>;

/** Adds what is in `data` (as exportDictionary writes it) that the dictionary doesn't have yet. Existing entries are left as they are. */
export async function importDictionary(data: Partial<Exported>): Promise<{ items: number; terms: number; brands: number; codes: number }> {
  const ids = new Map<string, string>();
  const status = (s?: string): Status => (s === "pending" || s === "off" ? s : "active");
  for (const item of data.items ?? []) {
    const row = await insertItem({ name: item.name, category: item.category, unit: item.unit ?? null, consumable: item.consumable ?? true, source: "manual", status: status(item.status) });
    ids.set(normalizeName(item.name), row.id);
  }
  const idOf = async (name: string) => ids.get(normalizeName(name)) ?? (await itemNamed(name)).id;
  for (const term of data.terms ?? []) await insertTerm({ text: term.text.trim().toLowerCase(), itemId: await idOf(term.item), source: "manual", status: status(term.status) });
  for (const brand of data.brands ?? []) {
    await insertBrand({ name: brand.name, terms: brand.terms, impliesItemId: brand.implies ? await idOf(brand.implies) : null, source: "manual", status: status(brand.status) });
  }
  for (const code of data.codes ?? []) await insertCode({ store: code.store, code: code.code, itemId: await idOf(code.item), source: "manual", status: status(code.status) });
  forgetKept();
  return { items: data.items?.length ?? 0, terms: data.terms?.length ?? 0, brands: data.brands?.length ?? 0, codes: data.codes?.length ?? 0 };
}
