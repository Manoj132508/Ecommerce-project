// Phase 5 security hardening on the legacy (MongoDB) API: authentication rate
// limits with the shared MongoDB store (R37), client-address handling behind
// proxies, and account-existence protection. In-memory MongoDB per test file.
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../app.js";
import { rateLimitSubject } from "../auth/clientIp.js";
import { AuthRateLimiter, loadAuthRateLimitRules, TOO_MANY_ATTEMPTS } from "../auth/rateLimit.js";
import { MONGO_RATE_LIMIT_COLLECTION, MongoRateLimitStore } from "../auth/rateLimitStores.js";
import User from "../models/User.js";

const PASSWORD = "right-password-123";
const RULES = {
  loginPerIp: { name: "login-ip", limit: 6, windowSeconds: 900 },
  loginFailuresPerAccount: { name: "login-account", limit: 3, windowSeconds: 900 },
  registerPerIp: { name: "register-ip", limit: 2, windowSeconds: 900 },
  exchangePerIp: { name: "exchange-ip", limit: 2, windowSeconds: 900 },
};

const store = () => new MongoRateLimitStore(() => mongoose.connection.db);
const appWith = ({ rules = RULES, trustProxyHops = 0, proxySecret } = {}) => createApp({
  rateLimiter: new AuthRateLimiter(store(), rules, { trustProxyHops, ...(proxySecret ? { proxySecret } : {}) }),
  trustProxyHops,
});
const login = (app, email, password = PASSWORD, headers = {}) => request(app).post("/api/auth/login").set(headers).send({ email, password });
const counters = () => mongoose.connection.db.collection(MONGO_RATE_LIMIT_COLLECTION);

async function createUser(email = "alice@example.com") {
  await User.collection.insertOne({ name: "Alice", email, password: await bcrypt.hash(PASSWORD, 4), isAdmin: false, createdAt: new Date(), updatedAt: new Date() });
}

/** Ends every current window, as if the configured time had passed. */
const expireWindows = () => counters().updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

describe("configuration", () => {
  test("on by default with the documented limits; off only outside production", () => {
    expect(loadAuthRateLimitRules({})).toEqual({
      loginPerIp: { name: "login-ip", limit: 20, windowSeconds: 900 },
      loginFailuresPerAccount: { name: "login-account", limit: 10, windowSeconds: 900 },
      registerPerIp: { name: "register-ip", limit: 10, windowSeconds: 900 },
      exchangePerIp: { name: "exchange-ip", limit: 20, windowSeconds: 900 },
    });
    expect(loadAuthRateLimitRules({ AUTH_RATE_LIMIT: "false" })).toBeNull();
    expect(() => loadAuthRateLimitRules({ AUTH_RATE_LIMIT: "false", NODE_ENV: "production" })).toThrow(/cannot be turned off/);
    expect(() => loadAuthRateLimitRules({ AUTH_RATE_LIMIT: "no" })).toThrow(/"true" or "false"/);
    expect(() => loadAuthRateLimitRules({ AUTH_RATE_LIMIT_LOGIN_PER_IP: "0" })).toThrow(/whole number/);
    expect(loadAuthRateLimitRules({ AUTH_RATE_LIMIT_WINDOW_MINUTES: "5", AUTH_RATE_LIMIT_LOGIN_PER_IP: "50" })?.loginPerIp)
      .toEqual({ name: "login-ip", limit: 50, windowSeconds: 300 });
  });
});

