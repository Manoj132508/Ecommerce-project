// Versioned, forward-only PostgreSQL migrations with a history table.
//
// Files live in db/migrations as NNNN_name.up.sql (required) and
// NNNN_name.down.sql (optional, used only by rollbackLatest). Each migration
// runs in its own transaction together with its history row, so it is either
// fully applied and recorded or not applied at all. A session advisory lock
// serialises concurrent runners. Applied migrations are verified by checksum,
// so an edited or deleted migration stops the runner instead of drifting.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

export const HISTORY_TABLE = "schema_migrations";

// Arbitrary constant shared by every runner of this project's migrations.
const ADVISORY_LOCK_KEY = 2_026_102_103;

const UP_FILE = /^(\d{4})_([a-z0-9_]+)\.up\.sql$/;
const DOWN_FILE = /^(\d{4})_([a-z0-9_]+)\.down\.sql$/;

export class MigrationError extends Error {
  override name = "MigrationError";
}

export interface Migration {
  version: string;
  name: string;
  upSql: string;
  downSql: string | null;
  checksum: string;
}

export interface MigrationStatus {
  version: string;
  name: string;
  state: "applied" | "pending" | "changed" | "missing-file";
  appliedAt: Date | null;
}

interface HistoryRow {
  version: string;
  name: string;
  checksum: string;
  applied_at: Date;
}

// Line endings depend on the checkout (CRLF on Windows, LF on Linux); the
// checksum must not.
const normalise = (sql: string) => sql.replace(/\r\n/g, "\n");

export const checksumOf = (sql: string) => createHash("sha256").update(normalise(sql)).digest("hex");

export async function loadMigrations(directory: string): Promise<Migration[]> {
  const files = await readdir(directory);
  const downFiles = new Map<string, string>();
  const migrations: Migration[] = [];

  for (const file of files) {
    const down = DOWN_FILE.exec(file);
    if (down?.[1]) {
      downFiles.set(down[1], file);
    }
  }

  for (const file of files.sort()) {
    if (!file.endsWith(".sql")) continue;
    const up = UP_FILE.exec(file);
    if (!up) {
      if (!DOWN_FILE.test(file)) {
        throw new MigrationError(`Unrecognised migration file name: ${file}`);
      }
      continue;
    }

    const [, version, name] = up;
    if (!version || !name) continue;
    if (migrations.some((migration) => migration.version === version)) {
      throw new MigrationError(`Duplicate migration version ${version}`);
    }

    const upSql = await readFile(path.join(directory, file), "utf8");
    const downFile = downFiles.get(version);
    migrations.push({
      version,
      name,
      upSql,
      downSql: downFile ? await readFile(path.join(directory, downFile), "utf8") : null,
      checksum: checksumOf(upSql),
    });
  }

  for (const version of downFiles.keys()) {
    if (!migrations.some((migration) => migration.version === version)) {
      throw new MigrationError(`Down migration ${version} has no matching up migration`);
    }
  }

  return migrations;
}

