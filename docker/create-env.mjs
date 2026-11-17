// Creates docker/.env (git-ignored) with random, local-only secrets for
// docker/compose.yaml. Refuses to overwrite an existing file. Prints no values.
// Usage: node docker/create-env.mjs
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("./.env", import.meta.url));
if (existsSync(target)) {
  console.error(`${target} already exists; delete it first to generate new secrets.`);
  process.exit(1);
}

const secret = (bytes) => randomBytes(bytes).toString("hex");
writeFileSync(target, [
  "# Local Docker stack only (docker/compose.yaml). Random values from docker/create-env.mjs.",
  "# Never reuse these anywhere else, and never put a real database's credentials here.",
  `POSTGRES_PASSWORD=${secret(24)}`,
  `JWT_SECRET=${secret(32)}`,
  "WEB_PORT=8080",
  "# Local default 1 minute so repeated test runs reset quickly; production keeps 15.",
  "AUTH_RATE_LIMIT_WINDOW_MINUTES=1",
  "",
].join("\n"), { mode: 0o600 });
console.log(`Wrote ${target} (values not shown).`);
