import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, type User } from "@/db/schema";
import { PASSWORD_MAX, PASSWORD_MIN } from "./limits";
import { hashPassword, verifyPassword } from "./password";

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export type SignUpOutcome = { ok: true; user: User } | { ok: false; error: "taken" };

/** Creates an account. `input` must already have passed EmailSchema and PasswordSchema. */
export async function createAccount(input: { email: string; password: string }): Promise<SignUpOutcome> {
  const passwordHash = await hashPassword(input.password);
  // The unique index on email decides a race between two sign-ups; no read-then-write.
  const [user] = await db
    .insert(users)
    .values({ email: input.email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning();
  return user ? { ok: true, user } : { ok: false, error: "taken" };
}

// Verified against when the email is unknown, so a wrong email takes as long as a wrong password.
const NO_SUCH_USER = hashPassword("no such user");

/** The user for this email and password, or null. Says nothing about which of the two was wrong. */
export async function checkCredentials(email: string, password: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user?.passwordHash) {
    await verifyPassword(password, await NO_SUCH_USER);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

/**
 * The account that the API routes and the scripts act for, since they have no
 * browser to sign in with: `INGEST_USER_EMAIL` if set, otherwise the oldest
 * account (the one that claimed the original demo data).
 */
export async function getDefaultUser(): Promise<User> {
  const email = process.env.INGEST_USER_EMAIL?.trim().toLowerCase();
  const [user] = email
    ? await db.select().from(users).where(eq(users.email, email))
    : await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
  if (!user) {
    throw new Error(
      email ? `INGEST_USER_EMAIL is ${email}, but no account has that email.` : "There are no accounts yet. Sign up first, or run npm run claim-demo.",
    );
  }
  return user;
}

export type ClaimOutcome = { ok: true; user: User } | { ok: false; error: "no-demo-user" | "email-taken" };

/**
 * One-off: hands the original demo user (and so all its data) to a real
 * person, by giving that row their email and password.
 */
export async function claimAccount(fromEmail: string, input: { email: string; password: string }): Promise<ClaimOutcome> {
  const [existing] = await db.select().from(users).where(eq(users.email, fromEmail));
  if (!existing) return { ok: false, error: "no-demo-user" };
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (taken && taken.id !== existing.id) return { ok: false, error: "email-taken" };
  const [user] = await db
    .update(users)
    .set({ email: input.email, name: null, passwordHash: await hashPassword(input.password) })
    .where(eq(users.id, existing.id))
    .returning();
  return { ok: true, user };
}
