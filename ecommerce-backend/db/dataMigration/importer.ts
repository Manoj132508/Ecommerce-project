// Imports a validated plan into PostgreSQL, and removes imported data again.
//
// - Explicit command only; never run on API start-up.
// - Requires every schema migration to be applied first (db:migrate).
// - One transaction for the whole import: a failure anywhere leaves
//   PostgreSQL exactly as it was. An advisory lock prevents concurrent runs.
// - Parameterised SQL only; table and column names come from constants.
// - Re-runnable. Reference data (delivery options, products, users) is
//   upserted only when a value differs. Orders are insert-or-compare: existing
//   history is never updated, and a difference is reported as a conflict.
// - Every run is recorded in data_import_runs (counts and ids only).
import type { Pool, PoolClient } from "pg";
import { loadMigrations } from "../migrator.js";
import {
  errorCount,
  IMPORTED_COLLECTIONS,
  type ImportedCollection,
  type MigrationPlan,
  type OrderRow,
} from "./plan.js";
import { planSummary, type MigrationReport, type TableCounts } from "./report.js";

const IMPORT_LOCK_KEY = 2_026_102_104;
const BATCH_ROWS = 500;

const TABLE_OF: Record<ImportedCollection, string> = {
  deliveryOptions: "delivery_options",
  products: "products",
  users: "users",
  orders: "orders",
};

export class DataMigrationError extends Error {
  override name = "DataMigrationError";

  constructor(message: string, readonly report: MigrationReport, options?: ErrorOptions) {
    super(message, options);
  }
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : String(error));

function chunk<T>(items: readonly T[], size = BATCH_ROWS): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

/** "($1, $2), ($3, $4)" for rowCount rows of columnCount parameters. */
function placeholders(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, row) => (
    `(${Array.from({ length: columnCount }, (_, column) => `$${row * columnCount + column + 1}`).join(", ")})`
  )).join(", ");
}

