// R31 proof of concept: reverse reconciliation, PostgreSQL -> MongoDB.
//
// After a domain is switched to PostgreSQL, new users, orders, status changes,
// carts and catalogue edits exist only there. Rolling back by pointing the app
// at MongoDB would hide them. This module copies them back first, so a
// rollback never silently discards accepted writes (MIGRATION_PLAN.md R31).
//
// Rules:
//   - PostgreSQL is read only, inside one REPEATABLE READ snapshot. Its
//     fingerprint is taken again at the end; any change means writes were not
//     frozen, and the run fails.
//   - MongoDB writes are idempotent and keyed by the original ids: re-running,
//     or resuming an interrupted run, never creates duplicates.
//   - Existing MongoDB orders are compared, never modified. Any difference in
//     an order is a conflict that blocks the rollback.
//   - Order status and its audit trail, and per-user carts, have no place in
//     the MongoDB model. They are kept in side collections the MongoDB app does
//     not read, never merged into the shared cart (D1).
//   - A product edited on PostgreSQL replaces the MongoDB version only after
//     the previous version is archived. Products deleted on PostgreSQL are
//     reported, never deleted from MongoDB.
//   - verifyRollbackTarget() is the only readiness gate. It refuses a MongoDB
//     that lacks any PostgreSQL record: an older snapshot is never "ready".
//
// Exercised against disposable databases only (test/db/reconciliation.test.ts,
// test/db/reconcileCli.test.ts). Operators run it through scripts/reconcile.ts
// (reconcile:plan, reconcile:apply, reconcile:verify), which refuses remote
// databases without an explicit flag and apply without frozen writes.
import { createHash, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import type { Pool } from "pg";

const { ObjectId } = mongoose.mongo;
type Db = mongoose.mongo.Db;
type Fields = Record<string, unknown>;
// A stored document: string ids (products, orders, delivery options) or ObjectIds (users).
interface Doc {
  _id: string | mongoose.mongo.ObjectId;
  [field: string]: unknown;
}

export const SIDE_COLLECTIONS = {
  runs: "reconciliation_runs",
  orderStatus: "reconciliation_order_status",
  carts: "reconciliation_carts",
  previousProducts: "reconciliation_previous_products",
} as const;

export type Domain = "deliveryOptions" | "products" | "users" | "orders" | "orderStatus" | "carts";

export type IssueCode =
  | "conflict"
  | "unexpected-in-mongo"
  | "deleted-after-cutover"
  | "not-representable"
  | "duplicate-email"
  | "postgres-changed"
  | "interrupted";

/** Ids and field names only: never values that could be personal data. */
export interface ReconciliationIssue {
  severity: "error" | "warning";
  domain: Domain;
  id: string;
  code: IssueCode;
  message: string;
}

export interface ProductUpdate {
  id: string;
  before: Doc;
  after: Doc;
}

export interface ReconciliationPlan {
  postgresFingerprint: string;
  inserts: Record<"deliveryOptions" | "products" | "users" | "orders", Doc[]>;
  productUpdates: ProductUpdate[];
  orderStatus: Doc[];
  carts: Doc[];
  issues: ReconciliationIssue[];
}

export interface ReconciliationReport {
  runId: string;
  outcome: "completed" | "failed";
  postgresFingerprint: string;
  written: Record<"deliveryOptions" | "products" | "users" | "orders" | "productUpdates" | "orderStatus" | "carts", number>;
  issues: ReconciliationIssue[];
}

export interface Readiness {
  ready: boolean;
  reasons: string[];
  postgresFingerprint: string;
}

export class ReconciliationError extends Error {
  constructor(message: string, readonly issues: ReconciliationIssue[] = []) {
    super(message);
    this.name = "ReconciliationError";
  }
}

// ---------------------------------------------------------------- PostgreSQL

interface PostgresSnapshot {
  fingerprint: string;
  deliveryOptions: Doc[];
  products: Doc[];
  users: Doc[];
  orders: Doc[];
  orderStatus: Doc[];
  carts: Doc[];
  inventoryTracked: string[];
}

interface OrderRow {
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

interface ItemRow {
  order_id: string;
  product_id: string;
  quantity: number;
  estimated_delivery_at: Date;
  snapshot_name: string | null;
  snapshot_image: string | null;
  snapshot_price_cents: number | null;
  snapshot_description: string | null;
  snapshot_category: string | null;
}

const group = <T>(rows: T[], key: (row: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
};

/** Every reconciled table, in MongoDB document shape, from one consistent snapshot. */
export async function readPostgres(pool: Pool): Promise<PostgresSnapshot> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");

    const deliveryOptions = (await client.query<{ id: string; delivery_days: number; price_cents: number; created_at: Date; updated_at: Date }>(
      "SELECT id, delivery_days, price_cents, created_at, updated_at FROM delivery_options ORDER BY id",
    )).rows.map((row): Doc => ({
      _id: row.id, deliveryDays: row.delivery_days, priceCents: row.price_cents, createdAt: row.created_at, updatedAt: row.updated_at,
    }));

    const productRows = (await client.query<{
      id: string; image: string; name: string; description: string; how_it_works: string; highlights: string[];
      care_instructions: string; category: string; stock: number; rating_stars: number; rating_count: number;
      price_cents: number; keywords: string[]; inventory_tracked: boolean; created_at: Date; updated_at: Date;
    }>(
      `SELECT id::text AS id, image, name, description, how_it_works, highlights, care_instructions, category, stock,
              rating_stars::float8 AS rating_stars, rating_count, price_cents, keywords, inventory_tracked, created_at, updated_at
         FROM products ORDER BY id`,
    )).rows;
    const products = productRows.map((row): Doc => ({
      _id: row.id, image: row.image, name: row.name, description: row.description, howItWorks: row.how_it_works,
      highlights: row.highlights, careInstructions: row.care_instructions, category: row.category, stock: row.stock,
      rating: { stars: row.rating_stars, count: row.rating_count }, priceCents: row.price_cents, keywords: row.keywords,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));

    const users = (await client.query<{ id: string; name: string; email: string; password_hash: string; is_admin: boolean; created_at: Date; updated_at: Date }>(
      "SELECT id, name, email, password_hash, is_admin, created_at, updated_at FROM users ORDER BY id",
    )).rows.map((row): Doc => ({
      // Inserted raw, never through the Mongoose model, whose save hook would hash the hash again.
      _id: new ObjectId(row.id), name: row.name, email: row.email, password: row.password_hash, isAdmin: row.is_admin,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }));

    const orderRows = (await client.query<OrderRow>(
      "SELECT *, id::text AS id FROM orders ORDER BY orders.id",
    )).rows;
    const items = group((await client.query<ItemRow>(
      `SELECT order_id::text AS order_id, product_id::text AS product_id, quantity, estimated_delivery_at,
              snapshot_name, snapshot_image, snapshot_price_cents, snapshot_description, snapshot_category
         FROM order_items ORDER BY order_id, position`,
    )).rows, (item) => item.order_id);
    const orders = orderRows.map((order) => orderDocument(order, items.get(order.id) ?? []));

    const events = group((await client.query<{ id: string; order_id: string; from_status: string | null; to_status: string; changed_by: string; reason: string; changed_at: Date }>(
      `SELECT id::text AS id, order_id::text AS order_id, from_status, to_status, changed_by, reason, changed_at
         FROM order_status_events ORDER BY order_id, id`,
    )).rows, (event) => event.order_id);
    const orderStatus = orderRows
      .filter((order) => order.status !== null || events.has(order.id))
      .map((order): Doc => ({
        _id: order.id,
        status: order.status,
        statusUpdatedAt: order.status_updated_at,
        events: (events.get(order.id) ?? []).map((event) => ({
          id: event.id, fromStatus: event.from_status, toStatus: event.to_status, changedBy: event.changed_by,
          reason: event.reason, changedAt: event.changed_at,
        })),
      }));

    const cartLines = group((await client.query<{ user_id: string; product_id: string; quantity: number; delivery_option_id: string; created_at: Date; updated_at: Date }>(
      `SELECT c.user_id, i.product_id::text AS product_id, i.quantity, i.delivery_option_id, i.created_at, i.updated_at
         FROM carts c JOIN cart_items i ON i.cart_id = c.id ORDER BY c.user_id, i.created_at, i.product_id`,
    )).rows, (line) => line.user_id);
    const carts = [...cartLines].map(([userId, lines]): Doc => ({
      _id: userId,
      items: lines.map((line) => ({
        productId: line.product_id, quantity: line.quantity, deliveryOptionId: line.delivery_option_id,
        createdAt: line.created_at, updatedAt: line.updated_at,
      })),
    }));

    await client.query("COMMIT");
    const content = { deliveryOptions, products, users, orders, orderStatus, carts };
    return {
      ...content,
      fingerprint: createHash("sha256").update(JSON.stringify(normalise(content))).digest("hex"),
      inventoryTracked: productRows.filter((row) => row.inventory_tracked).map((row) => row.id),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The document the MongoDB app would have stored, in its schema's field order. */
function orderDocument(order: OrderRow, items: ItemRow[]): Doc {
  const document: Doc = { _id: order.id };
  if (order.user_id !== null) document.userId = order.user_id;
  if (order.customer_full_name !== null) {
    document.customer = {
      fullName: order.customer_full_name, email: order.customer_email, phone: order.customer_phone,
      address: order.customer_address, city: order.customer_city, postalCode: order.customer_postal_code,
      country: order.customer_country,
    };
  }
  document.orderTimeMs = order.ordered_at.getTime();
  document.totalCostCents = order.total_cost_cents;
  document.products = items.map((item) => {
    const line: Fields = { productId: item.product_id };
    if (item.snapshot_name !== null) {
      line.product = {
        id: item.product_id, image: item.snapshot_image, name: item.snapshot_name, priceCents: item.snapshot_price_cents,
        description: item.snapshot_description, category: item.snapshot_category,
      };
    }
    line.quantity = item.quantity;
    line.estimatedDeliveryTimeMs = item.estimated_delivery_at.getTime();
    return line;
  });
  document.createdAt = order.created_at;
  document.updatedAt = order.updated_at;
  return document;
}

// ---------------------------------------------------------------- comparison

const idOf = (document: Doc) => (document._id instanceof ObjectId ? document._id.toHexString() : String(document._id));

const asRecord = (value: unknown): Fields => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
);

function normalise(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(normalise);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalise(entry)]));
  }
  return value;
}

