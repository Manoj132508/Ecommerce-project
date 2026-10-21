// Phase 3B: MongoDB -> PostgreSQL copy-and-verify tooling, against isolated
// databases on both sides: an in-memory MongoDB (a fresh database per test)
// and a fresh PostgreSQL database in the throwaway test container.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { DataMigrationError, importPlan, rollbackImportedData } from "../../db/dataMigration/importer.js";
import { buildPlan, errorCount, type MigrationPlan } from "../../db/dataMigration/plan.js";
import { connectionHosts, describeConnection, extractSource, isLocalConnection } from "../../db/dataMigration/source.js";
import { verifyAgainstSource } from "../../db/dataMigration/verify.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const { MongoClient, ObjectId } = mongoose.mongo;

// ------------------------------------------------------------- fixture ids
const PRODUCT_SOCKS = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const PRODUCT_BALL = "15b6fc6f-327a-4ec4-896f-486349e85a3d";
const PRODUCT_SHIRT = "83d4ca15-0f35-48f5-b7a3-1ea210004f2e";
const DELETED_PRODUCT = "99999999-9999-4999-8999-999999999999";
const ADMIN_ID = "6aa7f3b07e1b7e1411434c6b";
const SHOPPER_ID = "6ad8b3e08afe6f8ad3173cac";
const DELETED_USER_ID = "6aa7f3b07e1b7e1411434c6c";
const ORDER_LEGACY = "0e4111b0-cf69-448b-a3d1-ca2f5d6ba563";
const ORDER_OWNED = "813e5e9d-bba1-40a3-8fde-cf6673a7f1e7";
const ORDER_ORPHAN = "ce92c427-efb1-4cd1-a8f0-3ef49de4c67c";
const HASH = `$2b$12$${"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0".slice(0, 53)}`;

const at = (iso: string) => new Date(iso);
const CUSTOMER = {
  fullName: "Ada Lovelace", email: "ada@example.com", phone: "0123 456", address: "1 Analytical Way",
  city: "London", postalCode: "N1 1AA", country: "UK",
};

type Doc = Record<string, unknown>;
// Collections whose _id is a string (products, orders, delivery options).
interface StringIdDoc {
  _id: string;
  [field: string]: unknown;
}

