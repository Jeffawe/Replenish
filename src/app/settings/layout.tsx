import Link from "next/link";
import { SettingsTabs } from "./settings-tabs";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2">
        <Link href="/dashboard" className="text-sm text-zinc-600 underline-offset-2 hover:underline dark:text-zinc-400">
          &larr; Back to inventory
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </header>
      <SettingsTabs />
      {children}
    </main>
  );
}
