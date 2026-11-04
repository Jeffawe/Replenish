"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkCredentials,
  createAccount,
  EmailSchema,
  endSession,
  isApproved,
  PasswordSchema,
  startSession,
  verifyWithLimit,
} from "@/modules/auth";

export type AuthState = { error?: string; fieldErrors?: { email?: string; password?: string }; email?: string };

const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(1000) });
const SignUpSchema = z.object({ email: EmailSchema, password: PasswordSchema });

/** Pulls the email back out of the form so a failed attempt doesn't make the user retype it. */
const typedEmail = (formData: FormData) => String(formData.get("email") ?? "");

export async function signUpAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = SignUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      email: typedEmail(formData),
      fieldErrors: {
        email: fields.email && "Enter a valid email address.",
        password: fields.password?.[0],
      },
    };
  }

  const outcome = await createAccount(parsed.data);
  if (!outcome.ok) {
    return { email: parsed.data.email, fieldErrors: { email: "There's already an account with that email. Log in instead?" } };
  }
  await startSession(outcome.user.id);
  redirect(isApproved(outcome.user) ? "/dashboard" : "/pending");
}

export async function logInAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  const found: { user: Awaited<ReturnType<typeof checkCredentials>> } = { user: null };
  if (parsed.success) {
    const verdict = await verifyWithLimit(parsed.data.email, async () => {
      found.user = await checkCredentials(parsed.data.email, parsed.data.password);
      return found.user !== null;
    });
    if (verdict === "locked") return { email: typedEmail(formData), error: "Too many tries. Please wait 15 minutes and try again." };
  }
  const { user } = found;
  if (!user) return { email: typedEmail(formData), error: "That email and password don't match an account." };
  await startSession(user.id);
  redirect(isApproved(user) ? "/dashboard" : "/pending");
}

export async function logOutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
