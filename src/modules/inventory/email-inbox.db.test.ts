// Runs against the real database (npm run test:db), using throwaway users that are deleted afterwards.
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { emailInboxes, users } from "@/db/schema";
import {
  clearEmailLog,
  findUserByInboxToken,
  getOrCreateInboxToken,
  listEmailLog,
  logEmail,
  readVerification,
  readVerificationCode,
  replaceInboxToken,
  saveVerificationCode,
} from "./email-inbox";

const createdUsers: string[] = [];
async function newUser() {
  const [user] = await db.insert(users).values({ email: `inbox-test-${randomUUID()}@test.local` }).returning();
  createdUsers.push(user.id);
  return user.id;
}
afterAll(async () => {
  if (createdUsers.length) await db.delete(users).where(inArray(users.id, createdUsers));
});
const token = () => randomUUID().replace(/-/g, "").slice(0, 12);

describe("email inbox", () => {
  it("makes one stable token per user and finds the user by it", async () => {
    const userId = await newUser();
    const first = await getOrCreateInboxToken(userId, token);
    expect(await getOrCreateInboxToken(userId, token)).toBe(first);
    expect(await findUserByInboxToken(first)).toBe(userId);
    expect(await findUserByInboxToken("nobody")).toBeNull();
  });

  it("retires the old address when replaced, and forgets the confirmation code", async () => {
    const userId = await newUser();
    const old = await getOrCreateInboxToken(userId, token);
    await saveVerificationCode(userId, "123456789");
    const fresh = await replaceInboxToken(userId, token);
    expect(fresh).not.toBe(old);
    expect(await findUserByInboxToken(old)).toBeNull();
    expect(await findUserByInboxToken(fresh)).toBe(userId);
    expect(await readVerificationCode(userId)).toBeNull();
  });

  it("shows a confirmation code only while it is fresh", async () => {
    const userId = await newUser();
    await getOrCreateInboxToken(userId, token);
    await saveVerificationCode(userId, "424242424");
    expect(await readVerificationCode(userId)).toBe("424242424");
    expect(await readVerificationCode(userId, new Date(Date.now() + 31 * 60 * 1000))).toBeNull();

    // The confirm link is kept with the code, and goes with it.
    await saveVerificationCode(userId, null, "https://mail-settings.google.com/mail/vf-abc");
    expect(await readVerification(userId)).toEqual({ code: null, link: "https://mail-settings.google.com/mail/vf-abc" });
    expect(await readVerification(userId, new Date(Date.now() + 31 * 60 * 1000))).toBeNull();
  });

  it("logs outcomes newest first, keeps nothing else, and clears", async () => {
    const userId = await newUser();
    await logEmail(userId, { outcome: "dropped", reason: "Not from a store we read" });
    await logEmail(userId, { outcome: "accepted", retailer: "Amazon", itemCount: 3 });
    const log = await listEmailLog(userId);
    expect(log.map((entry) => entry.outcome)).toEqual(["accepted", "dropped"]);
    expect(log[0]).toMatchObject({ retailer: "Amazon", itemCount: 3 });
    await clearEmailLog(userId);
    expect(await listEmailLog(userId)).toHaveLength(0);
  });

  it("is removed with the user", async () => {
    const userId = await newUser();
    await getOrCreateInboxToken(userId, token);
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(emailInboxes).where(eq(emailInboxes.userId, userId))).toHaveLength(0);
  });
});
