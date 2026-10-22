// Migration runner behaviour against real, isolated PostgreSQL databases.
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  checksumOf,
  loadMigrations,
  migrate,
  MigrationError,
  migrationStatus,
  rollbackLatest,
} from "../../db/migrator.js";
import { copyMigrations, createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

// After 0001 only.
const TABLES_0001 = [
  "cart_items",
  "carts",
  "delivery_options",
  "order_items",
  "orders",
  "products",
  "schema_migrations",
  "users",
];
const FUNCTIONS_0001 = ["order_items_reject_update", "order_items_require_snapshot", "set_updated_at"];

// After 0001 + 0002.
const TABLES_0002 = [...TABLES_0001, "data_import_runs", "order_status_transitions"].sort();
const FUNCTIONS_0002 = [...FUNCTIONS_0001, "orders_protect_history", "reject_order_history_delete"].sort();

// After 0001 + 0002 + 0003.
const TABLES_0003 = [...TABLES_0002, "order_status_events"].sort();
const FUNCTIONS_0003 = [...FUNCTIONS_0002, "change_order_status", "reject_audit_change"].sort();

// After every migration (0001 + 0002 + 0003 + 0004).
const SCHEMA_TABLES = [...TABLES_0003, "auth_sessions"].sort();
const SCHEMA_FUNCTIONS = [...FUNCTIONS_0003, "auth_sessions_guard"].sort();
const ALL_VERSIONS = ["0001", "0002", "0003", "0004"];

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.drop();
});

const tables = async () => (await db.pool.query<{ table_name: string }>(
  "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
)).rows.map((row) => row.table_name);

const functions = async () => (await db.pool.query<{ proname: string }>(
  `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY proname`,
)).rows.map((row) => row.proname);

const history = async () => (await db.pool.query<{ version: string; name: string; checksum: string; applied_at: Date }>(
  "SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version",
)).rows;

