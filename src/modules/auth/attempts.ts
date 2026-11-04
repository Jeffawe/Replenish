import { createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";

/** After this many wrong passwords in the window, sign-in is refused until the window passes. */
export const MAX_FAILED_LOGINS = 8;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** The email is hashed, so the table says nothing about who has been trying to sign in. */
const keyFor = (email: string) => createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

/**
 * Whether too many wrong passwords have been tried for this email lately. By account rather than by
 * address, since this is what protects an account that can spend money, and an address is easy to
 * change. Someone could lock an account out for a few minutes this way; anyone already signed in is unaffected.
 */
export async function tooManyFailedLogins(email: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, keyFor(email)), gt(loginAttempts.createdAt, new Date(now.getTime() - LOGIN_WINDOW_MS))));
  return (row?.n ?? 0) >= MAX_FAILED_LOGINS;
}

export async function noteFailedLogin(email: string, now: Date = new Date()): Promise<void> {
  await db.insert(loginAttempts).values({ key: keyFor(email), createdAt: now });
  // Housekeeping: old attempts mean nothing.
  await db.delete(loginAttempts).where(lt(loginAttempts.createdAt, new Date(now.getTime() - LOGIN_WINDOW_MS)));
}

export async function clearFailedLogins(email: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.key, keyFor(email)));
}

/**
 * Checks a password for someone (at sign-in or before a sensitive change), counting wrong answers
 * towards the limit. "locked" means it wasn't even tried.
 */
export async function verifyWithLimit(email: string, check: () => Promise<boolean>): Promise<"ok" | "wrong" | "locked"> {
  if (await tooManyFailedLogins(email)) return "locked";
  if (await check()) {
    await clearFailedLogins(email);
    return "ok";
  }
  await noteFailedLogin(email);
  return "wrong";
}