const same = (left: unknown, right: unknown) => JSON.stringify(normalise(left)) === JSON.stringify(normalise(right));

// The fields that matter in each domain, with the MongoDB schema defaults that
// older documents rely on (the same defaults the forward import applied).
const deliveryOptionFields = (document: Doc) => [document.deliveryDays, document.priceCents];

const productFields = (document: Doc) => {
  const rating = asRecord(document.rating);
  return [
    document.image, document.name, document.description ?? "", document.howItWorks ?? "", document.highlights ?? [],
    document.careInstructions ?? "", document.category ?? "", document.stock ?? 0, rating.stars, rating.count,
    document.priceCents, document.keywords ?? [],
  ];
};

const userFields = (document: Doc) => [document.name, document.email, document.password, document.isAdmin ?? false];

/** What an order means financially. Never changed by reconciliation. */
const orderFields = (document: Doc, compareOwner: boolean) => {
  const lines = Array.isArray(document.products) ? document.products.map(asRecord) : [];
  return [
    compareOwner ? document.userId ?? null : "(legacy owner not compared)",
    document.customer ?? null,
    document.orderTimeMs,
    document.totalCostCents,
    lines.map((line) => {
      const snapshot = line.product === undefined || line.product === null ? null : asRecord(line.product);
      return [
        line.productId, line.quantity, line.estimatedDeliveryTimeMs,
        snapshot && [snapshot.name, snapshot.image, snapshot.priceCents, snapshot.description ?? "", snapshot.category ?? ""],
      ];
    }),
  ];
};

