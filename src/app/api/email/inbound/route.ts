import { revalidatePath } from "next/cache";
import { checkSecret } from "@/lib/api-access";
import { receiveEmail } from "@/modules/ingestion";

const MAX_BYTES = 1_000_000;

/**
 * Where the Cloudflare Worker posts each email that reaches a user's private
 * address. Only the Worker may call it (EMAIL_WORKER_SECRET). The answer never
 * says whether an address exists, so it can't be used to probe for addresses.
 */
export async function POST(request: Request) {
  const denied = checkSecret(request, process.env.EMAIL_WORKER_SECRET);
  if (denied) return denied;

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return Response.json({ error: "Too large" }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await receiveEmail(body);
  if (result.outcome === "invalid") return Response.json({ error: "Invalid email" }, { status: 400 });
  if (result.outcome === "accepted") revalidatePath("/dashboard");
  return Response.json({ ok: true });
}