/** Mirrors the shapes found in the real MongoDB profile (2026-10-21). */
function fixture(): Record<string, Doc[]> {
  return {
    deliveryOptions: [
      { _id: "1", deliveryDays: 7, priceCents: 0, createdAt: at("2024-06-01T09:00:00.001Z"), updatedAt: at("2024-06-01T09:00:00.001Z") },
      { _id: "2", deliveryDays: 3, priceCents: 499, createdAt: at("2024-06-01T09:00:00.002Z"), updatedAt: at("2024-06-01T09:00:00.002Z") },
      { _id: "3", deliveryDays: 1, priceCents: 999, createdAt: at("2024-06-01T09:00:00.003Z"), updatedAt: at("2024-06-01T09:00:00.003Z") },
    ],
    products: [
      {
        _id: PRODUCT_SOCKS, image: "images/products/socks.jpg", name: "Black and Gray Athletic Cotton Socks - 6 Pairs",
        description: "Comfortable socks.", howItWorks: "Wear them.", highlights: ["Cotton", "6 pairs"],
        careInstructions: "Machine wash.", category: "Clothing", rating: { stars: 4.5, count: 87 }, priceCents: 1090,
        keywords: ["socks", "sports"], createdAt: at("2024-06-02T10:00:00.123Z"), updatedAt: at("2024-07-02T10:00:00.456Z"),
      },
      {
        // Old seed shape: no stock, description, howItWorks or careInstructions.
        _id: PRODUCT_BALL, image: "images/products/basketball.jpg", name: "Intermediate Size Basketball",
        highlights: ["Composite"], category: "Sports", rating: { stars: 4, count: 127 }, priceCents: 2095,
        keywords: ["sports", "basketballs"], createdAt: at("2024-06-02T10:00:01.000Z"), updatedAt: at("2024-06-02T10:00:01.000Z"),
      },
      {
        _id: PRODUCT_SHIRT, image: "images/products/tshirt.jpg", name: "Adults Plain Cotton T-Shirt - 2 Pack",
        description: "Plain.", howItWorks: "Wear it.", highlights: ["2 pack"], careInstructions: "Wash cold.",
        category: "Clothing", stock: 12, rating: { stars: 3.5, count: 56 }, priceCents: 799, keywords: ["tshirts"],
        createdAt: at("2024-06-02T10:00:02.000Z"), updatedAt: at("2024-06-02T10:00:02.000Z"),
      },
    ],
    users: [
      { _id: new ObjectId(ADMIN_ID), name: "Admin", email: "admin@example.com", password: HASH, isAdmin: true, createdAt: at("2024-06-03T08:00:00.000Z"), updatedAt: at("2024-06-03T08:00:00.000Z") },
      { _id: new ObjectId(SHOPPER_ID), name: "Shopper", email: "shopper@example.com", password: HASH, createdAt: at("2024-06-04T08:00:00.000Z"), updatedAt: at("2024-06-04T08:00:00.000Z") },
    ],
    orders: [
      {
        // Legacy: no owner, no customer, no snapshots, one deleted product.
        _id: ORDER_LEGACY, orderTimeMs: 1_718_013_600_000, totalCostCents: 3506,
        products: [
          { productId: DELETED_PRODUCT, quantity: 2, estimatedDeliveryTimeMs: 1_718_618_400_000 },
          { productId: PRODUCT_SOCKS, quantity: 1, estimatedDeliveryTimeMs: 1_718_618_400_000 },
        ],
        createdAt: at("2024-06-10T10:00:00.000Z"), updatedAt: at("2024-06-10T10:00:00.000Z"),
      },
      {
        _id: ORDER_OWNED, userId: SHOPPER_ID, customer: CUSTOMER, orderTimeMs: 1_790_167_054_005, totalCostCents: 5801,
        products: [
          { productId: PRODUCT_SOCKS, product: { id: PRODUCT_SOCKS, image: "images/products/socks.jpg", name: "Socks (as sold)", priceCents: 1090, description: "Comfortable socks.", category: "Clothing" }, quantity: 2, estimatedDeliveryTimeMs: 1_790_771_854_005 },
          { productId: PRODUCT_BALL, quantity: 1, estimatedDeliveryTimeMs: 1_790_253_454_005 },
        ],
        createdAt: at("2026-09-24T12:37:34.005Z"), updatedAt: at("2026-09-24T12:37:34.009Z"),
      },
      {
        // The owner was deleted: imported with NULL ownership and audited.
        _id: ORDER_ORPHAN, userId: DELETED_USER_ID, customer: CUSTOMER, orderTimeMs: 1_750_000_000_000, totalCostCents: 1199,
        products: [
          { productId: PRODUCT_SHIRT, product: { id: PRODUCT_SHIRT, image: "images/products/tshirt.jpg", name: "T-Shirt", priceCents: 799 }, quantity: 1, estimatedDeliveryTimeMs: 1_750_259_200_000 },
        ],
        createdAt: at("2025-06-15T15:06:40.000Z"), updatedAt: at("2025-06-15T15:06:40.000Z"),
      },
    ],
    // The shared cart: four lines with no owner (D1: excluded).
    cartItems: [
      { _id: new ObjectId(), productId: PRODUCT_SOCKS, quantity: 2, deliveryOptionId: "1", createdAt: at("2026-10-01T00:00:00Z"), updatedAt: at("2026-10-01T00:00:00Z") },
      { _id: new ObjectId(), productId: PRODUCT_BALL, quantity: 1, deliveryOptionId: "1", createdAt: at("2026-10-01T00:00:01Z"), updatedAt: at("2026-10-01T00:00:01Z") },
      { _id: new ObjectId(), productId: PRODUCT_SHIRT, quantity: 1, deliveryOptionId: "2", createdAt: at("2026-10-01T00:00:02Z"), updatedAt: at("2026-10-01T00:00:02Z") },
      { _id: new ObjectId(), productId: DELETED_PRODUCT, quantity: 1, deliveryOptionId: "1", createdAt: at("2026-10-01T00:00:03Z"), updatedAt: at("2026-10-01T00:00:03Z") },
    ],
    // The stray empty collection found in the real database.
    "delivery Options": [],
  };
}

// ------------------------------------------------------------- harness
let mongoServer: MongoMemoryServer;
let mongoUri: string;
let pg: TestDatabase;
let databaseCounter = 0;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
});

