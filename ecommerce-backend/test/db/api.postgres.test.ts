// Phase 3C: every API endpoint served by PostgreSQL (all five domains), through
// the real Express app, against a fresh migrated test database per test.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { migrate } from "../../db/migrator.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const ALL_POSTGRES: DataSourceConfig = {
  deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
};

const SOCKS = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const BALL = "15b6fc6f-327a-4ec4-896f-486349e85a3d";
const SHIRT = "83d4ca15-0f35-48f5-b7a3-1ea210004f2e";
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const ADMIN_ID = "6aa7f3b07e1b7e1411434c6b";
const ALICE_ID = "6ad8b3e08afe6f8ad3173cac";
const BOB_ID = "6ad8b3e08afe6f8ad3173cad";
const LEGACY_ORDER = "0e4111b0-cf69-448b-a3d1-ca2f5d6ba563";
const DELETED_PRODUCT = "99999999-9999-4999-8999-999999999999";
const PASSWORD = "user-password-123";
const PRODUCT_KEYS = [
  "careInstructions", "category", "createdAt", "description", "highlights", "howItWorks",
  "id", "image", "keywords", "name", "priceCents", "rating", "stock", "updatedAt",
];
const CUSTOMER = {
  fullName: "  Ada Lovelace  ", email: "  ADA@Example.COM ", phone: " 0123 456 ", address: " 1 Analytical Way ",
  city: " London ", postalCode: " N1 1AA ", country: " UK ",
};

let db: TestDatabase;
let passwordHash: string;

beforeAll(async () => {
  process.env.JWT_SECRET = "postgres-api-tests-only-secret";
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  await seed();
});

afterEach(async () => {
  await db.drop();
});

const app = () => request(createApp({ repositories: createRepositories(ALL_POSTGRES, db.pool) }));
const tokenFor = (id: string) => jwt.sign({ id }, process.env.JWT_SECRET ?? "", { expiresIn: "30d" });
const auth = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });
const sql = (text: string, values: unknown[] = []) => db.pool.query(text, values);

async function seed() {
  await sql(`INSERT INTO delivery_options (id, delivery_days, price_cents, created_at, updated_at) VALUES
    ('1', 7, 0, '2025-12-31T23:30:00Z', '2025-12-31T23:30:00Z'),
    ('2', 3, 499, '2025-12-31T23:31:00Z', '2025-12-31T23:31:00Z'),
    ('3', 1, 999, '2025-12-31T23:32:00Z', '2025-12-31T23:32:00Z')`);
  await sql(`INSERT INTO products (id, image, name, description, how_it_works, highlights, care_instructions, category,
                                   stock, rating_stars, rating_count, price_cents, keywords, created_at, updated_at) VALUES
    ($1, 'images/products/socks.jpg', 'Socks', 'Comfortable socks.', 'Wear them.', '{Cotton,"6 pairs"}', 'Machine wash.', 'Clothing', 0, 4.5, 87, 1090, '{socks,sports}', '2025-12-31T23:40:00Z', '2025-12-31T23:40:00Z'),
    ($2, 'images/products/ball.jpg', 'Basketball', 'A ball.', 'Bounce it.', '{Composite}', 'Wipe clean.', 'Sports', 0, 4, 127, 2095, '{sports}', '2025-12-31T23:41:00Z', '2025-12-31T23:41:00Z'),
    ($3, 'images/products/shirt.jpg', 'T-Shirt', 'Plain.', 'Wear it.', '{"2 pack"}', 'Wash cold.', 'Clothing', 0, 4.5, 56, 799, '{tshirts}', '2025-12-31T23:42:00Z', '2025-12-31T23:42:00Z')`,
  [SOCKS, BALL, SHIRT]);
  await sql(`INSERT INTO users (id, name, email, password_hash, is_admin) VALUES
    ($1, 'Admin', 'admin@example.com', $4, true),
    ($2, 'Alice', 'alice@example.com', $4, false),
    ($3, 'Bob', 'bob@example.com', $4, false)`, [ADMIN_ID, ALICE_ID, BOB_ID, passwordHash]);
  // A legacy order imported from MongoDB: no owner, no customer, no snapshot, deleted product.
  await sql(`INSERT INTO orders (id, is_legacy, ordered_at, total_cost_cents, created_at, updated_at)
             VALUES ($1, true, to_timestamp(1718013600), 3506, '2024-06-10T10:00:00Z', '2024-06-10T10:00:00Z')`, [LEGACY_ORDER]);
  await sql(`INSERT INTO order_items (order_id, position, product_id, quantity, estimated_delivery_at) VALUES
    ($1, 0, $2, 2, to_timestamp(1718618400)), ($1, 1, $3, 1, to_timestamp(1718618400))`, [LEGACY_ORDER, DELETED_PRODUCT, SOCKS]);
}

