import type { EmailMessage, InboxProvider } from "../types";

/** An in-memory inbox, for development and tests. */
export function createSimulatedInbox(messages: EmailMessage[] = []): InboxProvider {
  return {
    async listMessages({ since }) {
      return messages
        .filter((message) => message.receivedAt.getTime() >= since.getTime())
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    },
  };
}
