import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/origin";
import { requireUser } from "@/modules/auth";
import { paymentsConfigured, paymentsFromEnv, PaymentError, startPaypalSetup } from "@/modules/orders";

/**
 * Sends the user to PayPal to approve us charging them later. It is a plain form post to a route (not a
 * server action) so the browser makes a real navigation to PayPal and back: the address bar then always
 * shows where the user really is. They return through ./return.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  const back = (result: string) => NextResponse.redirect(new URL(`/settings/payment?paypal=${result}`, request.url), 303);
  try {
    const { approveUrl } = await startPaypalSetup(user.id, await appOrigin(), paymentsFromEnv());
    return NextResponse.redirect(approveUrl, 303);
  } catch (error) {
    if (!(error instanceof PaymentError)) throw error;
    return back(paymentsConfigured() ? "unavailable" : "unconfigured");
  }
}