export async function assertSchemaCurrent(client: PoolClient, migrationsDirectory: string): Promise<void> {
  const migrations = await loadMigrations(migrationsDirectory);
  const { rows: [registry] } = await client.query<{ present: boolean }>(
    "SELECT to_regclass('schema_migrations') IS NOT NULL AS present",
  );
  if (!registry?.present) {
    throw new Error("The PostgreSQL schema has not been created. Run the schema migrations (db:migrate) first.");
  }
  const applied = new Set((await client.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((row) => row.version));
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (pending.length > 0) {
    throw new Error(`Schema migrations ${pending.map((migration) => migration.version).join(", ")} are pending. Run db:migrate first.`);
  }
}

async function withLockedClient<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const { rows: [lock] } = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [IMPORT_LOCK_KEY]);
    if (!lock?.acquired) {
      throw new Error("Another data import or rollback is running against this database.");
    }
    try {
      return await work(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [IMPORT_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

interface UpsertResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Inserts new rows and updates rows that differ; identical rows are untouched. */
async function upsert(
  client: PoolClient,
  table: string,
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
  idCast: string,
): Promise<UpsertResult> {
  const result: UpsertResult = { inserted: 0, updated: 0, unchanged: 0 };
  const assignments = columns.filter((column) => column !== "id").map((column) => `${column} = EXCLUDED.${column}`).join(", ");
  const current = columns.map((column) => `${table}.${column}`).join(", ");
  const incoming = columns.map((column) => `EXCLUDED.${column}`).join(", ");

  for (const batch of chunk(rows)) {
    const ids = batch.map((row) => row[0]);
    const existing = new Set((await client.query<{ id: string }>(
      `SELECT id::text AS id FROM ${table} WHERE id = ANY($1::${idCast}[])`, [ids],
    )).rows.map((row) => row.id));

    const { rows: changed } = await client.query<{ id: string }>(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders(batch.length, columns.length)}
       ON CONFLICT (id) DO UPDATE SET ${assignments}
       WHERE (${current}) IS DISTINCT FROM (${incoming})
       RETURNING id::text AS id`,
      batch.flat(),
    );

    for (const { id } of changed) {
      if (existing.has(id)) result.updated += 1;
      else result.inserted += 1;
    }
    result.unchanged += batch.length - changed.length;
  }

  return result;
}

const ORDER_COLUMNS = [
  "id", "is_legacy", "user_id",
  "customer_full_name", "customer_email", "customer_phone", "customer_address",
  "customer_city", "customer_postal_code", "customer_country",
  "ordered_at", "total_cost_cents", "created_at", "updated_at", "status", "status_updated_at",
];

const ORDER_ITEM_COLUMNS = [
  "order_id", "position", "product_id", "quantity", "estimated_delivery_at",
  "snapshot_name", "snapshot_image", "snapshot_price_cents", "snapshot_description", "snapshot_category",
];

const orderValues = (order: OrderRow): unknown[] => [
  order.id, true, order.user_id,
  order.customer?.customer_full_name ?? null, order.customer?.customer_email ?? null,
  order.customer?.customer_phone ?? null, order.customer?.customer_address ?? null,
  order.customer?.customer_city ?? null, order.customer?.customer_postal_code ?? null,
  order.customer?.customer_country ?? null,
  // Imported orders are legacy history: no operational status is invented.
  order.ordered_at, order.total_cost_cents, order.created_at, order.updated_at, null, null,
];

const orderItemValues = (order: OrderRow): unknown[][] => order.items.map((item) => [
  order.id, item.position, item.product_id, item.quantity, item.estimated_delivery_at,
  item.snapshot?.snapshot_name ?? null, item.snapshot?.snapshot_image ?? null,
  item.snapshot?.snapshot_price_cents ?? null, item.snapshot?.snapshot_description ?? null,
  item.snapshot?.snapshot_category ?? null,
]);

/** Canonical form of an order for comparing an existing row with the source. */
const orderSignature = (values: unknown[], items: unknown[][]) => JSON.stringify(
  [values, items],
  (_key, value: unknown) => (value instanceof Date ? value.getTime() : value),
);

interface StoredOrder {
  id: string;
  is_legacy: boolean;
  user_id: string | null;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_postal_code: string | null;
  customer_country: string | null;
  ordered_at: Date;
  total_cost_cents: number;
  created_at: Date;
  updated_at: Date;
  status: string | null;
  status_updated_at: Date | null;
}

interface StoredOrderItem {
  order_id: string;
  position: number;
  product_id: string;
  quantity: number;
  estimated_delivery_at: Date;
  snapshot_name: string | null;
  snapshot_image: string | null;
  snapshot_price_cents: number | null;
  snapshot_description: string | null;
  snapshot_category: string | null;
}

async function importOrders(client: PoolClient, orders: readonly OrderRow[]): Promise<UpsertResult & { conflicts: string[] }> {
  const conflicts: string[] = [];
  const result = { inserted: 0, updated: 0, unchanged: 0, conflicts };

  for (const batch of chunk(orders, 200)) {
    const { rows: insertedRows } = await client.query<{ id: string }>(
      `INSERT INTO orders (${ORDER_COLUMNS.join(", ")}) VALUES ${placeholders(batch.length, ORDER_COLUMNS.length)}
       ON CONFLICT (id) DO NOTHING
       RETURNING id::text AS id`,
      batch.flatMap(orderValues),
    );
    const inserted = new Set(insertedRows.map((row) => row.id));
    result.inserted += inserted.size;

    const lines = batch.filter((order) => inserted.has(order.id)).flatMap(orderItemValues);
    for (const lineBatch of chunk(lines)) {
      await client.query(
        `INSERT INTO order_items (${ORDER_ITEM_COLUMNS.join(", ")}) VALUES ${placeholders(lineBatch.length, ORDER_ITEM_COLUMNS.length)}`,
        lineBatch.flat(),
      );
    }

    // Orders that already exist must match the source exactly; history is never updated.
    const existing = batch.filter((order) => !inserted.has(order.id));
    if (existing.length === 0) continue;
    const ids = existing.map((order) => order.id);
    const stored = new Map((await client.query<StoredOrder>(
      `SELECT ${ORDER_COLUMNS.map((column) => (column === "id" ? "id::text AS id" : column)).join(", ")}
         FROM orders WHERE id = ANY($1::uuid[])`,
      [ids],
    )).rows.map((row) => [row.id, row]));
    const storedItems = (await client.query<StoredOrderItem>(
      `SELECT order_id::text AS order_id, position, product_id::text AS product_id, quantity, estimated_delivery_at,
              snapshot_name, snapshot_image, snapshot_price_cents, snapshot_description, snapshot_category
         FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY order_id, position`,
      [ids],
    )).rows;

    for (const order of existing) {
      const row = stored.get(order.id);
      const rowItems = storedItems.filter((item) => item.order_id === order.id);
      const actual = row ? orderSignature(
        [row.id, row.is_legacy, row.user_id, row.customer_full_name, row.customer_email, row.customer_phone,
          row.customer_address, row.customer_city, row.customer_postal_code, row.customer_country,
          row.ordered_at, row.total_cost_cents, row.created_at, row.updated_at, row.status, row.status_updated_at],
        rowItems.map((item) => [item.order_id, item.position, item.product_id, item.quantity, item.estimated_delivery_at,
          item.snapshot_name, item.snapshot_image, item.snapshot_price_cents, item.snapshot_description, item.snapshot_category]),
      ) : null;
      if (actual === orderSignature(orderValues(order), orderItemValues(order))) {
        result.unchanged += 1;
      } else {
        result.conflicts.push(order.id);
      }
    }
  }

  return result;
}

async function recordRun(
  pool: Pool,
  operation: "import" | "rollback",
  outcome: "succeeded" | "failed",
  startedAt: Date,
  fingerprint: string | null,
  summary: object,
): Promise<void> {
  await pool.query(
    `INSERT INTO data_import_runs (operation, outcome, started_at, finished_at, source_fingerprint, summary)
     VALUES ($1, $2, $3, now(), $4, $5)`,
    [operation, outcome, startedAt, fingerprint, JSON.stringify(summary)],
  );
}

export interface ImportOptions {
  migrationsDirectory: string;
  sourceConnection: string;
  targetConnection: string;
  /** Import the valid records and report the rest, instead of refusing. */
  skipInvalid?: boolean;
}

/** Imports the plan. Returns the report; throws DataMigrationError (with report) on failure. */
export async function importPlan(pool: Pool, plan: MigrationPlan, options: ImportOptions): Promise<MigrationReport> {
  const startedAt = new Date();
  const base: MigrationReport = {
    tool: "ecommerce-backend data migration",
    reportVersion: 1,
    operation: "import",
    outcome: "succeeded",
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    ...planSummary(plan, options.sourceConnection),
    target: { connection: options.targetConnection },
  };

  // Strict by default: invalid records block the whole import before any write.
  if (errorCount(plan) > 0 && !options.skipInvalid) {
    return {
      ...base,
      outcome: "blocked",
      finishedAt: new Date().toISOString(),
      error: `${errorCount(plan)} validation error(s). Nothing was written. Fix the source data, or re-run with --skip-invalid to import only valid records.`,
    };
  }

  const tables = base.tables;
  if (!tables) throw new Error("Report tables missing");

  try {
    await withLockedClient(pool, async (client) => {
      await assertSchemaCurrent(client, options.migrationsDirectory);
      await client.query("BEGIN");
      try {
        // Dependency order: delivery options, products, users, then orders and their lines.
        const apply = (collection: ImportedCollection, counts: UpsertResult) => {
          const target: TableCounts = tables[collection];
          target.inserted = counts.inserted;
          target.updated = counts.updated;
          target.unchanged = counts.unchanged;
        };

        apply("deliveryOptions", await upsert(client, "delivery_options",
          ["id", "delivery_days", "price_cents", "created_at", "updated_at"],
          plan.deliveryOptions.map((row) => [row.id, row.delivery_days, row.price_cents, row.created_at, row.updated_at]),
          "text"));

        apply("products", await upsert(client, "products",
          ["id", "image", "name", "description", "how_it_works", "highlights", "care_instructions", "category",
            "stock", "rating_stars", "rating_count", "price_cents", "keywords", "created_at", "updated_at"],
          plan.products.map((row) => [row.id, row.image, row.name, row.description, row.how_it_works, row.highlights,
            row.care_instructions, row.category, row.stock, row.rating_stars, row.rating_count, row.price_cents,
            row.keywords, row.created_at, row.updated_at]),
          "uuid"));

        apply("users", await upsert(client, "users",
          ["id", "name", "email", "password_hash", "is_admin", "created_at", "updated_at"],
          plan.users.map((row) => [row.id, row.name, row.email, row.password_hash, row.is_admin, row.created_at, row.updated_at]),
          "text"));

        const orders = await importOrders(client, plan.orders);
        apply("orders", orders);
        if (orders.conflicts.length > 0) {
          throw new Error(
            `${orders.conflicts.length} order(s) already exist in PostgreSQL with different content and were not changed `
            + `(order history is never updated): ${orders.conflicts.slice(0, 20).join(", ")}`,
          );
        }

        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  } catch (error) {
    for (const collection of IMPORTED_COLLECTIONS) {
      Object.assign(tables[collection], { inserted: 0, updated: 0, unchanged: 0 });
    }
    const failed: MigrationReport = {
      ...base,
      outcome: "failed",
      finishedAt: new Date().toISOString(),
      error: `${describeError(error)} (transaction rolled back; nothing was written)`,
    };
    await recordRun(pool, "import", "failed", startedAt, plan.sourceFingerprint, { error: failed.error }).catch(() => {});
    throw new DataMigrationError(describeError(error), failed, { cause: error });
  }

  const report: MigrationReport = { ...base, finishedAt: new Date().toISOString() };
  await recordRun(pool, "import", "succeeded", startedAt, plan.sourceFingerprint, {
    tables,
    importedIds: {
      deliveryOptions: plan.deliveryOptions.map((row) => row.id),
      products: plan.products.map((row) => row.id),
      users: plan.users.map((row) => row.id),
      orders: plan.orders.map((row) => row.id),
    },
    skipped: plan.invalid,
    orphanedOrders: plan.orphanedOrders,
    excludedCartItems: plan.excluded.cartItems.count,
  });
  return report;
}

/**
 * Removes all imported data so the import can be repeated from scratch.
 * Refuses unless every row was created by a recorded import and no
 * application data (carts, non-legacy orders) exists. Uses TRUNCATE, which
 * the order-history delete guard deliberately permits.
 */
export async function rollbackImportedData(
  pool: Pool,
  options: { confirm: boolean; targetConnection: string; migrationsDirectory: string },
): Promise<MigrationReport> {
  const startedAt = new Date();
  const base: MigrationReport = {
    tool: "ecommerce-backend data migration",
    reportVersion: 1,
    operation: "rollback",
    outcome: "succeeded",
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    target: { connection: options.targetConnection },
  };
  if (!options.confirm) {
    return { ...base, outcome: "blocked", error: "Rollback deletes imported data. Take a pg_dump backup, then re-run with --confirm." };
  }

  try {
    const removed = await withLockedClient(pool, async (client) => {
      await assertSchemaCurrent(client, options.migrationsDirectory);
      await client.query("BEGIN");
      try {
        const { rows: [appData] } = await client.query<{ carts: number; cart_items: number; new_orders: number; status_events: number; sessions: number }>(
          `SELECT (SELECT count(*) FROM carts)::int AS carts,
                  (SELECT count(*) FROM cart_items)::int AS cart_items,
                  (SELECT count(*) FROM orders WHERE NOT is_legacy)::int AS new_orders,
                  (SELECT count(*) FROM order_status_events)::int AS status_events,
                  (SELECT count(*) FROM auth_sessions)::int AS sessions`,
        );
        if (!appData || appData.carts + appData.cart_items + appData.new_orders + appData.status_events + appData.sessions > 0) {
          throw new Error(
            "PostgreSQL holds application data (carts, non-legacy orders, order status changes or sign-in sessions); refusing to remove it. Restore a backup instead.",
          );
        }

        for (const collection of IMPORTED_COLLECTIONS) {
          const table = TABLE_OF[collection];
          const { rows: [foreign] } = await client.query<{ count: number }>(
            `SELECT count(*)::int AS count FROM ${table}
              WHERE id::text NOT IN (
                SELECT jsonb_array_elements_text(summary -> 'importedIds' -> $1)
                  FROM data_import_runs WHERE operation = 'import' AND outcome = 'succeeded')`,
            [collection],
          );
          if ((foreign?.count ?? 0) > 0) {
            throw new Error(`${foreign?.count} row(s) in ${table} were not created by a recorded import; refusing to remove them. Restore a backup instead.`);
          }
        }

        const { rows: [counts] } = await client.query<Record<string, number>>(
          `SELECT (SELECT count(*) FROM order_items)::int AS order_items, (SELECT count(*) FROM orders)::int AS orders,
                  (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM products)::int AS products,
                  (SELECT count(*) FROM delivery_options)::int AS delivery_options`,
        );
        // order_status_events and auth_sessions are verified empty above; they are
        // listed because they reference orders and users.
        await client.query("TRUNCATE auth_sessions, order_status_events, order_items, orders, cart_items, carts, users, products, delivery_options");
        await client.query("COMMIT");
        return counts ?? {};
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });

    await recordRun(pool, "rollback", "succeeded", startedAt, null, { removed });
    return { ...base, finishedAt: new Date().toISOString(), rollback: { removed } };
  } catch (error) {
    const failed: MigrationReport = {
      ...base,
      outcome: "failed",
      finishedAt: new Date().toISOString(),
      error: `${describeError(error)} (nothing was removed)`,
    };
    await recordRun(pool, "rollback", "failed", startedAt, null, { error: failed.error }).catch(() => {});
    throw new DataMigrationError(describeError(error), failed, { cause: error });
  }
}