describe("brute force on the legacy login", () => {
  test("an account is locked after the failure limit, even for the right password, then recovers when the window ends", async () => {
    await createUser();
    const app = appWith({ rules: { ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 100 } } });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await login(app, "alice@example.com", "wrong-password-0")).status).toBe(401);
    }
    const locked = await login(app, "alice@example.com", PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ message: TOO_MANY_ATTEMPTS });
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(800);
    expect(locked.headers["cache-control"]).toBe("no-store");

    await expireWindows();
    const recovered = await login(app, "alice@example.com", PASSWORD);
    expect(recovered.status).toBe(200);
    expect(Object.keys(recovered.body).sort()).toEqual(["_id", "email", "isAdmin", "name", "token"]);
  });

  test("a successful login clears the account's failures", async () => {
    await createUser();
    const app = appWith({ rules: { ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 100 } } });
    for (let round = 0; round < 3; round += 1) {
      expect((await login(app, "alice@example.com", "wrong-password-0")).status).toBe(401);
      expect((await login(app, "alice@example.com", "wrong-password-0")).status).toBe(401);
      expect((await login(app, "alice@example.com")).status).toBe(200);
    }
  });

  test("simultaneous wrong passwords: exactly the account limit is checked (counted before the check)", async () => {
    await createUser();
    const app = appWith({ rules: { ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 100 } } });
    const statuses = (await Promise.all(Array.from({ length: 10 }, () => login(app, "alice@example.com", "wrong-password-0"))))
      .map((response) => response.status).sort();
    expect(statuses).toEqual([401, 401, 401, 429, 429, 429, 429, 429, 429, 429]);
    expect((await login(app, "alice@example.com")).status).toBe(429);
  });

  test("unknown accounts are limited exactly like real ones (no existence signal)", async () => {
    await createUser();
    const app = appWith({ rules: { ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 100 } } });
    const responses = { known: [], unknown: [] };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.known.push(await login(app, "alice@example.com", "wrong-password-0"));
      responses.unknown.push(await login(app, "nobody@example.com", "wrong-password-0"));
    }
    const shape = (list) => list.map((response) => [response.status, JSON.stringify(response.body)]);
    expect(shape(responses.unknown)).toEqual(shape(responses.known));
    expect(responses.known.map((response) => response.status)).toEqual([401, 401, 401, 429]);
  });

  test("unknown emails cost the same bcrypt work as wrong passwords", async () => {
    await createUser();
    const compare = vi.spyOn(bcrypt, "compare");
    await login(appWith(), "nobody@example.com", "wrong-password-0");
    await login(appWith(), "alice@example.com", "wrong-password-0");
    expect(compare).toHaveBeenCalledTimes(2);
  });

  test("the per-address limit covers every login attempt across accounts", async () => {
    const app = appWith();
    const statuses = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      statuses.push((await login(app, `user${attempt}@example.com`, "wrong-password-0")).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 429, 429]);
  });

  test("registration is limited per address; limited requests create nothing", async () => {
    const app = appWith();
    const register = (n) => request(app).post("/api/auth/register").send({ name: "New", email: `new${n}@example.com`, password: "password-12345" });
    expect((await register(1)).status).toBe(201);
    expect((await register(2)).status).toBe(201);
    const limited = await register(3);
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: TOO_MANY_ATTEMPTS });
    expect(await User.countDocuments()).toBe(2);
  });

  test("counters store neither email addresses nor client addresses", async () => {
    await login(appWith(), "alice@example.com", "wrong-password-0");
    const documents = await counters().find({}).toArray();
    expect(documents).toHaveLength(2);
    const text = JSON.stringify(documents);
    expect(text).not.toMatch(/alice|example\.com|127\.0\.0\.1|::1/);
    expect(documents.map((document) => document._id)).toContain(
      createHash("sha256").update("login-account\x00alice@example.com").digest("hex"),
    );
    // A TTL index removes ended windows on its own.
    expect(await counters().indexExists("expiresAt_ttl")).toBe(true);
  });

  test("simultaneous attempts are all counted (atomic upsert)", async () => {
    const app = appWith({ rules: { ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 1000 } } });
    await Promise.all(Array.from({ length: 25 }, () => login(app, "race@example.com", "wrong-password-0")));
    const key = createHash("sha256").update("login-ip\x00127.0.0.1").digest("hex");
    expect((await counters().findOne({ _id: key }))?.hits).toBe(25);
  });

  test("when the counter store fails, sign-in is refused (503), never allowed unchecked", async () => {
    await createUser();
    const failing = { hit: () => Promise.reject(new Error("store down")), peek: () => Promise.reject(new Error("store down")), clear: () => Promise.resolve() };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({ rateLimiter: new AuthRateLimiter(failing, RULES, { trustProxyHops: 0 }) });
    const response = await login(app, "alice@example.com");
    expect(response.status).toBe(503);
    expect(response.body.token).toBeUndefined();
    expect(errors).toHaveBeenCalled();
  });
});

