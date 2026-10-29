// Runs against the real database (npm run test:db), using throwaway users that are deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { receiptReads, users } from "@/db/schema";
import { refundReceiptRead, reserveReceiptRead } from "./receipt-reads";

const created: string[] = [];
async function newUser(receiptLimit: number | null) {
  const [user] = await db.insert(users).values({ email: `reads-test-${randomUUID()}@test.local`, receiptLimit }).returning();
  created.push(user.id);
  return user.id;
}

const original = process.env.RECEIPT_LIMIT;
afterEach(() => {
  if (original === undefined) delete process.env.RECEIPT_LIMIT;
  else process.env.RECEIPT_LIMIT = original;
});
afterAll(async () => {
  // Cascades to their reads.
  if (created.length) await db.delete(users).where(inArray(users.id, created));
});

describe("reserveReceiptRead", () => {
  it("allows exactly the user's limit, then refuses", async () => {
    const userId = await newUser(2);
    expect((await reserveReceiptRead(userId)).ok).toBe(true);
    expect((await reserveReceiptRead(userId)).ok).toBe(true);
    expect(await reserveReceiptRead(userId)).toEqual({ ok: false, limit: 2 });
  });

  it("gives a refunded photo back", async () => {
    const userId = await newUser(1);
    const first = await reserveReceiptRead(userId);
    if (!first.ok) throw new Error("setup failed");
    expect((await reserveReceiptRead(userId)).ok).toBe(false);
    await refundReceiptRead(first.id);
    expect((await reserveReceiptRead(userId)).ok).toBe(true);
  });

  it("uses RECEIPT_LIMIT for a user with no limit of their own, and their own limit over it", async () => {
    process.env.RECEIPT_LIMIT = "1";
    const plain = await newUser(null);
    expect((await reserveReceiptRead(plain)).ok).toBe(true);
    expect(await reserveReceiptRead(plain)).toEqual({ ok: false, limit: 1 });

    const generous = await newUser(3);
    for (let i = 0; i < 3; i++) expect((await reserveReceiptRead(generous)).ok).toBe(true);
    expect((await reserveReceiptRead(generous)).ok).toBe(false);
  });

  it("starts a fresh count each month", async () => {
    const userId = await newUser(1);
    expect((await reserveReceiptRead(userId)).ok).toBe(true);
    // Pretend that read happened on October 15th.
    await db.update(receiptReads).set({ createdAt: new Date("2026-10-15T12:00:00Z") }).where(eq(receiptReads.userId, userId));
    expect((await reserveReceiptRead(userId, new Date("2026-10-31T23:00:00Z"))).ok).toBe(false);
    expect((await reserveReceiptRead(userId, new Date("2026-11-01T00:00:01Z"))).ok).toBe(true);
  });

  it("can't be beaten by photos arriving at the same moment", async () => {
    const userId = await newUser(3);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => reserveReceiptRead(userId)));
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(3);
  });

  it("refuses an account whose limit is 0", async () => {
    expect(await reserveReceiptRead(await newUser(0))).toEqual({ ok: false, limit: 0 });
  });
});
