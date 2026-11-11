import { afterEach, describe, expect, it } from "vitest";
import { appUrl, originFrom } from "./request-origin";

const saved = process.env.APP_URL;
afterEach(() => {
  if (saved === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = saved;
});

describe("originFrom", () => {
  it("uses the proxy's forwarded host and protocol, not the app's private address", () => {
    delete process.env.APP_URL;
    const request = new Request("http://localhost:3000/x", { headers: { "x-forwarded-host": "replenish.jeffawe.dev", "x-forwarded-proto": "https" } });
    expect(appUrl("/settings/payment?paypal=connected", request).href).toBe("https://replenish.jeffawe.dev/settings/payment?paypal=connected");
  });

  it("lets APP_URL win", () => {
    process.env.APP_URL = "https://example.test/";
    expect(originFrom(new Headers({ host: "localhost:3000" }))).toBe("https://example.test");
  });

  it("stays on http for localhost", () => {
    delete process.env.APP_URL;
    expect(originFrom(new Headers({ host: "localhost:3001" }))).toBe("http://localhost:3001");
  });
});
