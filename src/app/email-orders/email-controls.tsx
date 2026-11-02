"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SECONDARY } from "@/app/ingest/flow-kit";
import { resetEmailAddressAction } from "./actions";

/** Text the user has to copy somewhere else (Gmail), with a button that does it. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="button"
        onClick={() => {
          navigator.clipboard
            .writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            // Blocked clipboard: the text is already selectable above.
            .catch(() => {});
        }}
        className={SECONDARY}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Gmail's confirmation email arrives a moment after the address is added. */
export function CheckAgain() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.refresh()} className="text-sm underline underline-offset-2">
      Check again
    </button>
  );
}

export function StopAndDelete() {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className={SECONDARY}>
        Stop and delete
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <p>
        This gives you a new address, so the old one stops working, and clears the list above. Orders already added stay. You&rsquo;ll need to
        point your Gmail filter at the new address.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            resetEmailAddressAction()
              .then(() => setAsking(false))
              .catch(() => setError("That didn't work. Please try again."))
              .finally(() => setBusy(false));
          }}
          className={SECONDARY + " text-rose-700 dark:text-rose-400"}
        >
          {busy ? "Working…" : "Yes, get a new address"}
        </button>
        <button type="button" onClick={() => setAsking(false)} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </div>
  );
}
