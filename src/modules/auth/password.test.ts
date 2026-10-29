import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("passwords", () => {
  it("accepts the password that was hashed and nothing else", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("treats a malformed stored value as a wrong password", async () => {
    expect(await verifyPassword("anything", "")).toBe(false);
    expect(await verifyPassword("anything", "plain$text")).toBe(false);
  });

  it("compares the same text however it was typed", async () => {
    const stored = await hashPassword("café au lait"); // é as one character
    expect(await verifyPassword("café au lait", stored)).toBe(true); // e + combining accent
  });
});
