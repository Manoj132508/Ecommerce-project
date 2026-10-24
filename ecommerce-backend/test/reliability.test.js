// Reliability (Phase 7A): pool settings, liveness/readiness and graceful
// shutdown. Database failures against real PostgreSQL are in
// test/db/reliability.test.ts; these run with the in-memory MongoDB.
import { createServer } from "node:http";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../app.js";
import { apiPoolConfig, loadPostgresTimeouts, PostgresOptionsError } from "../config/postgresOptions.js";
import { isReady, mongoReadiness } from "../health.js";
import { createShutdown, loadShutdownTimeout, ShutdownConfigError } from "../lifecycle.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PostgreSQL pool settings for the API", () => {
  test("defaults: 10 connections, 5 s to connect, 10 s per statement and idle in a transaction", () => {
    const timeouts = loadPostgresTimeouts({});
    expect(timeouts).toEqual({ max: 10, connectTimeoutMs: 5000, statementTimeoutMs: 10000, idleInTransactionTimeoutMs: 10000 });
    expect(apiPoolConfig("postgres://example.invalid/db", timeouts)).toEqual({
      connectionString: "postgres://example.invalid/db",
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      idle_in_transaction_session_timeout: 10000,
      application_name: "ecommerce-api",
      keepAlive: true,
    });
  });

  test("overrides are whole numbers within range; anything else stops start-up", () => {
    expect(loadPostgresTimeouts({ PG_POOL_MAX: "20", PG_STATEMENT_TIMEOUT_MS: "3000" })).toMatchObject({ max: 20, statementTimeoutMs: 3000 });
    for (const env of [{ PG_POOL_MAX: "0" }, { PG_CONNECT_TIMEOUT_MS: "5s" }, { PG_STATEMENT_TIMEOUT_MS: "-1" }, { PG_IDLE_IN_TRANSACTION_TIMEOUT_MS: "999999" }]) {
      expect(() => loadPostgresTimeouts(env)).toThrow(PostgresOptionsError);
    }
  });

  test("shutdown timeout: 10 s by default, validated", () => {
    expect(loadShutdownTimeout({})).toBe(10000);
    expect(loadShutdownTimeout({ SHUTDOWN_TIMEOUT_MS: "25000" })).toBe(25000);
    expect(() => loadShutdownTimeout({ SHUTDOWN_TIMEOUT_MS: "ten" })).toThrow(ShutdownConfigError);
  });
});

describe("GET /healthz and GET /readyz", () => {
  const never = { name: "stalled", check: () => new Promise(() => {}) };
  const failing = { name: "postgres", check: () => Promise.reject(new Error("connect ECONNREFUSED 10.20.30.40:5432")) };

  test("liveness answers without touching a database", async () => {
    const response = await request(createApp({ readiness: { shuttingDown: () => false, checks: [failing] } })).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("ready when the connected MongoDB answers a ping", async () => {
    const app = createApp({ readiness: { shuttingDown: () => false, checks: [mongoReadiness(mongoose.connection)] } });
    const response = await request(app).get("/readyz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });

  test("503 without details when a store fails, stalls past the timeout, or is not connected", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unconnected = mongoose.createConnection();
    for (const check of [failing, never, mongoReadiness(unconnected)]) {
      const started = Date.now();
      const response = await request(createApp({ readiness: { shuttingDown: () => false, checks: [check], timeoutMs: 200 } })).get("/readyz");
      expect(response.status).toBe(503);
      expect(response.body).toEqual({ status: "unavailable" });
      expect(Date.now() - started).toBeLessThan(2000);
    }
    expect(errors.mock.calls.map((call) => call.join(" "))).toEqual([
      expect.stringContaining("postgres unavailable: connect ECONNREFUSED"),
      expect.stringContaining("stalled unavailable: no answer within 200 ms"),
      expect.stringContaining("mongodb unavailable: not connected"),
    ]);
    await unconnected.close();
  });

  test("503 while shutting down, without running the checks", async () => {
    const check = vi.fn(() => Promise.resolve());
    expect(await isReady({ shuttingDown: () => true, checks: [{ name: "x", check }] })).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });
});

describe("graceful shutdown", () => {
  /** A server with a route that answers when `finish` is called. */
  async function serverWithSlowRoute() {
    let finish;
    const app = express();
    app.get("/slow", (req, res) => { finish = () => res.json({ done: true }); });
    app.get("/fast", (req, res) => res.json({ fast: true }));
    const server = createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { server, url, finish: () => finish?.(), arrived: () => finish !== undefined };
  }
  const waitFor = async (condition) => {
    for (let tries = 0; tries < 200 && !condition(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  };

  test("a request in flight finishes; new connections are refused; databases close afterwards, in order", async () => {
    const { server, url, finish, arrived } = await serverWithSlowRoute();
    const order = [];
    const lifecycle = createShutdown({
      server, timeoutMs: 5000, log: () => undefined,
      closers: [
        { name: "PostgreSQL pool", close: async () => { order.push("postgres"); } },
        { name: "MongoDB connection", close: async () => { order.push("mongodb"); } },
      ],
    });

    const inFlight = fetch(`${url}/slow`);
    await waitFor(arrived);
    expect(arrived()).toBe(true);
    const done = lifecycle.shutdown("SIGTERM");
    expect(lifecycle.shuttingDown()).toBe(true);
    // Same promise for a second signal.
    expect(lifecycle.shutdown("SIGINT")).toBe(done);

    await expect(fetch(`${url}/fast`)).rejects.toThrow();
    expect(order).toEqual([]); // nothing closed while the request is open

    finish();
    const response = await inFlight;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ done: true });
    expect(await done).toBe(true);
    expect(order).toEqual(["postgres", "mongodb"]);
    expect(server.listening).toBe(false);
  });

  test("a request that does not finish in time is closed, then the databases are closed anyway", async () => {
    const { server, url, arrived } = await serverWithSlowRoute();
    const closed = vi.fn(async () => undefined);
    const lifecycle = createShutdown({ server, timeoutMs: 200, log: () => undefined, closers: [{ name: "PostgreSQL pool", close: closed }] });
    const stuck = fetch(`${url}/slow`).catch((error) => error);
    await waitFor(arrived);
    const started = Date.now();
    expect(await lifecycle.shutdown("SIGTERM")).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(closed).toHaveBeenCalledOnce();
    expect(await stuck).toBeInstanceOf(Error);
  });

  test("a closer that fails is reported, and the others still run", async () => {
    const { server } = await serverWithSlowRoute();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const second = vi.fn(async () => undefined);
    const lifecycle = createShutdown({
      server, timeoutMs: 1000, log: () => undefined,
      closers: [{ name: "PostgreSQL pool", close: () => Promise.reject(new Error("end failed")) }, { name: "MongoDB connection", close: second }],
    });
    expect(await lifecycle.shutdown("SIGTERM")).toBe(false);
    expect(second).toHaveBeenCalledOnce();
  });
});
