/**
 * A thin line along the top of the sign-in and dashboard pages while payments are in PayPal's sandbox
 * (PAYPAL_ENV is not "live"), so nobody thinks real money moves. Read when the app is built, like the
 * rest of the environment, so a change of PAYPAL_ENV needs a rebuild.
 */
export function SandboxBanner() {
  if (process.env.PAYPAL_ENV?.trim().toLowerCase() === "live") return null;
  return (
    <div className="w-full bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      Sandbox mode: payments are test payments, so no real money moves and nothing is really bought.
    </div>
  );
}