async function mongoDocuments(db: Db, name: string): Promise<Map<string, Doc>> {
  const documents = await db.collection<Doc>(name).find({}).toArray();
  return new Map(documents.map((document) => [idOf(document), document]));
}

/** Read-only on both sides: what a reconciliation would write, and what blocks it. */
export async function planReconciliation(pool: Pool, db: Db): Promise<ReconciliationPlan> {
  const postgres = await readPostgres(pool);
  const issues: ReconciliationIssue[] = [];
  const issue = (severity: ReconciliationIssue["severity"], domain: Domain, id: string, code: IssueCode, message: string) => {
    issues.push({ severity, domain, id, code, message });
  };

  const missingFrom = async (
    domain: "deliveryOptions" | "products" | "users" | "orders",
    rows: Doc[],
    fields: (document: Doc) => unknown[],
    onDifference: (expected: Doc, actual: Doc) => void,
    onMongoOnly: (id: string) => void,
  ) => {
    const existing = await mongoDocuments(db, domain);
    const inserts: Doc[] = [];
    for (const expected of rows) {
      const actual = existing.get(idOf(expected));
      if (!actual) inserts.push(expected);
      else if (!same(fields(expected), fields(actual))) onDifference(expected, actual);
    }
    const postgresIds = new Set(rows.map(idOf));
    for (const id of existing.keys()) if (!postgresIds.has(id)) onMongoOnly(id);
    return inserts;
  };

  const divergence = (domain: Domain) => (id: string) => issue(
    "error", domain, id, "unexpected-in-mongo",
    "exists only in MongoDB: it was written after the cutover (writes not frozen) or skipped by the import; resolve manually",
  );

  const deliveryOptions = await missingFrom("deliveryOptions", postgres.deliveryOptions, deliveryOptionFields,
    (expected) => issue("error", "deliveryOptions", idOf(expected), "conflict", "delivery option differs between the databases"),
    divergence("deliveryOptions"));

  const productUpdates: ProductUpdate[] = [];
  const products = await missingFrom("products", postgres.products, productFields,
    (after, before) => productUpdates.push({ id: idOf(after), before, after }),
    (id) => issue("warning", "products", id, "deleted-after-cutover",
      "deleted on PostgreSQL after the cutover; still listed in MongoDB. Not deleted automatically: decide manually"));
  for (const id of postgres.inventoryTracked) {
    issue("warning", "products", id, "not-representable", "inventory tracking is on; MongoDB has no inventory model");
  }

  const users = await missingFrom("users", postgres.users, userFields,
    (expected) => issue("error", "users", idOf(expected), "conflict", "user differs between the databases"),
    divergence("users"));
  // Unique emails: a different MongoDB user with the same email would fail the insert.
  const mongoEmails = new Map([...(await mongoDocuments(db, "users")).values()].map((user) => [String(user.email), idOf(user)]));
  for (const user of users) {
    const holder = mongoEmails.get(String(user.email));
    if (holder !== undefined && holder !== idOf(user)) {
      issue("error", "users", idOf(user), "duplicate-email", `email already used by MongoDB user ${holder}`);
    }
  }

  const legacyWithoutOwner = new Set(postgres.orders.filter((order) => order.userId === undefined).map(idOf));
  const orders = await missingFrom("orders", postgres.orders,
    (document) => orderFields(document, !legacyWithoutOwner.has(idOf(document))),
    (expected) => issue("error", "orders", idOf(expected), "conflict",
      "order differs between the databases; orders are never modified, resolve manually"),
    divergence("orders"));

  return {
    postgresFingerprint: postgres.fingerprint,
    inserts: { deliveryOptions, products, users, orders },
    productUpdates,
    orderStatus: postgres.orderStatus,
    carts: postgres.carts,
    issues,
  };
}

