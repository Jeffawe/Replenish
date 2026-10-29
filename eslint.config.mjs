import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const doorsOnly = (name) => ({
  group: [`@/modules/${name}/*`, `!@/modules/${name}/client`],
  message: `Import from "@/modules/${name}" (server) or "@/modules/${name}/client" (browser), not from inside the module.`,
});

/** Blocks deep imports into each module, except from inside that module itself. */
function boundaries(modules) {
  const rule = (names) => ({ "no-restricted-imports": ["error", { patterns: names.map(doorsOnly) }] });
  return [
    { files: ["src/**/*.{ts,tsx}"], ignores: modules.map((name) => `src/modules/${name}/**`), rules: rule(modules) },
    ...modules.map((name) => ({ files: [`src/modules/${name}/**/*.{ts,tsx}`], rules: rule(modules.filter((other) => other !== name)) })),
  ];
}

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
  // Modules keep their insides to themselves: from outside a module, import only its
  // server door ("@/modules/<name>") or its browser door ("@/modules/<name>/client").
  // One rule per file, because a later "no-restricted-imports" replaces an earlier one.
  ...boundaries(["ingestion", "questions"]),
]);

export default eslintConfig;
