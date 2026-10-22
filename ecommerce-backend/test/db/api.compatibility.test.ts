// Phase 3C API compatibility: the same requests against a MongoDB-backed app
// and a PostgreSQL-backed app holding the same data (copied with the Phase 3B
// importer, so ids match). Responses must be equal, apart from the intentional
// differences listed in MIGRATION_PLAN.md, each asserted explicitly below.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { importPlan } from "../../db/dataMigration/importer.js";
import { buildPlan } from "../../db/dataMigration/plan.js";
import { extractSource } from "../../db/dataMigration/source.js";
import { migrate } from "../../db/migrator.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const { ObjectId } = mongoose.mongo;

// Set at load time: the request tables below sign tokens when the module loads.
process.env.JWT_SECRET = "compatibility-tests-only-secret";

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
const CUSTOMER = { fullName: "Ada Lovelace", email: "ada@example.com", phone: "0123 456", address: "1 Analytical Way", city: "London", postalCode: "N1 1AA", country: "UK" };
const at = (iso: string) => new Date(iso);

type Json = Record<string, unknown>;
type Doc = Record<string, unknown>;

let mongoServer: MongoMemoryServer;
let mongoUri: string;
let pg: TestDatabase;

const mongoApp = () => request(createApp());
const pgApp = () => request(createApp({ repositories: createRepositories(ALL_POSTGRES, pg.pool) }));
const auth = (id: string) => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET ?? "", { expiresIn: "30d" })}` });

async function seedMongo() {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const db = mongoose.connection.db;
  if (!db) throw new Error("MongoDB not connected");
  const insert = (name: string, documents: Doc[]) => db.collection<Doc>(name).insertMany(documents);

  await insert("deliveryOptions", [
    { _id: "1", deliveryDays: 7, priceCents: 0, createdAt: at("2024-06-01T09:00:00.001Z"), updatedAt: at("2024-06-01T09:00:00.001Z") },
    { _id: "2", deliveryDays: 3, priceCents: 499, createdAt: at("2024-06-01T09:00:00.002Z"), updatedAt: at("2024-06-01T09:00:00.002Z") },
    { _id: "3", deliveryDays: 1, priceCents: 999, createdAt: at("2024-06-01T09:00:00.003Z"), updatedAt: at("2024-06-01T09:00:00.003Z") },
  ]);
  await insert("products", [
    // The real seed shape: no stock field (MongoDB reports 0).
    { _id: SOCKS, image: "images/products/socks.jpg", name: "Socks", description: "Comfortable socks.", howItWorks: "Wear them.", highlights: ["Cotton", "6 pairs"], careInstructions: "Machine wash.", category: "Clothing", rating: { stars: 4.5, count: 87 }, priceCents: 1090, keywords: ["socks", "sports"], createdAt: at("2024-06-02T10:00:00.123Z"), updatedAt: at("2024-07-02T10:00:00.456Z") },
    { _id: BALL, image: "images/products/ball.jpg", name: "Basketball", description: "A ball.", howItWorks: "Bounce it.", highlights: ["Composite"], careInstructions: "Wipe clean.", category: "Sports", rating: { stars: 4, count: 127 }, priceCents: 2095, keywords: ["sports"], createdAt: at("2024-06-02T10:00:01.000Z"), updatedAt: at("2024-06-02T10:00:01.000Z") },
    { _id: SHIRT, image: "images/products/shirt.jpg", name: "T-Shirt", description: "Plain.", howItWorks: "Wear it.", highlights: ["2 pack"], careInstructions: "Wash cold.", category: "Clothing", stock: 12, rating: { stars: 3.5, count: 56 }, priceCents: 799, keywords: ["tshirts"], createdAt: at("2024-06-02T10:00:02.000Z"), updatedAt: at("2024-06-02T10:00:02.000Z") },
  ]);
  await insert("users", [
    { _id: new ObjectId(ADMIN_ID), name: "Admin", email: "admin@example.com", password: hash, isAdmin: true, createdAt: at("2024-06-03T08:00:00Z"), updatedAt: at("2024-06-03T08:00:00Z") },
    { _id: new ObjectId(SHOPPER_ID), name: "Shopper", email: "shopper@example.com", password: hash, isAdmin: false, createdAt: at("2024-06-04T08:00:00Z"), updatedAt: at("2024-06-04T08:00:00Z") },
  ]);
  await insert("orders", [
    { _id: ORDER_LEGACY, orderTimeMs: 1_718_013_600_000, totalCostCents: 3506, products: [{ productId: DELETED_PRODUCT, quantity: 2, estimatedDeliveryTimeMs: 1_718_618_400_000 }, { productId: SOCKS, quantity: 1, estimatedDeliveryTimeMs: 1_718_618_400_000 }], createdAt: at("2024-06-10T10:00:00Z"), updatedAt: at("2024-06-10T10:00:00Z") },
    { _id: ORDER_OWNED, userId: SHOPPER_ID, customer: CUSTOMER, orderTimeMs: 1_790_167_054_005, totalCostCents: 5801, products: [{ productId: SOCKS, product: { id: SOCKS, image: "images/products/socks.jpg", name: "Socks (as sold)", priceCents: 1090, description: "Comfortable socks.", category: "Clothing" }, quantity: 2, estimatedDeliveryTimeMs: 1_790_771_854_005 }, { productId: BALL, quantity: 1, estimatedDeliveryTimeMs: 1_790_253_454_005 }], createdAt: at("2026-09-24T12:37:34.005Z"), updatedAt: at("2026-09-24T12:37:34.009Z") },
    { _id: ORDER_ORPHAN, userId: DELETED_USER_ID, customer: CUSTOMER, orderTimeMs: 1_750_000_000_000, totalCostCents: 1199, products: [{ productId: SHIRT, product: { id: SHIRT, image: "images/products/shirt.jpg", name: "T-Shirt", priceCents: 799, description: "", category: "" }, quantity: 1, estimatedDeliveryTimeMs: 1_750_259_200_000 }], createdAt: at("2025-06-15T15:06:40Z"), updatedAt: at("2025-06-15T15:06:40Z") },
  ]);
}

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  mongoUri = `${mongoServer.getUri()}compatibility`;
  await mongoose.connect(mongoUri);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
  await seedMongo();

  pg = await createTestDatabase();
  await migrate(pg.pool, MIGRATIONS_DIRECTORY);
  const report = await importPlan(pg.pool, buildPlan(await extractSource(mongoUri)), {
    migrationsDirectory: MIGRATIONS_DIRECTORY, sourceConnection: "test", targetConnection: "test",
  });
  expect(report.outcome).toBe("succeeded");
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
  await pg.drop();
});

/** Removes the documented, intentional differences before comparing orders. */
function withoutIntentionalOrderDifferences(value: unknown, side: "mongo" | "pg"): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutIntentionalOrderDifferences(item, side));
  if (typeof value !== "object" || value === null) return value;
  const order: Json = { ...value };
  // Difference 1: PostgreSQL orders carry an operational status (null for legacy).
  if (side === "pg") delete order.status;
  // Difference 2: an order whose owner was deleted is imported with NULL ownership
  // (approved Phase 3B decision); MongoDB still shows the dangling userId.
  if (side === "mongo" && order.userId === DELETED_USER_ID) delete order.userId;
  return order;
}

const READ_REQUESTS: [string, Record<string, string>][] = [
  ["/api/products", {}],
  ["/api/delivery-options", {}],
  ["/api/auth/profile", auth(ADMIN_ID)],
  ["/api/auth/profile", auth(SHOPPER_ID)],
  ["/api/orders", auth(SHOPPER_ID)],
  ["/api/orders?expand=products", auth(SHOPPER_ID)],
  ["/api/orders/not-a-uuid", auth(ADMIN_ID)],
  ["/api/orders/00000000-0000-4000-8000-000000000000", auth(ADMIN_ID)],
  [`/api/orders/${ORDER_LEGACY}`, auth(SHOPPER_ID)],
];

describe("read endpoints return equal responses", () => {
  test.each(READ_REQUESTS)("GET %s", async (path, headers) => {
    const [mongo, pgResponse] = await Promise.all([mongoApp().get(path).set(headers), pgApp().get(path).set(headers)]);
    expect(pgResponse.status).toBe(mongo.status);
    expect(withoutIntentionalOrderDifferences(pgResponse.body, "pg")).toEqual(withoutIntentionalOrderDifferences(mongo.body, "mongo"));
  });

  test.each([
    ["/api/orders"],
    ["/api/orders?expand=products"],
    ...[ORDER_LEGACY, ORDER_OWNED, ORDER_ORPHAN].flatMap((id) => [[`/api/orders/${id}`], [`/api/orders/${id}?expand=products`]]),
  ])("GET %s as admin (legacy, owned and orphaned orders)", async (path) => {
    const [mongo, pgResponse] = await Promise.all([mongoApp().get(path).set(auth(ADMIN_ID)), pgApp().get(path).set(auth(ADMIN_ID))]);
    expect(pgResponse.status).toBe(mongo.status);
    expect(withoutIntentionalOrderDifferences(pgResponse.body, "pg")).toEqual(withoutIntentionalOrderDifferences(mongo.body, "mongo"));
  });

  test("delivery estimates agree (to the minute)", async () => {
    const path = "/api/delivery-options?expand=estimatedDeliveryTime";
    const [mongo, pgResponse] = await Promise.all([mongoApp().get(path), pgApp().get(path)]);
    const minutes = (body: Json[]) => body.map(({ estimatedDeliveryTimeMs, ...rest }) => ({ ...rest, minute: Math.round(Number(estimatedDeliveryTimeMs) / 60_000) }));
    expect(minutes(pgResponse.body)).toEqual(minutes(mongo.body));
  });
});

describe("invalid input is rejected identically", () => {
  const INVALID: [string, string, Json | undefined, Record<string, string>][] = [
    ["post", "/api/auth/register", { name: "", email: "x", password: "short" }, {}],
    ["post", "/api/auth/register", { name: "A", email: "admin@example.com", password: PASSWORD }, {}],
    ["post", "/api/auth/login", { email: { $ne: null }, password: "x" }, {}],
    ["post", "/api/auth/login", { email: "admin@example.com", password: "wrong-password" }, {}],
    ["get", "/api/auth/profile", undefined, { Authorization: "Bearer not-a-jwt" }],
    ["post", "/api/products", {}, auth(ADMIN_ID)],
    ["post", "/api/products", {}, auth(SHOPPER_ID)],
    ["put", "/api/products/not-a-uuid", {}, auth(ADMIN_ID)],
    ["delete", "/api/products/00000000-0000-4000-8000-000000000000", undefined, auth(ADMIN_ID)],
    ["post", "/api/cart-items", { productId: { $ne: null }, quantity: 1 }, auth(SHOPPER_ID)],
    ["post", "/api/cart-items", { productId: "00000000-0000-4000-8000-000000000000", quantity: 1 }, auth(SHOPPER_ID)],
    ["post", "/api/cart-items", { productId: SOCKS, quantity: 11 }, auth(SHOPPER_ID)],
    ["put", "/api/cart-items/not-a-uuid", { quantity: 1 }, auth(SHOPPER_ID)],
    ["post", "/api/orders", {}, auth(SHOPPER_ID)],
    ["post", "/api/orders", { customer: { fullName: "Partial" } }, auth(SHOPPER_ID)],
  ];

  test.each(INVALID)("%s %s", async (method, path, body, headers) => {
    const send = (agent: ReturnType<typeof mongoApp>) => {
      const call = method === "post" ? agent.post(path) : method === "put" ? agent.put(path) : method === "delete" ? agent.delete(path) : agent.get(path);
      return body === undefined ? call.set(headers) : call.set(headers).send(body);
    };
    const [mongo, pgResponse] = await Promise.all([send(mongoApp()), send(pgApp())]);
    expect([pgResponse.status, pgResponse.body]).toEqual([mongo.status, mongo.body]);
  });
});

describe("write endpoints produce equal results", () => {
  const ignore = (body: Json, ...keys: string[]) => Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));

  test("admin product create, update and delete", async () => {
    const form = { name: "Kettle", price: "19.99", description: "Boils.", howItWorks: "Fill.", highlights: "1.7 l, Auto off", careInstructions: "Descale.", image: "images/kettle.jpg", category: "Kitchen", stock: "3" };
    const [mongo, pgResponse] = await Promise.all([
      mongoApp().post("/api/products").set(auth(ADMIN_ID)).send(form),
      pgApp().post("/api/products").set(auth(ADMIN_ID)).send(form),
    ]);
    expect(pgResponse.status).toBe(mongo.status);
    expect(ignore(pgResponse.body, "id", "createdAt", "updatedAt")).toEqual(ignore(mongo.body, "id", "createdAt", "updatedAt"));

    const [mongoUpdate, pgUpdate] = await Promise.all([
      mongoApp().put(`/api/products/${mongo.body.id}`).set(auth(ADMIN_ID)).send({ ...form, price: "21" }),
      pgApp().put(`/api/products/${pgResponse.body.id}`).set(auth(ADMIN_ID)).send({ ...form, price: "21" }),
    ]);
    expect(ignore(pgUpdate.body, "id", "createdAt", "updatedAt")).toEqual(ignore(mongoUpdate.body, "id", "createdAt", "updatedAt"));

    const [mongoDelete, pgDelete] = await Promise.all([
      mongoApp().delete(`/api/products/${mongo.body.id}`).set(auth(ADMIN_ID)),
      pgApp().delete(`/api/products/${pgResponse.body.id}`).set(auth(ADMIN_ID)),
    ]);
    expect([pgDelete.status, Object.keys(pgDelete.body)]).toEqual([mongoDelete.status, Object.keys(mongoDelete.body)]);
  });

  test("register and login", async () => {
    const details = { name: " New ", email: " New@Example.com ", password: PASSWORD };
    const [mongo, pgResponse] = await Promise.all([
      mongoApp().post("/api/auth/register").send(details),
      pgApp().post("/api/auth/register").send(details),
    ]);
    expect(pgResponse.status).toBe(mongo.status);
    expect(ignore(pgResponse.body, "_id", "token")).toEqual(ignore(mongo.body, "_id", "token"));
    expect(pgResponse.body._id).toMatch(/^[0-9a-f]{24}$/);

    const [mongoLogin, pgLogin] = await Promise.all([
      mongoApp().post("/api/auth/login").send({ email: "new@example.com", password: PASSWORD }),
      pgApp().post("/api/auth/login").send({ email: "new@example.com", password: PASSWORD }),
    ]);
    expect(ignore(pgLogin.body, "_id", "token")).toEqual(ignore(mongoLogin.body, "_id", "token"));
  });

  test("cart, payment summary and checkout give the same lines, totals and snapshots", async () => {
    // MongoDB's shared cart is emptied first (the fixture's legacy lines are excluded from PostgreSQL).
    await mongoose.connection.db?.collection("cartItems").deleteMany({});

    const lines: [string, number][] = [[SOCKS, 2], [BALL, 1]];
    for (const [productId, quantity] of lines) {
      await mongoApp().post("/api/cart-items").send({ productId, quantity });
      await pgApp().post("/api/cart-items").set(auth(SHOPPER_ID)).send({ productId, quantity });
    }
    await mongoApp().put(`/api/cart-items/${BALL}`).send({ deliveryOptionId: "3" });
    await pgApp().put(`/api/cart-items/${BALL}`).set(auth(SHOPPER_ID)).send({ deliveryOptionId: "3" });

    const [mongoCart, pgCart] = await Promise.all([
      mongoApp().get("/api/cart-items?expand=product"),
      pgApp().get("/api/cart-items?expand=product").set(auth(SHOPPER_ID)),
    ]);
    const lineView = (lines: Json[]) => lines.map((line) => ignore(line, "id", "createdAt", "updatedAt"));
    expect(lineView(pgCart.body)).toEqual(lineView(mongoCart.body));

    const [mongoSummary, pgSummary] = await Promise.all([
      mongoApp().get("/api/payment-summary"),
      pgApp().get("/api/payment-summary").set(auth(SHOPPER_ID)),
    ]);
    expect(pgSummary.body).toEqual(mongoSummary.body);

    const [mongoOrder, pgOrder] = await Promise.all([
      mongoApp().post("/api/orders").set(auth(SHOPPER_ID)).send({ customer: CUSTOMER }),
      pgApp().post("/api/orders").set(auth(SHOPPER_ID)).send({ customer: CUSTOMER }),
    ]);
    expect(pgOrder.status).toBe(mongoOrder.status);
    const orderView = (order: Json) => ({
      ...ignore(order, "id", "createdAt", "updatedAt", "orderTimeMs", "status"),
      products: (Array.isArray(order.products) ? order.products : []).map((line: Json) => ignore(line, "estimatedDeliveryTimeMs")),
    });
    expect(orderView(pgOrder.body)).toEqual(orderView(mongoOrder.body));
    expect(pgOrder.body.totalCostCents).toBe(pgSummary.body.totalCostCents);
  });
});

describe("intentional differences (documented in MIGRATION_PLAN.md)", () => {
  test("D1: PostgreSQL carts require a login; the legacy MongoDB cart does not", async () => {
    expect((await mongoApp().get("/api/cart-items")).status).toBe(200);
    expect((await pgApp().get("/api/cart-items")).status).toBe(401);
  });

  test("FD1: PostgreSQL carts reject fractional quantities; MongoDB accepted them", async () => {
    await mongoose.connection.db?.collection("cartItems").deleteMany({});
    expect((await mongoApp().post("/api/cart-items").send({ productId: SHIRT, quantity: 1.5 })).status).toBe(201);
    expect((await pgApp().post("/api/cart-items").set(auth(SHOPPER_ID)).send({ productId: SHIRT, quantity: 1.5 })).status).toBe(400);
  });

  test("cart line ids: MongoDB ObjectIds, PostgreSQL UUIDs", async () => {
    await mongoose.connection.db?.collection("cartItems").deleteMany({});
    const [mongo, pgResponse] = await Promise.all([
      mongoApp().post("/api/cart-items").send({ productId: SHIRT, quantity: 1 }),
      pgApp().post("/api/cart-items").set(auth(SHOPPER_ID)).send({ productId: SHIRT, quantity: 1 }),
    ]);
    expect(mongo.body.id).toMatch(/^[0-9a-f]{24}$/);
    expect(pgResponse.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("order status: PostgreSQL orders report it and admins can change it; MongoDB answers 501", async () => {
    const [mongo, pgResponse] = await Promise.all([
      mongoApp().patch(`/api/orders/${ORDER_LEGACY}/status`).set(auth(ADMIN_ID)).send({ status: "delivered", reason: "closing" }),
      pgApp().patch(`/api/orders/${ORDER_LEGACY}/status`).set(auth(ADMIN_ID)).send({ status: "delivered", reason: "closing" }),
    ]);
    expect(mongo.status).toBe(501);
    expect(pgResponse.status).toBe(200);
    expect(pgResponse.body.status).toBe("delivered");
  });

  test("orphaned orders: MongoDB keeps the deleted owner's id, PostgreSQL has no owner", async () => {
    const [mongo, pgResponse] = await Promise.all([
      mongoApp().get(`/api/orders/${ORDER_ORPHAN}`).set(auth(ADMIN_ID)),
      pgApp().get(`/api/orders/${ORDER_ORPHAN}`).set(auth(ADMIN_ID)),
    ]);
    expect(mongo.body.userId).toBe(DELETED_USER_ID);
    expect(pgResponse.body).not.toHaveProperty("userId");
  });
});
