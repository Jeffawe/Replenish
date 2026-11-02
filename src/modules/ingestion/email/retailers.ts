/**
 * The stores whose order emails we read. Mail from anyone else is dropped the
 * moment it arrives, so a forwarding filter that is too wide can't pull in
 * their other mail. Add a store here only together with a way to read its emails.
 */
const RETAILERS: { name: string; domains: string[] }[] = [{ name: "Amazon", domains: ["amazon.com"] }];

/** The domain of an address like `Name <a@b.com>` or `a@b.com`, lowercased, or null. */
function domainOf(address: string): string | null {
  const match = /@([a-z0-9.-]+)>?\s*$/i.exec(address.trim());
  return match ? match[1]!.toLowerCase() : null;
}

/** The store this address belongs to (amazon.com and its subdomains), or null. */
export function retailerOf(address: string): string | null {
  const domain = domainOf(address);
  if (!domain) return null;
  return RETAILERS.find((r) => r.domains.some((d) => domain === d || domain.endsWith(`.${d}`)))?.name ?? null;
}

/**
 * Who an email is really from. A Gmail filter keeps the store as the sender;
 * someone forwarding by hand makes themselves the sender, and the store's
 * address is in the "Forwarded message" header block.
 */
export function originalSender(from: string, text: string): string {
  if (retailerOf(from)) return from;
  const block = /-{3,}\s*Forwarded message\s*-{3,}[\s\S]{0,400}?^\s*From:\s*(.+)$/im.exec(text.slice(0, 5000));
  return block?.[1]?.trim() ?? from;
}
