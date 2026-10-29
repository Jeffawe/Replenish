import { describe, expect, it } from "vitest";
import { createIdentifier } from "./engine";
import { confirmEntry, firstConfirmation, normalizeWording, planLearning, type Observation } from "./learn";
import { seedData } from "./seed";

const identify = createIdentifier(seedData());
const known = new Set<string>();

const line = (overrides: Partial<Observation> = {}): Observation => ({
  receipt: "receipt-1",
  wording: "MOOMOO NECTAR",
  productName: "Milk",
  productUnit: "gallon",
  productCreated: false,
  ...overrides,
});

describe("normalizeWording", () => {
  it("lowercases, drops bare numbers and punctuation, keeps letters", () => {
    expect(normalizeWording("GV  Whl MLK, 1 GAL")).toBe("gv whl mlk gal");
    expect(normalizeWording("MEMBER'S MARK 24CT")).toBe("members mark 24ct");
    expect(normalizeWording("12 30")).toBe("");
  });
});

describe("what a saved line teaches", () => {
  it("proposes a wording the dictionary doesn't know for the item the user chose", () => {
    expect(planLearning([line()], identify, known)).toEqual([
      { type: "term", receipt: "receipt-1", text: "moomoo nectar", item: "Milk" },
    ]);
  });

  it("learns nothing from a wording it already knows", () => {
    expect(planLearning([line({ wording: "GV WHL MLK GL" })], identify, known)).toEqual([]);
    expect(planLearning([line({ wording: "WHL MLK HALF GAL" })], identify, known)).toEqual([]);
  });

  it("learns a store's item code too", () => {
    const plans = planLearning([line({ code: "007874235186", store: "Walmart" })], identify, known);
    expect(plans).toContainEqual({ type: "code", receipt: "receipt-1", store: "Walmart", code: "007874235186", item: "Milk" });
    // Once it is known, there is nothing more to learn from it.
    const learned = createIdentifier({ ...seedData(), codes: [{ store: "walmart", code: "007874235186", item: "Milk" }] });
    expect(planLearning([line({ code: "007874235186", store: "Walmart" })], learned, known).some((p) => p.type === "code")).toBe(false);
  });

  it("learns nothing for a product the dictionary has no item for, unless the line just made it", () => {
    expect(planLearning([line({ productName: "Zorbo" })], identify, known)).toEqual([]);
    expect(planLearning([line({ productName: "Blackberries", wording: "BLACKBERRIES 6OZ", productUnit: "each", productCreated: true })], identify, known)).toEqual([
      { type: "item", receipt: "receipt-1", name: "Blackberries", category: "Other", unit: null, text: "blackberries 6oz" },
    ]);
  });

  it("doesn't propose an item it already has, whatever its status", () => {
    const plans = planLearning(
      [line({ productName: "Blackberries", wording: "BLACKBERRIES", productCreated: true })],
      identify,
      new Set(["blackberries"]),
    );
    expect(plans).toEqual([]);
  });

  it("ignores wordings too short to mean anything", () => {
    expect(planLearning([line({ wording: "XY 12" })], identify, known)).toEqual([]);
  });
});

describe("when a learned entry earns its place", () => {
  it("starts pending, and becomes active on a second, separate receipt", () => {
    const first = firstConfirmation("a", false);
    expect(first).toEqual({ status: "pending", evidence: ["a"], conflict: false });
    expect(confirmEntry(first, "b", false)).toEqual({ status: "active", evidence: ["a", "b"], conflict: false });
  });

  it("doesn't count the same receipt twice", () => {
    expect(confirmEntry(firstConfirmation("a", false), "a", false)).toBeNull();
  });

  it("never activates a wording that was confirmed for another item too", () => {
    const first = firstConfirmation("a", true);
    expect(confirmEntry(first, "b", false)).toEqual({ status: "pending", evidence: ["a", "b"], conflict: true });
    expect(confirmEntry(firstConfirmation("a", false), "b", true)?.status).toBe("pending");
  });

  it("leaves an entry a person switched off alone", () => {
    expect(confirmEntry({ status: "off", evidence: [], conflict: false }, "a", false)).toBeNull();
  });

  it("only changes the evidence of an entry already active", () => {
    expect(confirmEntry({ status: "active", evidence: ["a"], conflict: false }, "b", false)?.status).toBe("active");
  });
});