// ---------------------------------------------------------------- apply

export interface ApplyOptions {
  /** Test hook: called before each MongoDB write, so a test can interrupt the run. */
  beforeWrite?: (step: string) => void | Promise<void>;
}

const errorsOf = (issues: ReconciliationIssue[]) => issues.filter((issue) => issue.severity === "error");

/** Documents per ordered bulkWrite in applyReconciliation. */
export const WRITE_BATCH = 500;

// One run at a time: two overlapping runs would race on product updates.
// A process that dies mid-run leaves the lock; remove it by hand once no run is active.
const RUN_LOCK = "lock";

/**
 * Copies PostgreSQL-only records into MongoDB. PostgreSQL writes must be frozen
 * first. Stops without writing when the plan has errors; fails when PostgreSQL
 * changed during the run. Safe to re-run after any interruption.
 */
export async function applyReconciliation(pool: Pool, db: Db, options: ApplyOptions = {}): Promise<ReconciliationReport> {
  const runs = db.collection<Doc>(SIDE_COLLECTIONS.runs);
  try {
    await runs.insertOne({ _id: RUN_LOCK, startedAt: new Date() });
  } catch (error) {
    if (error instanceof mongoose.mongo.MongoServerError && error.code === 11000) {
      throw new ReconciliationError("Another reconciliation run is in progress (or died holding the lock). Nothing was written.");
    }
    throw error;
  }
  try {
    return await reconcile(pool, db, options);
  } finally {
    await runs.deleteOne({ _id: RUN_LOCK });
  }
}

