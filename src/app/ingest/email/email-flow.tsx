"use client";

import Link from "next/link";
import { FlowHeader, SECONDARY, type FlowProps } from "../flow-kit";

/**
 * Email orders aren't added one at a time: the user sets up forwarding once and
 * orders then arrive on their own. So this flow only explains that and links to
 * the setup page, where the address, the steps and the log are.
 */
export function EmailFlow({ onBack, onClose }: FlowProps) {
  return (
    <>
      <FlowHeader title="Orders by email" subtitle="For Amazon and other stores that don't give a receipt." onClose={onClose} />
      <div className="flex flex-col gap-4 px-5 py-5 text-sm">
        <p>
          Forward your order emails to a private address and we&rsquo;ll add what you bought, with nothing to type. You set it up once. After that,
          new orders show up on their own and you just say whether they look right.
        </p>
        <div className="flex gap-2">
          <button type="button" onClick={onBack} className={SECONDARY}>
            Back
          </button>
          <Link
            href="/email-orders"
            className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background"
          >
            Set up forwarding
          </Link>
        </div>
      </div>
    </>
  );
}
