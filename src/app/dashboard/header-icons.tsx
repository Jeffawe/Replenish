import type { ReactNode } from "react";
import Link from "next/link";
import { logOutAction } from "@/app/auth/actions";
import { requireUser } from "@/modules/auth";
import { unseenOrderResults } from "@/modules/orders";

const ICON_BUTTON =
  "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

function Icon({ children, size = 20 }: { children: ReactNode; size?: 20 | 24 }) {
  return (
    <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="size-5" fill="none" stroke="currentColor" strokeWidth={size === 24 ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

/** Orders, shown as a package. `unseen` is how many finished orders the user hasn't looked at yet: a badge says so. */
export function OrdersLink({ unseen = 0 }: { unseen?: number }) {
  const label = unseen > 0 ? `Orders, ${unseen} new` : "Orders";
  return (
    <Link href="/orders" aria-label={label} title={label} className={ICON_BUTTON + " relative"}>
      <Icon>
        <path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6L10 2.5Z" />
        <path d="M3.5 6 10 9.5 16.5 6M10 9.5v8" />
      </Icon>
      {unseen > 0 && (
        <span aria-hidden className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] font-semibold leading-4 text-white">
          {unseen > 9 ? "9+" : unseen}
        </span>
      )}
    </Link>
  );
}

/** The Orders icon with its badge (reads the user's orders, so it loads behind a Suspense). */
export async function OrdersLinkWithBadge() {
  const user = await requireUser();
  return <OrdersLink unseen={(await unseenOrderResults(user.id)).length} />;
}

/** Settings, shown as a gear (the Feather "settings" icon, MIT licensed, drawn on a 24 grid). */
export function SettingsLink() {
  return (
    <Link href="/settings" aria-label="Settings" title="Settings" className={ICON_BUTTON}>
      <Icon size={24}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </Icon>
    </Link>
  );
}

/** Sign out, shown as a door with an arrow. */
export function SignOutButton() {
  return (
    <form action={logOutAction}>
      <button type="submit" aria-label="Sign out" title="Sign out" className={ICON_BUTTON}>
        <Icon>
          <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3" />
          <path d="M12.5 6.5 16 10l-3.5 3.5M16 10H8" />
        </Icon>
      </button>
    </form>
  );
}
