/**
 * The server door to accounts and sign-in. Server components and actions ask
 * `requireUser()` who is signed in; sign-up and login start a session with
 * `startSession`. The browser-safe bits (the cookie's name, the password
 * rules) are in ./client.
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "./client";
import { isApproved } from "./approval";
import { createSession, deleteSession, findUserBySession, SESSION_DAYS } from "./sessions";

export { approvalRequired, isApproved } from "./approval";
export {
  approveUsers,
  checkCredentials,
  claimAccount,
  createAccount,
  EmailSchema,
  getDefaultUser,
  listPendingUsers,
  PasswordSchema,
} from "./accounts";

/** What the rest of the app may know about the signed-in user. `approved` is always true while REQUIRE_APPROVAL is off. */
export type CurrentUser = { id: string; email: string; approved: boolean };

/** Who is signed in (approved or not), or null. Looked up once per request, however many components ask. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = await findUserBySession(token);
  return user ? { id: user.id, email: user.email, approved: isApproved(user) } : null;
});

/**
 * The signed-in, approved user; anyone else is sent to the login page, or to
 * the "waiting for approval" page. Call this first in every server action and
 * data-loading component: it is what keeps an unapproved account away from the
 * OCR quota, however it got there.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.approved) redirect("/pending");
  return user;
}

/** Signs the user in on this browser. Only from a server action or route handler, where cookies can be set. */
export async function startSession(userId: string): Promise<void> {
  const { token } = await createSession(userId);
  // Behind HTTPS the cookie is marked secure. Plain http (the app over a tailnet, say) would drop a secure cookie.
  const https = (await headers()).get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: https,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

/** Signs out of this browser only. */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  jar.delete(SESSION_COOKIE);
}