const addToCart = (userId: string, productId: unknown, quantity: unknown) => (
  app().post("/api/cart-items").set(auth(userId)).send({ productId, quantity })
);
const checkout = (userId: string, idempotencyKey?: string, customer: typeof CUSTOMER = CUSTOMER) => {
  const pending = app().post("/api/orders").set(auth(userId));
  if (idempotencyKey) pending.set("Idempotency-Key", idempotencyKey);
  return pending.send({ customer });
};
const count = async (table: string) => Number((await sql(`SELECT count(*) FROM ${table}`)).rows[0]?.count);

// --------------------------------------------------------------- products
describe("products and delivery options", () => {
  test("GET /api/products lists products by creation time with the API shape", async () => {
    const response = await app().get("/api/products");
    expect(response.status).toBe(200);
    expect(response.body.map((product: { id: string }) => product.id)).toEqual([SOCKS, BALL, SHIRT]);
    expect(Object.keys(response.body[0]).sort()).toEqual(PRODUCT_KEYS);
    expect(response.body[0]).toMatchObject({
      id: SOCKS, priceCents: 1090, rating: { stars: 4.5, count: 87 }, highlights: ["Cotton", "6 pairs"],
      stock: 0, createdAt: "2025-12-31T23:40:00.000Z",
    });
  });

  test("admin create, update and delete; validation, 401/403/404 and malformed ids", async () => {
    const form = {
      name: " Kettle ", price: "19.99", description: "Boils.", howItWorks: "Fill.", highlights: "1.7 l, Auto off",
      careInstructions: "Descale.", image: "images/kettle.jpg", category: " Kitchen ", stock: "12",
    };
    expect((await app().post("/api/products").send(form)).status).toBe(401);
    expect((await app().post("/api/products").set(auth(ALICE_ID)).send(form)).status).toBe(403);
    expect((await app().post("/api/products").set(auth(ADMIN_ID)).send({})).body).toEqual({ message: "Please provide valid product details" });

    const created = await app().post("/api/products").set(auth(ADMIN_ID)).send(form);
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(PRODUCT_KEYS);
    expect(created.body).toMatchObject({
      name: "Kettle", priceCents: 1999, highlights: ["1.7 l", "Auto off"], category: "Kitchen", stock: 12,
      rating: { stars: 0, count: 0 }, keywords: ["kitchen"],
    });

    const updated = await app().put(`/api/products/${created.body.id}`).set(auth(ADMIN_ID)).send({ ...form, price: "21.50" });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ id: created.body.id, priceCents: 2150, createdAt: created.body.createdAt });

    expect((await app().put(`/api/products/${UNKNOWN_UUID}`).set(auth(ADMIN_ID)).send(form)).status).toBe(404);
    expect((await app().put("/api/products/not-a-uuid").set(auth(ADMIN_ID)).send(form)).body).toEqual({ message: "Invalid product id" });

    expect((await app().delete(`/api/products/${created.body.id}`).set(auth(ADMIN_ID))).body).toEqual({ id: created.body.id });
    expect((await app().delete(`/api/products/${created.body.id}`).set(auth(ADMIN_ID))).status).toBe(404);
  });

  test("GET /api/delivery-options with and without estimated times", async () => {
    const plain = await app().get("/api/delivery-options");
    expect(plain.body).toEqual([
      { deliveryDays: 7, priceCents: 0, createdAt: "2025-12-31T23:30:00.000Z", updatedAt: "2025-12-31T23:30:00.000Z", id: "1" },
      { deliveryDays: 3, priceCents: 499, createdAt: "2025-12-31T23:31:00.000Z", updatedAt: "2025-12-31T23:31:00.000Z", id: "2" },
      { deliveryDays: 1, priceCents: 999, createdAt: "2025-12-31T23:32:00.000Z", updatedAt: "2025-12-31T23:32:00.000Z", id: "3" },
    ]);
    const before = Date.now();
    const expanded = await app().get("/api/delivery-options?expand=estimatedDeliveryTime");
    expect(expanded.body[2].estimatedDeliveryTimeMs).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000);
  });
});