describe("client addresses behind proxies", () => {
  const LIMIT_ONE = { ...RULES, loginPerIp: { ...RULES.loginPerIp, limit: 1 } };
  // A new email for every attempt, so only the per-address rule can respond 429.
  let attempt = 0;
  const fresh = () => `proxy${(attempt += 1)}@example.com`;

  test("with no trusted proxy, X-Forwarded-For is ignored: rotating it does not reset the limit", async () => {
    const app = appWith({ rules: LIMIT_ONE });
    expect((await login(app, fresh(), "x-password-0", { "X-Forwarded-For": "203.0.113.1" })).status).toBe(401);
    expect((await login(app, fresh(), "x-password-0", { "X-Forwarded-For": "203.0.113.2" })).status).toBe(429);
  });

  test("with one trusted proxy (Render), each client address has its own budget, and a spoofed leftmost value is ignored", async () => {
    const app = appWith({ rules: LIMIT_ONE, trustProxyHops: 1 });
    expect((await login(app, fresh(), "x-password-0", { "X-Forwarded-For": "203.0.113.1" })).status).toBe(401);
    expect((await login(app, fresh(), "x-password-0", { "X-Forwarded-For": "203.0.113.2" })).status).toBe(401);
    // The proxy appends the real address; the client-supplied first entry is not believed.
    expect((await login(app, fresh(), "x-password-0", { "X-Forwarded-For": "198.51.100.9, 203.0.113.1" })).status).toBe(429);
  });

  test("X-Client-IP counts only with the shared proxy secret", async () => {
    const proxySecret = "s".repeat(40);
    const app = appWith({ rules: LIMIT_ONE, proxySecret });
    const viaProxy = (ip, secret = proxySecret) => login(app, fresh(), "x-password-0", { "X-Client-IP": ip, "X-Proxy-Secret": secret });
    expect((await viaProxy("203.0.113.1")).status).toBe(401);
    expect((await viaProxy("203.0.113.2")).status).toBe(401);
    expect((await viaProxy("203.0.113.1")).status).toBe(429);
    // Without the secret (or with a wrong one), the stated address is ignored:
    // these all fall back to the socket address and share its budget.
    expect((await login(app, fresh(), "x-password-0", { "X-Client-IP": "203.0.113.50" })).status).toBe(401);
    expect((await viaProxy("203.0.113.51", "wrong-secret")).status).toBe(429);
    expect((await viaProxy("not-an-ip")).status).toBe(429);
  });

  test("subjects: IPv4 as is, IPv4-mapped IPv6 unwrapped, IPv6 grouped by /64", () => {
    expect(rateLimitSubject("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitSubject("2001:db8:abcd:12:1:2:3:4")).toBe("2001:db8:abcd:12::/64");
    expect(rateLimitSubject("2001:db8:abcd:12::99")).toBe("2001:db8:abcd:12::/64");
    expect(rateLimitSubject("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(rateLimitSubject("garbage")).toBe("unknown");
  });
});

describe("legacy-client compatibility", () => {
  test("normal use is unaffected: register, login and profile responses keep their shape", async () => {
    const app = appWith();
    const registered = await request(app).post("/api/auth/register").set("Origin", "http://localhost:5173")
      .send({ name: "Vite User", email: "vite@example.com", password: PASSWORD });
    expect(registered.status).toBe(201);
    expect(registered.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const signedIn = await login(app, "vite@example.com", PASSWORD, { Origin: "http://localhost:5173" });
    expect(signedIn.status).toBe(200);
    expect(Object.keys(signedIn.body).sort()).toEqual(["_id", "email", "isAdmin", "name", "token"]);
    const profile = await request(app).get("/api/auth/profile").set("Authorization", `Bearer ${signedIn.body.token}`);
    expect(profile.body).toEqual({ _id: signedIn.body._id, name: "Vite User", email: "vite@example.com", isAdmin: false });
  });

  test("an app without a limiter (tests, AUTH_RATE_LIMIT=false) behaves as before", async () => {
    const app = createApp();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await login(app, "nobody@example.com", "wrong-password-0")).status).toBe(401);
    }
    expect(await counters().countDocuments()).toBe(0);
  });
});
