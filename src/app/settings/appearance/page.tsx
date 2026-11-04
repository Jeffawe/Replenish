import type { Metadata } from "next";
import { ThemeChoice } from "./theme-choice";

export const metadata: Metadata = { title: "Appearance · Settings · Replenish" };

export default function AppearancePage() {
  return (
    <section className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Choose light or dark for the whole app. This is remembered on this device and browser, so on another one you choose again.
      </p>
      <ThemeChoice />
    </section>
  );
}
