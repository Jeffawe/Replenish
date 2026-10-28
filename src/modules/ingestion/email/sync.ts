import type { Warning } from "../types";
import type { RunOutcome } from "../run";
import type { SubmitOutcome } from "../submit";
import type { EmailMessage, InboxProvider } from "./types";

export type MessageOutcome = "stored" | "duplicate" | "rejected" | "skipped" | "failed";

export interface MessageReport {
  messageId: string;
  subject: string;
  outcome: MessageOutcome;
  detail?: string;
  warnings: Warning[];
}

export interface SyncReport {
  messages: MessageReport[];
  counts: Record<MessageOutcome, number>;
}

export interface SyncDeps {
  inbox: InboxProvider;
  extract(message: EmailMessage): Promise<RunOutcome>;
  submit(userId: string, batch: unknown): Promise<SubmitOutcome>;
}

/**
 * The email trigger. Reads new messages, runs each through the email
 * producer, and submits any draft with no human in the loop; warnings are
 * reported, not blocking. One bad message never stops the rest.
 */
export async function syncInbox(userId: string, since: Date, deps: SyncDeps): Promise<SyncReport> {
  const counts: Record<MessageOutcome, number> = {
    stored: 0,
    duplicate: 0,
    rejected: 0,
    skipped: 0,
    failed: 0,
  };
  const messages: MessageReport[] = [];

  for (const message of await deps.inbox.listMessages({ since })) {
    const report = await processMessage(userId, message, deps);
    counts[report.outcome]++;
    messages.push(report);
  }
  return { messages, counts };
}

async function processMessage(
  userId: string,
  message: EmailMessage,
  deps: SyncDeps,
): Promise<MessageReport> {
  const base = { messageId: message.messageId, subject: message.subject };
  try {
    const extracted = await deps.extract(message);
    if (!extracted.ok) {
      return { ...base, outcome: "failed", detail: extracted.error, warnings: [] };
    }
    if (extracted.result.kind === "skipped") {
      return { ...base, outcome: "skipped", detail: extracted.result.reason, warnings: [] };
    }

    const { draft } = extracted.result;
    const submitted = await deps.submit(userId, draft.batch);
    if (!submitted.ok) {
      const detail = submitted.issues.map((i) => `${i.path}: ${i.message}`).join("; ");
      return { ...base, outcome: "failed", detail, warnings: draft.warnings };
    }

    const outcome = { processed: "stored", duplicate: "duplicate", rejected: "rejected" }[
      submitted.result.status
    ] as MessageOutcome;
    return { ...base, outcome, warnings: draft.warnings };
  } catch (error) {
    return {
      ...base,
      outcome: "failed",
      detail: error instanceof Error ? error.message : String(error),
      warnings: [],
    };
  }
}
