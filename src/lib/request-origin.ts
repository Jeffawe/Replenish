/**
 * The address people use to reach this app, from the proxy's headers. Behind nginx a request's own `url`
 * is the app's private address (localhost:3000), so never build a redirect from `request.url`.
 * APP_URL wins when it is set.
 */
export function originFrom(list: Headers): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto = list.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** An absolute address on this app for a redirect from a route handler or the proxy. */
export function appUrl(path: string, request: Request): URL {
  return new URL(path, originFrom(request.headers));
}
