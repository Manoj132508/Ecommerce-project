// Phase 5B: PostgreSQL-backed HttpOnly cookie sessions (migration 0004,
// auth/*). Real Express app, fresh migrated test database per test, all
// domains on PostgreSQL. The legacy bearer-token path is checked alongside.
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import request, { type Response } from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../../app.js";
import {
  DEVELOPMENT_COOKIE_NAME,
  loadSessionAuthConfig,
  SECURE_COOKIE_NAME,
  SessionConfigError,
  type SessionAuthConfig,
} from "../../auth/config.js";
import type { SessionAuth } from "../../auth/sessionAuth.js";
import { PostgresSessionRepository } from "../../auth/sessionRepository.js";
import { csrfTokenFor, generateSessionToken } from "../../auth/tokens.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { rollbackImportedData } from "../../db/dataMigration/importer.js";
import { migrate } from "../../db/migrator.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, SQLSTATE, type TestDatabase } from "./helpers.js";

const ALL_POSTGRES: DataSourceConfig = {
  deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
};
const ALL_MONGO: DataSourceConfig = {
  deliveryOptions: "mongo", products: "mongo", users: "mongo", carts: "mongo", orders: "mongo",
};

const ORIGIN = "https://shop.example.test";
const SOCKS = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const BALL = "15b6fc6f-327a-4ec4-896f-486349e85a3d";
const ADMIN_ID = "6aa7f3b07e1b7e1411434c6b";
const ALICE_ID = "6ad8b3e08afe6f8ad3173cac";
const BOB_ID = "6ad8b3e08afe6f8ad3173cad";
const PASSWORD = "user-password-123";
const CUSTOMER = { fullName: "Ada Lovelace", email: "ada@example.com", phone: "0123 456", address: "1 Analytical Way", city: "London", postalCode: "N1 1AA", country: "UK" };
const PRODUCT_FORM = {
  name: "Water Bottle", description: "Keeps water cold.", howItWorks: "Fill it.", careInstructions: "Hand wash.",
  highlights: ["Steel"], image: "images/products/bottle.jpg", category: "Kitchen", price: 12.5, stock: 3,
};

const SECURE: SessionAuthConfig = {
  cookieName: SECURE_COOKIE_NAME,
  secureCookie: true,
  allowedOrigins: new Set([ORIGIN]),
  idleSeconds: 3600,
  absoluteSeconds: 7200,
  renewAfterSeconds: 60,
};

let db: TestDatabase;
let passwordHash: string;

beforeAll(async () => {
  process.env.JWT_SECRET = "auth-session-tests-only-secret";
  passwordHash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  await sql(`INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0), ('2', 3, 499)`);
  await sql(`INSERT INTO products (id, image, name, description, how_it_works, highlights, care_instructions, category,
                                   stock, rating_stars, rating_count, price_cents, keywords) VALUES
    ($1, 'images/products/socks.jpg', 'Socks', 'Soft.', 'Wear.', '{Cotton}', 'Wash.', 'Clothing', 0, 4.5, 87, 1090, '{socks}'),
    ($2, 'images/products/ball.jpg', 'Basketball', 'A ball.', 'Bounce.', '{Composite}', 'Wipe.', 'Sports', 0, 4, 127, 2095, '{sports}')`,
  [SOCKS, BALL]);
  await sql(`INSERT INTO users (id, name, email, password_hash, is_admin) VALUES
    ($1, 'Admin', 'admin@example.com', $4, true),
    ($2, 'Alice', 'alice@example.com', $4, false),
    ($3, 'Bob', 'bob@example.com', $4, false)`, [ADMIN_ID, ALICE_ID, BOB_ID, passwordHash]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.drop();
});

const sql = (text: string, values: unknown[] = []) => db.pool.query(text, values);
const count = async (table: string, where = "true", values: unknown[] = []) => (
  Number((await sql(`SELECT count(*) FROM ${table} WHERE ${where}`, values)).rows[0]?.count)
);

const sessionAuth = (config: SessionAuthConfig = SECURE, pool: pg.Pool = db.pool): SessionAuth => ({
  config, sessions: new PostgresSessionRepository(pool, config),
});
/** null: the feature is off (no sessionAuth), as in production today. */
const appWith = (auth: SessionAuth | null = sessionAuth()) => createApp({ repositories: createRepositories(ALL_POSTGRES, db.pool), sessionAuth: auth ?? undefined });

// Origins outside the CORS allow-list are rejected by the existing cors()
// middleware before any route runs, with a 500 (pre-existing behaviour, see
// MIGRATION_PLAN.md R36). A missing Origin reaches the session code: 403.
const REFUSED_BY_CORS = 500;
const bearer = (id: string) => `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET ?? "", { expiresIn: "1h" })}`;
const tokenHash = (token: string) => createHash("sha256").update(token).digest();

// ----------------------------------------------------------- cookie helpers
interface ParsedCookie {
  name: string;
  value: string;
  attributes: Map<string, string>;
}

function setCookies(response: Response): ParsedCookie[] {
  const header: unknown = response.headers["set-cookie"];
  const lines = Array.isArray(header) ? header.filter((line): line is string => typeof line === "string") : [];
  return lines.map((line) => {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      attributes: new Map(attributes.map((attribute) => {
        const [key = "", ...rest] = attribute.split("=");
        return [key.toLowerCase(), rest.join("=")];
      })),
    };
  });
}