async function withLock<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      return await work(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function ensureHistoryTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (
      version      text PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
      name         text NOT NULL,
      checksum     text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at   timestamptz NOT NULL DEFAULT now(),
      execution_ms integer NOT NULL CHECK (execution_ms >= 0)
    )
  `);
}

async function readHistory(client: PoolClient): Promise<HistoryRow[]> {
  const result = await client.query<HistoryRow>(
    `SELECT version, name, checksum, applied_at FROM ${HISTORY_TABLE} ORDER BY version`,
  );
  return result.rows;
}

// Refuses to continue when history and files disagree.
function verifyHistory(history: HistoryRow[], migrations: Migration[]): void {
  for (const row of history) {
    const migration = migrations.find((candidate) => candidate.version === row.version);
    if (!migration) {
      throw new MigrationError(`Applied migration ${row.version}_${row.name} has no file; restore it before migrating`);
    }
    if (migration.checksum !== row.checksum) {
      throw new MigrationError(
        `Applied migration ${row.version}_${row.name} was modified after it was applied; add a new migration instead`,
      );
    }
  }

  const latestApplied = history.at(-1)?.version;
  const pending = migrations.filter((migration) => !history.some((row) => row.version === migration.version));
  const outOfOrder = latestApplied ? pending.find((migration) => migration.version < latestApplied) : undefined;
  if (outOfOrder) {
    throw new MigrationError(
      `Pending migration ${outOfOrder.version}_${outOfOrder.name} is older than applied ${latestApplied}; renumber it`,
    );
  }
}

async function inTransaction(client: PoolClient, work: () => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    await work();
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

/** Applies every pending migration in version order. Safe to run repeatedly. */
export async function migrate(
  pool: Pool,
  directory: string,
  log: (message: string) => void = () => {},
): Promise<MigrateResult> {
  const migrations = await loadMigrations(directory);

  return withLock(pool, async (client) => {
    await ensureHistoryTable(client);
    const history = await readHistory(client);
    verifyHistory(history, migrations);

    const alreadyApplied = history.map((row) => row.version);
    const applied: string[] = [];

    for (const migration of migrations) {
      if (alreadyApplied.includes(migration.version)) continue;

      const started = Date.now();
      try {
        await inTransaction(client, async () => {
          await client.query(migration.upSql);
          await client.query(
            `INSERT INTO ${HISTORY_TABLE} (version, name, checksum, execution_ms) VALUES ($1, $2, $3, $4)`,
            [migration.version, migration.name, migration.checksum, Date.now() - started],
          );
        });
      } catch (error) {
        throw new MigrationError(
          `Migration ${migration.version}_${migration.name} failed and was rolled back: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error },
        );
      }

      applied.push(migration.version);
      log(`applied ${migration.version}_${migration.name} (${Date.now() - started} ms)`);
    }

    return { applied, alreadyApplied };
  });
}

/** Lists every known migration and whether it is applied, pending or inconsistent. */
export async function migrationStatus(pool: Pool, directory: string): Promise<MigrationStatus[]> {
  const migrations = await loadMigrations(directory);

  return withLock(pool, async (client) => {
    await ensureHistoryTable(client);
    const history = await readHistory(client);

    const fromFiles = migrations.map((migration): MigrationStatus => {
      const row = history.find((candidate) => candidate.version === migration.version);
      return {
        version: migration.version,
        name: migration.name,
        state: !row ? "pending" : row.checksum === migration.checksum ? "applied" : "changed",
        appliedAt: row?.applied_at ?? null,
      };
    });
    const orphans = history
      .filter((row) => !migrations.some((migration) => migration.version === row.version))
      .map((row): MigrationStatus => ({
        version: row.version,
        name: row.name,
        state: "missing-file",
        appliedAt: row.applied_at,
      }));

    return [...fromFiles, ...orphans].sort((a, b) => a.version.localeCompare(b.version));
  });
}

/**
 * Reverts the most recently applied migration using its .down.sql file, in a
 * single transaction. Destructive: callers must take a backup first.
 */
export async function rollbackLatest(pool: Pool, directory: string): Promise<string | null> {
  const migrations = await loadMigrations(directory);

  return withLock(pool, async (client) => {
    await ensureHistoryTable(client);
    const history = await readHistory(client);
    verifyHistory(history, migrations);

    const latest = history.at(-1);
    if (!latest) return null;

    const migration = migrations.find((candidate) => candidate.version === latest.version);
    if (!migration?.downSql) {
      throw new MigrationError(`Migration ${latest.version}_${latest.name} has no down file; restore from backup instead`);
    }
    const { downSql } = migration;

    await inTransaction(client, async () => {
      await client.query(downSql);
      await client.query(`DELETE FROM ${HISTORY_TABLE} WHERE version = $1`, [latest.version]);
    });

    return latest.version;
  });
}
