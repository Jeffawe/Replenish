import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_KEY, THEME_SCRIPT } from "./theme";

describe("resolveTheme", () => {
  it("uses an explicit choice, and the device's setting for 'system'", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

/** Runs the <head> script against a fake page. */
function run({ stored, prefersDark, storageThrows = false }: { stored?: string; prefersDark: boolean; storageThrows?: boolean }) {
  const attributes: Record<string, string> = {};
  runInNewContext(THEME_SCRIPT, {
    document: { documentElement: { setAttribute: (name: string, value: string) => (attributes[name] = value) } },
    localStorage: {
      getItem: (key: string) => {
        if (storageThrows) throw new Error("blocked");
        return key === THEME_KEY ? (stored ?? null) : null;
      },
    },
    window: { matchMedia: () => ({ matches: prefersDark }) },
  });
  return attributes["data-theme"];
}

describe("the script that runs before the page is painted", () => {
  it("applies the stored choice over the device's", () => {
    expect(run({ stored: "light", prefersDark: true })).toBe("light");
    expect(run({ stored: "dark", prefersDark: false })).toBe("dark");
  });

  it("follows the device when nothing is stored, or the stored value is nonsense", () => {
    expect(run({ prefersDark: true })).toBe("dark");
    expect(run({ prefersDark: false })).toBe("light");
    expect(run({ stored: "purple", prefersDark: true })).toBe("dark");
  });

  it("still follows the device when storage is blocked", () => {
    expect(run({ storageThrows: true, prefersDark: true })).toBe("dark");
  });
});
