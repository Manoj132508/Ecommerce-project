import type { Pool } from "pg";
import { errorMessage } from "../utils/errors.js";

let pool: Pool | undefined;
try {
  const postgres = await import("../config/postgres.js");
  pool = postgres.default;

  const connection = await postgres.checkPostgresConnection();

  console.log(
    `PostgreSQL connected: database=${connection.database_name}, user=${connection.user_name}`,
  );
  console.log(connection.version);
} catch (error) {
  console.error(`PostgreSQL connection failed: ${String(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}