async function reconcile(pool: Pool, db: Db, options: ApplyOptions): Promise<ReconciliationReport> {
  const plan = await planReconciliation(pool, db);
  const runs = db.collection<Doc>(SIDE_COLLECTIONS.runs);
  const runId = randomUUID();
  const written = { deliveryOptions: 0, products: 0, users: 0, orders: 0, productUpdates: 0, orderStatus: 0, carts: 0 };
  const finish = async (outcome: ReconciliationReport["outcome"], issues: ReconciliationIssue[]) => {
    await runs.updateOne({ _id: runId }, { $set: { outcome, finishedAt: new Date(), written, issues } });
    return { runId, outcome, postgresFingerprint: plan.postgresFingerprint, written, issues };
  };

  await runs.insertOne({ _id: runId, outcome: "running", startedAt: new Date(), postgresFingerprint: plan.postgresFingerprint });
  if (errorsOf(plan.issues).length > 0) {
    await finish("failed", plan.issues);
    throw new ReconciliationError("Reconciliation blocked: resolve the reported conflicts first. Nothing was written.", plan.issues);
  }

  const step = async (name: string) => { await options.beforeWrite?.(name); };
  // Insert-only: an existing document (from an earlier, interrupted run) is left as it is.
  const insert = async (collection: string, document: Doc) => {
    await db.collection<Doc>(collection).updateOne({ _id: document._id }, { $setOnInsert: document }, { upsert: true });
  };
  // Batched writes (Phase 7A, production volumes): the same idempotent operations,
  // WRITE_BATCH at a time in one ordered bulkWrite, so an interruption still
  // leaves a prefix of the dependency order. 20,000 users and orders took 27 s
  // one document at a time.
  const inBatches = async (
    name: keyof typeof written, collection: string, documents: Doc[],
    operation: (document: Doc) => mongoose.mongo.AnyBulkWriteOperation<Doc>,
  ) => {
    for (let start = 0; start < documents.length; start += WRITE_BATCH) {
      const batch = documents.slice(start, start + WRITE_BATCH);
      await step(name);
      await db.collection<Doc>(collection).bulkWrite(batch.map(operation), { ordered: true });
      written[name] += batch.length;
    }
  };
  const insertOnly = (document: Doc): mongoose.mongo.AnyBulkWriteOperation<Doc> => (
    { updateOne: { filter: { _id: document._id }, update: { $setOnInsert: document }, upsert: true } }
  );
  // Side collections mirror PostgreSQL exactly, so they are replaced, not merged.
  const mirror = (document: Doc): mongoose.mongo.AnyBulkWriteOperation<Doc> => (
    { replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } }
  );

  try {
    // Dependency order: an interruption never leaves an order without its user.
    await inBatches("deliveryOptions", "deliveryOptions", plan.inserts.deliveryOptions, insertOnly);
    await inBatches("products", "products", plan.inserts.products, insertOnly);
    for (const update of plan.productUpdates) {
      await step("productUpdates");
      await insert(SIDE_COLLECTIONS.previousProducts, { _id: `${update.id}@${normalise(update.before.updatedAt)}`, productId: update.id, archivedAt: new Date(), product: update.before });
      const replaced = await db.collection<Doc>("products").replaceOne({ _id: update.id, updatedAt: update.before.updatedAt }, update.after);
      if (replaced.matchedCount !== 1) throw new ReconciliationError(`MongoDB product ${update.id} changed during reconciliation`);
      written.productUpdates += 1;
    }
    await inBatches("users", "users", plan.inserts.users, insertOnly);
    await inBatches("orders", "orders", plan.inserts.orders, insertOnly);
    await inBatches("orderStatus", SIDE_COLLECTIONS.orderStatus, plan.orderStatus, mirror);
    await inBatches("carts", SIDE_COLLECTIONS.carts, plan.carts, mirror);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finish("failed", [{ severity: "error", domain: "orders", id: runId, code: "interrupted", message }]);
    throw error;
  }

  const after = await readPostgres(pool);
  if (after.fingerprint !== plan.postgresFingerprint) {
    const changed: ReconciliationIssue = {
      severity: "error", domain: "orders", id: runId, code: "postgres-changed",
      message: "PostgreSQL changed during reconciliation: writes are not frozen. Freeze writes and run again.",
    };
    await finish("failed", [changed]);
    throw new ReconciliationError(changed.message, [changed]);
  }
  return finish("completed", plan.issues);
}