// ------------------------------------------------------------------- auth
describe("auth (users in PostgreSQL)", () => {
  test("register issues a token for a new ObjectId-style id and stores only a bcrypt hash", async () => {
    const response = await app().post("/api/auth/register").send({ name: " New ", email: " NEW@Example.com ", password: PASSWORD });
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(["_id", "email", "isAdmin", "name", "token"]);
    expect(response.body).toMatchObject({ name: "New", email: "new@example.com", isAdmin: false });
    expect(response.body._id).toMatch(/^[0-9a-f]{24}$/);
    expect(jwt.verify(response.body.token, process.env.JWT_SECRET ?? "")).toMatchObject({ id: response.body._id });

    const { rows: [stored] } = await sql("SELECT password_hash FROM users WHERE id = $1", [response.body._id]);
    expect(stored?.password_hash).toMatch(/^\$2[aby]\$12\$/);
    expect(await bcrypt.compare(PASSWORD, stored?.password_hash)).toBe(true);
  });

  test("duplicate, concurrent and invalid registrations", async () => {
    expect((await app().post("/api/auth/register").send({ name: "A", email: "alice@example.com", password: PASSWORD })).status).toBe(409);
    expect((await app().post("/api/auth/register").send({ name: "A", email: "bad", password: PASSWORD })).status).toBe(400);

    const racers = await Promise.all(Array.from({ length: 4 }, () => (
      app().post("/api/auth/register").send({ name: "Racer", email: "racer@example.com", password: PASSWORD })
    )));
    expect(racers.map((response) => response.status).sort()).toEqual([201, 409, 409, 409]);
    expect(await count("users WHERE email = 'racer@example.com'")).toBe(1);
  });

  test("login, wrong password, unknown user and profile", async () => {
    const login = await app().post("/api/auth/login").send({ email: " ALICE@example.com ", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ _id: ALICE_ID, name: "Alice", isAdmin: false });

    const wrong = await app().post("/api/auth/login").send({ email: "alice@example.com", password: "wrong-password" });
    const unknown = await app().post("/api/auth/login").send({ email: "nobody@example.com", password: PASSWORD });
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(unknown.body);

    const profile = await app().get("/api/auth/profile").set({ Authorization: `Bearer ${login.body.token}` });
    expect(profile.body).toEqual({ _id: ALICE_ID, name: "Alice", email: "alice@example.com", isAdmin: false });
    expect(profile.headers["cache-control"]).toBe("no-store");
  });

  test("existing MongoDB-era tokens keep working (D2) and bad tokens are rejected", async () => {
    // A token issued by the MongoDB API carries the same ObjectId string.
    expect((await app().get("/api/auth/profile").set(auth(ALICE_ID))).status).toBe(200);
    for (const header of [{}, { Authorization: "Bearer not-a-jwt" }, auth("aaaaaaaaaaaaaaaaaaaaaaaa"), auth("not-an-object-id")]) {
      expect((await app().get("/api/auth/profile").set(header)).status).toBe(401);
    }
  });
});

