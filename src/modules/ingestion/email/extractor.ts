import type { Extractor } from "../types";
import { EmailMessageSchema, type EmailMessage } from "./types";

/**
 * Producer for emails.
 *
 * OPEN: how an email becomes a draft (deciding whether it is an order
 * confirmation, reading its lines, matching them to `ctx.products`, choosing
 * the idempotencyKey) is deliberately not decided yet. Until it is, every
 * email is skipped.
 */
export const emailExtractor: Extractor<EmailMessage> = {
  source: "email",
  input: EmailMessageSchema,
  async extract() {
    return { kind: "skipped", reason: "Reading emails is not implemented yet." };
  },
};
