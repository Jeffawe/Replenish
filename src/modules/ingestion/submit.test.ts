import { describe, expect, it, vi } from "vitest";
import type { IngestResult, PurchaseBatch } from "@/core/purchase-batch";
import { createSubmit } from "./submit";

const stored: IngestResult = {
  status: "processed",
  items: [{ index: 0, result: "created", productId: "p", productCreated: false, purchaseEventId: "e" }],
};
const batch = {
  source: "email",
  idempotencyKey: "email-order-12345",
  purchasedAt: "2026-10-20",
  items: [{ productName: "Milk", quantity: 1, unit: "gallon" }],
};

describe("createSubmit", () => {
  it("validates the batch, then hands the parsed version to the receiver", async () => {
    const ingest = vi.fn<(userId: string, batch: PurchaseBatch) => Promise<IngestResult>>(
      async () => stored,
    );
    const outcome = await createSubmit(ingest)("user-1", batch);

    expect(outcome).toEqual({ ok: true, result: stored });
    const [userId, received] = ingest.mock.calls[0];
    expect(userId).toBe("user-1");
    // Parsing applied the defaults and coercions.
    expect(received.currency).toBe("USD");
    expect(received.purchasedAt).toEqual(new Date("2026-10-20"));
  });

  it("returns the problems, and stores nothing, when the batch is invalid", async () => {
    const ingest = vi.fn(async () => stored);
    const outcome = await createSubmit(ingest)("user-1", { ...batch, items: [], idempotencyKey: undefined });

    expect(outcome.ok).toBe(false);
    const paths = outcome.ok ? [] : outcome.issues.map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["items", "idempotencyKey"]));
    expect(ingest).not.toHaveBeenCalled();
  });

  it("passes the receiver's own result through, including rejections", async () => {
    const rejected: IngestResult = { status: "rejected", items: [{ index: 0, result: "rejected", reason: "x" }] };
    const outcome = await createSubmit(async () => rejected)("user-1", batch);
    expect(outcome).toEqual({ ok: true, result: rejected });
  });
});