describe("fresh database", () => {
  test("starts empty, then gets every table, function and a history row", async () => {
    expect(await tables()).toEqual([]);

    const result = await migrate(db.pool, MIGRATIONS_DIRECTORY);

    expect(result).toEqual({ applied: ALL_VERSIONS, alreadyApplied: [] });
    expect(await tables()).toEqual(SCHEMA_TABLES);
    expect(await functions()).toEqual(SCHEMA_FUNCTIONS);
    const checksum = async (file: string) => checksumOf(await readFile(path.join(MIGRATIONS_DIRECTORY, file), "utf8"));
    expect(await history()).toEqual([
      expect.objectContaining({ version: "0001", name: "initial_schema", checksum: await checksum("0001_initial_schema.up.sql") }),
      expect.objectContaining({
        version: "0002",
        name: "order_history_protection",
        checksum: await checksum("0002_order_history_protection.up.sql"),
      }),
      expect.objectContaining({
        version: "0003",
        name: "inventory_and_status_audit",
        checksum: await checksum("0003_inventory_and_status_audit.up.sql"),
      }),
      expect.objectContaining({ version: "0004", name: "auth_sessions", checksum: await checksum("0004_auth_sessions.up.sql") }),
    ]);
  });

  test("creates the expected indexes and constraints", async () => {
    await migrate(db.pool, MIGRATIONS_DIRECTORY);

    const indexes = (await db.pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname",
    )).rows.map((row) => row.indexname);
    expect(indexes).toEqual(expect.arrayContaining([
      "cart_items_cart_id_created_at_idx",
      "cart_items_cart_id_product_id_key",
      "carts_user_id_key",
      "order_items_pkey",
      "orders_ordered_at_idx",
      "orders_user_id_ordered_at_idx",
      "products_created_at_id_idx",
      "users_email_key",
      "auth_sessions_token_hash_key",
      "auth_sessions_user_id_active_idx",
      "auth_sessions_absolute_expires_at_idx",
      "auth_sessions_idle_expires_at_idx",
      "auth_sessions_revoked_at_idx",
    ]));

    const foreignKeys = (await db.pool.query<{ conname: string; confdeltype: string }>(
      "SELECT conname, confdeltype FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace ORDER BY conname",
    )).rows;
    // a = no action, c = cascade, r = restrict
    expect(foreignKeys).toEqual([
      { conname: "auth_sessions_user_id_fkey", confdeltype: "c" },
      { conname: "cart_items_cart_id_fkey", confdeltype: "c" },
      { conname: "cart_items_delivery_option_id_fkey", confdeltype: "r" },
      { conname: "carts_user_id_fkey", confdeltype: "c" },
      { conname: "order_items_order_id_fkey", confdeltype: "c" },
      { conname: "order_status_events_changed_by_fkey", confdeltype: "r" },
      { conname: "order_status_events_order_id_fkey", confdeltype: "r" },
      { conname: "orders_user_id_fkey", confdeltype: "r" },
    ]);
  });

  test("money columns are integer minor units and quantities are integers", async () => {
    await migrate(db.pool, MIGRATIONS_DIRECTORY);
    const columns = (await db.pool.query<{ table_name: string; column_name: string; data_type: string }>(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND (column_name LIKE '%cents' OR column_name = 'quantity')
        ORDER BY table_name, column_name`,
    )).rows;
    expect(columns).toEqual([
      { table_name: "cart_items", column_name: "quantity", data_type: "integer" },
      { table_name: "delivery_options", column_name: "price_cents", data_type: "integer" },
      { table_name: "order_items", column_name: "quantity", data_type: "integer" },
      { table_name: "order_items", column_name: "snapshot_price_cents", data_type: "integer" },
      { table_name: "orders", column_name: "total_cost_cents", data_type: "integer" },
      { table_name: "products", column_name: "price_cents", data_type: "integer" },
    ]);
  });
});

describe("repeated and concurrent runs", () => {
  test("running again applies nothing and leaves history untouched", async () => {
    await migrate(db.pool, MIGRATIONS_DIRECTORY);
    const before = await history();

    for (let run = 0; run < 3; run += 1) {
      expect(await migrate(db.pool, MIGRATIONS_DIRECTORY)).toEqual({ applied: [], alreadyApplied: ALL_VERSIONS });
    }

    expect(await history()).toEqual(before);
    expect(await tables()).toEqual(SCHEMA_TABLES);
  });

  test("concurrent runners apply each migration exactly once", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => migrate(db.pool, MIGRATIONS_DIRECTORY)),
    );
    expect(results.flatMap((result) => result.applied)).toEqual(ALL_VERSIONS);
    expect(await history()).toHaveLength(4);
  });

  test("status reports applied migrations", async () => {
    expect(await migrationStatus(db.pool, MIGRATIONS_DIRECTORY)).toEqual([
      { version: "0001", name: "initial_schema", state: "pending", appliedAt: null },
      { version: "0002", name: "order_history_protection", state: "pending", appliedAt: null },
      { version: "0003", name: "inventory_and_status_audit", state: "pending", appliedAt: null },
      { version: "0004", name: "auth_sessions", state: "pending", appliedAt: null },
    ]);
    await migrate(db.pool, MIGRATIONS_DIRECTORY);
    expect(await migrationStatus(db.pool, MIGRATIONS_DIRECTORY)).toEqual([
      { version: "0001", name: "initial_schema", state: "applied", appliedAt: expect.any(Date) },
      { version: "0002", name: "order_history_protection", state: "applied", appliedAt: expect.any(Date) },
      { version: "0003", name: "inventory_and_status_audit", state: "applied", appliedAt: expect.any(Date) },
      { version: "0004", name: "auth_sessions", state: "applied", appliedAt: expect.any(Date) },
    ]);
  });
});

describe("safety checks", () => {
  let copy: Awaited<ReturnType<typeof copyMigrations>>;

  beforeEach(async () => {
    copy = await copyMigrations();
  });

  afterEach(async () => {
    await copy.remove();
  });

  test("refuses to continue when an applied migration was edited", async () => {
    await migrate(db.pool, copy.directory);
    const file = path.join(copy.directory, "0001_initial_schema.up.sql");
    await writeFile(file, `${await readFile(file, "utf8")}\n-- edited later\n`);

    await expect(migrate(db.pool, copy.directory)).rejects.toThrow(MigrationError);
    await expect(migrate(db.pool, copy.directory)).rejects.toThrow(/modified after it was applied/);
    expect((await migrationStatus(db.pool, copy.directory))[0]?.state).toBe("changed");
  });

  test("line endings do not count as an edit (Windows CRLF vs Linux LF checkouts)", async () => {
    await migrate(db.pool, copy.directory);
    const file = path.join(copy.directory, "0001_initial_schema.up.sql");
    const sql = await readFile(file, "utf8");
    const flipped = sql.includes("\r\n") ? sql.replace(/\r\n/g, "\n") : sql.replace(/\n/g, "\r\n");
    await writeFile(file, flipped);

    expect(await migrate(db.pool, copy.directory)).toEqual({ applied: [], alreadyApplied: ALL_VERSIONS });
  });

  test("refuses to continue when an applied migration's file is missing", async () => {
    await migrate(db.pool, copy.directory);
    await rm(path.join(copy.directory, "0001_initial_schema.up.sql"));
    await rm(path.join(copy.directory, "0001_initial_schema.down.sql"));

    await expect(migrate(db.pool, copy.directory)).rejects.toThrow(/has no file/);
    expect((await migrationStatus(db.pool, copy.directory))[0]?.state).toBe("missing-file");
  });

  test("a failing migration is rolled back completely and not recorded", async () => {
    await migrate(db.pool, copy.directory);
    await writeFile(
      path.join(copy.directory, "0005_broken.up.sql"),
      "CREATE TABLE half_done (id integer);\nALTER TABLE products ADD COLUMN half_done integer;\nSELECT 1 / 0;\n",
    );

    await expect(migrate(db.pool, copy.directory)).rejects.toThrow(/0005_broken failed and was rolled back: division by zero/);

    expect(await tables()).toEqual(SCHEMA_TABLES);
    const productColumns = await db.pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'half_done'",
    );
    expect(productColumns.rowCount).toBe(0);
    expect((await history()).map((row) => row.version)).toEqual(ALL_VERSIONS);
  });

  test("applies later migrations in order and rejects one numbered before an applied migration", async () => {
    await writeFile(path.join(copy.directory, "0006_later.up.sql"), "CREATE TABLE later_table (id integer);\n");
    expect((await migrate(db.pool, copy.directory)).applied).toEqual([...ALL_VERSIONS, "0006"]);

    await writeFile(path.join(copy.directory, "0005_too_late.up.sql"), "CREATE TABLE too_late (id integer);\n");
    await expect(migrate(db.pool, copy.directory)).rejects.toThrow(/older than applied 0006/);
    expect(await tables()).not.toContain("too_late");
  });

  test("rejects unrecognised file names and orphaned down files", async () => {
    await writeFile(path.join(copy.directory, "2_bad_name.sql"), "SELECT 1;\n");
    await expect(loadMigrations(copy.directory)).rejects.toThrow(/Unrecognised migration file name: 2_bad_name.sql/);
    await rm(path.join(copy.directory, "2_bad_name.sql"));

    await writeFile(path.join(copy.directory, "0009_orphan.down.sql"), "SELECT 1;\n");
    await expect(loadMigrations(copy.directory)).rejects.toThrow(/0009 has no matching up migration/);
  });
});

describe("rollback", () => {
  test("reverts migrations one at a time, newest first, after which they re-apply cleanly", async () => {
    await migrate(db.pool, MIGRATIONS_DIRECTORY);
    await db.pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0)");

    expect(await rollbackLatest(db.pool, MIGRATIONS_DIRECTORY)).toBe("0004");
    expect(await tables()).toEqual(TABLES_0003);
    expect(await functions()).toEqual(FUNCTIONS_0003);

    expect(await rollbackLatest(db.pool, MIGRATIONS_DIRECTORY)).toBe("0003");
    expect(await tables()).toEqual(TABLES_0002);
    expect(await functions()).toEqual(FUNCTIONS_0002);

    expect(await rollbackLatest(db.pool, MIGRATIONS_DIRECTORY)).toBe("0002");
    expect(await tables()).toEqual(TABLES_0001);
    expect(await functions()).toEqual(FUNCTIONS_0001);
    // 0002's down file restores 0001's set_updated_at: an explicit updated_at is overwritten again.
    await db.pool.query("UPDATE delivery_options SET price_cents = 1, updated_at = '2000-01-01'");
    const { rows } = await db.pool.query<{ year: number }>(
      "SELECT extract(year FROM updated_at)::int AS year FROM delivery_options",
    );
    expect(rows[0]?.year).toBeGreaterThan(2000);

    expect(await rollbackLatest(db.pool, MIGRATIONS_DIRECTORY)).toBe("0001");
    expect(await tables()).toEqual(["schema_migrations"]);
    expect(await functions()).toEqual([]);
    expect(await history()).toEqual([]);

    expect((await migrate(db.pool, MIGRATIONS_DIRECTORY)).applied).toEqual(ALL_VERSIONS);
    expect(await tables()).toEqual(SCHEMA_TABLES);
  });

  test("does nothing when no migration is applied", async () => {
    expect(await rollbackLatest(db.pool, MIGRATIONS_DIRECTORY)).toBeNull();
  });

  test("refuses when the latest migration has no down file", async () => {
    const copy = await copyMigrations();
    try {
      await writeFile(path.join(copy.directory, "0005_no_down.up.sql"), "CREATE TABLE kept (id integer);\n");
      await migrate(db.pool, copy.directory);
      await expect(rollbackLatest(db.pool, copy.directory)).rejects.toThrow(/0005_no_down has no down file/);
      expect(await tables()).toContain("kept");
    } finally {
      await copy.remove();
    }
  });
});

test("the real migrations directory holds 0001-0004, each with a down file", async () => {
  const migrations = await loadMigrations(MIGRATIONS_DIRECTORY);
  expect(migrations.map(({ version, name, downSql }) => ({ version, name, hasDown: downSql !== null }))).toEqual([
    { version: "0001", name: "initial_schema", hasDown: true },
    { version: "0002", name: "order_history_protection", hasDown: true },
    { version: "0003", name: "inventory_and_status_audit", hasDown: true },
    { version: "0004", name: "auth_sessions", hasDown: true },
  ]);
});