// ------------------------------------------------------------------ carts
describe("per-user carts (D1, FD1, D3)", () => {
  test("every cart endpoint requires authentication", async () => {
    for (const response of await Promise.all([
      app().get("/api/cart-items"),
      app().post("/api/cart-items").send({ productId: SOCKS, quantity: 1 }),
      app().put(`/api/cart-items/${SOCKS}`).send({ quantity: 2 }),
      app().delete(`/api/cart-items/${SOCKS}`),
      app().get("/api/payment-summary"),
    ])) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Not authorized" });
    }
  });

  test("add, list, update and delete a line with the API shape", async () => {
    const added = await addToCart(ALICE_ID, SOCKS, 2);
    expect(added.status).toBe(201);
    expect(Object.keys(added.body).sort()).toEqual(["createdAt", "deliveryOptionId", "id", "productId", "quantity", "updatedAt"]);
    expect(added.body).toMatchObject({ productId: SOCKS, quantity: 2, deliveryOptionId: "1" });

    expect((await addToCart(ALICE_ID, SOCKS, 3)).body.quantity).toBe(5);
    const updated = await app().put(`/api/cart-items/${SOCKS}`).set(auth(ALICE_ID)).send({ quantity: 4, deliveryOptionId: "3" });
    expect(updated.body).toMatchObject({ quantity: 4, deliveryOptionId: "3" });

    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body).toEqual([updated.body]);
    expect((await app().delete(`/api/cart-items/${SOCKS}`).set(auth(ALICE_ID))).status).toBe(204);
    expect((await app().delete(`/api/cart-items/${SOCKS}`).set(auth(ALICE_ID))).status).toBe(404);
  });

  test("authenticated cart responses are private and never cacheable", async () => {
    const response = await app().get("/api/cart-items").set(auth(ALICE_ID));
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(response.headers.vary).toContain("Cookie");
    expect(response.headers.vary).toContain("Authorization");
  });

  test("FD1: quantities must be integers from 1 to 10, including after merging", async () => {
    for (const quantity of [0, 11, 1.5, "2", null, -1]) {
      const response = await addToCart(ALICE_ID, SOCKS, quantity);
      expect(response.status, `quantity ${String(quantity)}`).toBe(400);
      expect(response.body).toEqual({ message: "Quantity must be between 1 and 10" });
    }
    await addToCart(ALICE_ID, SOCKS, 8);
    expect((await addToCart(ALICE_ID, SOCKS, 3)).body).toEqual({ message: "Quantity must be between 1 and 10" });
    for (const quantity of [0, 11, 2.5]) {
      expect((await app().put(`/api/cart-items/${SOCKS}`).set(auth(ALICE_ID)).send({ quantity })).status).toBe(400);
    }
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body[0].quantity).toBe(8);
  });

  test("users only ever see and change their own cart", async () => {
    await addToCart(ALICE_ID, SOCKS, 2);
    expect((await app().get("/api/cart-items").set(auth(BOB_ID))).body).toEqual([]);
    expect((await app().put(`/api/cart-items/${SOCKS}`).set(auth(BOB_ID)).send({ quantity: 9 })).status).toBe(404);
    expect((await app().delete(`/api/cart-items/${SOCKS}`).set(auth(BOB_ID))).status).toBe(404);

    // The same product in two carts is two independent lines.
    await addToCart(BOB_ID, SOCKS, 1);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body[0].quantity).toBe(2);
    expect((await app().get("/api/cart-items").set(auth(BOB_ID))).body[0].quantity).toBe(1);
    expect((await app().get("/api/payment-summary").set(auth(BOB_ID))).body.totalItems).toBe(1);
  });

  test("invalid input: operator objects, malformed ids, unknown products and delivery options", async () => {
    for (const productId of [{ $ne: null }, ["x"], "not-a-uuid", 123]) {
      expect((await addToCart(ALICE_ID, productId, 1)).body).toEqual({ message: "Invalid product id" });
    }
    expect((await addToCart(ALICE_ID, UNKNOWN_UUID, 1)).status).toBe(404);
    await addToCart(ALICE_ID, SOCKS, 1);
    for (const deliveryOptionId of [{ $ne: null }, 3, "9", "abc"]) {
      const response = await app().put(`/api/cart-items/${SOCKS}`).set(auth(ALICE_ID)).send({ deliveryOptionId });
      expect(response.body).toEqual({ message: "Invalid delivery option" });
    }
    expect((await app().put("/api/cart-items/not-a-uuid").set(auth(ALICE_ID)).send({ quantity: 1 })).status).toBe(400);
  });

  test("D3: a deleted product stays in the cart as unavailable and is left out of totals", async () => {
    await addToCart(ALICE_ID, SOCKS, 2);
    await addToCart(ALICE_ID, BALL, 1);
    await app().put(`/api/cart-items/${BALL}`).set(auth(ALICE_ID)).send({ deliveryOptionId: "3" });
    await app().delete(`/api/products/${SOCKS}`).set(auth(ADMIN_ID));

    const cart = await app().get("/api/cart-items?expand=product").set(auth(ALICE_ID));
    expect(cart.body.map((line: { productId: string; unavailable: boolean; product: unknown }) => [line.productId, line.unavailable, line.product === null]))
      .toEqual([[SOCKS, true, true], [BALL, false, false]]);
    expect((await app().get("/api/payment-summary").set(auth(ALICE_ID))).body).toEqual({
      totalItems: 1, productCostCents: 2095, shippingCostCents: 999, totalCostBeforeTaxCents: 3094,
      taxCents: 309, totalCostCents: 3403, unavailableProductIds: [SOCKS],
    });
  });

  test("concurrent adds to one line are never lost, and the limit still holds", async () => {
    const responses = await Promise.all(Array.from({ length: 12 }, () => addToCart(ALICE_ID, SOCKS, 1)));
    expect(responses.filter((response) => response.status === 201)).toHaveLength(10);
    expect(responses.filter((response) => response.status === 400)).toHaveLength(2);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body[0].quantity).toBe(10);
    expect(await count("carts")).toBe(1);
  });
});