interface Login {
  response: Response;
  token: string;
  cookie: string;
  csrf: string;
}

async function login(app: ReturnType<typeof appWith>, email: string, options: { password?: string; cookie?: string; config?: SessionAuthConfig } = {}): Promise<Login> {
  const call = request(app).post("/api/auth/session").set("Origin", ORIGIN);
  if (options.cookie) call.set("Cookie", options.cookie);
  const response = await call.send({ email, password: options.password ?? PASSWORD });
  const name = (options.config ?? SECURE).cookieName;
  const token = setCookies(response).find((cookie) => cookie.name === name)?.value ?? "";
  return { response, token, cookie: `${name}=${token}`, csrf: String(response.body?.csrfToken ?? "") };
}

/** A cookie-authenticated, CSRF-protected request, as the Next.js app makes it. */
const unsafe = (method: "post" | "put" | "patch" | "delete", app: ReturnType<typeof appWith>, path: string, session: Login) => (
  request(app)[method](path).set("Cookie", session.cookie).set("Origin", ORIGIN).set("X-CSRF-Token", session.csrf)
);

// ----------------------------------------------------------- configuration
describe("configuration (auth/config.ts)", () => {
  const PG_USERS: DataSourceConfig = { ...ALL_MONGO, users: "postgres" };
  const env = (values: Record<string, string>) => ({ AUTH_COOKIE_SESSIONS: "true", AUTH_ALLOWED_ORIGINS: ORIGIN, ...values });

  test("disabled unless explicitly enabled", () => {
    expect(loadSessionAuthConfig({}, PG_USERS)).toBeNull();
    expect(loadSessionAuthConfig({ AUTH_COOKIE_SESSIONS: "false" }, PG_USERS)).toBeNull();
    expect(() => loadSessionAuthConfig({ AUTH_COOKIE_SESSIONS: "yes" }, PG_USERS)).toThrow(SessionConfigError);
  });

  test("refused in production, and without PostgreSQL users", () => {
    expect(() => loadSessionAuthConfig(env({ NODE_ENV: "production" }), PG_USERS)).toThrow(/cannot be enabled with NODE_ENV=production/);
    expect(() => loadSessionAuthConfig(env({}), ALL_MONGO)).toThrow(/DATA_SOURCE_USERS=postgres/);
  });

  test("secure by default: __Host- cookie, HTTPS origins only", () => {
    expect(loadSessionAuthConfig(env({}), PG_USERS)).toMatchObject({
      cookieName: SECURE_COOKIE_NAME, secureCookie: true, allowedOrigins: new Set([ORIGIN]),
      idleSeconds: 168 * 3600, absoluteSeconds: 720 * 3600, renewAfterSeconds: 900,
    });
    expect(() => loadSessionAuthConfig(env({ AUTH_ALLOWED_ORIGINS: "http://localhost:3001" }), PG_USERS)).toThrow(/must use https/);
  });

  test("local development cookie only when Secure is explicitly turned off", () => {
    expect(loadSessionAuthConfig(env({ AUTH_COOKIE_SECURE: "false", AUTH_ALLOWED_ORIGINS: "http://localhost:3001" }), PG_USERS))
      .toMatchObject({ cookieName: DEVELOPMENT_COOKIE_NAME, secureCookie: false });
  });

  test.each([
    ["", /needs AUTH_ALLOWED_ORIGINS/],
    ["https://shop.example.test/", /exact origin/],
    ["https://shop.example.test/path", /exact origin/],
    ["*", /not a URL/],
    ["javascript:alert(1)", /exact origin/],
  ])("rejects the origin list %j", (origins, message) => {
    expect(() => loadSessionAuthConfig(env({ AUTH_ALLOWED_ORIGINS: origins }), PG_USERS)).toThrow(message);
  });

  test("validates lifetimes", () => {
    expect(() => loadSessionAuthConfig(env({ AUTH_SESSION_IDLE_HOURS: "800" }), PG_USERS)).toThrow(/cannot exceed/);
    expect(() => loadSessionAuthConfig(env({ AUTH_SESSION_IDLE_HOURS: "1.5" }), PG_USERS)).toThrow(/whole number/);
    expect(() => loadSessionAuthConfig(env({ AUTH_SESSION_ABSOLUTE_HOURS: "0" }), PG_USERS)).toThrow(/whole number/);
  });
});

