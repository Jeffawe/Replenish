import { describe, expect, it, vi, type Mock } from "vitest";
import type { IngestResult } from "@/core/purchase-batch";
import { gmailConfirmation, handleInboundEmail, verificationCode, type InboundDeps } from "./inbound";
import { addressFor, newToken, tokenFromAddress } from "./address";
import { originalSender, retailerOf } from "./retailers";

const TOKEN = "k7m2x9qa3b4c";
const mail = (overrides: Record<string, unknown> = {}) => ({
  to: `o-${TOKEN}@orders.example.dev`,
  from: "Amazon.com <auto-confirm@amazon.com>",
  subject: "Ordered: toilet paper",
  text: "Order #111-2222222-3333333",
  messageId: "<m1@amazon.com>",
  ...overrides,
});

const created: IngestResult = {
  status: "processed",
  items: [{ index: 0, result: "created", productId: "p", productCreated: false, purchaseEventId: "e" }],
};

type Mocked = { [K in keyof InboundDeps]: Mock<InboundDeps[K]> };

function deps(overrides: Partial<InboundDeps> = {}): Mocked {
  const d = {
    findUser: vi.fn(async (token: string) => (token === TOKEN ? "user-1" : null)),
    extract: vi.fn(async () => ({
      ok: true as const,
      result: { kind: "draft" as const, draft: { batch: { source: "email", idempotencyKey: "amazon-111", items: [] }, warnings: [] } },
    })),
    submit: vi.fn(async () => ({ ok: true as const, result: created })),
    saveVerificationCode: vi.fn(async () => {}),
    log: vi.fn(async () => {}),
    ...overrides,
  };
  return d as unknown as Mocked;
}

