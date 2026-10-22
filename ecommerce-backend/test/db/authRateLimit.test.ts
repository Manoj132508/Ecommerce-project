// Phase 5 security hardening on PostgreSQL: the shared rate-limit store
// (migration 0005), limits on cookie-session login, account creation and
// token exchange, and the cookie-flow registration endpoint (POST /api/auth/accounts).
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createApp } from "../../app.js";
import { SECURE_COOKIE_NAME, type SessionAuthConfig } from "../../auth/config.js";
import { AuthRateLimiter, TOO_MANY_ATTEMPTS, type AuthRateLimitRules } from "../../auth/rateLimit.js";
import { PostgresRateLimitStore } from "../../auth/rateLimitStores.js";
import { PostgresSessionRepository } from "../../auth/sessionRepository.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { migrate } from "../../db/migrator.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, SQLSTATE, type TestDatabase } from "./helpers.js";

const ALL_POSTGRES: DataSourceConfig = {
  deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
};
const ORIGIN = "https://shop.example.test";
const ALICE_ID = "6ad8b3e08afe6f8ad3173cac";
const PASSWORD = "user-password-123";
const SESSIONS: SessionAuthConfig = {
  cookieName: SECURE_COOKIE_NAME, secureCookie: true, allowedOrigins: new Set([ORIGIN]),
  idleSeconds: 3600, absoluteSeconds: 7200, renewAfterSeconds: 60,
};
const RULES: AuthRateLimitRules = {
  loginPerIp: { name: "login-ip", limit: 50, windowSeconds: 900 },
  loginFailuresPerAccount: { name: "login-account", limit: 3, windowSeconds: 900 },
  registerPerIp: { name: "register-ip", limit: 3, windowSeconds: 900 },
  exchangePerIp: { name: "exchange-ip", limit: 2, windowSeconds: 900 },
};

let db: TestDatabase;

beforeAll(() => {
  process.env.JWT_SECRET = "rate-limit-tests-only-secret";
});

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  await db.pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Alice', 'alice@example.com', $2)",
    [ALICE_ID, await bcrypt.hash(PASSWORD, 4)]);
});

afterEach(async () => {
  await db.drop();
});

const appWith = (rules: AuthRateLimitRules = RULES) => createApp({
  repositories: createRepositories(ALL_POSTGRES, db.pool),
  sessionAuth: { config: SESSIONS, sessions: new PostgresSessionRepository(db.pool, SESSIONS) },
  rateLimiter: new AuthRateLimiter(new PostgresRateLimitStore(db.pool), rules, { trustProxyHops: 0 }),
});
const sessionLogin = (app: ReturnType<typeof appWith>, email: string, password = PASSWORD) => (
  request(app).post("/api/auth/session").set("Origin", ORIGIN).send({ email, password })
);
const count = async (table: string) => Number((await db.pool.query(`SELECT count(*) FROM ${table}`)).rows[0]?.count);
const key = (text: string) => createHash("sha256").update(text).digest();

describe("PostgreSQL store (0005)", () => {
  test("counts atomically, reports the window, starts a new window after expiry, and clears", async () => {
    const store = new PostgresRateLimitStore(db.pool);
    const results = await Promise.all(Array.from({ length: 30 }, () => store.hit(key("k"), 600)));
    expect(results.map((result) => result.hits).sort((a, b) => a - b)).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));
    expect(await store.peek(key("k"))).toMatchObject({ hits: 30 });
    expect((await store.peek(key("k"))).resetInSeconds).toBeGreaterThan(590);

    await db.pool.query("UPDATE auth_rate_limits SET window_started_at = now() - interval '20 minutes', expires_at = now() - interval '1 second'");
    expect(await store.peek(key("k"))).toEqual({ hits: 0, resetInSeconds: 0 });
    expect((await store.hit(key("k"), 600)).hits).toBe(1);

    await store.clear(key("k"));
    expect(await count("auth_rate_limits")).toBe(0);
  });

  test("cleanup removes only windows that ended before the retention period", async () => {
    const store = new PostgresRateLimitStore(db.pool);
    await store.hit(key("live"), 600);
    await store.hit(key("old"), 600);
    await db.pool.query("UPDATE auth_rate_limits SET window_started_at = now() - interval '9 days', expires_at = now() - interval '8 days' WHERE key = $1", [key("old")]);
    expect(await store.deleteExpired(7 * 86_400)).toBe(1);
    expect(await count("auth_rate_limits")).toBe(1);
  });

  test("the schema refuses malformed rows", async () => {
    await expect(db.pool.query("INSERT INTO auth_rate_limits VALUES ($1, 1, now(), now() + interval '1 minute')", [Buffer.alloc(8)]))
      .rejects.toMatchObject({ code: SQLSTATE.checkViolation });
    await expect(db.pool.query("INSERT INTO auth_rate_limits VALUES ($1, 0, now(), now() + interval '1 minute')", [key("x")]))
      .rejects.toMatchObject({ code: SQLSTATE.checkViolation });
  });
});

