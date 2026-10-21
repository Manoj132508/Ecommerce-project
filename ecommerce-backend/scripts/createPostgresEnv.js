import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const envPath = fileURLToPath(new URL("../.env.postgres", import.meta.url));
const password = randomBytes(32).toString("hex");
const database = "ecommerce";
const user = "ecommerce_app";

const contents = [
  `POSTGRES_DB=${database}`,
  `POSTGRES_USER=${user}`,
  `POSTGRES_PASSWORD=${password}`,
  `DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:5432/${database}`,
  "",
].join("\n");

try {
  await writeFile(envPath, contents, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  console.log("Created .env.postgres with a private random password.");
} catch (error) {
  if (error.code === "EEXIST") {
    console.log(".env.postgres already exists; left it unchanged.");
  } else {
    throw error;
  }
}

