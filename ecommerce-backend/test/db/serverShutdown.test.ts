// server.ts end to end (Phase 7A): start the real server on a throwaway
// database, check readiness, send SIGTERM during a slow request, and expect the
// request to finish, the pool to close and the process to exit 0.
// Windows cannot deliver SIGTERM to a handler (Node terminates the process), so
// this runs on Linux (CI) and is skipped on Windows.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const BACKEND = fileURLToPath(new URL("../..", import.meta.url));
let db: TestDatabase;
let child: ChildProcess | undefined;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
});

afterEach(async () => {
  child?.kill("SIGKILL");
  child = undefined;
  await db.drop();
});

describe.skipIf(process.platform === "win32")("server.ts graceful shutdown (SIGTERM)", () => {
  test("drains a request in flight, closes the pool and exits 0", async () => {
    const port = await freePort();
    const output: string[] = [];
    child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
      cwd: BACKEND,
      env: {
        // MONGODB_URI empty: server.ts loads a local .env, and dotenv never overrides a variable that is set.
        PATH: process.env.PATH, PORT: String(port), MONGODB_URI: "", JWT_SECRET: "shutdown-test-only-secret",
        DATABASE_URL: db.url, DATA_SOURCE_DELIVERY_OPTIONS: "postgres", DATA_SOURCE_PRODUCTS: "postgres",
        DATA_SOURCE_USERS: "postgres", DATA_SOURCE_CARTS: "postgres", DATA_SOURCE_ORDERS: "postgres",
        PG_STATEMENT_TIMEOUT_MS: "5000", SHUTDOWN_TIMEOUT_MS: "4000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child?.once("exit", resolve));
    const base = `http://127.0.0.1:${port}`;

    await expect.poll(() => output.join(""), { timeout: 20_000 }).toMatch(/Server is running/);
    expect((await fetch(`${base}/readyz`)).status).toBe(200);

    // A request held by a table lock, released 1 s after SIGTERM.
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    await holder.query("BEGIN; LOCK TABLE products IN ACCESS EXCLUSIVE MODE");
    const slow = fetch(`${base}/api/products`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await holder.query("ROLLBACK");
    await holder.end();

    const response = await slow;
    expect(response.status).toBe(200);
    expect(await exited).toBe(0);
    const log = output.join("");
    expect(log).toMatch(/Shutdown \(SIGTERM\)/);
    expect(log).toMatch(/PostgreSQL pool closed/);
    expect(log).toMatch(/Shutdown: complete\n/);
  }, 60_000);
});
