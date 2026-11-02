import { randomInt } from "node:crypto";

/**
 * A user's private forwarding address is `o-<token>@<domain>`. The token is
 * random, so the address can't be guessed, and it holds nothing about the user.
 */

// No 0/o/1/l/i: the address is read and typed by people.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 12;
const PREFIX = "o-";

export function newToken(): string {
  return Array.from({ length: TOKEN_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function addressFor(token: string, domain: string): string {
  return `${PREFIX}${token}@${domain}`;
}

/** The token in an address (`o-abc@x.dev`, or `Name <o-abc@x.dev>`), or null if it isn't one of ours. */
export function tokenFromAddress(to: string): string | null {
  const match = /(?:^|[<\s,])o-([a-z0-9]{6,40})@/i.exec(to);
  return match ? match[1]!.toLowerCase() : null;
}