// ----------------------------------------------------------------- orders
describe("checkout (transactional)", () => {
  test("validates customer details and refuses an empty cart", async () => {
    expect((await app().post("/api/orders").set(auth(ALICE_ID)).send({})).body).toEqual({ message: "Please provide complete customer details" });
    expect((await checkout(ALICE_ID)).body).toEqual({ message: "Cart is empty" });
  });

  test("D3: blocks with 409 while the cart holds a deleted product, keeping the cart", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    await app().delete(`/api/products/${SOCKS}`).set(auth(ADMIN_ID));
    const response = await checkout(ALICE_ID);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: "Remove unavailable products from your cart before placing the order", unavailableProductIds: [SOCKS],
    });
    expect(await count("cart_items")).toBe(1);
    expect(await count("orders WHERE NOT is_legacy")).toBe(0);
  });

  test("places the order with snapshots, the same totals, an audit event, and clears only the buyer's cart", async () => {
    await addToCart(ALICE_ID, SOCKS, 2);
    await addToCart(ALICE_ID, BALL, 1);
    await app().put(`/api/cart-items/${BALL}`).set(auth(ALICE_ID)).send({ deliveryOptionId: "3" });
    await addToCart(BOB_ID, SHIRT, 1);

    const before = Date.now();
    const response = await checkout(ALICE_ID);

    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual([
      "createdAt", "customer", "id", "orderTimeMs", "products", "status", "totalCostCents", "updatedAt", "userId",
    ]);
    expect(response.body).toMatchObject({
      userId: ALICE_ID,
      customer: { fullName: "Ada Lovelace", email: "ada@example.com", phone: "0123 456", address: "1 Analytical Way", city: "London", postalCode: "N1 1AA", country: "UK" },
      totalCostCents: 5801,
      status: "placed",
    });
    expect(response.body.orderTimeMs).toBeGreaterThanOrEqual(before);
    expect(response.body.products).toEqual([
      { productId: SOCKS, product: { id: SOCKS, image: "images/products/socks.jpg", name: "Socks", priceCents: 1090, description: "Comfortable socks.", category: "Clothing" }, quantity: 2, estimatedDeliveryTimeMs: expect.any(Number) },
      { productId: BALL, product: { id: BALL, image: "images/products/ball.jpg", name: "Basketball", priceCents: 2095, description: "A ball.", category: "Sports" }, quantity: 1, estimatedDeliveryTimeMs: expect.any(Number) },
    ]);

    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body).toEqual([]);
    expect((await app().get("/api/cart-items").set(auth(BOB_ID))).body).toHaveLength(1);
    const { rows: events } = await sql("SELECT from_status, to_status, changed_by, reason FROM order_status_events");
    expect(events).toEqual([{ from_status: null, to_status: "placed", changed_by: ALICE_ID, reason: "order placed" }]);
  });

  test("D4: snapshots stay as sold after the product is edited or deleted", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const { body: order } = await checkout(ALICE_ID);
    await app().put(`/api/products/${SOCKS}`).set(auth(ADMIN_ID)).send({
      name: "Renamed", price: "99", description: "d", howItWorks: "h", highlights: "x", careInstructions: "c",
      image: "i.jpg", category: "Other", stock: "0",
    });
    await app().delete(`/api/products/${SOCKS}`).set(auth(ADMIN_ID));
    const fetched = await app().get(`/api/orders/${order.id}?expand=products`).set(auth(ALICE_ID));
    expect(fetched.body.products[0].product).toEqual(order.products[0].product);
  });

  test("two simultaneous checkouts of one cart create exactly one order", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const responses = await Promise.all([checkout(ALICE_ID), checkout(ALICE_ID), checkout(ALICE_ID)]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 400, 400]);
    expect(await count("orders WHERE NOT is_legacy")).toBe(1);
  });

  test("one idempotency key safely replays simultaneous and later checkout attempts", async () => {
    const key = "11111111-1111-4111-8111-111111111111";
    await addToCart(ALICE_ID, SOCKS, 1);
    const responses = await Promise.all([checkout(ALICE_ID, key), checkout(ALICE_ID, key), checkout(ALICE_ID, key)]);
    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(new Set(responses.map((response) => response.body.id)).size).toBe(1);
    expect(await count("orders WHERE NOT is_legacy")).toBe(1);
    expect((await checkout(ALICE_ID, key)).body.id).toBe(responses[0]?.body.id);
    expect((await checkout(BOB_ID, key)).body).toEqual({ message: "Cart is empty" });
  });

  test("a key reused with different details is refused and changes nothing", async () => {
    const key = "22222222-2222-4222-8222-222222222222";
    await addToCart(ALICE_ID, SOCKS, 1);
    const first = await checkout(ALICE_ID, key);
    expect(first.status).toBe(201);
    await addToCart(ALICE_ID, BALL, 2);

    const reused = await checkout(ALICE_ID, key, { ...CUSTOMER, address: "2 Different Road" });

    expect(reused.status).toBe(422);
    expect(reused.body).toEqual({
      message: "This checkout request was already used with different details. Review your order and try again.",
    });
    expect(await count("orders WHERE NOT is_legacy")).toBe(1);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body).toHaveLength(1);
    const { rows: [stored] } = await sql("SELECT customer_address FROM orders WHERE id = $1", [first.body.id]);
    expect(stored).toEqual({ customer_address: "1 Analytical Way" });
  });

  test("details that normalise to the same values replay instead of conflicting", async () => {
    const key = "33333333-3333-4333-8333-333333333333";
    await addToCart(ALICE_ID, SOCKS, 1);
    const first = await checkout(ALICE_ID, key);
    const again = await checkout(ALICE_ID, key, { ...CUSTOMER, email: "ada@example.com", city: "London" });
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
  });

  test("a late retry returns the original order and leaves a refilled cart alone", async () => {
    const key = "44444444-4444-4444-8444-444444444444";
    await addToCart(ALICE_ID, SOCKS, 1);
    const first = await checkout(ALICE_ID, key);
    await addToCart(ALICE_ID, BALL, 3);

    const retry = await checkout(ALICE_ID, key);

    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(first.body);
    expect(await count("orders WHERE NOT is_legacy")).toBe(1);
    const cart = (await app().get("/api/cart-items").set(auth(ALICE_ID))).body;
    expect(cart).toEqual([expect.objectContaining({ productId: BALL, quantity: 3 })]);
  });

  test("a fresh key places a new intentional order", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const first = await checkout(ALICE_ID, "55555555-5555-4555-8555-555555555555");
    await addToCart(ALICE_ID, SOCKS, 1);
    const second = await checkout(ALICE_ID, "66666666-6666-4666-8666-666666666666");
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.id).not.toBe(first.body.id);
    expect(await count("orders WHERE NOT is_legacy")).toBe(2);
  });

  test("a checkout interrupted before commit stores nothing, and the same key then succeeds", async () => {
    const key = "77777777-7777-4777-8777-777777777777";
    await addToCart(ALICE_ID, SOCKS, 2);
    // Fails the last statement before the cart is cleared, after the order and its lines were inserted.
    await sql(`CREATE FUNCTION test_interrupt() RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'simulated interruption'; END; $$`);
    await sql(`CREATE TRIGGER test_interrupt BEFORE INSERT ON order_status_events
               FOR EACH ROW EXECUTE FUNCTION test_interrupt()`);

    const failed = await checkout(ALICE_ID, key);

    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ message: "Unable to place the order" });
    expect(await count("orders WHERE NOT is_legacy")).toBe(0);
    expect(await count("order_items")).toBe(2); // the legacy order's lines only
    expect(await count(`orders WHERE checkout_key = '${key}'`)).toBe(0);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body).toEqual([
      expect.objectContaining({ productId: SOCKS, quantity: 2 }),
    ]);

    await sql("DROP TRIGGER test_interrupt ON order_status_events");
    await sql("DROP FUNCTION test_interrupt()");
    const retried = await checkout(ALICE_ID, key);
    expect(retried.status).toBe(201);
    expect(await count("orders WHERE NOT is_legacy")).toBe(1);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body).toEqual([]);
  });

  test("rejects a malformed Idempotency-Key before changing the cart", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const response = await checkout(ALICE_ID, "not-a-uuid");
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid Idempotency-Key" });
    expect(await count("orders WHERE NOT is_legacy")).toBe(0);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body).toHaveLength(1);
  });

  test("stock is enforced only for tracked inventory, and never goes negative under concurrency", async () => {
    await sql("UPDATE products SET inventory_tracked = true, stock = 1 WHERE id = $1", [BALL]);
    await addToCart(ALICE_ID, BALL, 1);
    await addToCart(BOB_ID, BALL, 1);

    const responses = await Promise.all([checkout(ALICE_ID), checkout(BOB_ID)]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    expect(rejected?.body).toEqual({ message: "Some products do not have enough stock for this order", insufficientStockProductIds: [BALL] });
    const { rows: [ball] } = await sql("SELECT stock FROM products WHERE id = $1", [BALL]);
    expect(ball).toEqual({ stock: 0 });

    // Untracked products (all imported products) are never blocked or decremented.
    await addToCart(ALICE_ID, SOCKS, 3);
    expect((await checkout(ALICE_ID)).status).toBe(201);
    const { rows: [socks] } = await sql("SELECT stock FROM products WHERE id = $1", [SOCKS]);
    expect(socks).toEqual({ stock: 0 });
  });

  test("a failure part-way through rolls everything back: no order, cart and stock intact", async () => {
    await sql("UPDATE products SET inventory_tracked = true, stock = 5 WHERE id = $1", [SOCKS]);
    await addToCart(ALICE_ID, SOCKS, 2);
    await sql(`CREATE FUNCTION fail_line() RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN RAISE EXCEPTION 'simulated failure while writing order lines'; END $$;
               CREATE TRIGGER fail_line BEFORE INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION fail_line();`);

    const response = await checkout(ALICE_ID);

    expect(response.status).toBe(500);
    expect(await count("orders WHERE NOT is_legacy")).toBe(0);
    expect(await count("order_status_events")).toBe(0);
    expect((await app().get("/api/cart-items").set(auth(ALICE_ID))).body[0].quantity).toBe(2);
    expect((await sql("SELECT stock FROM products WHERE id = $1", [SOCKS])).rows[0]).toEqual({ stock: 5 });
  });
});

