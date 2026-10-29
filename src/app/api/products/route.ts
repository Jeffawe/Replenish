import { checkApiAccess } from "@/lib/api-access";
import { getDefaultUser } from "@/modules/auth";
import { listProductSummaries } from "@/modules/inventory/ingest";

/**
 * The user's existing products, so a sender can match what it read (a receipt
 * line, an email item) to a product before posting to /api/ingest. Same access
 * rules as ingestion.
 */
export async function GET(request: Request) {
  const denied = checkApiAccess(request);
  if (denied) return denied;

  const user = await getDefaultUser();
  return Response.json({ products: await listProductSummaries(user.id) });
}
