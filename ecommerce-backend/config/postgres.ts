import dotenv from "dotenv";
import { existsSync } from "node:fs";
import pg from "pg";
import { fileURLToPath } from "node:url";

// Keep PostgreSQL credentials separate while MongoDB remains the live database.
// Existing process environment variables still take precedence in deployment.
// The file sits in the package root: one level up from config/ when run from
// source, two levels up from dist/config/ when compiled (R19).
const postgresEnvPath = ["../.env.postgres", "../../.env.postgres"]
  .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
  .find((candidate) => existsSync(candidate));

if (postgresEnvPath) {
  dotenv.config({ path: postgresEnvPath, quiet: true });
}

const { Pool } = pg;

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.postgres.example to .env.postgres and set a private password.",
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export interface PostgresConnectionInfo {
  database_name: string;
  user_name: string;
  version: string;
}

export async function checkPostgresConnection(): Promise<PostgresConnectionInfo> {
  const result = await pool.query<PostgresConnectionInfo>(
    "SELECT current_database() AS database_name, current_user AS user_name, version() AS version",
  );

  const [connection] = result.rows;
  if (!connection) {
    throw new Error("PostgreSQL returned no connection details");
  }

  return connection;
}

export default pool;

