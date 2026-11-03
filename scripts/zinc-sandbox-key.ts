// Gets a free Zinc sandbox key and adds it to .env.local as ZINC_API_KEY. The sandbox places no real
// orders and charges nothing; its searches return invented "Sample ..." listings (marked as sample
// data in the restock report). The key expires after 7 days without use; run this again for a new one.
//   npm run zinc:key
import { appendFileSync, existsSync, readFileSync } from "node:fs";

const ENV_FILE = ".env.local";

async function main() {
  const text = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  if (/^ZINC_API_KEY=/m.test(text)) {
    console.log("ZINC_API_KEY is already in .env.local. Delete that line first to get a new key.");
    return;
  }
  const response = await fetch("https://api.zinc.com/sandbox/keys", { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { api_key?: string };
  if (!response.ok || !body.api_key?.startsWith("zn_test_")) {
    console.error(`Zinc did not give a sandbox key (status ${response.status}).`);
    process.exit(1);
  }
  appendFileSync(ENV_FILE, `${text === "" || text.endsWith("\n") ? "" : "\n"}ZINC_API_KEY=${body.api_key}\n`);
  console.log("Added ZINC_API_KEY (a free sandbox key) to .env.local.");
}

main().then(() => process.exit(), (error) => {
  console.error(error);
  process.exit(1);
});
