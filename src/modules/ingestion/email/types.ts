import { z } from "zod";

/** One email, as an inbox hands it over. */
export const EmailMessageSchema = z.object({
  messageId: z.string().min(1),
  from: z.string(),
  subject: z.string(),
  receivedAt: z.coerce.date(),
  text: z.string(),
});
export type EmailMessage = z.output<typeof EmailMessageSchema>;

/** Where emails come from. Gmail later; a simulated inbox for now. */
export interface InboxProvider {
  /** Messages received at or after `since`, oldest first. */
  listMessages(args: { since: Date }): Promise<EmailMessage[]>;
}
