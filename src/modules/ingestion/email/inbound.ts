import { z } from "zod";
import type { IngestResult } from "@/core/purchase-batch";
import type { RunOutcome } from "../run";
import type { SubmitOutcome } from "../submit";
import { tokenFromAddress } from "./address";
import { originalSender, retailerOf } from "./retailers";
import type { EmailMessage } from "./types";

/** What the Cloudflare Worker posts for each email that reaches a user's address. */
export const InboundEmailSchema = z.object({
  to: z.string().max(500),
  from: z.string().max(500),
  subject: z.string().max(1000).default(""),
  text: z.string().max(300_000).default(""),
  messageId: z.string().min(1).max(500),
  receivedAt: z.coerce.date().optional(),
});

export type InboundOutcome =
  /** Nobody has this address. Nothing is stored or logged. */
  | { outcome: "unknown-address" }
  | { outcome: "verification" }
  | { outcome: "accepted"; items: number }
  | { outcome: "dropped"; reason: string };

export interface InboundDeps {
  findUser(token: string): Promise<string | null>;
  extract(userId: string, message: EmailMessage): Promise<RunOutcome>;
  submit(userId: string, batch: unknown): Promise<SubmitOutcome>;
  saveVerificationCode(userId: string, code: string): Promise<void>;
  log(userId: string, entry: { outcome: "accepted" | "dropped" | "verification"; reason?: string; retailer?: string | null; itemCount?: number }): Promise<void>;
}

/**
 * Gmail asks the new forwarding address to confirm: its code, if this is that email.
 * It has to come from Google and be about forwarding. The code is in the subject ("(#123456789)")
 * or the body ("Confirmation code: 123456789"); failing both, the one long number in the body.
 */
export function verificationCode(from: string, subject: string, text: string): string | null {
  const domain = /@([a-z0-9.-]+)>?\s*$/i.exec(from.trim())?.[1]?.toLowerCase() ?? "";
  const fromGoogle = ["google.com", "googlemail.com"].some((d) => domain === d || domain.endsWith(`.${d}`));
  const aboutForwarding = /forwarding confirmation|forward(?:ing)? mail|confirm.*forward/i.test(subject + " " + text.slice(0, 600));
  if (!fromGoogle || !aboutForwarding) return null;
  const inSubject = /\(#(\d{6,12})\)/.exec(subject);
  const inBody = /code[^\d]{0,40}(\d{6,12})/i.exec(text);
  const anyNumber = /(?<!\d)(\d{6,12})(?!\d)/.exec(text.slice(0, 2000));
  return inSubject?.[1] ?? inBody?.[1] ?? anyNumber?.[1] ?? null;
}

/** Why a submission that stored nothing stored nothing, in words the user can read. */
function whyNothingStored(result: IngestResult): string {
  if (result.status === "duplicate") return "Already added from an earlier email";
  const reasons = result.items.flatMap((item) => (item.result === "rejected" ? [item.reason] : []));
  return reasons[0] ?? "Nothing in it could be added";
}

/**
 * One email arriving at a private address. In order: find whose address it is;
 * keep Gmail's confirmation code; drop anything not from a store we read;
 * otherwise read it into an order and store it as *pending* (see core/pending.ts),
 * where the user will be asked. The email's own text is never stored, and the
 * log keeps only what we did with it.
 */
export async function handleInboundEmail(raw: unknown, deps: InboundDeps): Promise<InboundOutcome | { outcome: "invalid" }> {
  const parsed = InboundEmailSchema.safeParse(raw);
  if (!parsed.success) return { outcome: "invalid" };
  const email = parsed.data;

  const token = tokenFromAddress(email.to);
  const userId = token ? await deps.findUser(token) : null;
  if (!userId) return { outcome: "unknown-address" };

  const code = verificationCode(email.from, email.subject, email.text);
  if (code) {
    await deps.saveVerificationCode(userId, code);
    await deps.log(userId, { outcome: "verification", reason: "Gmail's confirmation code" });
    return { outcome: "verification" };
  }

  const drop = async (reason: string, retailer?: string | null): Promise<InboundOutcome> => {
    await deps.log(userId, { outcome: "dropped", reason, retailer });
    return { outcome: "dropped", reason };
  };

  const sender = originalSender(email.from, email.text);
  const retailer = retailerOf(sender);
  if (!retailer) return drop("Not from a store we read");

  try {
    const message: EmailMessage = {
      messageId: email.messageId,
      from: sender,
      subject: email.subject,
      receivedAt: email.receivedAt ?? new Date(),
      text: email.text,
    };
    const extracted = await deps.extract(userId, message);
    if (!extracted.ok) return drop("We couldn't read this email", retailer);
    if (extracted.result.kind === "skipped") return drop(extracted.result.reason, retailer);

    // Nobody has looked at this one: it counts now and waits for the user's answer.
    const submitted = await deps.submit(userId, { ...extracted.result.draft.batch, status: "pending" });
    if (!submitted.ok) return drop("We couldn't read the order's details", retailer);

    const stored = submitted.result.items.filter((item) => item.result === "created").length;
    if (stored === 0) return drop(whyNothingStored(submitted.result), retailer);

    await deps.log(userId, { outcome: "accepted", retailer, itemCount: stored });
    return { outcome: "accepted", items: stored };
  } catch (error) {
    console.error("Reading a forwarded email failed", error);
    return drop("Something went wrong reading this email", retailer);
  }
}
