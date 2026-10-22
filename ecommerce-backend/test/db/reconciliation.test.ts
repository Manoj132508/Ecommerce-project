// R31 proof of concept: rolling back to MongoDB after writes were accepted on
// PostgreSQL. Disposable databases only: an in-memory MongoDB (a fresh
// database per test) and a fresh database in the throwaway PostgreSQL
// container. Post-cutover writes go through the PostgreSQL-backed API; the
// result is checked through the MongoDB-backed API, as a rollback would serve it.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { importPlan } from "../../db/dataMigration/importer.js";
import { buildPlan } from "../../db/dataMigration/plan.js";
import { extractSource } from "../../db/dataMigration/source.js";
import { migrate } from "../../db/migrator.js";
import {
  applyReconciliation,
  planReconciliation,
  ReconciliationError,
  SIDE_COLLECTIONS,
  verifyRollbackTarget,
} from "../../db/reconciliation/reverse.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const { ObjectId } = mongoose.mongo;

process.env.JWT_SECRET = "reconciliation-tests-only-secret";

const ALL_POSTGRES: DataSourceConfig = {
  deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
};

const SOCKS = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const BALL = "15b6fc6f-327a-4ec4-896f-486349e85a3d";
const SHIRT = "83d4ca15-0f35-48f5-b7a3-1ea210004f2e";
const DELETED_PRODUCT = "99999999-9999-4999-8999-999999999999";
const ADMIN_ID = "6aa7f3b07e1b7e1411434c6b";
const SHOPPER_ID = "6ad8b3e08afe6f8ad3173cac";
const DELETED_USER_ID = "6aa7f3b07e1b7e1411434c6c";
const ORDER_LEGACY = "0e4111b0-cf69-448b-a3d1-ca2f5d6ba563";
const ORDER_OWNED = "813e5e9d-bba1-40a3-8fde-cf6673a7f1e7";
const ORDER_ORPHAN = "ce92c427-efb1-4cd1-a8f0-3ef49de4c67c";
const PASSWORD = "user-password-123";
const NEW_PASSWORD = "new-user-password-456";
const CUSTOMER = { fullName: "Ada Lovelace", email: "ada@example.com", phone: "0123 456", address: "1 Analytical Way", city: "London", postalCode: "N1 1AA", country: "UK" };
const PRODUCT_FORM = {
  name: "Water Bottle", description: "Keeps water cold.", howItWorks: "Fill it.", careInstructions: "Hand wash.",
  highlights: ["Steel"], image: "images/products/bottle.jpg", category: "Kitchen", price: 12.5, stock: 3,
};
const MAIN_COLLECTIONS = ["deliveryOptions", "products", "users", "orders", "cartItems"];
const at = (iso: string) => new Date(iso);

interface Doc {
  _id: string | mongoose.mongo.ObjectId;
  [field: string]: unknown;
}

let mongoServer: MongoMemoryServer;
let pg: TestDatabase;
let databaseCounter = 0;

