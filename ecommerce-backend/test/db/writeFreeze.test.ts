// Write-freeze maintenance mode (R31) on PostgreSQL: while frozen, no request
// changes shop data — the reconciliation fingerprint of PostgreSQL stays the
// same — reading works, and customers can still sign in and out.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import { SECURE_COOKIE_NAME, type SessionAuthConfig } from "../../auth/config.js";
import { PostgresSessionRepository } from "../../auth/sessionRepository.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { migrate } from "../../db/migrator.js";
import { readPostgres } from "../../db/reconciliation/reverse.js";
import { isAllowedWhileFrozen, loadWriteFreeze, WRITE_FREEZE_MESSAGE, WriteFreezeConfigError } from "../../middleware/writeFreeze.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const ALL_POSTGRES: DataSourceConfig = {
  deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
};
const ORIGIN = "https://shop.example.test";
const SESSIONS: SessionAuthConfig = {
  cookieName: SECURE_COOKIE_NAME, secureCookie: true, allowedOrigins: new Set([ORIGIN]),
  idleSeconds: 3600, absoluteSeconds: 7200, renewAfterSeconds: 60,
};
const SOCKS = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const ADMIN_ID = "6aa7f3b07e1b7e1411434c6b";
const ALICE_ID = "6ad8b3e08afe6f8ad3173cac";
const PASSWORD = "user-password-123";
const CUSTOMER = { fullName: "Ada", email: "ada@example.com", phone: "0123", address: "1 Way", city: "London", postalCode: "N1 1AA", country: "UK" };

let db: TestDatabase;

beforeAll(() => {
  process.env.JWT_SECRET = "write-freeze-tests-only-secret";
});

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  const hash = await bcrypt.hash(PASSWORD, 4);
  await db.pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0)");
  await db.pool.query(`INSERT INTO products (id, image, name, description, how_it_works, highlights, care_instructions, category,
                                             stock, rating_stars, rating_count, price_cents, keywords)
                       VALUES ($1, 'images/products/socks.jpg', 'Socks', 'Socks.', 'Wear.', '{Cotton}', 'Wash.', 'Clothing', 0, 4.5, 87, 1090, '{socks}')`, [SOCKS]);
  await db.pool.query(`INSERT INTO users (id, name, email, password_hash, is_admin) VALUES
                       ($1, 'Admin', 'admin@example.com', $3, true), ($2, 'Alice', 'alice@example.com', $3, false)`, [ADMIN_ID, ALICE_ID, hash]);
});

afterEach(async () => {
  await db.drop();
});

const appWith = (writeFreeze: boolean) => createApp({
  repositories: createRepositories(ALL_POSTGRES, db.pool),
  sessionAuth: { config: SESSIONS, sessions: new PostgresSessionRepository(db.pool, SESSIONS) },
  writeFreeze,
});
const bearer = (id: string) => ({ Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET ?? "", { expiresIn: "1h" })}` });

describe("configuration", () => {
  test("off unless WRITE_FREEZE=true; anything else stops start-up", () => {
    expect(loadWriteFreeze({})).toBe(false);
    expect(loadWriteFreeze({ WRITE_FREEZE: "false" })).toBe(false);
    expect(loadWriteFreeze({ WRITE_FREEZE: "true" })).toBe(true);
    expect(() => loadWriteFreeze({ WRITE_FREEZE: "yes" })).toThrow(WriteFreezeConfigError);
  });

  test("only reads, sign-in and sign-out pass", () => {
    for (const [method, path] of [["GET", "/api/orders"], ["HEAD", "/api/products"], ["OPTIONS", "/api/cart-items"], ["POST", "/api/auth/session"],
      ["POST", "/api/auth/login"], ["DELETE", "/api/auth/session"], ["DELETE", "/api/auth/sessions"], ["POST", "/api/auth/session/exchange"]] as const) {
      expect(isAllowedWhileFrozen(method, path), `${method} ${path}`).toBe(true);
    }
    for (const [method, path] of [["POST", "/api/cart-items"], ["POST", "/api/orders"], ["POST", "/api/auth/register"], ["POST", "/api/auth/accounts"],
      ["PUT", "/api/products/x"], ["DELETE", "/api/products/x"], ["PATCH", "/api/orders/x/status"], ["POST", "/api/auth/session/other"]] as const) {
      expect(isAllowedWhileFrozen(method, path), `${method} ${path}`).toBe(false);
    }
  });
});

describe("while frozen", () => {
  test("every write to shop data is refused with 503 and changes nothing; reads work", async () => {
    const before = (await readPostgres(db.pool)).fingerprint;
    const frozen = appWith(true);

    const writes = [
      request(frozen).post("/api/cart-items").set(bearer(ALICE_ID)).send({ productId: SOCKS, quantity: 1 }),
      request(frozen).post("/api/orders").set(bearer(ALICE_ID)).set("Idempotency-Key", "11111111-1111-4111-8111-111111111111").send({ customer: CUSTOMER }),
      request(frozen).post("/api/auth/register").send({ name: "Eve", email: "eve@example.com", password: "password-1234" }),
      request(frozen).post("/api/auth/accounts").set("Origin", ORIGIN).send({ name: "Eve", email: "eve2@example.com", password: "password-1234" }),
      request(frozen).put(`/api/products/${SOCKS}`).set(bearer(ADMIN_ID)).send({ name: "Changed" }),
      request(frozen).delete(`/api/products/${SOCKS}`).set(bearer(ADMIN_ID)),
      request(frozen).post("/api/products").set(bearer(ADMIN_ID)).send({ name: "New" }),
    ];
    for (const response of await Promise.all(writes)) {
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ message: WRITE_FREEZE_MESSAGE });
      expect(response.headers["retry-after"]).toBe("120");
    }

    expect((await request(frozen).get("/api/products")).status).toBe(200);
    expect((await request(frozen).get("/api/cart-items").set(bearer(ALICE_ID))).status).toBe(200);
    expect((await request(frozen).get("/api/orders").set(bearer(ALICE_ID))).status).toBe(200);
    expect((await readPostgres(db.pool)).fingerprint).toBe(before);
  });

  test("customers can still sign in and out (sessions are not shop data)", async () => {
    const frozen = appWith(true);
    const login = await request(frozen).post("/api/auth/session").set("Origin", ORIGIN).send({ email: "alice@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    const cookie = String(login.headers["set-cookie"]?.[0]).split(";")[0] ?? "";
    expect((await request(frozen).get("/api/auth/session").set("Cookie", cookie)).status).toBe(200);
    const logout = await request(frozen).delete("/api/auth/session").set("Cookie", cookie).set("Origin", ORIGIN).set("X-CSRF-Token", login.body.csrfToken);
    expect(logout.status).toBe(204);
    expect((await request(frozen).post("/api/auth/login").send({ email: "alice@example.com", password: PASSWORD })).status).toBe(200);
  });

  test("unfrozen, the same writes work as usual", async () => {
    const open = appWith(false);
    expect((await request(open).post("/api/cart-items").set(bearer(ALICE_ID)).send({ productId: SOCKS, quantity: 1 })).status).toBe(201);
  });
});