describe("order history and ownership", () => {
  test("authenticated order responses are private and never cacheable", async () => {
    const response = await app().get("/api/orders").set(auth(ALICE_ID));
    expect(response.headers["cache-control"]).toContain("private");
    expect(response.headers["cache-control"]).toContain("no-store");
  });
  test("users see their own orders; admins see all, including legacy history", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const { body: aliceOrder } = await checkout(ALICE_ID);

    expect((await app().get("/api/orders").set(auth(ALICE_ID))).body.map((order: { id: string }) => order.id)).toEqual([aliceOrder.id]);
    expect((await app().get("/api/orders").set(auth(BOB_ID))).body).toEqual([]);
    const all = (await app().get("/api/orders").set(auth(ADMIN_ID))).body;
    expect(all.map((order: { id: string }) => order.id)).toEqual([aliceOrder.id, LEGACY_ORDER]);
  });

  test("legacy orders keep their original shape; expand adds the current product or null", async () => {
    const plain = await app().get(`/api/orders/${LEGACY_ORDER}`).set(auth(ADMIN_ID));
    expect(plain.body).toEqual({
      orderTimeMs: 1_718_013_600_000, totalCostCents: 3506,
      products: [
        { productId: DELETED_PRODUCT, quantity: 2, estimatedDeliveryTimeMs: 1_718_618_400_000 },
        { productId: SOCKS, quantity: 1, estimatedDeliveryTimeMs: 1_718_618_400_000 },
      ],
      createdAt: "2024-06-10T10:00:00.000Z", updatedAt: "2024-06-10T10:00:00.000Z", id: LEGACY_ORDER, status: null,
    });
    const expanded = await app().get(`/api/orders/${LEGACY_ORDER}?expand=products`).set(auth(ADMIN_ID));
    expect(expanded.body.products[0].product).toBeNull();
    expect(expanded.body.products[1].product).toMatchObject({ id: SOCKS, name: "Socks", priceCents: 1090 });
  });

  test("404 for other users' orders, unknown ids and ownerless legacy orders; 400 for malformed ids", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const { body: order } = await checkout(ALICE_ID);
    expect((await app().get(`/api/orders/${order.id}`).set(auth(BOB_ID))).status).toBe(404);
    expect((await app().get(`/api/orders/${LEGACY_ORDER}`).set(auth(ALICE_ID))).status).toBe(404);
    expect((await app().get(`/api/orders/${UNKNOWN_UUID}`).set(auth(ALICE_ID))).status).toBe(404);
    expect((await app().get("/api/orders/not-a-uuid").set(auth(ALICE_ID))).body).toEqual({ message: "Invalid order id" });
    expect((await app().get(`/api/orders/${order.id}`).set(auth(ADMIN_ID))).status).toBe(200);
  });
});