afterAll(async () => {
  await mongoServer.stop();
});

async function withMongo<T>(work: (db: mongoose.mongo.Db) => Promise<T>): Promise<T> {
  const client = await MongoClient.connect(mongoUri);
  try {
    return await work(client.db());
  } finally {
    await client.close();
  }
}

async function seed(collections: Record<string, Doc[]>) {
  await withMongo(async (db) => {
    for (const [name, documents] of Object.entries(collections)) {
      await db.createCollection(name);
      if (documents.length > 0) await db.collection<Doc>(name).insertMany(documents);
    }
  });
}

const sourceHash = () => withMongo(async (db) => {
  const result = await db.command({ dbHash: 1 });
  return JSON.stringify(result.collections);
});

beforeEach(async () => {
  databaseCounter += 1;
  mongoUri = `${mongoServer.getUri()}migration_source_${databaseCounter}`;
  pg = await createTestDatabase();
  await migrate(pg.pool, MIGRATIONS_DIRECTORY);
});

afterEach(async () => {
  await pg.drop();
});

const plan = async () => buildPlan(await extractSource(mongoUri));

const runImport = async (options: { skipInvalid?: boolean } = {}) => importPlan(pg.pool, await plan(), {
  migrationsDirectory: MIGRATIONS_DIRECTORY,
  sourceConnection: describeConnection(mongoUri),
  targetConnection: "test",
  ...options,
});

const verify = async () => {
  const source = await extractSource(mongoUri);
  return verifyAgainstSource(pg.pool, source, buildPlan(source));
};

const counts = async () => (await pg.pool.query<Record<string, number>>(
  `SELECT (SELECT count(*) FROM delivery_options)::int AS delivery_options, (SELECT count(*) FROM products)::int AS products,
          (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM orders)::int AS orders,
          (SELECT count(*) FROM order_items)::int AS order_items, (SELECT count(*) FROM carts)::int AS carts,
          (SELECT count(*) FROM cart_items)::int AS cart_items`,
)).rows[0];

const EMPTY = { delivery_options: 0, products: 0, users: 0, orders: 0, order_items: 0, carts: 0, cart_items: 0 };

/** Every row of every imported table, for before/after comparisons. */
const dump = async () => {
  const tables = ["delivery_options", "products", "users", "orders", "order_items"];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) {
    result[table] = (await pg.pool.query(`SELECT * FROM ${table} ORDER BY 1, 2`)).rows;
  }
  return JSON.stringify(result);
};

const runs = async () => (await pg.pool.query<{ operation: string; outcome: string; source_fingerprint: string | null }>(
  "SELECT operation, outcome, source_fingerprint FROM data_import_runs ORDER BY id",
)).rows;

