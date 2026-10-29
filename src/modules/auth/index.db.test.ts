// Runs against the real database (npm run test:db). Checks that an account waiting for approval
// can't get past requireUser(), which every server action and data-loading component starts with.
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { SESSION_COOKIE } from "./client";
import { approveUsers, createAccount, listPendingUsers } from "./accounts";
import { createSession } from "./sessions";

let cookieToken: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === SESSION_COOKIE && cookieToken ? { value: cookieToken } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const emails: string[] = [];
async function signedInAs() {
  const email = `approval-test-${randomUUID()}@test.local`;
  emails.push(email);
  const created = await createAccount({ email, password: "a good password" });
  if (!created.ok) throw new Error("setup failed");
  cookieToken = (await createSession(created.user.id)).token;
  return email;
}

const original = process.env.REQUIRE_APPROVAL;
beforeEach(() => {
  process.env.REQUIRE_APPROVAL = "1";
});
afterEach(() => {
  cookieToken = undefined;
  if (original === undefined) delete process.env.REQUIRE_APPROVAL;
  else process.env.REQUIRE_APPROVAL = original;
});
afterAll(async () => {
  if (emails.length) await db.delete(users).where(inArray(users.email, emails));
});

// Imported per test: getCurrentUser is cached per request, and there is no request here.
const freshAuth = async () => {
  vi.resetModules();
  return import("./index");
};

describe("requireUser with approval on", () => {
  it("sends an unapproved account to the waiting page", async () => {
    await signedInAs();
    const { requireUser, getCurrentUser } = await freshAuth();
    await expect(requireUser()).rejects.toThrow("redirect:/pending");
    expect((await getCurrentUser())?.approved).toBe(false);
  });

  it("lets an approved account through, matching the email in any case", async () => {
    const email = await signedInAs();
    expect(await approveUsers([email.toUpperCase(), "nobody@test.local"])).toEqual({ approved: [email], unknown: ["nobody@test.local"] });
    const { requireUser } = await freshAuth();
    expect((await requireUser()).email).toBe(email);
  });

  it("sends a visitor with no session to login", async () => {
    const { requireUser } = await freshAuth();
    await expect(requireUser()).rejects.toThrow("redirect:/login");
  });

  it("lets everyone through when approval is off", async () => {
    await signedInAs();
    process.env.REQUIRE_APPROVAL = "";
    const { requireUser } = await freshAuth();
    expect((await requireUser()).approved).toBe(true);
  });

  it("lists who is waiting", async () => {
    const email = await signedInAs();
    expect((await listPendingUsers()).map((row) => row.email)).toContain(email);
    await approveUsers([email]);
    expect((await listPendingUsers()).map((row) => row.email)).not.toContain(email);
  });
});
