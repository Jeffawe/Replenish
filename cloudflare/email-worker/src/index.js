import PostalMime from "postal-mime";

// Emails bigger than this are refused. Order confirmations are far smaller.
const MAX_BYTES = 2_000_000;
// The app reads at most this much text.
const MAX_TEXT = 200_000;

/** Plain text of an email: its text part, or the HTML with the tags taken out. */
function textOf(parsed) {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  return (parsed.html ?? "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

export default {
  /**
   * Cloudflare Email Routing calls this for every email sent to any address on
   * the domain (the catch-all rule). The email is read here, in memory, and only
   * its sender, subject and text are sent on. Nothing is stored in Cloudflare.
   */
  async email(message, env) {
    if (message.rawSize > MAX_BYTES) {
      message.setReject("Message too large");
      return;
    }

    const parsed = await PostalMime.parse(message.raw);
    const response = await fetch(`${env.APP_URL}/api/email/inbound`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.EMAIL_WORKER_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        to: message.to,
        // The From header (the store, when Gmail forwards it), not the envelope sender (the user's Gmail).
        from: parsed.from?.address ? `${parsed.from.name ?? ""} <${parsed.from.address}>`.trim() : message.from,
        subject: parsed.subject ?? "",
        text: textOf(parsed).slice(0, MAX_TEXT),
        messageId: parsed.messageId ?? crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
      }),
    });

    // The app answers 200 for everything it handled, including mail it chose to drop. Anything else is
    // logged in Cloudflare, not bounced: a bounce would only tell the sender's mail server to retry or give up.
    if (!response.ok) console.error(`App answered ${response.status}`);
  },
};
