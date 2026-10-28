import { describe, expect, it, vi } from "vitest";
import type { IngestResult } from "@/core/purchase-batch";
import type { RunOutcome } from "../run";
import type { SubmitOutcome } from "../submit";
import { createSimulatedInbox } from "./inbox/simulated";
import { syncInbox, type SyncDeps } from "./sync";
import type { EmailMessage } from "./types";

const email = (id: string, receivedAt = "2026-10-20T10:00:00Z"): EmailMessage => ({
  messageId: id,
  from: "orders@example.com",
  subject: `Order ${id}`,
  receivedAt: new Date(receivedAt),
  text: "body",
});

// The batch's key carries the message id, so a fake receiver can tell messages apart.
const draft = (warnings = [] as { code: string; message: string }[], id = "x"): RunOutcome => ({
  ok: true,
  result: {
    kind: "draft",
    draft: {
      batch: {
        source: "email",
        idempotencyKey: `email-${id}`,
        purchasedAt: "2026-10-20",
        items: [{ productName: "Milk", quantity: 1, unit: "gallon" }],
      },
      warnings,
    },
  },
});
const submitted = (status: IngestResult["status"]): SubmitOutcome => ({ ok: true, result: { status, items: [] } });

function setup(
  messages: EmailMessage[],
  extract: SyncDeps["extract"],
  submit: SyncDeps["submit"] = async () => submitted("processed"),
) {
  const inbox = createSimulatedInbox(messages);
  const listMessages = vi.spyOn(inbox, "listMessages");
  return { deps: { inbox, extract, submit }, listMessages };
}

const since = new Date("2026-10-19T00:00:00Z");

describe("syncInbox", () => {
  it("stores what the producer drafts and counts each outcome", async () => {
    const statuses: Record<string, IngestResult["status"]> = {
      stored: "processed",
      duplicate: "duplicate",
      rejected: "rejected",
    };
    const { deps } = setup(
      ["stored", "duplicate", "rejected", "skipped"].map((id, i) => email(id, `2026-10-20T0${i}:00:00Z`)),
      async (message) =>
        message.messageId === "skipped"
          ? { ok: true, result: { kind: "skipped", reason: "not an order" } }
          : draft([], message.messageId),
      async (_userId, batch) =>
        submitted(statuses[(batch as { idempotencyKey: string }).idempotencyKey.replace("email-", "")]),
    );

    const report = await syncInbox("user-1", since, deps);

    expect(report.messages.map((m) => [m.messageId, m.outcome])).toEqual([
      ["stored", "stored"],
      ["duplicate", "duplicate"],
      ["rejected", "rejected"],
      ["skipped", "skipped"],
    ]);
    expect(report.counts).toEqual({ stored: 1, duplicate: 1, rejected: 1, skipped: 1, failed: 0 });
    expect(report.messages[3].detail).toBe("not an order");
  });

  it("submits for the right user, with the draft's batch", async () => {
    const submit = vi.fn(async () => submitted("processed"));
    const { deps } = setup([email("a")], async () => draft(), submit);
    await syncInbox("user-7", since, deps);
    expect(submit).toHaveBeenCalledWith("user-7", expect.objectContaining({ idempotencyKey: "email-x" }));
  });

  it("carries the draft's warnings into the report without blocking the submit", async () => {
    const warning = { code: "possible-duplicate", message: "looks recorded" };
    const submit = vi.fn(async () => submitted("processed"));
    const { deps } = setup([email("a")], async () => draft([warning]), submit);

    const report = await syncInbox("user-1", since, deps);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(report.messages[0]).toMatchObject({ outcome: "stored", warnings: [warning] });
  });

  it("asks the inbox only for mail since the given time", async () => {
    const { deps, listMessages } = setup(
      [email("old", "2026-10-01T00:00:00Z"), email("new", "2026-10-20T00:00:00Z")],
      async () => draft(),
    );
    const report = await syncInbox("user-1", since, deps);
    expect(listMessages).toHaveBeenCalledWith({ since });
    expect(report.messages.map((m) => m.messageId)).toEqual(["new"]);
  });

  describe("when one message goes wrong", () => {
    it("marks it failed and carries on with the rest", async () => {
      const { deps } = setup(
        [email("boom", "2026-10-20T01:00:00Z"), email("fine", "2026-10-20T02:00:00Z")],
        async (message) => {
          if (message.messageId === "boom") throw new Error("extraction blew up");
          return draft();
        },
      );
      const report = await syncInbox("user-1", since, deps);
      expect(report.messages.map((m) => m.outcome)).toEqual(["failed", "stored"]);
      expect(report.messages[0].detail).toBe("extraction blew up");
      expect(report.counts).toMatchObject({ failed: 1, stored: 1 });
    });

    it("marks it failed when the receiver throws", async () => {
      const { deps } = setup([email("a")], async () => draft(), async () => {
        throw new Error("database down");
      });
      const report = await syncInbox("user-1", since, deps);
      expect(report.messages[0]).toMatchObject({ outcome: "failed", detail: "database down" });
    });

    it("marks it failed, with the reasons, when the draft is not a valid batch", async () => {
      const { deps } = setup([email("a")], async () => draft(), async () => ({
        ok: false,
        issues: [{ path: "items", message: "Too small" }],
      }));
      const report = await syncInbox("user-1", since, deps);
      expect(report.messages[0]).toMatchObject({ outcome: "failed", detail: "items: Too small" });
    });

    it("marks it failed when the runner could not run the producer", async () => {
      const { deps } = setup([email("a")], async () => ({ ok: false, error: "unknown-source" }));
      const report = await syncInbox("user-1", since, deps);
      expect(report.messages[0]).toMatchObject({ outcome: "failed", detail: "unknown-source" });
    });
  });

  it("lets an inbox failure through, since there is nothing to report on", async () => {
    const inbox = {
      listMessages: async () => {
        throw new Error("cannot reach mail server");
      },
    };
    await expect(
      syncInbox("user-1", since, { inbox, extract: async () => draft(), submit: async () => submitted("processed") }),
    ).rejects.toThrow("cannot reach mail server");
  });

  it("reports nothing for an empty inbox", async () => {
    const { deps } = setup([], async () => draft());
    expect(await syncInbox("user-1", since, deps)).toEqual({
      messages: [],
      counts: { stored: 0, duplicate: 0, rejected: 0, skipped: 0, failed: 0 },
    });
  });
});

describe("createSimulatedInbox", () => {
  it("returns messages at or after `since`, oldest first", async () => {
    const inbox = createSimulatedInbox([
      email("c", "2026-10-22T00:00:00Z"),
      email("a", "2026-10-18T00:00:00Z"),
      email("b", "2026-10-20T00:00:00Z"),
    ]);
    const listed = await inbox.listMessages({ since: new Date("2026-10-19T00:00:00Z") });
    expect(listed.map((m) => m.messageId)).toEqual(["b", "c"]);
  });
});