// ------------------------------------------------------------- tests
describe("dry run (extraction and validation)", () => {
  test("reports counts, exclusions, ownership, snapshots and deleted products, and writes nothing", async () => {
    await seed(fixture());
    const before = await sourceHash();

    const result = await plan();

    expect(errorCount(result)).toBe(0);
    expect(result.sourceCounts).toEqual({ cartItems: 4, deliveryOptions: 3, "delivery Options": 0, orders: 3, products: 3, users: 2 });
    expect([result.deliveryOptions.length, result.products.length, result.users.length, result.orders.length]).toEqual([3, 3, 2, 3]);
    expect(result.excluded.cartItems).toMatchObject({ count: 4, totalQuantity: 5, distinctProducts: 4 });
    expect(result.excluded.otherCollections).toEqual([{ name: "delivery Options", count: 0 }]);
    expect(result.orphanedOrders).toEqual([{ orderId: ORDER_ORPHAN, originalUserId: DELETED_USER_ID }]);
    expect(result.ordersWithoutOwnership).toEqual([ORDER_LEGACY]);
    expect(result.missingSnapshots).toEqual([
      { orderId: ORDER_LEGACY, positions: [0, 1] },
      { orderId: ORDER_OWNED, positions: [1] },
    ]);
    expect(result.deletedProductReferences).toEqual([{ orderId: ORDER_LEGACY, productId: DELETED_PRODUCT }]);
    expect(result.defaultsApplied.map(({ collection, field, value, ids }) => `${collection}.${field}=${value}:${ids.length}`)).toEqual([
      "orders.products[].product.category=\"\":1",
      "orders.products[].product.description=\"\":1",
      "products.careInstructions=\"\":1",
      "products.description=\"\":1",
      "products.howItWorks=\"\":1",
      "products.stock=0:2",
      "users.isAdmin=false:1",
    ]);

    expect(await counts()).toEqual(EMPTY);
    expect(await runs()).toEqual([]);
    expect(await sourceHash()).toBe(before);
  });

  test("is deterministic: the same source gives the same plan and fingerprint", async () => {
    await seed(fixture());
    const first = await plan();
    const second = await plan();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test("reports malformed ids, broken references, duplicates and incompatible values as errors", async () => {
    const data = fixture();
    data.deliveryOptions?.push({ _id: "abc", deliveryDays: 1, priceCents: 0, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") });
    data.products?.push(
      { _id: "not-a-uuid", image: "i.jpg", name: "Bad id", rating: { stars: 4, count: 1 }, priceCents: 100, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", image: "i.jpg", name: "Uppercase", rating: { stars: 4, count: 1 }, priceCents: 100, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: "11111111-1111-4111-8111-111111111111", image: "i.jpg", name: "Bad values", rating: { stars: 4.3, count: 1 }, priceCents: 10.5, createdAt: at("2024-01-01") },
    );
    data.users?.push(
      { _id: new ObjectId("6aa7f3b07e1b7e1411434c70"), name: "Dup A", email: "dup@example.com", password: HASH, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: new ObjectId("6aa7f3b07e1b7e1411434c71"), name: "Dup B", email: "dup@example.com", password: HASH, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: new ObjectId("6aa7f3b07e1b7e1411434c72"), name: "Caps", email: "Caps@Example.com", password: "plaintext", createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
    );
    data.orders?.push(
      { _id: "22222222-2222-4222-8222-222222222222", userId: "xyz", orderTimeMs: 1, totalCostCents: 1, products: [], createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: "33333333-3333-4333-8333-333333333333", customer: { fullName: "Partial" }, orderTimeMs: 1, totalCostCents: 1, products: [], createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: "44444444-4444-4444-8444-444444444444", orderTimeMs: 1.5, totalCostCents: 1, products: [{ productId: "bad", quantity: 0, estimatedDeliveryTimeMs: 1 }], createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
      { _id: "55555555-5555-4555-8555-555555555555", userId: "6aa7f3b07e1b7e1411434c70", orderTimeMs: 1, totalCostCents: 1, products: [], createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") },
    );
    await seed(data);

    const result = await plan();
    const errorsFor = (id: string) => result.issues.filter((issue) => issue.id === id && issue.severity === "error").map((issue) => `${issue.code}:${issue.field ?? ""}`);

    expect(result.invalid).toEqual({
      deliveryOptions: ["abc"],
      products: ["11111111-1111-4111-8111-111111111111", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "not-a-uuid"],
      users: ["6aa7f3b07e1b7e1411434c70", "6aa7f3b07e1b7e1411434c71", "6aa7f3b07e1b7e1411434c72"],
      orders: [
        "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333",
        "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555",
      ],
    });
    expect(errorsFor("abc")).toEqual(["invalid-id:_id"]);
    expect(errorsFor("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA")).toEqual(["invalid-id:_id"]);
    expect(errorsFor("11111111-1111-4111-8111-111111111111")).toEqual(["invalid-field:rating.stars", "invalid-field:priceCents", "missing-field:updatedAt"]);
    expect(errorsFor("6aa7f3b07e1b7e1411434c70")).toEqual(["duplicate-key:email"]);
    expect(errorsFor("6aa7f3b07e1b7e1411434c72")).toEqual(["invalid-field:email", "invalid-field:password"]);
    expect(errorsFor("22222222-2222-4222-8222-222222222222")).toEqual(["invalid-reference:userId"]);
    expect(errorsFor("33333333-3333-4333-8333-333333333333")).toEqual(["invalid-field:customer"]);
    expect(errorsFor("44444444-4444-4444-8444-444444444444")).toEqual(["invalid-field:orderTimeMs", "invalid-reference:products[0].productId"]);
    expect(errorsFor("55555555-5555-4555-8555-555555555555")).toEqual(["invalid-reference:userId"]);
    // Issues never carry personal data: no emails in any message.
    expect(JSON.stringify(result.issues)).not.toMatch(/@example\.com/i);
  });

  test("reports fields the model does not define (they would not be copied)", async () => {
    const data = fixture();
    const socks = data.products?.[0];
    if (socks) socks.legacyColour = "black";
    await seed(data);
    const result = await plan();
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "warning", code: "unknown-field", collection: "products", id: PRODUCT_SOCKS, field: "legacyColour",
    }));
  });
});

describe("import", () => {
  test("copies every record exactly, preserves ids/prices/timestamps, excludes the cart, and verifies clean", async () => {
    await seed(fixture());
    const before = await sourceHash();

    const report = await runImport();

    expect(report.outcome).toBe("succeeded");
    expect(report.tables).toEqual({
      deliveryOptions: { source: 3, valid: 3, invalid: 0, inserted: 3, updated: 0, unchanged: 0 },
      products: { source: 3, valid: 3, invalid: 0, inserted: 3, updated: 0, unchanged: 0 },
      users: { source: 2, valid: 2, invalid: 0, inserted: 2, updated: 0, unchanged: 0 },
      orders: { source: 3, valid: 3, invalid: 0, inserted: 3, updated: 0, unchanged: 0 },
    });
    expect(await counts()).toEqual({ ...EMPTY, delivery_options: 3, products: 3, users: 2, orders: 3, order_items: 5 });
    expect(report.excluded?.cartItems.count).toBe(4);
    expect(report.orphanedOrders).toEqual([{ orderId: ORDER_ORPHAN, originalUserId: DELETED_USER_ID }]);

    // Exact values, independent of the tool's own verification.
    const { rows: [socks] } = await pg.pool.query("SELECT price_cents, rating_stars, highlights, created_at, updated_at, stock FROM products WHERE id = $1", [PRODUCT_SOCKS]);
    expect(socks).toEqual({
      price_cents: 1090, rating_stars: "4.5", highlights: ["Cotton", "6 pairs"],
      created_at: at("2024-06-02T10:00:00.123Z"), updated_at: at("2024-07-02T10:00:00.456Z"), stock: 0,
    });
    const { rows: [ball] } = await pg.pool.query("SELECT description, how_it_works, care_instructions, stock FROM products WHERE id = $1", [PRODUCT_BALL]);
    expect(ball).toEqual({ description: "", how_it_works: "", care_instructions: "", stock: 0 });
    const { rows: users } = await pg.pool.query("SELECT id, is_admin, password_hash FROM users ORDER BY id");
    expect(users).toEqual([
      { id: ADMIN_ID, is_admin: true, password_hash: HASH },
      { id: SHOPPER_ID, is_admin: false, password_hash: HASH },
    ]);

    const { rows: orders } = await pg.pool.query<{ id: string; is_legacy: boolean; user_id: string | null; customer_email: string | null; ordered_at: Date; status: string | null }>(
      "SELECT id::text, is_legacy, user_id, customer_email, ordered_at, status FROM orders ORDER BY id",
    );
    expect(orders).toEqual([
      { id: ORDER_LEGACY, is_legacy: true, user_id: null, customer_email: null, ordered_at: new Date(1_718_013_600_000), status: null },
      { id: ORDER_OWNED, is_legacy: true, user_id: SHOPPER_ID, customer_email: "ada@example.com", ordered_at: new Date(1_790_167_054_005), status: null },
      { id: ORDER_ORPHAN, is_legacy: true, user_id: null, customer_email: "ada@example.com", ordered_at: new Date(1_750_000_000_000), status: null },
    ]);

    const { rows: lines } = await pg.pool.query(
      `SELECT order_id::text, position, product_id::text, quantity, snapshot_name, snapshot_price_cents, snapshot_description, estimated_delivery_at
         FROM order_items ORDER BY order_id, position`,
    );
    expect(lines).toEqual([
      { order_id: ORDER_LEGACY, position: 0, product_id: DELETED_PRODUCT, quantity: 2, snapshot_name: null, snapshot_price_cents: null, snapshot_description: null, estimated_delivery_at: new Date(1_718_618_400_000) },
      { order_id: ORDER_LEGACY, position: 1, product_id: PRODUCT_SOCKS, quantity: 1, snapshot_name: null, snapshot_price_cents: null, snapshot_description: null, estimated_delivery_at: new Date(1_718_618_400_000) },
      { order_id: ORDER_OWNED, position: 0, product_id: PRODUCT_SOCKS, quantity: 2, snapshot_name: "Socks (as sold)", snapshot_price_cents: 1090, snapshot_description: "Comfortable socks.", estimated_delivery_at: new Date(1_790_771_854_005) },
      { order_id: ORDER_OWNED, position: 1, product_id: PRODUCT_BALL, quantity: 1, snapshot_name: null, snapshot_price_cents: null, snapshot_description: null, estimated_delivery_at: new Date(1_790_253_454_005) },
      { order_id: ORDER_ORPHAN, position: 0, product_id: PRODUCT_SHIRT, quantity: 1, snapshot_name: "T-Shirt", snapshot_price_cents: 799, snapshot_description: "", estimated_delivery_at: new Date(1_750_259_200_000) },
    ]);

    // Deleted products resolve to nothing through the LEFT JOIN, as history.
    const { rows: [orphanLine] } = await pg.pool.query(
      "SELECT p.id FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.product_id = $1", [DELETED_PRODUCT],
    );
    expect(orphanLine).toEqual({ id: null });

    expect(await runs()).toEqual([{ operation: "import", outcome: "succeeded", source_fingerprint: (await plan()).sourceFingerprint }]);
    const verification = await verify();
    expect(verification.outcome).toBe("match");
    expect(verification.excludedCart).toEqual({ sourceCartItems: 4, destinationCarts: 0, destinationCartItems: 0 });
    expect(await sourceHash()).toBe(before);
  });

  test("re-running changes nothing", async () => {
    await seed(fixture());
    await runImport();
    const before = await dump();

    const again = await runImport();

    expect(Object.values(again.tables ?? {}).map((table) => [table.inserted, table.updated, table.unchanged])).toEqual([
      [0, 0, 3], [0, 0, 3], [0, 0, 2], [0, 0, 3],
    ]);
    expect(await dump()).toBe(before);
    expect((await verify()).outcome).toBe("match");
    expect((await runs()).map((run) => run.outcome)).toEqual(["succeeded", "succeeded"]);
  });

  test("a re-run picks up source changes to reference data and keeps the source timestamps", async () => {
    await seed(fixture());
    await runImport();
    await withMongo((db) => db.collection<StringIdDoc>("products").updateOne(
      { _id: PRODUCT_SOCKS },
      { $set: { priceCents: 1299, updatedAt: at("2026-10-20T08:00:00.789Z") } },
    ));

    const again = await runImport();

    expect(again.tables?.products).toMatchObject({ inserted: 0, updated: 1, unchanged: 2 });
    const { rows: [socks] } = await pg.pool.query("SELECT price_cents, updated_at FROM products WHERE id = $1", [PRODUCT_SOCKS]);
    expect(socks).toEqual({ price_cents: 1299, updated_at: at("2026-10-20T08:00:00.789Z") });
    expect((await verify()).outcome).toBe("match");
  });

  test("invalid records block the whole import by default; nothing is written", async () => {
    const data = fixture();
    data.products?.push({ _id: "not-a-uuid", image: "i.jpg", name: "Bad", rating: { stars: 4, count: 1 }, priceCents: 1, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") });
    await seed(data);

    const report = await runImport();

    expect(report.outcome).toBe("blocked");
    expect(report.error).toMatch(/1 validation error\(s\)\. Nothing was written/);
    expect(await counts()).toEqual(EMPTY);
    expect(await runs()).toEqual([]);
  });

  test("--skip-invalid imports only valid records, skips dependants, and reports every skip", async () => {
    const data = fixture();
    data.users?.push({ _id: new ObjectId("6aa7f3b07e1b7e1411434c72"), name: "Caps", email: "Caps@Example.com", password: HASH, createdAt: at("2024-01-01"), updatedAt: at("2024-01-01") });
    data.orders?.push({
      _id: "55555555-5555-4555-8555-555555555555", userId: "6aa7f3b07e1b7e1411434c72", customer: CUSTOMER, orderTimeMs: 1,
      totalCostCents: 1, products: [], createdAt: at("2024-01-01"), updatedAt: at("2024-01-01"),
    });
    await seed(data);

    const report = await runImport({ skipInvalid: true });

    expect(report.outcome).toBe("succeeded");
    expect(report.skipped).toEqual({
      deliveryOptions: [], products: [], users: ["6aa7f3b07e1b7e1411434c72"], orders: ["55555555-5555-4555-8555-555555555555"],
    });
    expect(await counts()).toMatchObject({ users: 2, orders: 3 });
    expect((await verify()).outcome).toBe("match");
  });
});

describe("failures roll back completely", () => {
  test("a failure part-way through (after delivery options and products) leaves PostgreSQL unchanged", async () => {
    await seed(fixture());
    // A pre-existing user with the shopper's email but another id: the users
    // step violates users_email_key after two tables were already written.
    await pg.pool.query(
      "INSERT INTO users (id, name, email, password_hash) VALUES ('aaaaaaaaaaaaaaaaaaaaaaaa', 'Other', 'shopper@example.com', $1)",
      [HASH],
    );

    const failure = await runImport().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataMigrationError);
    if (!(failure instanceof DataMigrationError)) return;
    expect(failure.report.outcome).toBe("failed");
    expect(failure.report.error).toMatch(/users_email_key.*transaction rolled back; nothing was written/);
    expect(await counts()).toEqual({ ...EMPTY, users: 1 });
    expect(await runs()).toEqual([expect.objectContaining({ operation: "import", outcome: "failed" })]);
  });

  test("an existing order with different content is a conflict: history is never overwritten", async () => {
    await seed(fixture());
    await pg.pool.query(
      `INSERT INTO orders (id, is_legacy, ordered_at, total_cost_cents) VALUES ($1, true, now(), 1)`,
      [ORDER_LEGACY],
    );

    const failure = await runImport().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DataMigrationError);
    expect(failure instanceof Error ? failure.message : "").toMatch(new RegExp(`1 order\\(s\\) already exist.*${ORDER_LEGACY}`));
    expect(await counts()).toEqual({ ...EMPTY, orders: 1 });
    const { rows: [order] } = await pg.pool.query("SELECT total_cost_cents FROM orders");
    expect(order).toEqual({ total_cost_cents: 1 });
  });

  test("refuses to import into a database whose schema is not fully migrated", async () => {
    await seed(fixture());
    const bare = await createTestDatabase();
    try {
      const failure = await importPlan(bare.pool, await plan(), {
        migrationsDirectory: MIGRATIONS_DIRECTORY, sourceConnection: "s", targetConnection: "t",
      }).catch((error: unknown) => error);
      expect(failure instanceof Error ? failure.message : "").toMatch(/schema has not been created.*db:migrate/);
    } finally {
      await bare.drop();
    }
  });

  test("two concurrent imports cannot interleave", async () => {
    await seed(fixture());
    const results = await Promise.allSettled([runImport(), runImport()]);
    const succeeded = results.filter((result) => result.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    for (const result of results) {
      if (result.status === "rejected") expect(String(result.reason)).toMatch(/Another data import or rollback is running/);
    }
    expect((await verify()).outcome).toBe("match");
  });
});

describe("verification", () => {
  test("detects content drift, missing rows and unexpected rows (field names only, no values)", async () => {
    await seed(fixture());
    await runImport();

    await pg.pool.query("UPDATE products SET price_cents = 1 WHERE id = $1", [PRODUCT_SOCKS]);
    await pg.pool.query("UPDATE users SET name = 'Changed' WHERE id = $1", [SHOPPER_ID]);
    await pg.pool.query("DELETE FROM products WHERE id = $1", [PRODUCT_SHIRT]);
    await pg.pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('9', 1, 1)");

    const result = await verify();

    expect(result.outcome).toBe("mismatch");
    expect(result.mismatches).toEqual([
      { table: "products", id: PRODUCT_SOCKS, field: "price_cents" },
      { table: "products", id: PRODUCT_SOCKS, field: "updated_at" },
      { table: "users", id: SHOPPER_ID, field: "name" },
      { table: "users", id: SHOPPER_ID, field: "updated_at" },
    ]);
    expect(result.tables.products.missing).toEqual([PRODUCT_SHIRT]);
    expect(result.tables.deliveryOptions.unexpected).toEqual(["9"]);
    expect(JSON.stringify(result)).not.toMatch(/"Changed"|@example/);
  });

  test("flags a source that changed after the last import", async () => {
    await seed(fixture());
    await runImport();
    await withMongo((db) => db.collection<StringIdDoc>("deliveryOptions").updateOne({ _id: "2" }, { $set: { priceCents: 599 } }));
    const result = await verify();
    expect(result.sourceChangedSinceLastImport).toBe(true);
    expect(result.mismatches).toEqual([{ table: "deliveryOptions", id: "2", field: "price_cents" }]);
  });
});

describe("rollback of imported data", () => {
  const rollback = (confirm = true) => rollbackImportedData(pg.pool, {
    confirm, targetConnection: "test", migrationsDirectory: MIGRATIONS_DIRECTORY,
  });

  test("needs --confirm, then removes every imported row and keeps the audit trail; re-import works", async () => {
    await seed(fixture());
    await runImport();

    expect((await rollback(false)).outcome).toBe("blocked");
    expect(await counts()).toMatchObject({ orders: 3 });

    const report = await rollback();
    expect(report.outcome).toBe("succeeded");
    expect(report.rollback?.removed).toEqual({ order_items: 5, orders: 3, users: 2, products: 3, delivery_options: 3 });
    expect(await counts()).toEqual(EMPTY);
    expect((await runs()).map((run) => `${run.operation}:${run.outcome}`)).toEqual(["import:succeeded", "rollback:succeeded"]);

    expect((await runImport()).outcome).toBe("succeeded");
    expect((await verify()).outcome).toBe("match");
  });

  test("refuses when PostgreSQL holds application data (a cart or a non-legacy order)", async () => {
    await seed(fixture());
    await runImport();
    await pg.pool.query("INSERT INTO carts (user_id) VALUES ($1)", [SHOPPER_ID]);

    const failure = await rollback().catch((error: unknown) => error);

    expect(failure instanceof Error ? failure.message : "").toMatch(/application data.*refusing/);
    expect(await counts()).toMatchObject({ orders: 3, carts: 1 });
  });

  test("refuses when a row was not created by a recorded import", async () => {
    await seed(fixture());
    await runImport();
    await pg.pool.query("INSERT INTO products (id, image, name, price_cents) VALUES ($1, 'i.jpg', 'Manual', 1)", [DELETED_PRODUCT]);

    const failure = await rollback().catch((error: unknown) => error);

    expect(failure instanceof Error ? failure.message : "").toMatch(/1 row\(s\) in products were not created by a recorded import/);
    expect(await counts()).toMatchObject({ products: 4, orders: 3 });
  });
});

describe("MongoDB is never modified", () => {
  test("dry-run, import, re-import, verify and rollback leave the source byte-identical", async () => {
    await seed(fixture());
    const before = await sourceHash();
    await plan();
    await runImport();
    await runImport();
    await verify();
    await rollbackImportedData(pg.pool, { confirm: true, targetConnection: "t", migrationsDirectory: MIGRATIONS_DIRECTORY });
    expect(await sourceHash()).toBe(before);
  });
});

describe("connection safety guard", () => {
  test.each([
    ["mongodb://127.0.0.1:27017/ecommerce_store", true],
    ["mongodb://localhost/db", true],
    ["postgresql://user:secret@127.0.0.1:5432/ecommerce", true],
    ["mongodb://[::1]:27017/db", true],
    ["mongodb+srv://user:secret@cluster0.example.mongodb.net/db", false],
    ["mongodb://user:secret@db.example.com:27017/db", false],
    ["mongodb://127.0.0.1:27017,db2.example.com:27017/db?replicaSet=rs0", false],
    ["postgresql://user:secret@dpg-abc.oregon-postgres.render.com/db", false],
    ["", false],
  ])("isLocalConnection(%j) is %s", (uri, local) => {
    expect(isLocalConnection(uri)).toBe(local);
  });

  test("connection descriptions never include credentials", () => {
    expect(describeConnection("postgresql://user:secret@127.0.0.1:5432/ecommerce?sslmode=require")).toBe("127.0.0.1/ecommerce");
    expect(connectionHosts("mongodb://u:p@a.example.com:1,b.example.com:2/db")).toEqual(["a.example.com", "b.example.com"]);
  });
});

// Keeps the MigrationPlan type in use for readers of this file.
export type { MigrationPlan };
