"use client";

import Link from "next/link";
import { useActionState } from "react";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/modules/auth/client";
import { logInAction, signUpAction, type AuthState } from "./actions";

const INPUT =
  "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";

/** The email-and-password form for both /login and /signup; `mode` picks the action and the wording. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const signup = mode === "signup";
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signup ? signUpAction : logInAction, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {state.error}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm font-medium">
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          required
          maxLength={254}
          aria-invalid={!!state.fieldErrors?.email}
          className={INPUT}
        />
        {state.fieldErrors?.email && <span className="text-xs font-normal text-red-600 dark:text-red-400">{state.fieldErrors.email}</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Password
        <input
          name="password"
          type="password"
          autoComplete={signup ? "new-password" : "current-password"}
          required
          minLength={signup ? PASSWORD_MIN : undefined}
          maxLength={PASSWORD_MAX}
          aria-invalid={!!state.fieldErrors?.password}
          className={INPUT}
        />
        {signup && !state.fieldErrors?.password && (
          <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">At least {PASSWORD_MIN} characters.</span>
        )}
        {state.fieldErrors?.password && <span className="text-xs font-normal text-red-600 dark:text-red-400">{state.fieldErrors.password}</span>}
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-60"
      >
        {pending ? (signup ? "Creating account…" : "Logging in…") : signup ? "Create account" : "Log in"}
      </button>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {signup ? (
          <>
            Already have an account? <Link href="/login" className="font-medium text-foreground underline">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/signup" className="font-medium text-foreground underline">Create an account</Link>
          </>
        )}
      </p>
    </form>
  );
}
