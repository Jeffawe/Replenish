import { revalidatePath } from "next/cache";
import { checkApiAccess } from "@/lib/api-access";
import { getDemoUser } from "@/lib/demo-user";
import { submitBatch } from "@/modules/ingestion";

/**
 * Where outside services send purchases. Body: a PurchaseBatch (see
 * src/core/purchase-batch.ts). Code inside this app uses submitBatch directly
 * instead of going over HTTP.
 */
export async function POST(request: Request) {
  const denied = checkApiAccess(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body must be valid JSON" }, { status: 400 });
  }

  // Everything is stored for the demo user until real accounts exist.
  const user = await getDemoUser();
  const outcome = await submitBatch(user.id, body);
  if (!outcome.ok) {
    return Response.json({ error: "Invalid purchase batch", issues: outcome.issues }, { status: 400 });
  }

  if (outcome.result.status === "processed") revalidatePath("/dashboard");
  return Response.json(outcome.result, {
    status: { processed: 201, duplicate: 200, rejected: 422 }[outcome.result.status],
  });
}
