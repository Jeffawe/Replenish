import { describe, expect, it } from "vitest";
import { isAwaitingAnswer, isConfirmed, PENDING_DAYS, pendingUntilFor } from "./pending";

const from = new Date("2026-10-30T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

describe("pendingUntilFor", () => {
  it("gives a product the user already had a time limit", () => {
    expect(pendingUntilFor(false, from)).toEqual(new Date(from.getTime() + PENDING_DAYS * day));
  });

  it("gives a new product no limit", () => {
    expect(pendingUntilFor(true, from)).toBeNull();
  });
});

describe("isAwaitingAnswer", () => {
  const limited = { status: "pending", pendingUntil: new Date(from.getTime() + PENDING_DAYS * day) };

  it("asks about a limited line until its date, then counts it as approved", () => {
    expect(isAwaitingAnswer(limited, new Date(from.getTime() + 9 * day))).toBe(true);
    expect(isAwaitingAnswer(limited, new Date(from.getTime() + 11 * day))).toBe(false);
  });

  it("keeps asking about an unlimited line however long it takes", () => {
    expect(isAwaitingAnswer({ status: "pending", pendingUntil: null }, new Date(from.getTime() + 400 * day))).toBe(true);
  });

  it("never asks about an approved purchase", () => {
    expect(isAwaitingAnswer({ status: "approved", pendingUntil: null }, from)).toBe(false);
  });
});

describe("isConfirmed", () => {
  it("is false while a purchase that made the product is unanswered", () => {
    expect(isConfirmed([{ status: "pending", pendingUntil: null }])).toBe(false);
  });

  it("stays true for a pending line on a product the user already had", () => {
    expect(isConfirmed([{ status: "pending", pendingUntil: new Date(from.getTime() + day) }])).toBe(true);
  });

  it("is true once approved, and for a product with no pending lines", () => {
    expect(isConfirmed([{ status: "approved", pendingUntil: null }])).toBe(true);
    expect(isConfirmed([])).toBe(true);
  });
});
