"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  checkCredentials,
  createAccount,
  EmailSchema,
  endSession,
  PasswordSchema,
  startSession,
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
  redirect("/dashboard");
}

export async function logInAction(_previous: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = LoginSchema.safeParse(Object.fromEntries(formData));
  const user = parsed.success ? await checkCredentials(parsed.data.email, parsed.data.password) : null;
  if (!user) return { email: typedEmail(formData), error: "That email and password don't match an account." };
  await startSession(user.id);
  redirect("/dashboard");
}

export async function logOutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}
