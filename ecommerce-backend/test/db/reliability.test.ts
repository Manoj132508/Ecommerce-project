// Reliability against a real PostgreSQL (Phase 7A): the API pool's timeouts,
// lost connections, an unreachable or silent server, readiness and shutdown.
// Every database here is a throwaway one in the test container.
import { createServer, type Server, type Socket } from "node:net";
import pg from "pg";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../../app.js";
import type { DataSourceConfig } from "../../config/dataSources.js";
import { API_APPLICATION_NAME, createApiPoolFor, loadPostgresTimeouts, type PostgresTimeouts } from "../../config/postgresOptions.js";
import { migrate } from "../../db/migrator.js";
import { isReady, postgresReadiness } from "../../health.js";
import { createRepositories } from "../../repositories/index.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const ALL_POSTGRES: DataSourceConfig = {
  deliveryOptions: "postgres", products: "postgres", users: "postgres", carts: "postgres", orders: "postgres",
};
// Short limits so the tests are quick; the defaults are checked in test/reliability.test.js.
const FAST: PostgresTimeouts = { max: 3, connectTimeoutMs: 300, statementTimeoutMs: 400, idleInTransactionTimeoutMs: 400 };

let db: TestDatabase;
const pools: pg.Pool[] = [];
const apiPool = (url = db.url, timeouts = FAST) => {
  const pool = createApiPoolFor(url, timeouts);
  pools.push(pool);
  return pool;
};
const productsApp = (pool: pg.Pool) => createApp({ repositories: createRepositories(ALL_POSTGRES, pool) });
const elapsed = async <T>(work: () => Promise<T>) => {
  const started = Date.now();
  const result = await work();
  return { result, ms: Date.now() - started };
};

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(pools.splice(0).map((pool) => pool.end().catch(() => undefined)));
  await db.drop();
});

describe("the API pool's session settings", () => {
  test("every connection carries the statement and idle-in-transaction limits and the application name", async () => {
    const pool = apiPool(db.url, loadPostgresTimeouts({}));
    const { rows: [settings] } = await pool.query<Record<string, string>>(
      "SELECT current_setting('statement_timeout') AS statement, current_setting('idle_in_transaction_session_timeout') AS idle, current_setting('application_name') AS name",
    );
    expect(settings).toEqual({ statement: "10s", idle: "10s", name: API_APPLICATION_NAME });
  });
});

describe("slow queries", () => {
  test("a statement blocked by a lock is cancelled at the limit; the client gets the fixed 500 message", async () => {
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    await holder.query("BEGIN; LOCK TABLE products IN ACCESS EXCLUSIVE MODE");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { result: response, ms } = await elapsed(() => request(productsApp(apiPool())).get("/api/products"));
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: "Unable to load products" });
      expect(ms).toBeGreaterThanOrEqual(350);
      expect(ms).toBeLessThan(3000);
      expect(errors).toHaveBeenCalledWith("Product list failed:", expect.stringMatching(/statement timeout/));
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
  });

  test("pg_sleep longer than the limit fails with SQLSTATE 57014 (query_canceled); the pool keeps serving", async () => {
    const pool = apiPool();
    await expect(pool.query("SELECT pg_sleep(2)")).rejects.toMatchObject({ code: "57014" });
    expect((await pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]);
  });

  test("a session left idle inside a transaction is ended, which releases its locks", async () => {
    const pool = apiPool();
    const client = await pool.connect();
    client.on("error", () => undefined); // the server ends this session on purpose
    await client.query("BEGIN");
    await client.query("LOCK TABLE products IN ACCESS EXCLUSIVE MODE");
    await new Promise((resolve) => setTimeout(resolve, 800));
    await expect(client.query("SELECT 1")).rejects.toThrow();
    client.release(true);
    // The lock is gone: another session reads the table at once.
    const reader = new pg.Client({ connectionString: db.url, statement_timeout: 1000 });
    await reader.connect();
    expect((await reader.query("SELECT count(*) FROM products")).rowCount).toBe(1);
    await reader.end();
  });
});

describe("lost and unavailable connections", () => {
  test("connections ended by the server (restart, failover) are logged, not fatal; the next request reconnects", async () => {
    const pool = apiPool();
    const app = productsApp(pool);
    expect((await request(app).get("/api/products")).status).toBe(200);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { rows } = await db.pool.query<{ ended: boolean }>(
      "SELECT pg_terminate_backend(pid) AS ended FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()",
      [API_APPLICATION_NAME],
    );
    expect(rows.length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(errors).toHaveBeenCalledWith("PostgreSQL (api) idle connection lost:", expect.any(String)));

    expect((await request(app).get("/api/products")).status).toBe(200);
  });

  test("an unreachable server: requests fail fast with the fixed message and readiness is 503", async () => {
    // A port nothing listens on.
    const closed = createServer();
    await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
    const port = (closed.address() as { port: number }).port;
    await new Promise((resolve) => closed.close(resolve));
    const pool = apiPool(`postgresql://app:unused@127.0.0.1:${port}/none`);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result: response, ms } = await elapsed(() => request(productsApp(pool)).get("/api/products"));
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Unable to load products" });
    expect(ms).toBeLessThan(2000);

    const ready = createApp({ readiness: { shuttingDown: () => false, checks: [postgresReadiness(pool)], timeoutMs: 1000 } });
    const readiness = await request(ready).get("/readyz");
    expect(readiness.status).toBe(503);
    expect(readiness.body).toEqual({ status: "unavailable" });
  });

  test("a server that accepts but never answers: the connection attempt times out instead of hanging", async () => {
    const sockets = new Set<Socket>();
    const silent: Server = createServer((socket) => { sockets.add(socket); });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const port = (silent.address() as { port: number }).port;
    try {
      const pool = apiPool(`postgresql://app:unused@127.0.0.1:${port}/none`);
      const { result, ms } = await elapsed(() => pool.query("SELECT 1").then(() => null, (error: unknown) => error));
      expect(String(result)).toMatch(/timeout/i);
      expect(ms).toBeGreaterThanOrEqual(250);
      expect(ms).toBeLessThan(2000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  test("a waiting request does not queue forever when every connection is busy", async () => {
    const pool = apiPool(db.url, { ...FAST, max: 1, statementTimeoutMs: 5000 });
    const busy = pool.query("SELECT pg_sleep(1.5)");
    const { result, ms } = await elapsed(() => pool.query("SELECT 1").then(() => null, (error: unknown) => error));
    expect(String(result)).toMatch(/timeout exceeded when trying to connect/i);
    expect(ms).toBeLessThan(1000);
    await busy;
  });
});

describe("readiness and shutdown with a real pool", () => {
  test("ready while the database answers; after pool.end() (shutdown) it is not", async () => {
    const pool = apiPool();
    expect(await isReady({ shuttingDown: () => false, checks: [postgresReadiness(pool)] })).toBe(true);
    await pool.end();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await isReady({ shuttingDown: () => false, checks: [postgresReadiness(pool)] })).toBe(false);
    // No API connection is left open on the server.
    const { rows: [left] } = await db.pool.query<{ count: string }>(
      "SELECT count(*) FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()", [API_APPLICATION_NAME],
    );
    expect(Number(left?.count)).toBe(0);
  });
});
