import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { receiptReads, users } from "@/db/schema";
import { effectiveReceiptLimit, monthStart } from "@/core/receipt-limit";

export type ReadReservation =
  | { ok: true; id: string }
  | { ok: false; limit: number };

/**
 * Charges one receipt photo to the user's month, unless they are out. The check
 * and the charge are one statement, so two photos arriving together can't both
 * take the last one. Give the charge back with `refundReceiptRead` if the read fails.
 */
export async function reserveReceiptRead(userId: string, now = new Date()): Promise<ReadReservation> {
  const [user] = await db.select({ receiptLimit: users.receiptLimit }).from(users).where(eq(users.id, userId));
  const limit = effectiveReceiptLimit(user?.receiptLimit ?? null, process.env.RECEIPT_LIMIT);

  const result = await db.execute(sql`
    insert into ${receiptReads} (user_id)
    select ${userId}::uuid
    where (
      select count(*) from ${receiptReads}
      where user_id = ${userId}::uuid and created_at >= ${monthStart(now).toISOString()}::timestamptz
    ) < ${limit}
    returning id
  `);
  const id = (result.rows[0] as { id: string } | undefined)?.id;
  return id ? { ok: true, id } : { ok: false, limit };
}

export async function refundReceiptRead(id: string): Promise<void> {
  await db.delete(receiptReads).where(eq(receiptReads.id, id));
}
