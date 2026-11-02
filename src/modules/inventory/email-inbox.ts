import { and, desc, eq, gt, lt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { emailInboxes, emailLog } from "@/db/schema";

/**
 * Storage for the email-forwarding feature: each user's private address token,
 * the Gmail confirmation code, and the log of what happened to each email.
 * The tokens are made by the caller (the ingestion module owns the address format).
 */

const CODE_LIFETIME_MS = 30 * 60 * 1000;
const LOG_KEEP_DAYS = 30;
const LOG_SHOW = 25;

export interface EmailLogEntry {
  id: string;
  receivedAt: Date;
  outcome: string;
  reason: string | null;
  retailer: string | null;
  itemCount: number | null;
}

/** The user's token, made on first use. */
export async function getOrCreateInboxToken(userId: string, makeToken: () => string): Promise<string> {
  await db.insert(emailInboxes).values({ userId, token: makeToken() }).onConflictDoNothing();
  const [row] = await db.select({ token: emailInboxes.token }).from(emailInboxes).where(eq(emailInboxes.userId, userId));
  return row!.token;
}

/** Retires the old address for a new one, and forgets any confirmation code. */
export async function replaceInboxToken(userId: string, makeToken: () => string): Promise<string> {
  const token = makeToken();
  await db
    .insert(emailInboxes)
    .values({ userId, token })
    .onConflictDoUpdate({ target: emailInboxes.userId, set: { token, verificationCode: null, verificationAt: null } });
  return token;
}

export async function findUserByInboxToken(token: string): Promise<string | null> {
  const [row] = await db.select({ userId: emailInboxes.userId }).from(emailInboxes).where(eq(emailInboxes.token, token));
  return row?.userId ?? null;
}

export async function saveVerificationCode(userId: string, code: string | null, link: string | null = null): Promise<void> {
  await db
    .update(emailInboxes)
    .set({ verificationCode: code, verificationLink: link, verificationAt: new Date() })
    .where(eq(emailInboxes.userId, userId));
}

/** The latest Gmail confirmation (code and/or link), while it's still fresh. */
export async function readVerification(userId: string, now = new Date()): Promise<{ code: string | null; link: string | null } | null> {
  const [row] = await db
    .select({ code: emailInboxes.verificationCode, link: emailInboxes.verificationLink, at: emailInboxes.verificationAt })
    .from(emailInboxes)
    .where(eq(emailInboxes.userId, userId));
  if (!row?.at || now.getTime() - row.at.getTime() >= CODE_LIFETIME_MS) return null;
  if (!row.code && !row.link) return null;

  // Any other email arriving after it shows forwarding already works, so there is nothing left to confirm.
  const [later] = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(and(eq(emailLog.userId, userId), gt(emailLog.receivedAt, row.at), ne(emailLog.outcome, "verification")))
    .limit(1);
  return later ? null : { code: row.code, link: row.link };
}

/** The latest Gmail confirmation code, while it's still fresh. */
export async function readVerificationCode(userId: string, now = new Date()): Promise<string | null> {
  return (await readVerification(userId, now))?.code ?? null;
}

export async function logEmail(
  userId: string,
  entry: { outcome: string; reason?: string; retailer?: string | null; itemCount?: number },
): Promise<void> {
  await db.insert(emailLog).values({
    userId,
    outcome: entry.outcome,
    reason: entry.reason ?? null,
    retailer: entry.retailer ?? null,
    itemCount: entry.itemCount ?? null,
  });
  // The log is for checking recent mail, not an archive.
  const cutoff = new Date(Date.now() - LOG_KEEP_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(emailLog).where(and(eq(emailLog.userId, userId), lt(emailLog.receivedAt, cutoff)));
}

export async function listEmailLog(userId: string): Promise<EmailLogEntry[]> {
  return db
    .select({
      id: emailLog.id,
      receivedAt: emailLog.receivedAt,
      outcome: emailLog.outcome,
      reason: emailLog.reason,
      retailer: emailLog.retailer,
      itemCount: emailLog.itemCount,
    })
    .from(emailLog)
    .where(eq(emailLog.userId, userId))
    .orderBy(desc(emailLog.receivedAt))
    .limit(LOG_SHOW);
}

export async function clearEmailLog(userId: string): Promise<void> {
  await db.delete(emailLog).where(eq(emailLog.userId, userId));
}
