import { timingSafeEqual } from "node:crypto";

/**
 * Callers send `Authorization: Bearer <INGEST_API_KEY>`. With no key set the
 * endpoint is open in development only; production refuses until one is set.
 */
export function checkApiAccess(request: Request): Response | null {
  const expected = process.env.INGEST_API_KEY;
  if (!expected) {
    return process.env.NODE_ENV === "production"
      ? Response.json({ error: "Ingestion is not configured" }, { status: 503 })
      : null;
  }

  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const wanted = Buffer.from(expected);
  const ok = given.length === wanted.length && timingSafeEqual(given, wanted);
  return ok ? null : Response.json({ error: "Unauthorized" }, { status: 401 });
}
