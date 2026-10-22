// Shared PostgreSQL helpers for the repositories.
import type { Pool, PoolClient } from "pg";
import { loadMigrations } from "./migrator.js";

/** Runs work in one transaction: COMMIT on success, ROLLBACK on any error. */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
  }
}

/** Refuses to serve from a database whose schema migrations are not all applied. */
export async function verifySchemaCurrent(pool: Pool, migrationsDirectory: string): Promise<void> {
  const migrations = await loadMigrations(migrationsDirectory);
  const { rows: [registry] } = await pool.query<{ present: boolean }>(
    "SELECT to_regclass('schema_migrations') IS NOT NULL AS present",
  );
  const applied = registry?.present
    ? new Set((await pool.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((row) => row.version))
    : new Set<string>();
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (pending.length > 0) {
    throw new Error(
      `PostgreSQL schema migrations ${pending.map((migration) => migration.version).join(", ")} are not applied. `
      + "Run db:migrate before selecting PostgreSQL.",
    );
  }
}

/** SQLSTATE of a pg error, if any. */
export const sqlState = (error: unknown): string | undefined => (
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : undefined
);

/** Constraint name of a pg error, if any. */
export const constraintOf = (error: unknown): string | undefined => (
  typeof error === "object" && error !== null && "constraint" in error && typeof error.constraint === "string"
    ? error.constraint
    : undefined
);
