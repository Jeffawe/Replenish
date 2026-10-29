import { revalidatePath } from "next/cache";
import { checkApiAccess } from "@/lib/api-access";
import { getDefaultUser } from "@/modules/auth";
import { createSimulatedInbox, syncEmailInbox } from "@/modules/ingestion";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The email trigger: a scheduler (cron) calls this to poll the inbox and
 * record any purchases in new mail. `?since=<ISO date>` overrides the default
 * window of the last two days. Re-reading mail is safe, because the receiver
 * ignores a submission it has already stored.
 */
export async function POST(request: Request) {
  const denied = checkApiAccess(request);
  if (denied) return denied;

  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 2 * DAY_MS);
  if (Number.isNaN(since.getTime())) {
    return Response.json({ error: "since must be a valid date" }, { status: 400 });
  }

  // OPEN: which inbox to read. A real provider (Gmail) replaces this once an
  // account is connected; until then the simulated inbox is empty.
  const inbox = createSimulatedInbox();

  const user = await getDefaultUser();
  let report;
  try {
    report = await syncEmailInbox(user.id, since, inbox);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not read the inbox" },
      { status: 502 },
    );
  }

  if (report.counts.stored > 0) revalidatePath("/dashboard");
  return Response.json(report);
}