// ----------------------------------------------------------- login and logout
describe("login and logout", () => {
  test("login sets a host-only __Host- cookie (HttpOnly, Secure, SameSite=Lax, Path=/) and returns no token", async () => {
    const session = await login(appWith(), "alice@example.com");
    expect(session.response.status).toBe(200);
    expect(session.response.body).toEqual({
      user: { _id: ALICE_ID, name: "Alice", email: "alice@example.com", isAdmin: false },
      csrfToken: csrfTokenFor(session.token),
    });
    expect(session.response.headers["cache-control"]).toBe("no-store");

    const [cookie, ...others] = setCookies(session.response);
    expect(others).toEqual([]);
    expect(cookie?.name).toBe("__Host-ecom_session");
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes.has("httponly")).toBe(true);
    expect(cookie?.attributes.has("secure")).toBe(true);
    expect(cookie?.attributes.get("samesite")).toBe("Lax");
    expect(cookie?.attributes.get("path")).toBe("/");
    expect(cookie?.attributes.has("domain")).toBe(false);
    expect(Date.parse(cookie?.attributes.get("expires") ?? "")).toBeGreaterThan(Date.now() + 3500_000);

    // The token appears nowhere except the cookie: not in the body, not in the database.
    expect(JSON.stringify(session.response.body)).not.toContain(session.token);
    const { rows } = await sql("SELECT token_hash, row_to_json(auth_sessions)::text AS everything FROM auth_sessions");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toEqual(tokenHash(session.token));
    expect(rows[0]?.everything).not.toContain(session.token);
  });

  test("local development cookie: separate name, no Secure attribute", async () => {
    const config: SessionAuthConfig = { ...SECURE, cookieName: DEVELOPMENT_COOKIE_NAME, secureCookie: false };
    const session = await login(appWith(sessionAuth(config)), "alice@example.com", { config });
    const [cookie] = setCookies(session.response);
    expect(cookie?.name).toBe("ecom_dev_session");
    expect(cookie?.attributes.has("secure")).toBe(false);
    expect(cookie?.attributes.has("httponly")).toBe(true);
    expect(cookie?.attributes.get("samesite")).toBe("Lax");
    expect((await request(appWith(sessionAuth(config))).get("/api/auth/session").set("Cookie", session.cookie)).status).toBe(200);
  });

  test("invalid credentials: 401, the same message for unknown users, no cookie, no session", async () => {
    const app = appWith();
    const wrong = await login(app, "alice@example.com", { password: "wrong-password-000" });
    const unknown = await login(app, "nobody@example.com");
    for (const attempt of [wrong, unknown]) {
      expect(attempt.response.status).toBe(401);
      expect(attempt.response.body).toEqual({ message: "Invalid email or password" });
      expect(setCookies(attempt.response)).toEqual([]);
    }
    expect((await request(app).post("/api/auth/session").set("Origin", ORIGIN).send({ email: "alice@example.com" })).status).toBe(400);
    expect((await request(app).post("/api/auth/session").set("Origin", ORIGIN).type("form").send("email=alice@example.com&password=x")).status).toBe(415);
    expect(await count("auth_sessions")).toBe(0);
  });

  test.each([
    ["no Origin", undefined, 403],
    ["a foreign Origin", "https://evil.example", REFUSED_BY_CORS],
    ["the opaque null Origin", "null", REFUSED_BY_CORS],
    ["a look-alike Origin", "https://shop.example.test.evil.example", REFUSED_BY_CORS],
  ])("login with %s is refused (login CSRF) without creating a session", async (_label, origin, status) => {
    const call = request(appWith()).post("/api/auth/session");
    if (origin) call.set("Origin", origin);
    const response = await call.send({ email: "alice@example.com", password: PASSWORD });
    expect(response.status).toBe(status);
    expect(setCookies(response)).toEqual([]);
    expect(await count("auth_sessions")).toBe(0);
  });

  test("GET /api/auth/session returns the user and the CSRF token; signed out is 401", async () => {
    const app = appWith();
    const session = await login(app, "alice@example.com");
    const current = await request(app).get("/api/auth/session").set("Cookie", session.cookie);
    expect(current.status).toBe(200);
    expect(current.body).toEqual({ user: session.response.body.user, csrfToken: session.csrf });
    expect(current.headers["cache-control"]).toBe("no-store");
    expect((await request(app).get("/api/auth/session")).status).toBe(401);
  });

  test("logout needs Origin and CSRF; then the session is revoked and the cookie cleared", async () => {
    const app = appWith();
    const session = await login(app, "alice@example.com");

    expect((await request(app).delete("/api/auth/session").set("Cookie", session.cookie).set("Origin", ORIGIN)).status).toBe(403);
    expect((await request(app).delete("/api/auth/session").set("Cookie", session.cookie).set("Origin", ORIGIN).set("X-CSRF-Token", "x")).status).toBe(403);
    expect((await request(app).delete("/api/auth/session").set("Cookie", session.cookie).set("X-CSRF-Token", session.csrf)).status).toBe(403);
    expect((await request(app).delete("/api/auth/session").set("Cookie", session.cookie).set("Origin", "https://evil.example").set("X-CSRF-Token", session.csrf)).status).toBe(REFUSED_BY_CORS);
    expect(await count("auth_sessions", "revoked_at IS NULL")).toBe(1);

    const logout = await unsafe("delete", app, "/api/auth/session", session);
    expect(logout.status).toBe(204);
    const [cleared] = setCookies(logout);
    expect(cleared).toMatchObject({ name: "__Host-ecom_session", value: "" });
    expect(Date.parse(cleared?.attributes.get("expires") ?? "")).toBeLessThan(Date.now());
    expect((await sql("SELECT revoked_reason FROM auth_sessions")).rows).toEqual([{ revoked_reason: "logout" }]);

    expect((await request(app).get("/api/auth/session").set("Cookie", session.cookie)).status).toBe(401);
    expect((await request(app).get("/api/orders").set("Cookie", session.cookie)).status).toBe(401);
  });
});

