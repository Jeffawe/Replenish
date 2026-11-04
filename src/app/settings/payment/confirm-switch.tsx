"use client";

import { useState, useTransition } from "react";
import { setSkipBuyConfirmAction } from "../actions";

/** Brings back the confirmation someone turned off with "Don't show me this again". */
export function ConfirmSwitch({ skip }: { skip: boolean }) {
  const [asking, setAsking] = useState(!skip);
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={asking}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.checked;
          setAsking(next);
          startTransition(() => setSkipBuyConfirmAction(!next));
        }}
        className="mt-0.5 size-4 shrink-0"
      />
      <span>
        <span className="font-medium">Show the costs and ask me to confirm before Buy for me</span>
        <span className="block text-zinc-500 dark:text-zinc-400">We always ask for anything unusual, like a different brand or pack size, even with this off.</span>
      </span>
    </label>
  );
}