// ---------------------------------------------------------------- readiness

/**
 * The rollback gate. MongoDB is ready to become the active database only when
 * it holds every PostgreSQL record, nothing conflicts, the side collections
 * mirror PostgreSQL, and the last run completed against PostgreSQL as it is now.
 */
export async function verifyRollbackTarget(pool: Pool, db: Db): Promise<Readiness> {
  const plan = await planReconciliation(pool, db);
  const reasons: string[] = [];

  for (const [domain, documents] of Object.entries(plan.inserts)) {
    if (documents.length > 0) reasons.push(`${documents.length} ${domain} exist only in PostgreSQL (MongoDB is older)`);
  }
  if (plan.productUpdates.length > 0) reasons.push(`${plan.productUpdates.length} products are newer in PostgreSQL`);
  for (const issue of errorsOf(plan.issues)) reasons.push(`${issue.domain} ${issue.id}: ${issue.code}`);

  const mirrors = async (collection: string, expected: Doc[]) => {
    const actual = await mongoDocuments(db, collection);
    return actual.size === expected.length && expected.every((document) => same(document, actual.get(idOf(document))));
  };
  if (!(await mirrors(SIDE_COLLECTIONS.orderStatus, plan.orderStatus))) reasons.push("order status archive differs from PostgreSQL");
  if (!(await mirrors(SIDE_COLLECTIONS.carts, plan.carts))) reasons.push("cart archive differs from PostgreSQL");

  const runs = db.collection<Doc>(SIDE_COLLECTIONS.runs);
  if (await runs.findOne({ _id: RUN_LOCK })) reasons.push("a reconciliation run is in progress");
  const [lastRun] = await runs.find({ _id: { $ne: RUN_LOCK } }).sort({ startedAt: -1 }).limit(1).toArray();
  if (lastRun?.outcome !== "completed") reasons.push("no completed reconciliation run");
  else if (lastRun.postgresFingerprint !== plan.postgresFingerprint) reasons.push("PostgreSQL changed since the last completed run");

  return { ready: reasons.length === 0, reasons, postgresFingerprint: plan.postgresFingerprint };
}
