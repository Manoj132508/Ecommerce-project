// CURRENT BEHAVIOUR — KNOWN SECURITY WEAKNESS (Phase 7A review). NOT THE TARGET CONTRACT.
//
// The per-account failure limit is check-then-act: AuthRateLimiter.authenticate()
// peeks at the failure count, checks the password (bcrypt, slow), and only then
// records a failure. Simultaneous wrong-password attempts all see the count from
// before the burst, so more than `loginFailuresPerAccount.limit` guesses are
// checked. The per-address limit is atomic (increment, then compare) and still
// bounds a burst from one address; the account is locked as soon as the burst
// has been counted. This file keeps the weakness visible and pins what still
// holds. When the limiter counts before checking (MIGRATION_PLAN.md 7A), replace
// the first expectation with "exactly `limit` attempts are checked".
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
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
const PER_ADDRESS_LIMIT = 8;
const RULES: AuthRateLimitRules = {
  loginPerIp: { name: "login-ip", limit: PER_ADDRESS_LIMIT, windowSeconds: 900 },
  loginFailuresPerAccount: { name: "login-account", limit: ACCOUNT_LIMIT, windowSeconds: 900 },
  registerPerIp: { name: "register-ip", limit: 3, windowSeconds: 900 },
  exchangePerIp: { name: "exchange-ip", limit: 2, windowSeconds: 900 },
};

let db: TestDatabase;

beforeEach(async () => {
  process.env.JWT_SECRET = "concurrent-flaw-tests-only-secret";
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  // Cost 12, as for real accounts: the slow check is what opens the window.
  await db.pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('6ad8b3e08afe6f8ad3173cac', 'Alice', 'alice@example.com', $1)",
    [await bcrypt.hash("user-password-123", 12)]);
});

afterEach(async () => {
  await db.drop();
});

describe("simultaneous wrong-password sign-ins (one address)", () => {
  test("more guesses than the account limit are checked; the per-address limit and the lock still hold", async () => {
    const app = createApp({
      repositories: createRepositories(ALL_POSTGRES, db.pool),
      sessionAuth: { config: SESSIONS, sessions: new PostgresSessionRepository(db.pool, SESSIONS) },
      rateLimiter: new AuthRateLimiter(new PostgresRateLimitStore(db.pool), RULES, { trustProxyHops: 0 }),
    });
    const attempt = () => request(app).post("/api/auth/session").set("Origin", ORIGIN).send({ email: "alice@example.com", password: "wrong-password-0" });

    const statuses = (await Promise.all(Array.from({ length: 12 }, attempt))).map((response) => response.status);
    const checked = statuses.filter((status) => status === 401).length;

    // The weakness: guesses checked beyond the account limit (with sequential attempts it is exactly 3).
    expect(checked).toBeGreaterThan(ACCOUNT_LIMIT);
    // Still holds: the atomic per-address limit caps the burst; everything else is refused.
    expect(checked).toBeLessThanOrEqual(PER_ADDRESS_LIMIT);
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
    // Still holds: afterwards the account is locked, even for the right password, and no session exists.
    const right = await request(app).post("/api/auth/session").set("Origin", ORIGIN).send({ email: "alice@example.com", password: "user-password-123" });
    expect(right.status).toBe(429);
    expect(Number((await db.pool.query("SELECT count(*) FROM auth_sessions")).rows[0]?.count)).toBe(0);
  }, 60_000);
});
