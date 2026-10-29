import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users, type User } from "@/db/schema";

/** How long a sign-in lasts. */
export const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The cookie holds the random token; the database holds only this hash of it. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Starts a session for the user. Returns the token to put in the cookie, and when it stops working. */
export async function createSession(userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY_MS);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  // Housekeeping: other people's expired sessions can go whenever someone signs in.
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  return { token, expiresAt };
}

/**
 * The user a cookie's token belongs to, or null when it is unknown or expired.
 * Without `now` the database's clock decides: the app's own `new Date()` can't be
 * read this early while a page is being prepared.
 */
export async function findUserBySession(token: string, now?: Date): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now ?? sql`now()`)));
  return row?.user ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
