"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string; short?: string }[] = [
  { href: "/settings/autobuy", label: "Auto-buy" },
  { href: "/settings/payment", label: "Payment & delivery", short: "Payment" },
  { href: "/settings/estimates", label: "Estimates" },
  { href: "/settings/appearance", label: "Appearance" },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => {
        const current = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={
              "shrink-0 whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium sm:px-3 " +
              (current
                ? "border-foreground text-foreground"
                : "border-transparent text-zinc-600 hover:text-foreground dark:text-zinc-400")
            }
          >
            {tab.short ? (
              <>
                <span className="sm:hidden">{tab.short}</span>
                <span className="hidden sm:inline">{tab.label}</span>
              </>
            ) : (
              tab.label
            )}
          </Link>
        );
      })}
    </nav>
  );
}