const mongoApp = () => request(createApp());
const pgApp = () => request(createApp({ repositories: createRepositories(ALL_POSTGRES, pg.pool) }));
const auth = (id: string) => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET ?? "", { expiresIn: "1h" })}` });

function mongoDb(): mongoose.mongo.Db {
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB not connected");
  return db;
}

const mainHash = async () => JSON.stringify((await mongoDb().command({ dbHash: 1, collections: MAIN_COLLECTIONS })).collections);
const count = (collection: string) => mongoDb().collection(collection).countDocuments();

async function seedMongo() {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const insert = (name: string, documents: Doc[]) => mongoDb().collection<Doc>(name).insertMany(documents);
  await insert("deliveryOptions", [
    { _id: "1", deliveryDays: 7, priceCents: 0, createdAt: at("2024-06-01T09:00:00.001Z"), updatedAt: at("2024-06-01T09:00:00.001Z") },
    { _id: "2", deliveryDays: 3, priceCents: 499, createdAt: at("2024-06-01T09:00:00.002Z"), updatedAt: at("2024-06-01T09:00:00.002Z") },
    { _id: "3", deliveryDays: 1, priceCents: 999, createdAt: at("2024-06-01T09:00:00.003Z"), updatedAt: at("2024-06-01T09:00:00.003Z") },
  ]);
  await insert("products", [
    // The real seed shape: no stock field (MongoDB reports 0).
    { _id: SOCKS, image: "images/products/socks.jpg", name: "Socks", description: "Comfortable socks.", howItWorks: "Wear them.", highlights: ["Cotton"], careInstructions: "Machine wash.", category: "Clothing", rating: { stars: 4.5, count: 87 }, priceCents: 1090, keywords: ["socks"], createdAt: at("2024-06-02T10:00:00.123Z"), updatedAt: at("2024-07-02T10:00:00.456Z") },
    { _id: BALL, image: "images/products/ball.jpg", name: "Basketball", description: "A ball.", howItWorks: "Bounce it.", highlights: ["Composite"], careInstructions: "Wipe clean.", category: "Sports", stock: 5, rating: { stars: 4, count: 127 }, priceCents: 2095, keywords: ["sports"], createdAt: at("2024-06-02T10:00:01.000Z"), updatedAt: at("2024-06-02T10:00:01.000Z") },
    { _id: SHIRT, image: "images/products/shirt.jpg", name: "T-Shirt", description: "Plain.", howItWorks: "Wear it.", highlights: ["2 pack"], careInstructions: "Wash cold.", category: "Clothing", stock: 12, rating: { stars: 3.5, count: 56 }, priceCents: 799, keywords: ["tshirts"], createdAt: at("2024-06-02T10:00:02.000Z"), updatedAt: at("2024-06-02T10:00:02.000Z") },
  ]);
  await insert("users", [
    { _id: new ObjectId(ADMIN_ID), name: "Admin", email: "admin@example.com", password: hash, isAdmin: true, createdAt: at("2024-06-03T08:00:00Z"), updatedAt: at("2024-06-03T08:00:00Z") },
    { _id: new ObjectId(SHOPPER_ID), name: "Shopper", email: "shopper@example.com", password: hash, isAdmin: false, createdAt: at("2024-06-04T08:00:00Z"), updatedAt: at("2024-06-04T08:00:00Z") },
  ]);
  await insert("orders", [
    { _id: ORDER_LEGACY, orderTimeMs: 1_718_013_600_000, totalCostCents: 3506, products: [{ productId: DELETED_PRODUCT, quantity: 2, estimatedDeliveryTimeMs: 1_718_618_400_000 }, { productId: SOCKS, quantity: 1, estimatedDeliveryTimeMs: 1_718_618_400_000 }], createdAt: at("2024-06-10T10:00:00Z"), updatedAt: at("2024-06-10T10:00:00Z") },
    { _id: ORDER_OWNED, userId: SHOPPER_ID, customer: CUSTOMER, orderTimeMs: 1_790_167_054_005, totalCostCents: 5801, products: [{ productId: SOCKS, product: { id: SOCKS, image: "images/products/socks.jpg", name: "Socks (as sold)", priceCents: 1090, description: "Comfortable socks.", category: "Clothing" }, quantity: 2, estimatedDeliveryTimeMs: 1_790_771_854_005 }, { productId: BALL, quantity: 1, estimatedDeliveryTimeMs: 1_790_253_454_005 }], createdAt: at("2026-09-24T12:37:34.005Z"), updatedAt: at("2026-09-24T12:37:34.009Z") },
    // The owner was deleted: imported with NULL ownership; MongoDB keeps the dangling id.
    { _id: ORDER_ORPHAN, userId: DELETED_USER_ID, customer: CUSTOMER, orderTimeMs: 1_750_000_000_000, totalCostCents: 1199, products: [{ productId: SHIRT, product: { id: SHIRT, image: "images/products/shirt.jpg", name: "T-Shirt", priceCents: 799 }, quantity: 1, estimatedDeliveryTimeMs: 1_750_259_200_000 }], createdAt: at("2025-06-15T15:06:40Z"), updatedAt: at("2025-06-15T15:06:40Z") },
  ]);
  // The legacy shared cart (D1: never imported, and never overwritten on the way back).
  await insert("cartItems", [
    { _id: new ObjectId(), productId: SHIRT, quantity: 1, deliveryOptionId: "1", createdAt: at("2026-10-01T00:00:00Z"), updatedAt: at("2026-10-01T00:00:00Z") },
  ]);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
});

afterAll(async () => {
  await mongoServer.stop();
});

beforeEach(async () => {
  databaseCounter += 1;
  await mongoose.connect(`${mongoServer.getUri()}reconciliation_${databaseCounter}`);
  // The unique email index, as in the real database.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await seedMongo();

  pg = await createTestDatabase();
  await migrate(pg.pool, MIGRATIONS_DIRECTORY);
  const report = await importPlan(pg.pool, buildPlan(await extractSource(`${mongoServer.getUri()}reconciliation_${databaseCounter}`)), {
    migrationsDirectory: MIGRATIONS_DIRECTORY, sourceConnection: "test", targetConnection: "test",
  });
  expect(report.outcome).toBe("succeeded");
});

afterEach(async () => {
  await mongoose.disconnect();
  await pg.drop();
});

interface CutoverWrites {
  nora: { id: string; email: string };
  otto: { id: string };
  noraOrder: Doc;
  createdProductId: string;
}

/** Real traffic after all domains moved to PostgreSQL. MongoDB receives nothing. */
async function acceptWritesOnPostgres(): Promise<CutoverWrites> {
  const register = async (name: string, email: string) => {
    const response = await pgApp().post("/api/auth/register").send({ name, email, password: NEW_PASSWORD });
    expect(response.status).toBe(201);
    return { id: String(response.body._id), email };
  };
  const nora = await register("Nora", "nora@example.com");
  const otto = await register("Otto", "otto@example.com");

  expect((await pgApp().post("/api/cart-items").set(auth(nora.id)).send({ productId: SOCKS, quantity: 2 })).status).toBe(201);
  expect((await pgApp().post("/api/cart-items").set(auth(nora.id)).send({ productId: BALL, quantity: 1 })).status).toBe(201);
  const placed = await pgApp().post("/api/orders").set(auth(nora.id)).send({ customer: { ...CUSTOMER, fullName: "Nora N", email: nora.email } });
  expect(placed.status).toBe(201);

  // Status changes: the new order is shipped; a legacy order is closed.
  for (const status of ["processing", "shipped"]) {
    expect((await pgApp().patch(`/api/orders/${placed.body.id}/status`).set(auth(ADMIN_ID)).send({ status, reason: `test ${status}` })).status).toBe(200);
  }
  expect((await pgApp().patch(`/api/orders/${ORDER_LEGACY}/status`).set(auth(ADMIN_ID)).send({ status: "delivered", reason: "confirmed by courier" })).status).toBe(200);

  // Otto leaves a cart (Nora's was emptied by checkout).
  expect((await pgApp().post("/api/cart-items").set(auth(otto.id)).send({ productId: SHIRT, quantity: 3 })).status).toBe(201);

  // Catalogue: one product edited, one created, one deleted.
  expect((await pgApp().put(`/api/products/${BALL}`).set(auth(ADMIN_ID)).send({ ...PRODUCT_FORM, name: "Basketball Pro", category: "Sports", price: 25 })).status).toBe(200);
  const created = await pgApp().post("/api/products").set(auth(ADMIN_ID)).send(PRODUCT_FORM);
  expect(created.status).toBe(201);
  expect((await pgApp().delete(`/api/products/${SHIRT}`).set(auth(ADMIN_ID))).status).toBe(200);

  const noraOrder = (await pgApp().get(`/api/orders/${placed.body.id}`).set(auth(nora.id))).body;
  return { nora, otto, noraOrder, createdProductId: String(created.body.id) };
}

const login = (email: string, password: string) => mongoApp().post("/api/auth/login").send({ email, password });
const withoutStatus = (order: Doc) => Object.fromEntries(Object.entries(order).filter(([key]) => key !== "status"));

// ----------------------------------------------------------------- tests
describe("rollback without reconciliation", () => {
  test("hides accepted writes, and the readiness gate refuses the older MongoDB", async () => {
    const writes = await acceptWritesOnPostgres();

    // What a plain rollback would serve: the new customer and their order are gone.
    expect((await login(writes.nora.email, NEW_PASSWORD)).status).toBe(401);
    expect((await mongoApp().get("/api/orders").set(auth(ADMIN_ID))).body).toHaveLength(3);

    const readiness = await verifyRollbackTarget(pg.pool, mongoDb());
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons).toEqual(expect.arrayContaining([
      "1 products exist only in PostgreSQL (MongoDB is older)",
      "2 users exist only in PostgreSQL (MongoDB is older)",
      "1 orders exist only in PostgreSQL (MongoDB is older)",
      "1 products are newer in PostgreSQL",
      "no completed reconciliation run",
    ]));
  });

  test("planning is read-only on both databases", async () => {
    await acceptWritesOnPostgres();
    const before = await mainHash();
    const plan = await planReconciliation(pg.pool, mongoDb());
    expect(await mainHash()).toBe(before);
    expect(await count(SIDE_COLLECTIONS.runs)).toBe(0);
    expect(plan.inserts.users).toHaveLength(2);
    expect(plan.issues).toEqual([
      expect.objectContaining({ severity: "warning", domain: "products", id: SHIRT, code: "deleted-after-cutover" }),
    ]);
  });
});

describe("reverse reconciliation", () => {
  test("copies new users, orders, statuses, carts and catalogue edits; the MongoDB app then serves them", async () => {
    const writes = await acceptWritesOnPostgres();
    const legacyOrdersBefore = await mongoDb().collection("orders").find({}).sort({ _id: 1 }).toArray();

    const report = await applyReconciliation(pg.pool, mongoDb());
    expect(report.outcome).toBe("completed");
    expect(report.written).toEqual({ deliveryOptions: 0, products: 1, users: 2, orders: 1, productUpdates: 1, orderStatus: 2, carts: 1 });
    expect(await verifyRollbackTarget(pg.pool, mongoDb())).toMatchObject({ ready: true, reasons: [] });

    // Rolled back: new users log in with their existing passwords (the hash was not re-hashed).
    const noraLogin = await login(writes.nora.email, NEW_PASSWORD);
    expect(noraLogin.status).toBe(200);
    expect(noraLogin.body._id).toBe(writes.nora.id);
    expect((await login("otto@example.com", NEW_PASSWORD)).body._id).toBe(writes.otto.id);
    expect((await login(writes.nora.email, "wrong-password-000")).status).toBe(401);

    // Nora's order, as sold: identical to PostgreSQL's response apart from the status field.
    const mongoOrder = await mongoApp().get(`/api/orders/${String(writes.noraOrder.id)}`).set(auth(writes.nora.id));
    expect(mongoOrder.status).toBe(200);
    expect(mongoOrder.body).toEqual(withoutStatus(writes.noraOrder));
    expect((await mongoApp().get("/api/orders").set(auth(writes.nora.id))).body).toHaveLength(1);
    expect((await mongoApp().get("/api/orders").set(auth(ADMIN_ID))).body).toHaveLength(4);

    // Existing orders were never touched.
    const legacyOrdersAfter = await mongoDb().collection<Doc>("orders").find({ _id: { $in: [ORDER_LEGACY, ORDER_OWNED, ORDER_ORPHAN] } }).sort({ _id: 1 }).toArray();
    expect(legacyOrdersAfter).toEqual(legacyOrdersBefore);

    // Status history is preserved beside the orders, not lost.
    const status = await mongoDb().collection<Doc>(SIDE_COLLECTIONS.orderStatus).findOne({ _id: String(writes.noraOrder.id) });
    expect(status).toMatchObject({ status: "shipped" });
    expect(Array.isArray(status?.events) ? status.events.map((event: Doc) => event.toStatus) : []).toEqual(["placed", "processing", "shipped"]);
    expect(await mongoDb().collection<Doc>(SIDE_COLLECTIONS.orderStatus).findOne({ _id: ORDER_LEGACY })).toMatchObject({ status: "delivered" });

    // Per-user carts are archived, never merged into the shared cart.
    expect((await mongoApp().get("/api/cart-items")).body).toEqual([expect.objectContaining({ productId: SHIRT, quantity: 1 })]);
    expect(await mongoDb().collection<Doc>(SIDE_COLLECTIONS.carts).findOne({ _id: writes.otto.id })).toMatchObject({ items: [{ productId: SHIRT, quantity: 3 }] });

    // Catalogue: the edit and the new product are served; the old version is archived;
    // the product deleted on PostgreSQL is reported, not deleted.
    const products: Doc[] = (await mongoApp().get("/api/products")).body;
    expect(products.find((product) => product.id === BALL)).toMatchObject({ name: "Basketball Pro", priceCents: 2500 });
    expect(products.map((product) => product.id)).toEqual(expect.arrayContaining([writes.createdProductId, SHIRT]));
    expect(await mongoDb().collection<Doc>(SIDE_COLLECTIONS.previousProducts).findOne({ productId: BALL })).toMatchObject({ product: { name: "Basketball", priceCents: 2095 } });
    expect(report.issues).toEqual([expect.objectContaining({ id: SHIRT, code: "deleted-after-cutover" })]);
  });

  test("re-running is a no-op: no duplicate users, orders or archives", async () => {
    await acceptWritesOnPostgres();
    await applyReconciliation(pg.pool, mongoDb());
    const hash = await mainHash();
    const sizes = await Promise.all([...MAIN_COLLECTIONS, SIDE_COLLECTIONS.orderStatus, SIDE_COLLECTIONS.carts, SIDE_COLLECTIONS.previousProducts].map(count));

    const again = await applyReconciliation(pg.pool, mongoDb());
    expect(again.outcome).toBe("completed");
    expect(again.written).toMatchObject({ products: 0, users: 0, orders: 0, productUpdates: 0 });
    expect(await mainHash()).toBe(hash);
    expect(await Promise.all([...MAIN_COLLECTIONS, SIDE_COLLECTIONS.orderStatus, SIDE_COLLECTIONS.carts, SIDE_COLLECTIONS.previousProducts].map(count))).toEqual(sizes);
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(true);
  });

  test("an interrupted run is not ready, and resuming completes it without duplicates", async () => {
    const writes = await acceptWritesOnPostgres();
    await expect(applyReconciliation(pg.pool, mongoDb(), {
      beforeWrite: (step) => { if (step === "orders") throw new Error("connection lost"); },
    })).rejects.toThrow("connection lost");

    // Users were copied, the order was not: the gate refuses.
    expect(await mongoDb().collection("users").countDocuments({ _id: new ObjectId(writes.nora.id) })).toBe(1);
    const halfway = await verifyRollbackTarget(pg.pool, mongoDb());
    expect(halfway.ready).toBe(false);
    expect(halfway.reasons).toEqual(expect.arrayContaining(["1 orders exist only in PostgreSQL (MongoDB is older)", "no completed reconciliation run"]));
    expect(await mongoDb().collection(SIDE_COLLECTIONS.runs).findOne({ outcome: "failed" })).not.toBeNull();

    const resumed = await applyReconciliation(pg.pool, mongoDb());
    expect(resumed.written).toMatchObject({ users: 0, orders: 1, productUpdates: 0 });
    expect(await count("users")).toBe(4);
    expect(await count("orders")).toBe(4);
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(true);
  });
});

describe("verification failures block the rollback", () => {
  test("a differing order is a conflict: nothing is written and the order is never modified", async () => {
    await acceptWritesOnPostgres();
    await mongoDb().collection<Doc>("orders").updateOne({ _id: ORDER_OWNED }, { $set: { totalCostCents: 1 } });
    const before = await mainHash();

    const failure = await applyReconciliation(pg.pool, mongoDb()).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ReconciliationError);
    expect(failure instanceof ReconciliationError ? failure.issues : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", domain: "orders", id: ORDER_OWNED, code: "conflict" }),
    ]));
    expect(await mainHash()).toBe(before);
    expect(await mongoDb().collection<Doc>("orders").findOne({ _id: ORDER_OWNED })).toMatchObject({ totalCostCents: 1 });
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(false);
  });

  test("an email already used by a different MongoDB user blocks the rollback", async () => {
    await acceptWritesOnPostgres();
    const intruder = new ObjectId();
    await mongoDb().collection<Doc>("users").insertOne({ _id: intruder, name: "Other", email: "nora@example.com", password: "x", isAdmin: false });

    const failure = await applyReconciliation(pg.pool, mongoDb()).catch((error: unknown) => error);
    expect(failure instanceof ReconciliationError ? failure.issues.map((issue) => issue.code) : []).toEqual(
      expect.arrayContaining(["duplicate-email", "unexpected-in-mongo"]),
    );
    expect(await mongoDb().collection("users").countDocuments({ email: "nora@example.com" })).toBe(1);
  });

  test("writes during the run are detected (writes not frozen), and the run must be repeated", async () => {
    await acceptWritesOnPostgres();
    let wrote = false;
    await expect(applyReconciliation(pg.pool, mongoDb(), {
      beforeWrite: async () => {
        if (wrote) return;
        wrote = true;
        expect((await pgApp().post("/api/auth/register").send({ name: "Late", email: "late@example.com", password: NEW_PASSWORD })).status).toBe(201);
      },
    })).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "postgres-changed" })] });
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(false);

    // With writes frozen, a second run picks up the late user too.
    expect((await applyReconciliation(pg.pool, mongoDb())).written.users).toBe(1);
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(true);
    expect((await login("late@example.com", NEW_PASSWORD)).status).toBe(200);
  });

  test("a completed run goes stale as soon as PostgreSQL accepts another write", async () => {
    const writes = await acceptWritesOnPostgres();
    await applyReconciliation(pg.pool, mongoDb());
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(true);

    expect((await pgApp().post("/api/cart-items").set(auth(writes.nora.id)).send({ productId: SOCKS, quantity: 1 })).status).toBe(201);
    const stale = await verifyRollbackTarget(pg.pool, mongoDb());
    expect(stale.ready).toBe(false);
    expect(stale.reasons).toEqual(expect.arrayContaining(["cart archive differs from PostgreSQL", "PostgreSQL changed since the last completed run"]));
  });
});

describe("overlapping runs", () => {
  test("a second run is refused while one is in progress; neither duplicates anything", async () => {
    await acceptWritesOnPostgres();
    let second: Promise<unknown> = Promise.resolve();
    let started = false;
    const first = applyReconciliation(pg.pool, mongoDb(), {
      beforeWrite: () => {
        if (started) return;
        started = true;
        second = applyReconciliation(pg.pool, mongoDb()).catch((error: unknown) => error);
      },
    });

    expect((await first).outcome).toBe("completed");
    const refused = await second;
    expect(refused).toBeInstanceOf(ReconciliationError);
    expect(refused instanceof Error ? refused.message : "").toContain("in progress");
    expect(await count("users")).toBe(4);
    expect(await count("orders")).toBe(4);
    expect((await verifyRollbackTarget(pg.pool, mongoDb())).ready).toBe(true);
  });
});
