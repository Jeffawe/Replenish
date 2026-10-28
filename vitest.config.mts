import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// `npm test` runs the fast offline suite. `npm run test:db` runs only the
// *.db.test.ts files, which talk to the real database in .env.local.
const dbTests = process.env.DB_TESTS === "1";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: dbTests ? ["src/**/*.db.test.ts"] : ["src/**/*.test.ts"],
    exclude: dbTests ? configDefaults.exclude : [...configDefaults.exclude, "src/**/*.db.test.ts"],
    setupFiles: dbTests ? ["./vitest.db-setup.ts"] : [],
    testTimeout: dbTests ? 30_000 : 5_000,
  },
});
