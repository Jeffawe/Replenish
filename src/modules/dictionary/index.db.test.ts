// Runs against the real database (npm run test:db). The dictionary is shared, so every test uses names
// of its own (random) and removes what it made.
import { randomUUID } from "node:crypto";
import { inArray, like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { dictionaryBrands, dictionaryItems } from "@/db/schema";
import {
  DictionaryError,
  addBrand,
  addCode,
  addItem,
  addTerm,
  exportDictionary,
  learnFromSave,
  listEntries,
  loadDictionary,
  setEntryStatus,
  type Observation,
} from "./index";
import { createIdentifier } from "./engine";

const tag = randomUUID().slice(0, 8);
const made: string[] = [];
afterAll(async () => {
  // Cascades to the terms and codes.
  if (made.length) await db.delete(dictionaryItems).where(inArray(dictionaryItems.name, made));
  await db.delete(dictionaryBrands).where(like(dictionaryBrands.name, `%${tag}%`));
});

/** A throwaway item the dictionary can recognise by its own name, as a user's product would be. */
async function newItem(label = "Widget") {
  const name = `Zq${tag} ${label}`;
  made.push(name);
  await addItem({ name, category: "Test", unit: null });
  await addTerm(name.toLowerCase(), name);
  return name;
}

const saw = (receipt: string, wording: string, productName: string, extra: Partial<Observation> = {}): Observation => ({
  receipt,
  wording,
  productName,
  productUnit: "each",
  productCreated: false,
  ...extra,
});

const termsFor = async (text: string) => (await listEntries({ kind: "term", contains: text })).filter((row) => row.label === `"${text}"`);
const identifier = async () => createIdentifier(await loadDictionary());

describe("the live dictionary", () => {
  it("has the starter list", async () => {
    const identify = await identifier();
    expect(identify("GV WHL MLK GL")).toMatchObject({ item: { name: "Milk" }, brand: "Great Value" });
  });

  it("uses what a person adds, at once", async () => {
    const item = await newItem("Gadget");
    await addTerm(`bzz${tag}`, item);
    await addBrand(`Brand ${tag}`, [`brandx${tag}`], item);
    await addCode("Wal-Mart", "999000111", item);
    const identify = await identifier();
    expect(identify(`BZZ${tag.toUpperCase()}`).item?.name).toBe(item);
    expect(identify(`BRANDX${tag.toUpperCase()}`)).toMatchObject({ item: { name: item }, brand: `Brand ${tag}` });
    expect(identify("MYSTERY LINE", { code: "999000111", store: "WALMART" }).item?.name).toBe(item);
  });

  it("leaves out what is switched off, and puts it back when asked", async () => {
    const item = await newItem("Gizmo");
    await addTerm(`gzz${tag}`, item);
    expect((await identifier())(`GZZ${tag}`).item?.name).toBe(item);

    await setEntryStatus("item", item, "off");
    expect((await identifier())(`GZZ${tag}`).item).toBeNull();
    await setEntryStatus("item", item, "active");
    expect((await identifier())(`GZZ${tag}`).item?.name).toBe(item);
  });

  it("says why when it can't do what was asked", async () => {
    await expect(addTerm("whatever", `No such item ${tag}`)).rejects.toThrow(DictionaryError);
    await expect(setEntryStatus("term", "ffffffff", "off")).rejects.toThrow(/No term starts with/);
  });

  it("exports what it has", async () => {
    const item = await newItem("Doodad");
    const data = await exportDictionary();
    expect(data.items.some((i) => i.name === item)).toBe(true);
    expect(data.terms.some((t) => t.item === item)).toBe(true);
  });
});

describe("learning from saved receipts", () => {
  it("starts a new wording pending, and activates it on a second separate receipt", async () => {
    const item = await newItem("Thing");
    const wording = `nectar${tag} bottle`;

    await learnFromSave([saw("receipt-a", wording.toUpperCase(), item)]);
    expect((await termsFor(wording))[0]).toMatchObject({ status: "pending" });
    expect((await identifier())(wording).item).toBeNull();

    // The same receipt saved again is not a second confirmation.
    await learnFromSave([saw("receipt-a", wording.toUpperCase(), item)]);
    expect((await termsFor(wording))[0]).toMatchObject({ status: "pending" });

    await learnFromSave([saw("receipt-b", wording.toUpperCase(), item)]);
    expect((await termsFor(wording))[0]).toMatchObject({ status: "active" });
    expect((await identifier())(wording).item?.name).toBe(item);
  });

  it("keeps a wording confirmed for two different items waiting for a person", async () => {
    const one = await newItem("One");
    const two = await newItem("Two");
    const wording = `ambig${tag} pack`;

    await learnFromSave([saw("r1", wording, one)]);
    await learnFromSave([saw("r2", wording, two), saw("r3", wording, two)]);
    await learnFromSave([saw("r4", wording, two)]);

    const rows = await termsFor(wording);
    expect(rows.length).toBe(2);
    expect(rows.every((row) => row.status === "pending")).toBe(true);
    expect(rows.some((row) => row.detail.includes("ALSO CONFIRMED"))).toBe(true);
  });

  it("proposes a new item for a person to approve, and uses it once approved", async () => {
    const name = `Zq${tag} Berries`;
    made.push(name);
    const wording = `berry${tag} 6oz`;

    const { proposed } = await learnFromSave([saw("r1", wording, name, { productCreated: true, productCategory: "Groceries" })]);
    expect(proposed).toBe(1);
    expect((await listEntries({ kind: "item", contains: name }))[0]).toMatchObject({ status: "pending", source: "learned" });
    expect((await identifier())(wording).item).toBeNull();

    // Seeing it again doesn't propose it twice.
    expect((await learnFromSave([saw("r2", wording, name, { productCreated: true })])).proposed).toBe(0);

    await setEntryStatus("item", name, "active");
    expect((await listEntries({ kind: "item", contains: name }))[0]).toMatchObject({ status: "active" });
  });

  it("learns a store's code for an item, activated on a second receipt", async () => {
    const item = await newItem("Coded");
    const code = `55${Math.floor(Math.random() * 1e9)}`;
    await learnFromSave([saw("r1", `XQ${tag} UNKNOWN`, item, { code, store: "Target" })]);
    expect((await identifier())("MYSTERY", { code, store: "Target" }).item).toBeNull();
    await learnFromSave([saw("r2", `XQ${tag} UNKNOWN`, item, { code, store: "Target" })]);
    expect((await identifier())("MYSTERY", { code, store: "Target" }).item?.name).toBe(item);
  });

  it("doesn't re-learn what a person switched off", async () => {
    const item = await newItem("Muted");
    const wording = `muted${tag} word`;
    await addTerm(wording, item);
    const [row] = await termsFor(wording);
    await setEntryStatus("term", row!.id.slice(0, 12), "off");
    await learnFromSave([saw("r1", wording, item), saw("r2", wording, item)]);
    expect((await termsFor(wording))[0]).toMatchObject({ status: "off" });
  });
});
