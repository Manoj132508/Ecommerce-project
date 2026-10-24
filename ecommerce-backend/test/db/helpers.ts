import { cp, mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, inject } from "vitest";

export const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../../db/migrations", import.meta.url));

export interface TestDatabase {
  name: string;
  /** Connection string of this throwaway database (for pools with other options). */
  url: string;
  pool: pg.Pool;
  drop: () => Promise<void>;
}

/** Creates a brand-new, empty database in the throwaway test container. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const adminUrl = inject("postgresAdminUrl");
  const name = `migration_test_${randomBytes(6).toString("hex")}`;

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // The name is generated above from hex characters only.
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });

  return {
    name,
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end();
      const cleanup = new pg.Client({ connectionString: adminUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}

/** A private copy of the real migrations that a test may edit. */
export async function copyMigrations(): Promise<{ directory: string; remove: () => Promise<void> }> {
  const directory = await mkdtemp(path.join(tmpdir(), "migrations-"));
  await cp(MIGRATIONS_DIRECTORY, directory, { recursive: true });
  return { directory, remove: () => rm(directory, { recursive: true, force: true }) };
}

/** Asserts that a statement fails with the given PostgreSQL SQLSTATE code. */
export async function expectSqlState(statement: Promise<unknown>, code: string, constraint?: string): Promise<void> {
  await expect(statement).rejects.toMatchObject(constraint ? { code, constraint } : { code });
}

export const SQLSTATE = {
  checkViolation: "23514",
  uniqueViolation: "23505",
  foreignKeyViolation: "23503",
  notNullViolation: "23502",
  restrictViolation: "23001",
  invalidTextRepresentation: "22P02",
};
