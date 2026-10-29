// Runs against the real database (npm run test:db), using throwaway users that are deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { checkCredentials, claimAccount, createAccount, getDefaultUser } from "./accounts";
import { createSession, deleteSession, findUserBySession, SESSION_DAYS } from "./sessions";

const emails: string[] = [];
const newEmail = () => {
  const email = `auth-test-${randomUUID()}@test.local`;
  emails.push(email);
  return email;
};

afterAll(async () => {
  // Cascades to their sessions.
  if (emails.length) await db.delete(users).where(inArray(users.email, emails));
});

describe("accounts", () => {
  it("signs up once per email and checks the password at login", async () => {
    const email = newEmail();
    const created = await createAccount({ email, password: "a good password" });
    expect(created.ok).toBe(true);
    expect(await createAccount({ email, password: "another password" })).toEqual({ ok: false, error: "taken" });

    expect((await checkCredentials(email, "a good password"))?.email).toBe(email);
    expect(await checkCredentials(email, "a bad password")).toBeNull();
    expect(await checkCredentials(newEmail(), "a good password")).toBeNull();
  });

  it("never stores the password itself", async () => {
    const email = newEmail();
    await createAccount({ email, password: "visible password" });
    const [row] = await db.select().from(users).where(eq(users.email, email));
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain("visible password");
  });

  it("refuses to log in to an account that has no password", async () => {
    const email = newEmail();
    await db.insert(users).values({ email });
    expect(await checkCredentials(email, "")).toBeNull();
    expect(await checkCredentials(email, "anything at all")).toBeNull();
  });
});

describe("sessions", () => {
  it("finds the user for a live token, and not after logout or expiry", async () => {
    const email = newEmail();
    const created = await createAccount({ email, password: "a good password" });
    if (!created.ok) throw new Error("setup failed");

    const { token } = await createSession(created.user.id);
    expect((await findUserBySession(token))?.id).toBe(created.user.id);
    expect(await findUserBySession("not a real token")).toBeNull();

    const later = new Date(Date.now() + (SESSION_DAYS + 1) * 24 * 60 * 60 * 1000);
    expect(await findUserBySession(token, later)).toBeNull();

    await deleteSession(token);
    expect(await findUserBySession(token)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const created = await createAccount({ email: newEmail(), password: "a good password" });
    if (!created.ok) throw new Error("setup failed");
    const { token } = await createSession(created.user.id);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, created.user.id));
    expect(rows.map((row) => row.tokenHash)).not.toContain(token);
  });
});

describe("claiming the demo user", () => {
  it("moves the row (and so its data) to the new email and password", async () => {
    const demoEmail = newEmail();
    const [demo] = await db.insert(users).values({ email: demoEmail, name: "Demo User" }).returning();
    const email = newEmail();

    const claimed = await claimAccount(demoEmail, { email, password: "my new password" });
    expect(claimed.ok && claimed.user.id).toBe(demo.id);
    expect((await checkCredentials(email, "my new password"))?.id).toBe(demo.id);
    expect(await claimAccount(demoEmail, { email: newEmail(), password: "my new password" })).toEqual({ ok: false, error: "no-demo-user" });
  });

  it("won't take an email another account uses", async () => {
    const demoEmail = newEmail();
    await db.insert(users).values({ email: demoEmail });
    const other = newEmail();
    await createAccount({ email: other, password: "a good password" });
    expect(await claimAccount(demoEmail, { email: other, password: "my new password" })).toEqual({ ok: false, error: "email-taken" });
  });
});

describe("the default user", () => {
  it("is the account named by INGEST_USER_EMAIL", async () => {
    const email = newEmail();
    await createAccount({ email, password: "a good password" });
    const before = process.env.INGEST_USER_EMAIL;
    process.env.INGEST_USER_EMAIL = email.toUpperCase();
    try {
      expect((await getDefaultUser()).email).toBe(email);
      process.env.INGEST_USER_EMAIL = "nobody@test.local";
      await expect(getDefaultUser()).rejects.toThrow(/no account/);
    } finally {
      if (before === undefined) delete process.env.INGEST_USER_EMAIL;
      else process.env.INGEST_USER_EMAIL = before;
    }
  });
});
