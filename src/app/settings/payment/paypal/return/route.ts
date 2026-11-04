import { NextResponse } from "next/server";
import { requireUser } from "@/modules/auth";
import { finishPaypalSetup, paymentsFromEnv, PaymentError } from "@/modules/orders";

/**
 * Where PayPal sends the user back after they approve (or don't). PayPal doesn't say which, so we ask it,
 * save the account if they approved, and send them on to the settings page.
 */
export async function GET(request: Request) {
  const user = await requireUser();
  let result: string;
  try {
    result = await finishPaypalSetup(user.id, paymentsFromEnv());
  } catch (error) {
    if (!(error instanceof PaymentError)) throw error;
    result = "unavailable";
  }
  const to = result === "connected" ? "connected" : result === "not-approved" ? "not-approved" : "unavailable";
  return NextResponse.redirect(new URL(`/settings/payment?paypal=${to}`, request.url));
}
