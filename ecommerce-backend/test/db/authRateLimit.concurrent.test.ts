// Simultaneous sign-ins against the per-account failure limit (Phase 7A finding,
// fixed). AuthRateLimiter.authenticate() counts the attempt with one atomic
// upsert before the slow password check, so a burst cannot all see the count
// from before it: at most `limit` passwords are checked per window, from one
// address or from many. Until the fix, 12 simultaneous guesses had 4–8 checked.
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../../app.js";
import { SECURE_COOKIE_NAME, type SessionAuthConfig } from "../../auth/config.js";
import { AuthRateLimiter, type AuthRateLimitRules } from "../../auth/rateLimit.js";
import { PostgresRateLimitStore } from "../../auth/rateLimitStores.js";
import { PostgresSessionRepository } from "../../auth/sessionRepository.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { migrate } from "../../db/migrator.js";
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
const ACCOUNT_LIMIT = 3;
const PASSWORD = "user-password-123";
const rules = (perAddress: number): AuthRateLimitRules => ({
  loginPerIp: { name: "login-ip", limit: perAddress, windowSeconds: 900 },
  loginFailuresPerAccount: { name: "login-account", limit: ACCOUNT_LIMIT, windowSeconds: 900 },
  registerPerIp: { name: "register-ip", limit: 3, windowSeconds: 900 },
  exchangePerIp: { name: "exchange-ip", limit: 2, windowSeconds: 900 },
});
const accountKey = createHash("sha256").update("login-account\0alice@example.com").digest();

let db: TestDatabase;

beforeEach(async () => {
  process.env.JWT_SECRET = "concurrent-limit-tests-only-secret";
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  // Cost 12, as for real accounts: the slow check is what opened the window before the fix.
  await db.pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('6ad8b3e08afe6f8ad3173cac', 'Alice', 'alice@example.com', $1)",
    [await bcrypt.hash(PASSWORD, 12)]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.drop();
});

function appWith({ perAddress = 50, trustProxyHops = 0, repositories = createRepositories(ALL_POSTGRES, db.pool) } = {}) {
  return createApp({
    repositories,
    sessionAuth: { config: SESSIONS, sessions: new PostgresSessionRepository(db.pool, SESSIONS) },
    rateLimiter: new AuthRateLimiter(new PostgresRateLimitStore(db.pool), rules(perAddress), { trustProxyHops }),
    trustProxyHops,
  });
}
const signIn = (app: ReturnType<typeof appWith>, password: string, headers: Record<string, string> = {}) => (
  request(app).post("/api/auth/session").set("Origin", ORIGIN).set(headers).send({ email: "alice@example.com", password })
);
const sessionCount = async () => Number((await db.pool.query("SELECT count(*) FROM auth_sessions")).rows[0]?.count);
const accountHits = async () => (await db.pool.query<{ hits: number }>("SELECT hits FROM auth_rate_limits WHERE key = $1", [accountKey])).rows[0]?.hits ?? 0;
const tally = (statuses: number[]) => statuses.reduce<Record<number, number>>((counts, status) => ({ ...counts, [status]: (counts[status] ?? 0) + 1 }), {});

describe("simultaneous sign-ins and the per-account limit", () => {
  test("12 simultaneous wrong passwords from one address: exactly the account limit is checked", async () => {
    const app = appWith();
    const statuses = (await Promise.all(Array.from({ length: 12 }, () => signIn(app, "wrong-password-0")))).map((response) => response.status);
    expect(tally(statuses)).toEqual({ 401: ACCOUNT_LIMIT, 429: 12 - ACCOUNT_LIMIT });
    // Locked afterwards, even for the right password; no session exists.
    expect((await signIn(app, PASSWORD)).status).toBe(429);
    expect(await sessionCount()).toBe(0);
  }, 60_000);

  test("12 simultaneous wrong passwords from 12 addresses: the account limit holds without the per-address limit", async () => {
    const app = appWith({ perAddress: 1, trustProxyHops: 1 });
    const statuses = (await Promise.all(Array.from({ length: 12 }, (_, index) => (
      signIn(app, "wrong-password-0", { "X-Forwarded-For": `203.0.113.${index + 1}` })
    )))).map((response) => response.status);
    expect(tally(statuses)).toEqual({ 401: ACCOUNT_LIMIT, 429: 12 - ACCOUNT_LIMIT });
    expect(await sessionCount()).toBe(0);
  }, 60_000);

  test("with one attempt left, 5 simultaneous right passwords: exactly one is checked and signs in", async () => {
    const app = appWith();
    for (let failure = 1; failure < ACCOUNT_LIMIT; failure += 1) expect((await signIn(app, "wrong-password-0")).status).toBe(401);
    const statuses = (await Promise.all(Array.from({ length: 5 }, () => signIn(app, PASSWORD)))).map((response) => response.status);
    expect(tally(statuses)).toEqual({ 200: 1, 429: 4 });
    expect(await sessionCount()).toBe(1);
  }, 60_000);

  test("sequential behaviour is unchanged: limit − 1 failures, then the right password signs in and clears the count", async () => {
    const app = appWith();
    for (let failure = 1; failure < ACCOUNT_LIMIT; failure += 1) expect((await signIn(app, "wrong-password-0")).status).toBe(401);
    expect((await signIn(app, PASSWORD)).status).toBe(200);
    expect(await accountHits()).toBe(0);
    // A fresh budget afterwards.
    for (let failure = 1; failure <= ACCOUNT_LIMIT; failure += 1) expect((await signIn(app, "wrong-password-0")).status).toBe(401);
    expect((await signIn(app, PASSWORD)).status).toBe(429);
  }, 60_000);

  test("a failing password check is a generic 500 and still counts as an attempt (fail closed)", async () => {
    const repositories = createRepositories(ALL_POSTGRES, db.pool);
    vi.spyOn(repositories.users, "authenticate").mockRejectedValue(new Error("connect ECONNREFUSED 10.20.30.40:5432"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = appWith({ repositories });
    const response = await signIn(app, PASSWORD);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
    expect(JSON.stringify(response.body)).not.toMatch(/ECONNREFUSED|10\.20/);
    expect(errors).toHaveBeenCalled();
    expect(await accountHits()).toBe(1);
    expect(await sessionCount()).toBe(0);
  });

  test("when the account counter cannot be written, the password is not checked and no session starts", async () => {
    // The per-address counter works; only the per-account one fails.
    const store = new PostgresRateLimitStore(db.pool);
    const hit = store.hit.bind(store);
    vi.spyOn(store, "hit").mockImplementation((key, windowSeconds) => (
      key.equals(accountKey) ? Promise.reject(new Error("store down")) : hit(key, windowSeconds)
    ));
    const repositories = createRepositories(ALL_POSTGRES, db.pool);
    const check = vi.spyOn(repositories.users, "authenticate");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({
      repositories,
      sessionAuth: { config: SESSIONS, sessions: new PostgresSessionRepository(db.pool, SESSIONS) },
      rateLimiter: new AuthRateLimiter(store, rules(50), { trustProxyHops: 0 }),
    });
    const response = await signIn(app, PASSWORD);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
    expect(check).not.toHaveBeenCalled();
    expect(await sessionCount()).toBe(0);
  });
});