describe("order status (admin, audited)", () => {
  const setStatus = (orderId: string, body: object, userId = ADMIN_ID) => (
    app().patch(`/api/orders/${orderId}/status`).set(auth(userId)).send(body)
  );

  test("admins move an order along allowed transitions; each change is audited", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const { body: order } = await checkout(ALICE_ID);

    for (const status of ["processing", "shipped", "delivered"]) {
      const response = await setStatus(order.id, { status, reason: `marked ${status}` });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: order.id, status, totalCostCents: order.totalCostCents });
    }
    const { rows } = await sql("SELECT from_status, to_status, changed_by, reason FROM order_status_events ORDER BY id");
    expect(rows).toEqual([
      { from_status: null, to_status: "placed", changed_by: ALICE_ID, reason: "order placed" },
      { from_status: "placed", to_status: "processing", changed_by: ADMIN_ID, reason: "marked processing" },
      { from_status: "processing", to_status: "shipped", changed_by: ADMIN_ID, reason: "marked shipped" },
      { from_status: "shipped", to_status: "delivered", changed_by: ADMIN_ID, reason: "marked delivered" },
    ]);
  });

  test("cancellation is a status only: the total is preserved and nothing is refunded", async () => {
    await addToCart(ALICE_ID, SOCKS, 2);
    const { body: order } = await checkout(ALICE_ID);
    const cancelled = await setStatus(order.id, { status: "cancelled", reason: "customer request" });
    expect(cancelled.body).toMatchObject({ status: "cancelled", totalCostCents: order.totalCostCents, products: order.products });
    expect((await setStatus(order.id, { status: "processing", reason: "x" })).status).toBe(409);
  });

  test("legacy orders: an admin may close them as delivered or cancelled, audited; nothing else", async () => {
    expect((await setStatus(LEGACY_ORDER, { status: "shipped", reason: "x" })).body)
      .toEqual({ message: "Order status transition none -> shipped is not allowed" });
    const closed = await setStatus(LEGACY_ORDER, { status: "delivered", reason: "historical order fulfilled" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("delivered");
    expect((await sql("SELECT from_status, to_status FROM order_status_events")).rows).toEqual([{ from_status: null, to_status: "delivered" }]);
  });

  test("rejects non-admins, invalid statuses, missing reasons, unknown and malformed ids", async () => {
    await addToCart(ALICE_ID, SOCKS, 1);
    const { body: order } = await checkout(ALICE_ID);
    expect((await setStatus(order.id, { status: "processing", reason: "x" }, ALICE_ID)).status).toBe(403);
    expect((await app().patch(`/api/orders/${order.id}/status`).send({ status: "processing", reason: "x" })).status).toBe(401);
    expect((await setStatus(order.id, { status: "lost", reason: "x" })).status).toBe(400);
    expect((await setStatus(order.id, { status: { $ne: null }, reason: "x" })).status).toBe(400);
    expect((await setStatus(order.id, { status: "processing" })).status).toBe(400);
    expect((await setStatus(order.id, { status: "processing", reason: "   " })).status).toBe(400);
    expect((await setStatus(UNKNOWN_UUID, { status: "processing", reason: "x" })).status).toBe(404);
    expect((await setStatus("not-a-uuid", { status: "processing", reason: "x" })).status).toBe(400);
    expect((await setStatus(order.id, { status: "delivered", reason: "skip ahead" })).body)
      .toEqual({ message: "Order status transition placed -> delivered is not allowed" });
    expect(await count("order_status_events")).toBe(1);
  });
});
