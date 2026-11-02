import { describe, expect, it } from "vitest";
import { arrived } from "./arrived";

const now = new Date("2026-10-30T12:00:00Z");

describe("arrived", () => {
  it("keeps purchases up to now and leaves out ones still on their way", () => {
    const past = { id: "past", purchasedAt: new Date("2026-10-20T00:00:00Z") };
    const justNow = { id: "now", purchasedAt: now };
    const incoming = { id: "incoming", purchasedAt: new Date("2026-11-02T00:00:00Z") };
    expect(arrived([incoming, justNow, past], now).map((p) => p.id)).toEqual(["now", "past"]);
  });

  it("counts an incoming order once its date has come", () => {
    const order = { purchasedAt: new Date("2026-11-02T00:00:00Z") };
    expect(arrived([order], now)).toHaveLength(0);
    expect(arrived([order], new Date("2026-11-02T08:00:00Z"))).toHaveLength(1);
  });
});
