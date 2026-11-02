"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/modules/auth";
import { resetEmailAddress } from "@/modules/ingestion";

/** "Stop and delete": a new private address (the old one stops working) and an empty log. */
export async function resetEmailAddressAction(): Promise<void> {
  // Server Functions can be called directly, so identify the user here.
  const user = await requireUser();
  await resetEmailAddress(user.id);
  revalidatePath("/email-orders");
}