describe("cookie-session login limits", () => {
  test("account failures lock the account (no session is created), for known and unknown emails alike", async () => {
    const app = appWith();
    const known: number[] = [];
    const unknown: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      known.push((await sessionLogin(app, "alice@example.com", "wrong-password-0")).status);
      unknown.push((await sessionLogin(app, "nobody@example.com", "wrong-password-0")).status);
    }
    expect(known).toEqual([401, 401, 401, 429]);
    expect(unknown).toEqual(known);

    const locked = await sessionLogin(app, "alice@example.com");
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ message: TOO_MANY_ATTEMPTS });
    expect(locked.headers["set-cookie"]).toBeUndefined();
    expect(await count("auth_sessions")).toBe(0);

    await db.pool.query("UPDATE auth_rate_limits SET window_started_at = now() - interval '20 minutes', expires_at = now() - interval '1 second'");
    expect((await sessionLogin(app, "alice@example.com")).status).toBe(200);
  });

  test("legacy and cookie logins share one per-address budget", async () => {
    const app = appWith({ ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 2 } });
    expect((await request(app).post("/api/auth/login").send({ email: "x@example.com", password: "wrong-password-0" })).status).toBe(401);
    expect((await sessionLogin(app, "y@example.com", "wrong-password-0")).status).toBe(401);
    expect((await sessionLogin(app, "alice@example.com")).status).toBe(429);
  });

  test("a request from a rejected origin is refused before it is counted or changes anything", async () => {
    const response = await request(appWith()).post("/api/auth/session").set("Origin", "https://evil.example").send({ email: "alice@example.com", password: PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ message: "Origin not allowed" });
    expect(await count("auth_rate_limits")).toBe(0);
    expect(await count("auth_sessions")).toBe(0);
  });

  test("token exchange is limited per address", async () => {
    const app = appWith();
    const token = jwt.sign({ id: ALICE_ID }, process.env.JWT_SECRET ?? "", { expiresIn: "1h" });
    const exchange = () => request(app).post("/api/auth/session/exchange").set("Origin", ORIGIN).set("Authorization", `Bearer ${token}`);
    expect((await exchange()).status).toBe(200);
    expect((await exchange()).status).toBe(200);
    expect((await exchange()).status).toBe(429);
    expect(await count("auth_sessions")).toBe(2);
  });
});

describe("registration for the cookie-session flow (POST /api/auth/accounts)", () => {
  const create = (app: ReturnType<typeof appWith>, body: unknown, origin: string | null = ORIGIN) => {
    const call = request(app).post("/api/auth/accounts");
    if (origin) call.set("Origin", origin);
    return call.send(body as object);
  };

  test("register → sign in → profile: the account is created without any token or session, then the normal login applies", async () => {
    const app = appWith();
    const created = await create(app, { name: "  Nora  ", email: " Nora@Example.com ", password: "nora-password-1" });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ user: { _id: expect.stringMatching(/^[0-9a-f]{24}$/), name: "Nora", email: "nora@example.com", isAdmin: false } });
    expect(created.headers["set-cookie"]).toBeUndefined();
    expect(JSON.stringify(created.body)).not.toMatch(/token|csrf|password/i);
    expect(await count("auth_sessions")).toBe(0);

    const signedIn = await sessionLogin(app, "nora@example.com", "nora-password-1");
    expect(signedIn.status).toBe(200);
    const cookie = String(signedIn.headers["set-cookie"]?.[0] ?? "").split(";")[0] ?? "";
    const profile = await request(app).get("/api/auth/session").set("Cookie", cookie);
    expect(profile.body.user).toEqual(created.body.user);
  });

  test("the same validation and errors as the legacy registration", async () => {
    const app = appWith({ ...RULES, registerPerIp: { ...RULES.registerPerIp, limit: 100 } });
    const legacyInvalid = await request(app).post("/api/auth/register").send({ name: "", email: "bad", password: "short" });
    const invalid = await create(app, { name: "", email: "bad", password: "short" });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toEqual(legacyInvalid.body);
    expect((await create(app, { name: "A", email: "a@example.com", password: "x".repeat(73) })).status).toBe(400);
    expect(await create(app, { name: "Alice", email: "ALICE@example.com", password: PASSWORD })).toMatchObject({ status: 409, body: { message: "User already exists" } });
    expect(await count("users")).toBe(1);
  });

  test("Origin and JSON are required; nothing is created otherwise", async () => {
    const app = appWith({ ...RULES, registerPerIp: { ...RULES.registerPerIp, limit: 100 } });
    const body = { name: "Mallory", email: "mallory@example.com", password: "mallory-password-1" };
    expect((await create(app, body, null)).status).toBe(403);
    expect((await create(app, body, "https://evil.example")).status).toBe(403);
    expect((await request(app).post("/api/auth/accounts").set("Origin", ORIGIN).type("form").send("name=M&email=m@example.com&password=mallory-password-1")).status).toBe(415);
    expect(await count("users")).toBe(1);
  });

  test("account creation shares the per-address registration budget with the legacy endpoint", async () => {
    const app = appWith();
    expect((await request(app).post("/api/auth/register").send({ name: "One", email: "one@example.com", password: "password-12345" })).status).toBe(201);
    expect((await create(app, { name: "Two", email: "two@example.com", password: "password-12345" })).status).toBe(201);
    expect((await create(app, { name: "Three", email: "three@example.com", password: "password-12345" })).status).toBe(201);
    const limited = await create(app, { name: "Four", email: "four@example.com", password: "password-12345" });
    expect(limited.status).toBe(429);
    expect(await count("users")).toBe(4);
  });

  test("a server failure is a generic 500 without details", async () => {
    const app = appWith();
    await db.pool.query("ALTER TABLE users RENAME TO users_unavailable");
    const failed = await create(app, { name: "Nora", email: "nora@example.com", password: "nora-password-1" });
    expect(failed.status).toBe(500);
    expect(failed.body).toEqual({ message: "Server error" });
  });
});
