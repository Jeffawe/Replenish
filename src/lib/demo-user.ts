import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

export const DEMO_USER_EMAIL = "demo@replenish.local";

/**
 * Stand-in for real auth: everyone is the one demo user, created on first use.
 * Replace with the signed-in user when login is added.
 */
export async function getDemoUser() {
  await db
    .insert(users)
    .values({ email: DEMO_USER_EMAIL, name: "Demo User" })
    .onConflictDoNothing({ target: users.email });
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_USER_EMAIL));
  return user;
}
