import {
  PurchaseBatchSchema,
  type IngestResult,
  type PurchaseBatch,
} from "@/core/purchase-batch";
import { toIssues, type Issue } from "./types";

export type SubmitOutcome =
  | { ok: true; result: IngestResult }
  | { ok: false; issues: Issue[] };

/**
 * The single front door for storing a batch. The UI's submit action, the HTTP
 * endpoint and the email sync all go through here, so validation lives in one
 * place. `ingest` is what actually stores it (inventory's receiver).
 */
export function createSubmit(ingest: (userId: string, batch: PurchaseBatch) => Promise<IngestResult>) {
  return async function submitBatch(userId: string, input: unknown): Promise<SubmitOutcome> {
    const parsed = PurchaseBatchSchema.safeParse(input);
    if (!parsed.success) return { ok: false, issues: toIssues(parsed.error) };
    return { ok: true, result: await ingest(userId, parsed.data) };
  };
}
