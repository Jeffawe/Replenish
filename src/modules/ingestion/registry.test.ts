import { describe, expect, it } from "vitest";
import { emailExtractor } from "./email/extractor";
import { createRegistry } from "./registry";
import type { ExtractContext, Extractor } from "./types";

const ctx: ExtractContext = { userId: "u", products: [], now: new Date("2026-10-21T00:00:00Z") };

describe("registry", () => {
  const fake = { source: "fake" } as Extractor;
  const getExtractor = createRegistry([fake, emailExtractor]);

  it("finds a producer by its source label", () => {
    expect(getExtractor("fake")).toBe(fake);
    expect(getExtractor("email")).toBe(emailExtractor);
  });

  it("returns nothing for an unknown source", () => {
    expect(getExtractor("carrier-pigeon")).toBeUndefined();
  });
});

describe("email producer", () => {
  const message = {
    messageId: "m-1",
    from: "orders@example.com",
    subject: "Your order",
    receivedAt: "2026-10-20T10:00:00Z",
    text: "body",
  };

  it("takes an email message as input, coercing the date", () => {
    const parsed = emailExtractor.input.safeParse(message);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({ receivedAt: new Date("2026-10-20T10:00:00Z") });
  });

  it("rejects a message with no id or subject", () => {
    expect(emailExtractor.input.safeParse({ ...message, messageId: "" }).success).toBe(false);
    expect(emailExtractor.input.safeParse({ ...message, subject: undefined }).success).toBe(false);
  });

  it("skips everything until reading emails is decided", async () => {
    expect(await emailExtractor.extract(emailExtractor.input.parse(message) as never, ctx)).toMatchObject({
      kind: "skipped",
    });
  });
});
