import { describe, expect, it } from "vitest";
import type { IngestResult } from "@/core/purchase-batch";
import { lessonsFromReview } from "./aliases";

const created = (index: number, productId: string) =>
  ({ index, result: "created", productId, productCreated: false, purchaseEventId: `e${index}` }) as const;

describe("lessonsFromReview", () => {
  it("ties each stored line's wording to the product it landed on, normalized", () => {
    const result: IngestResult = { status: "processed", items: [created(0, "p-milk"), created(1, "p-new")] };
    expect(lessonsFromReview({ sources: ["GV  WHL MLK GL", "Bananas"], skipped: [] }, result).aliases).toEqual([
      { alias: "gv whl mlk gl", productId: "p-milk" },
      { alias: "bananas", productId: "p-new" },
    ]);
  });

  it("learns from lines that were already stored, but not from rejected ones", () => {
    const result: IngestResult = {
      status: "processed",
      items: [
        { index: 0, result: "duplicate", productId: "p-milk", purchaseEventId: "e0" },
        { index: 1, result: "rejected", reason: "unit mismatch" },
      ],
    };
    expect(lessonsFromReview({ sources: ["MILK GAL", "EGGS LRG"], skipped: [] }, result).aliases).toEqual([
      { alias: "milk gal", productId: "p-milk" },
    ]);
  });

  it("skips lines with no wording and wordings too short to mean anything", () => {
    const result: IngestResult = { status: "processed", items: [created(0, "a"), created(1, "b")] };
    expect(lessonsFromReview({ sources: [null, "tp"], skipped: ["x"] }, result)).toEqual({
      aliases: [],
      ignore: [],
      keep: [],
    });
  });

  it("keeps the last product when two lines share a wording", () => {
    const result: IngestResult = { status: "processed", items: [created(0, "a"), created(1, "b")] };
    expect(lessonsFromReview({ sources: ["Milk", "milk"], skipped: [] }, result).aliases).toEqual([
      { alias: "milk", productId: "b" },
    ]);
  });

  it("remembers what was left out and what was kept", () => {
    const result: IngestResult = { status: "processed", items: [created(0, "p-milk")] };
    expect(lessonsFromReview({ sources: ["MILK"], skipped: ["OFFICE CHAIR", "GIFT  CARD"] }, result)).toMatchObject({
      ignore: ["office chair", "gift card"],
      keep: ["milk"],
    });
  });

  it("doesn't ignore a wording that was also kept on the same receipt", () => {
    const result: IngestResult = { status: "processed", items: [created(0, "p-milk")] };
    expect(lessonsFromReview({ sources: ["MILK"], skipped: ["milk"] }, result).ignore).toEqual([]);
  });
});

describe("lessonsFromReview: item codes", () => {
  const result: IngestResult = { status: "processed", items: [created(0, "p-milk"), created(1, "p-eggs")] };

  it("ties each line's item code at that store to the product it landed on", () => {
    const lessons = lessonsFromReview({ sources: ["GV WHL MLK", "EGGS"], skipped: [], codes: ["007874235186", null], store: "Wal-Mart" }, result);
    expect(lessons.aliases).toContainEqual({ alias: "#walmart#007874235186", productId: "p-milk" });
    expect(lessons.aliases.filter((a) => a.alias.startsWith("#"))).toHaveLength(1);
  });

  it("can't learn a code without knowing the store", () => {
    const lessons = lessonsFromReview({ sources: ["GV WHL MLK", "EGGS"], skipped: [], codes: ["007874235186", null] }, result);
    expect(lessons.aliases.some((a) => a.alias.startsWith("#"))).toBe(false);
  });
});
