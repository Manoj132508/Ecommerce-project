// Official Next.js rules (core web vitals + TypeScript). Its fast-glob
// dependency is replaced by tools/fast-glob-shim (package.json "overrides"),
// so the unpatched braces advisory (GHSA-vfj7-8cjw-p6xm, MIGRATION_PLAN.md
// R35) is not installed.
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([".next/**", "node_modules/**", "next-env.d.ts", "tools/**", "playwright-report/**", "test-results/**", "blob-report/**"]),
]);
