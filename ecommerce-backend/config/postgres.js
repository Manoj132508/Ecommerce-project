import dotenv from "dotenv";
import pg from "pg";
import { fileURLToPath } from "node:url";

// Keep PostgreSQL credentials separate while MongoDB remains the live database.
// Existing process environment variables still take precedence in deployment.
const postgresEnvPath = fileURLToPath(
  new URL("../.env.postgres", import.meta.url),
);

dotenv.config({ path: postgresEnvPath, quiet: true });

const { Pool } = pg;

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.postgres.example to .env.postgres and set a private password.",
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function checkPostgresConnection() {
  const result = await pool.query(
    "SELECT current_database() AS database_name, current_user AS user_name, version() AS version",
  );

  return result.rows[0];
}

export default pool;