// ----------------------------------------------------------- expiry, renewal and revocation
describe("expiry, renewal and revocation", () => {
  /** Inserts a session row directly, for states the API cannot produce on demand. */
  async function plantSession(columns: { created: string; idle: string; absolute: string; lastSeen?: string }) {
    const token = generateSessionToken();
    await sql(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at)
       VALUES ($1, $2, now() + $3::interval, now() + $4::interval, now() + $5::interval, now() + $6::interval)`,
      [tokenHash(token), ALICE_ID, columns.created, columns.lastSeen ?? columns.created, columns.idle, columns.absolute],
    );
    return `${SECURE_COOKIE_NAME}=${token}`;
  }

  test.each([
    ["idle timeout passed", { created: "-30 minutes", idle: "-1 second", absolute: "+1 hour" }],
    ["absolute lifetime passed", { created: "-3 hours", idle: "-1 hour", absolute: "-1 hour" }],
  ])("%s: 401 and the cookie is cleared", async (_label, columns) => {
    const response = await request(appWith()).get("/api/auth/session").set("Cookie", await plantSession(columns));
    expect(response.status).toBe(401);
    expect(setCookies(response)[0]).toMatchObject({ name: SECURE_COOKIE_NAME, value: "" });
  });

  test("an active session is renewed (sliding idle expiry), at most once per interval", async () => {
    const cookie = await plantSession({ created: "-10 minutes", lastSeen: "-5 minutes", idle: "+30 seconds", absolute: "+1 hour" });
    const app = appWith();

    const first = await request(app).get("/api/auth/session").set("Cookie", cookie);
    expect(first.status).toBe(200);
    const [renewed] = setCookies(first);
    expect(renewed?.name).toBe(SECURE_COOKIE_NAME);
    const { rows: [row] } = await sql("SELECT extract(epoch FROM idle_expires_at - now())::int AS left_seconds, idle_expires_at = absolute_expires_at AS capped FROM auth_sessions");
    // Extended to idle (1 h) but capped at the absolute expiry (also about 1 h away).
    expect(row?.left_seconds).toBeGreaterThan(3500);
    expect(row?.capped).toBe(true);

    const second = await request(app).get("/api/auth/session").set("Cookie", cookie);
    expect(second.status).toBe(200);
    expect(setCookies(second)).toEqual([]);
  });

  test("a revoked session is rejected", async () => {
    const app = appWith();
    const session = await login(app, "alice@example.com");
    await sql("UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'admin'");
    expect((await request(app).get("/api/auth/session").set("Cookie", session.cookie)).status).toBe(401);
  });
});

// ----------------------------------------------------------- fixation and tampering
describe("session fixation and tampered tokens", () => {
  test("login rotates: a session the browser already presented is revoked, never reused", async () => {
    const app = appWith();
    const planted = await login(app, "bob@example.com");

    const alice = await login(app, "alice@example.com", { cookie: planted.cookie });
    expect(alice.response.status).toBe(200);
    expect(alice.token).not.toBe(planted.token);
    expect((await sql("SELECT user_id, revoked_reason FROM auth_sessions ORDER BY created_at")).rows).toEqual([
      { user_id: BOB_ID, revoked_reason: "rotated" },
      { user_id: ALICE_ID, revoked_reason: null },
    ]);
    expect((await request(app).get("/api/auth/session").set("Cookie", planted.cookie)).status).toBe(401);
    expect((await request(app).get("/api/auth/session").set("Cookie", alice.cookie)).body.user._id).toBe(ALICE_ID);
  });

  test("an attacker-chosen cookie value is never adopted as a session", async () => {
    const chosen = generateSessionToken();
    const session = await login(appWith(), "alice@example.com", { cookie: `${SECURE_COOKIE_NAME}=${chosen}` });
    expect(session.token).not.toBe(chosen);
    expect(await count("auth_sessions", "token_hash = $1", [tokenHash(chosen)])).toBe(0);
  });

  test("invalid and tampered tokens are rejected without errors", async () => {
    const app = appWith();
    const session = await login(app, "alice@example.com");
    const flipped = `${session.token.slice(0, -1)}${session.token.endsWith("A") ? "B" : "A"}`;
    for (const value of [generateSessionToken(), flipped, `${session.token}x`, session.token.slice(1), "not a token", "%00", tokenHash(session.token).toString("base64url")]) {
      const response = await request(app).get("/api/auth/session").set("Cookie", `${SECURE_COOKIE_NAME}=${value}`);
      expect(response.status).toBe(401);
    }
    // The stored hash is not usable as a cookie, and another session's CSRF token does not fit.
    const bob = await login(app, "bob@example.com");
    expect((await request(app).post("/api/cart-items").set("Cookie", session.cookie).set("Origin", ORIGIN).set("X-CSRF-Token", bob.csrf).send({ productId: SOCKS, quantity: 1 })).status).toBe(403);
  });
});

// ----------------------------------------------------------- CSRF on application routes
describe("CSRF and Origin on application routes", () => {
  test("cart writes need the session's CSRF token and an allowed Origin; refused requests change nothing", async () => {
    const app = appWith();
    const alice = await login(app, "alice@example.com");
    const add = () => request(app).post("/api/cart-items").set("Cookie", alice.cookie);

    expect((await add().set("Origin", ORIGIN).send({ productId: SOCKS, quantity: 1 })).status).toBe(403);
    expect((await add().set("X-CSRF-Token", alice.csrf).send({ productId: SOCKS, quantity: 1 })).status).toBe(403);
    expect((await add().set("Origin", "https://evil.example").set("X-CSRF-Token", alice.csrf).send({ productId: SOCKS, quantity: 1 })).status).toBe(REFUSED_BY_CORS);
    expect((await add().set("Origin", "http://shop.example.test").set("X-CSRF-Token", alice.csrf).send({ productId: SOCKS, quantity: 1 })).status).toBe(REFUSED_BY_CORS);
    expect(await count("cart_items")).toBe(0);

    expect((await unsafe("post", app, "/api/cart-items", alice).send({ productId: SOCKS, quantity: 1 })).status).toBe(201);
    // Reads need no CSRF token.
    expect((await request(app).get("/api/cart-items").set("Cookie", alice.cookie)).body).toEqual([expect.objectContaining({ productId: SOCKS, quantity: 1 })]);

    expect((await request(app).put(`/api/cart-items/${SOCKS}`).set("Cookie", alice.cookie).set("Origin", ORIGIN).send({ quantity: 5 })).status).toBe(403);
    expect((await request(app).delete(`/api/cart-items/${SOCKS}`).set("Cookie", alice.cookie).set("Origin", ORIGIN)).status).toBe(403);
    expect((await sql("SELECT quantity FROM cart_items")).rows).toEqual([{ quantity: 1 }]);
    expect((await unsafe("put", app, `/api/cart-items/${SOCKS}`, alice).send({ quantity: 5 })).body.quantity).toBe(5);
  });

  test("an admin PATCH without CSRF is refused before the order is touched", async () => {
    const app = appWith();
    const alice = await login(app, "alice@example.com");
    await unsafe("post", app, "/api/cart-items", alice).send({ productId: SOCKS, quantity: 1 });
    const order = await unsafe("post", app, "/api/orders", alice).send({ customer: CUSTOMER });
    expect(order.status).toBe(201);

    const admin = await login(app, "admin@example.com");
    const path = `/api/orders/${String(order.body.id)}/status`;
    expect((await request(app).patch(path).set("Cookie", admin.cookie).set("Origin", ORIGIN).send({ status: "processing", reason: "x" })).status).toBe(403);
    expect((await sql("SELECT status FROM orders")).rows).toEqual([{ status: "placed" }]);
    expect((await unsafe("patch", app, path, admin).send({ status: "processing", reason: "picked" })).status).toBe(200);
  });
});

// ----------------------------------------------------------- authorisation
describe("authorisation and ownership are unchanged with cookie sessions", () => {
  test("users see only their own cart and orders; admin routes need an admin", async () => {
    const app = appWith();
    const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    await unsafe("post", app, "/api/cart-items", bob).send({ productId: BALL, quantity: 2 });
    await unsafe("post", app, "/api/cart-items", alice).send({ productId: SOCKS, quantity: 1 });
    const bobOrder = await unsafe("post", app, "/api/orders", bob).send({ customer: CUSTOMER });
    expect(bobOrder.status).toBe(201);

    expect((await request(app).get("/api/cart-items").set("Cookie", alice.cookie)).body).toEqual([expect.objectContaining({ productId: SOCKS })]);
    expect((await request(app).get("/api/orders").set("Cookie", alice.cookie)).body).toEqual([]);
    expect((await request(app).get(`/api/orders/${String(bobOrder.body.id)}`).set("Cookie", alice.cookie)).status).toBe(404);
    // Alice cannot change or remove a line that only exists in Bob's cart.
    expect((await unsafe("delete", app, `/api/cart-items/${BALL}`, alice)).status).toBe(404);

    expect((await unsafe("post", app, "/api/products", alice).send(PRODUCT_FORM)).status).toBe(403);
    expect((await unsafe("patch", app, `/api/orders/${String(bobOrder.body.id)}/status`, alice).send({ status: "processing", reason: "x" })).status).toBe(403);
    const admin = await login(app, "admin@example.com");
    expect((await unsafe("post", app, "/api/products", admin).send(PRODUCT_FORM)).status).toBe(201);
    expect((await request(app).get("/api/orders").set("Cookie", admin.cookie)).body).toHaveLength(1);
  });
});

// ----------------------------------------------------------- multiple sessions
describe("multiple sessions", () => {
  test("each device has its own session; logout ends one, logout everywhere ends all of that user's", async () => {
    const app = appWith();
    const laptop = await login(app, "alice@example.com");
    const phone = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    expect(laptop.token).not.toBe(phone.token);

    expect((await unsafe("delete", app, "/api/auth/session", laptop)).status).toBe(204);
    expect((await request(app).get("/api/auth/session").set("Cookie", laptop.cookie)).status).toBe(401);
    expect((await request(app).get("/api/auth/session").set("Cookie", phone.cookie)).status).toBe(200);

    const tablet = await login(app, "alice@example.com");
    expect((await unsafe("delete", app, "/api/auth/sessions", tablet)).status).toBe(204);
    for (const device of [phone, tablet]) {
      expect((await request(app).get("/api/auth/session").set("Cookie", device.cookie)).status).toBe(401);
    }
    expect((await request(app).get("/api/auth/session").set("Cookie", bob.cookie)).status).toBe(200);
    expect((await sql("SELECT revoked_reason, count(*)::int AS n FROM auth_sessions GROUP BY 1 ORDER BY 1 NULLS LAST")).rows).toEqual([
      { revoked_reason: "logout", n: 1 }, { revoked_reason: "logout_all", n: 2 }, { revoked_reason: null, n: 1 },
    ]);
  });
});

// ----------------------------------------------------------- legacy JWT compatibility
describe("legacy bearer-token compatibility", () => {
  test("the legacy endpoints and bearer requests behave exactly as without cookie sessions", async () => {
    const withSessions = appWith();
    const without = appWith(null);

    const legacy = await request(withSessions).post("/api/auth/login").send({ email: "alice@example.com", password: PASSWORD });
    expect(legacy.status).toBe(200);
    expect(Object.keys(legacy.body).sort()).toEqual(["_id", "email", "isAdmin", "name", "token"]);
    expect(setCookies(legacy)).toEqual([]);

    for (const app of [withSessions, without]) {
      const profile = await request(app).get("/api/auth/profile").set("Authorization", bearer(ALICE_ID));
      expect(profile.body).toEqual({ _id: ALICE_ID, name: "Alice", email: "alice@example.com", isAdmin: false });
    }
    // Bearer writes need no CSRF token: the token is not sent automatically by browsers.
    expect((await request(withSessions).post("/api/cart-items").set("Authorization", bearer(ALICE_ID)).send({ productId: SOCKS, quantity: 1 })).status).toBe(201);
    // A bearer token takes the legacy path even if a (stale) session cookie is present.
    expect((await request(withSessions).get("/api/cart-items").set("Authorization", bearer(ALICE_ID)).set("Cookie", `${SECURE_COOKIE_NAME}=${generateSessionToken()}`)).status).toBe(200);
    expect((await request(withSessions).get("/api/orders").set("Authorization", "Bearer not-a-jwt")).status).toBe(401);
  });

  test("a legacy token can be exchanged for a session (Origin-checked); the exchange needs a valid bearer token", async () => {
    const app = appWith();
    const exchange = () => request(app).post("/api/auth/session/exchange");

    expect((await exchange().set("Authorization", bearer(ALICE_ID))).status).toBe(403);
    expect((await exchange().set("Origin", ORIGIN).set("Authorization", "Bearer forged")).status).toBe(401);
    expect((await exchange().set("Origin", ORIGIN)).status).toBe(401);
    expect(await count("auth_sessions")).toBe(0);

    const exchanged = await exchange().set("Origin", ORIGIN).set("Authorization", bearer(ALICE_ID));
    expect(exchanged.status).toBe(200);
    expect(exchanged.body.user._id).toBe(ALICE_ID);
    const [cookie] = setCookies(exchanged);
    expect(cookie?.name).toBe(SECURE_COOKIE_NAME);
    expect((await request(app).get("/api/auth/session").set("Cookie", `${SECURE_COOKIE_NAME}=${cookie?.value ?? ""}`)).body.user._id).toBe(ALICE_ID);
  });

  test("with the feature off, session endpoints do not exist and session cookies are ignored", async () => {
    const off = appWith(null);
    expect((await request(off).post("/api/auth/session").send({ email: "alice@example.com", password: PASSWORD })).status).toBe(404);
    expect((await request(off).get("/api/auth/session")).status).toBe(404);
    const session = await login(appWith(), "alice@example.com");
    expect((await request(off).get("/api/orders").set("Cookie", session.cookie)).status).toBe(401);
  });
});

// ----------------------------------------------------------- database failures
describe("database failures and integrity", () => {
  test("a failed rotation rolls back: the presented session is not revoked", async () => {
    const app = appWith();
    const existing = await login(app, "alice@example.com");
    const sessions = new PostgresSessionRepository(db.pool, SECURE);
    await expect(sessions.create("ffffffffffffffffffffffff", "test", existing.token)).rejects.toMatchObject({ code: SQLSTATE.foreignKeyViolation });
    expect((await sql("SELECT revoked_at FROM auth_sessions")).rows).toEqual([{ revoked_at: null }]);
    expect((await request(app).get("/api/auth/session").set("Cookie", existing.cookie)).status).toBe(200);
  });

  test("when the session store is unreachable: 500, no cookie, and no token in the logs", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = new pg.Pool({ connectionString: "postgres://nobody:wrong@127.0.0.1:1/none", connectionTimeoutMillis: 2000 });
    try {
      const app = appWith(sessionAuth(SECURE, broken));
      const failedLogin = await login(app, "alice@example.com");
      expect(failedLogin.response.status).toBe(500);
      expect(failedLogin.response.body).toEqual({ message: "Server error" });
      expect(setCookies(failedLogin.response)).toEqual([]);

      const token = generateSessionToken();
      const lookup = await request(app).get("/api/auth/session").set("Cookie", `${SECURE_COOKIE_NAME}=${token}`);
      expect(lookup.status).toBe(500);
      expect(JSON.stringify(errors.mock.calls)).not.toContain(token);
      expect(await count("auth_sessions")).toBe(0);
    } finally {
      await broken.end();
    }
  });

  test("the schema guards session integrity (0004)", async () => {
    await login(appWith(), "alice@example.com");
    await expect(sql("UPDATE auth_sessions SET token_hash = $1", [randomBytes(32)])).rejects.toMatchObject({ code: SQLSTATE.restrictViolation });
    await expect(sql("UPDATE auth_sessions SET user_id = $1", [BOB_ID])).rejects.toMatchObject({ code: SQLSTATE.restrictViolation });
    await expect(sql("UPDATE auth_sessions SET absolute_expires_at = absolute_expires_at + interval '1 year'")).rejects.toMatchObject({ code: SQLSTATE.restrictViolation });
    await expect(sql("UPDATE auth_sessions SET idle_expires_at = absolute_expires_at + interval '1 second'")).rejects.toMatchObject({ code: SQLSTATE.checkViolation });
    await expect(sql("UPDATE auth_sessions SET revoked_at = now()")).rejects.toMatchObject({ code: SQLSTATE.checkViolation });
    await sql("UPDATE auth_sessions SET revoked_at = now(), revoked_reason = 'logout'");
    await expect(sql("UPDATE auth_sessions SET revoked_at = NULL, revoked_reason = NULL")).rejects.toMatchObject({ code: SQLSTATE.restrictViolation });
    await expect(sql(
      "INSERT INTO auth_sessions (token_hash, user_id, idle_expires_at, absolute_expires_at) VALUES ($1, $2, now() + interval '1 hour', now() + interval '2 hours')",
      [randomBytes(16), ALICE_ID],
    )).rejects.toMatchObject({ code: SQLSTATE.checkViolation });
  });

  test("cleanup deletes only sessions that finished before the retention period", async () => {
    const plant = (created: string, idle: string, absolute: string, revoked: string | null) => sql(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, revoked_reason)
       VALUES ($1, $2, now() + $3::interval, now() + $3::interval, now() + $4::interval, now() + $5::interval,
               now() + $6::interval, CASE WHEN $6::interval IS NULL THEN NULL ELSE 'logout' END)`,
      [randomBytes(32), ALICE_ID, created, idle, absolute, revoked],
    );
    await plant("-1 hour", "+1 hour", "+2 hours", null); // active: kept
    await plant("-40 days", "-10 days", "-9 days", null); // expired long ago: deleted
    await plant("-1 day", "-2 hours", "+5 days", null); // idle-expired recently: kept
    await plant("-20 days", "+1 day", "+5 days", "-8 days"); // revoked long ago: deleted
    await plant("-1 day", "+1 day", "+5 days", "-1 hour"); // revoked recently: kept

    const sessions = new PostgresSessionRepository(db.pool, SECURE);
    expect(await sessions.deleteExpired(7 * 86_400)).toBe(2);
    expect(await count("auth_sessions")).toBe(3);
  });

  test("the data-migration rollback refuses while sign-in sessions exist", async () => {
    await login(appWith(), "alice@example.com");
    await expect(rollbackImportedData(db.pool, { confirm: true, targetConnection: "test", migrationsDirectory: MIGRATIONS_DIRECTORY }))
      .rejects.toThrow(/sign-in sessions/);
    expect(await count("users")).toBe(3);
  });
});
