import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/modules/auth";
import { AuthForm } from "./auth-form";

/** Someone who is already signed in has no use for the login page. Reads the cookie, so it sits in its own Suspense. */
async function SkipIfSignedIn() {
  if (await getCurrentUser()) redirect("/dashboard");
  return null;
}

/** The shared look of /login and /signup. */
export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={null}>
        <SkipIfSignedIn />
      </Suspense>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{mode === "signup" ? "Create your account" : "Log in"}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Replenish keeps track of what you have at home.</p>
      </header>
      <AuthForm mode={mode} />
    </main>
  );
}
