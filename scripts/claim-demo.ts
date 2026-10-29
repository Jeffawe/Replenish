// One-off: gives the original demo user, and every product and purchase saved
// under it, to a real account. Run with: npm run claim-demo -- you@example.com
// The password is asked for here (hidden), so it never lands in shell history.
import { claimAccount, EmailSchema, PasswordSchema } from "../src/modules/auth/accounts";

const DEMO_USER_EMAIL = "demo@replenish.local";

/** Reads a line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("Run this in a terminal: the password is typed in, hidden."));
    process.stdout.write(question);
    let typed = "";
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onKey = (key: string) => {
      for (const char of key) {
        if (char === "\u0003") process.exit(130); // Ctrl-C
        if (char === "\r" || char === "\n") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onKey);
          process.stdout.write("\n");
          return resolve(typed);
        }
        if (char === "\u007f") typed = typed.slice(0, -1);
        else typed += char;
      }
    };
    process.stdin.on("data", onKey);
  });
}

async function main() {
  const email = EmailSchema.safeParse(process.argv[2]);
  if (!email.success) {
    console.error("Usage: npm run claim-demo -- you@example.com");
    process.exit(1);
  }
  const password = PasswordSchema.safeParse(await askHidden("New password: "));
  if (!password.success) {
    console.error(password.error.issues[0]?.message);
    process.exit(1);
  }
  if ((await askHidden("Again: ")) !== password.data) {
    console.error("Those didn't match. Nothing was changed.");
    process.exit(1);
  }

  const outcome = await claimAccount(DEMO_USER_EMAIL, { email: email.data, password: password.data });
  if (!outcome.ok) {
    console.error(
      outcome.error === "email-taken"
        ? `Another account already uses ${email.data}. Nothing was changed.`
        : "There's no demo user left to claim (it may already have been claimed).",
    );
    process.exit(1);
  }
  console.log(`Done. ${email.data} now owns the demo data; log in with it at /login.`);
}

main().then(() => process.exit(0), (error) => {
  console.error(error);
  process.exit(1);
});