describe("handleInboundEmail", () => {
  it("stores an order from a known store as pending and logs it", async () => {
    const d = deps();
    expect(await handleInboundEmail(mail(), d)).toEqual({ outcome: "accepted", items: 1 });
    expect(d.submit).toHaveBeenCalledWith("user-1", expect.objectContaining({ status: "pending", idempotencyKey: "amazon-111" }));
    expect(d.log).toHaveBeenCalledWith("user-1", { outcome: "accepted", retailer: "Amazon", itemCount: 1 });
  });

  it("ignores an address nobody has, without logging", async () => {
    const d = deps();
    expect(await handleInboundEmail(mail({ to: "o-zzzzzzzzzzzz@orders.example.dev" }), d)).toEqual({ outcome: "unknown-address" });
    expect(d.log).not.toHaveBeenCalled();
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("drops mail that isn't from a store we read, before reading it", async () => {
    const d = deps();
    const outcome = await handleInboundEmail(mail({ from: "alerts@mybank.com" }), d);
    expect(outcome).toEqual({ outcome: "dropped", reason: "Not from a store we read" });
    expect(d.extract).not.toHaveBeenCalled();
    // The log never names who it was from.
    expect(JSON.stringify(d.log.mock.calls)).not.toContain("mybank");
  });

  it("rejects a sender that only looks like the store", async () => {
    const d = deps();
    expect((await handleInboundEmail(mail({ from: "x@amazon.com.evil.io" }), d)).outcome).toBe("dropped");
    expect((await handleInboundEmail(mail({ from: "x@notamazon.com" }), d)).outcome).toBe("dropped");
  });

  it("keeps Gmail's confirmation code and stores nothing", async () => {
    const d = deps();
    const outcome = await handleInboundEmail(
      mail({
        from: "Gmail Team <forwarding-noreply@google.com>",
        subject: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from someone@gmail.com",
        text: "someone@gmail.com has requested to forward mail. Confirmation code: 123456789",
      }),
      d,
    );
    expect(outcome).toEqual({ outcome: "verification" });
    expect(d.saveVerificationCode).toHaveBeenCalledWith("user-1", "123456789", null);
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("reports an email the producer can't read, with its reason", async () => {
    const d = deps({ extract: vi.fn(async () => ({ ok: true as const, result: { kind: "skipped" as const, reason: "This isn't an order confirmation" } })) });
    expect(await handleInboundEmail(mail(), d)).toEqual({ outcome: "dropped", reason: "This isn't an order confirmation" });
    expect(d.submit).not.toHaveBeenCalled();
  });

  it("says when an order was already added", async () => {
    const d = deps({ submit: vi.fn(async () => ({ ok: true as const, result: { status: "duplicate" as const, items: [] } })) });
    expect(await handleInboundEmail(mail(), d)).toEqual({ outcome: "dropped", reason: "Already added from an earlier email" });
  });

  it("says when the user removed the order earlier", async () => {
    const result: IngestResult = { status: "rejected", items: [{ index: 0, result: "rejected", reason: "You rejected this order earlier" }] };
    const d = deps({ submit: vi.fn(async () => ({ ok: true as const, result })) });
    expect(await handleInboundEmail(mail(), d)).toEqual({ outcome: "dropped", reason: "You rejected this order earlier" });
  });

  it("never throws for a failure, and logs only a plain reason", async () => {
    const d = deps({ extract: vi.fn(async () => { throw new Error("boom with secret details"); }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const outcome = await handleInboundEmail(mail(), d);
    expect(outcome).toEqual({ outcome: "dropped", reason: "Something went wrong reading this email" });
    expect(JSON.stringify(d.log.mock.calls)).not.toContain("secret");
  });

  it("returns invalid for a malformed post", async () => {
    expect(await handleInboundEmail({ nope: true }, deps())).toEqual({ outcome: "invalid" });
  });

  it("reads a hand-forwarded order by its original sender", async () => {
    const d = deps();
    const text = "Look at this\n\n---------- Forwarded message ---------\nFrom: Amazon.com <auto-confirm@amazon.com>\nDate: Mon\n";
    expect((await handleInboundEmail(mail({ from: "me@gmail.com", text }), d)).outcome).toBe("accepted");
  });
});

describe("verificationCode", () => {
  it("only trusts Gmail's forwarding sender", () => {
    expect(verificationCode("bad@evil.com", "(#123456789) Gmail Forwarding Confirmation", "")).toBeNull();
  });
  it("finds the code in the subject or the body", () => {
    const from = "forwarding-noreply@google.com";
    expect(verificationCode(from, "(#987654321) Gmail Forwarding Confirmation", "")).toBe("987654321");
    expect(verificationCode(from, "Gmail Forwarding Confirmation", "Confirmation code: 55443322")).toBe("55443322");
    // Google's other sender addresses, and a code worded differently.
    expect(verificationCode("Gmail Team <mail-noreply@google.com>", "Gmail Forwarding Confirmation - Receive Mail from a@gmail.com", "a@gmail.com has requested to forward mail to you. Your code is 123456789.")).toBe("123456789");
    // Not Google, or not about forwarding: never a code.
    expect(verificationCode("a@google.com.evil.io", "Gmail Forwarding Confirmation", "Confirmation code: 55443322")).toBeNull();
    expect(verificationCode("no-reply@accounts.google.com", "Security alert", "Your device id is 12345678")).toBeNull();
  });
});

describe("addresses", () => {
  it("round-trips a token", () => {
    const token = newToken();
    expect(token).toMatch(/^[a-z2-9]{12}$/);
    expect(tokenFromAddress(addressFor(token, "orders.example.dev"))).toBe(token);
    expect(tokenFromAddress(`Replenish <${addressFor(token, "x.dev").toUpperCase()}>`)).toBe(token);
  });
  it("makes different tokens", () => {
    expect(new Set(Array.from({ length: 50 }, newToken)).size).toBe(50);
  });
  it("ignores addresses that aren't ours", () => {
    expect(tokenFromAddress("hello@orders.example.dev")).toBeNull();
  });
});

describe("retailers", () => {
  it("recognises the store and its subdomains only", () => {
    expect(retailerOf("Amazon.com <auto-confirm@amazon.com>")).toBe("Amazon");
    expect(retailerOf("shipment@mail.amazon.com")).toBe("Amazon");
    expect(retailerOf("a@amazon.com.evil.io")).toBeNull();
    expect(retailerOf("a@notamazon.com")).toBeNull();
    expect(retailerOf("Walmart <help@walmart.com>")).toBe("Walmart");
    expect(retailerOf("a@walmart.com.evil.io")).toBeNull();
    expect(retailerOf("a@notwalmart.com")).toBeNull();
  });
  it("leaves a direct sender alone", () => {
    expect(originalSender("auto-confirm@amazon.com", "")).toBe("auto-confirm@amazon.com");
  });
});

describe("gmailConfirmation", () => {
  const from = "Gmail Team <forwarding-noreply@google.com>";
  const link = "https://mail-settings.google.com/mail/vf-%5BANGjdJ8x%5D-abc123";

  it("finds the confirm link as well as the code", () => {
    const text = `a@gmail.com has requested to forward mail to you.\nConfirmation code: 123456789\nTo allow it, click the link below:\n${link}\nThanks`;
    expect(gmailConfirmation(from, "Gmail Forwarding Confirmation", text)).toEqual({ code: "123456789", link });
  });

  it("keeps a link when no code can be found", () => {
    expect(gmailConfirmation(from, "Gmail Forwarding Confirmation", `Please confirm forwarding: ${link}.`)).toEqual({ code: null, link });
  });

  it("never offers a link that isn't Google's settings address", () => {
    const text = "Confirmation code: 123456789\nhttps://mail-settings.google.com.evil.io/mail/vf-abc\nhttp://mail-settings.google.com/mail/vf-abc\nhttps://evil.io/mail/vf-abc";
    expect(gmailConfirmation(from, "Gmail Forwarding Confirmation", text)).toEqual({ code: "123456789", link: null });
  });

  it("is not a confirmation when the sender isn't Google", () => {
    expect(gmailConfirmation("a@evil.io", "Gmail Forwarding Confirmation", `Confirmation code: 123456789 ${link}`)).toBeNull();
  });
});
