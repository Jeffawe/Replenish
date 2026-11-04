"use client";

import { useSyncExternalStore } from "react";
import { readPreference, savePreference, subscribePreference, THEME_CHOICES, type ThemePreference } from "@/lib/theme";

/** The light / dark / match-my-device choice. Changes the whole app straight away. */
export function ThemeChoice() {
  // The server can't know the choice; it renders "system" and the browser corrects it without a hydration error.
  const current = useSyncExternalStore(subscribePreference, readPreference, (): ThemePreference => "system");

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Appearance</legend>
      {THEME_CHOICES.map((choice) => (
        <label
          key={choice.value}
          className="flex cursor-pointer items-start gap-3 rounded-xl border border-zinc-200 p-4 has-[:checked]:border-foreground dark:border-zinc-800"
        >
          <input
            type="radio"
            name="theme"
            value={choice.value}
            checked={current === choice.value}
            onChange={() => savePreference(choice.value)}
            className="mt-1"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">{choice.label}</span>
            {choice.hint && <span className="text-sm text-zinc-600 dark:text-zinc-400">{choice.hint}</span>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
