import { describe, expect, it } from "vitest";
import { groupIntoRows } from "./layout";
import type { OcrWord } from "./ocr/types";

const word = (text: string, cx: number, cy: number, extra: Partial<OcrWord> = {}): OcrWord => ({
  text,
  cx,
  cy,
  width: text.length * 10,
  height: 20,
  angle: 0,
  ...extra,
});

/** Rotates a point about the origin, the way a tilted photo would. */
const tilt = (point: { cx: number; cy: number }, radians: number) => ({
  cx: point.cx * Math.cos(radians) - point.cy * Math.sin(radians),
  cy: point.cx * Math.sin(radians) + point.cy * Math.cos(radians),
});

describe("groupIntoRows", () => {
  it("returns nothing for no words", () => {
    expect(groupIntoRows([])).toEqual([]);
  });

  it("joins the words of a row left to right, whatever order they arrive in", () => {
    const rows = groupIntoRows([word("MILK", 100, 50), word("WHOLE", 40, 50), word("GAL", 160, 50)]);
    expect(rows).toEqual(["WHOLE MILK GAL"]);
  });

  it("keeps rows in top-to-bottom order", () => {
    const rows = groupIntoRows([word("BREAD", 50, 120), word("MILK", 50, 80), word("STORE", 50, 40)]);
    expect(rows).toEqual(["STORE", "MILK", "BREAD"]);
  });

  it("puts a price on the same row as its name even when they are far apart, marking the gap", () => {
    const rows = groupIntoRows([word("MILK", 40, 80), word("3.98", 400, 82), word("BREAD", 40, 110), word("2.25", 400, 111)]);
    expect(rows).toEqual(["MILK  3.98", "BREAD  2.25"]);
  });

  it("separates rows that are one line apart", () => {
    const rows = groupIntoRows([word("A", 50, 100), word("B", 50, 126)]);
    expect(rows).toEqual(["A", "B"]);
  });

  it("straightens a tilted photo before grouping", () => {
    const radians = (6 * Math.PI) / 180;
    const level = [
      word("MILK", 40, 100),
      word("3.98", 700, 100),
      word("BREAD", 40, 160),
      word("2.25", 700, 160),
      word("EGGS", 40, 220),
      word("4.28", 700, 220),
    ];
    // Without straightening, the far-right price would be ~70px off its name's row.
    const tilted = level.map((w) => ({ ...w, ...tilt(w, radians), angle: radians }));
    expect(groupIntoRows(tilted)).toEqual(["MILK  3.98", "BREAD  2.25", "EGGS  4.28"]);
  });

  it("follows a sloping name to its price on a curled receipt where the price column is level", () => {
    // Positions from a real photo: names drop ~3.5 degrees left to right, prices
    // don't, so each price is nearer the middle of the next name than its own.
    const angle = (3.5 * Math.PI) / 180;
    const name = (text: string, cx: number, cy: number) => word(text, cx, cy, { angle, height: 25 });
    const price = (text: string, cy: number) => word(text, 814, cy, { height: 24 });
    const rows = groupIntoRows([
      name("FIESTA", 472, 438),
      name("SHRED", 559, 444),
      price("6.99", 454),
      name("CILANTRO", 431, 466),
      name("BUNCH", 532, 472),
      price("1.99", 481),
      name("ROMAINE", 477, 497),
      name("HEART", 572, 503),
      price("3.99", 510),
    ]);
    expect(rows).toEqual(["FIESTA SHRED  6.99", "CILANTRO BUNCH  1.99", "ROMAINE HEART  3.99"]);
  });
});
