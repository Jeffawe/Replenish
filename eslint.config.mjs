import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Ingestion keeps its insides to itself: the rest of the app imports "@/modules/ingestion" (server) or ".../client" (browser).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/modules/ingestion/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/modules/ingestion/*", "!@/modules/ingestion/client"],
              message: 'Import from "@/modules/ingestion" (server) or "@/modules/ingestion/client" (browser), not from inside the module.',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
