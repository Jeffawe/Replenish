// Lets accounts use the app while REQUIRE_APPROVAL is on.
//   npm run approve -- friend@example.com other@example.com    approve these accounts
//   npm run approve -- --pending                               who has signed up and is still waiting
import { approveUsers, listPendingUsers } from "../src/modules/auth/accounts";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--pending")) {
    const waiting = await listPendingUsers();
    if (waiting.length === 0) console.log("Nobody is waiting.");
    for (const { email, createdAt } of waiting) console.log(`${email}  (signed up ${createdAt.toISOString().slice(0, 10)})`);
    return;
  }

  const emails = args.filter((arg) => !arg.startsWith("--"));
  if (emails.length === 0) {
    console.error("Usage: npm run approve -- <email> [more emails]   |   npm run approve -- --pending");
    process.exit(1);
  }
  const { approved, unknown } = await approveUsers(emails);
  for (const email of approved) console.log(`Approved ${email}`);
  for (const email of unknown) console.error(`No account with the email ${email}`);
  if (unknown.length > 0) process.exitCode = 1;
}

main().then(() => process.exit(), (error) => {
  console.error(error);
  process.exit(1);
});
