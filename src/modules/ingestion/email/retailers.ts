import { canRead } from "./reader";

/** A store whose order emails we read. */
export interface Retailer {
  name: string;
  /** Where its order emails come from (and their subdomains). */
  domains: string[];
  /** What goes in Gmail's "From" box to find this store's order emails. */
  from: string;
}

/**
 * The stores whose order emails we read. Mail from anyone else is dropped the
 * moment it arrives, so a forwarding filter that is too wide can't pull in
 * their other mail. To add a store, add it here and say how to read its emails
 * (see reader.ts); the setup page lists whatever is here.
 */
const RETAILERS: Retailer[] = [
  { name: "Amazon", domains: ["amazon.com"], from: "auto-confirm@amazon.com" },
  // Not verified against a real order email yet (no reader either), so the setup page doesn't offer a filter for it.
  { name: "Walmart", domains: ["walmart.com"], from: "walmart.com" },
];

/** The stores the setup page lists. Only a store something can read yet gets a filter to copy. */
export function supportedStores(): { name: string; from: string; readable: boolean }[] {
  return RETAILERS.map(({ name, from }) => ({ name, from, readable: canRead(name) }));
}

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
