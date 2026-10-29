import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { logOutAction } from "@/app/auth/actions";
import { getCurrentUser } from "@/modules/auth";

export const metadata: Metadata = { title: "Waiting for approval · Replenish" };

export default function PendingPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12">
      <Suspense fallback={null}>
        <Waiting />
      </Suspense>
    </main>
  );
}

async function Waiting() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // Approved since the last visit (or approval was switched off): carry on.
  if (user.approved) redirect("/dashboard");

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Waiting for approval</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Your account ({user.email}) is created, but it hasn&rsquo;t been approved yet. Once it is, refresh this page and
          you&rsquo;ll be taken in.
        </p>
      </header>
      <form action={logOutAction}>
        <button type="submit" className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          Sign out
        </button>
      </form>
    </>
  );
}
