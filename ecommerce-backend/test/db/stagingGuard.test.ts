// The production cookie-session guard at the real start-up path (server.ts),
// on a throwaway database: production-shaped settings with
// AUTH_COOKIE_SESSIONS=true stop the process before it listens; the staging
// allowance starts it, with secure cookies, and says so in the log.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const BACKEND = fileURLToPath(new URL("../..", import.meta.url));
let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
});

afterEach(async () => {
  await db.drop();
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Runs server.ts with exactly these variables; resolves when it exits or prints that it listens. */
async function start(env: Record<string, string>) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "tsx", "server.ts"], {
    cwd: BACKEND,
    // MONGODB_URI empty: server.ts loads a local .env, and dotenv never overrides a variable that is set.
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", PORT: String(port), MONGODB_URI: "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { log += chunk.toString(); });
  const outcome = await new Promise<{ exitCode: number | null; listening: boolean }>((resolve) => {
    child.once("exit", (exitCode) => resolve({ exitCode, listening: false }));
    const timer = setInterval(() => {
      if (log.includes("Server is running")) {
        clearInterval(timer);
        resolve({ exitCode: null, listening: true });
      }
    }, 50);
    child.once("exit", () => clearInterval(timer));
  });
  return { ...outcome, port, log: () => log, stop: () => child.kill("SIGKILL") };
}

const productionShaped = () => ({
  NODE_ENV: "production", JWT_SECRET: "guard-test-only-secret", DATABASE_URL: db.url,
  POSTGRES_PRODUCTION_ENABLED: "true", DATA_SOURCE_DELIVERY_OPTIONS: "postgres", DATA_SOURCE_PRODUCTS: "postgres",
  DATA_SOURCE_USERS: "postgres", DATA_SOURCE_CARTS: "postgres", DATA_SOURCE_ORDERS: "postgres",
  CLIENT_URL: "https://ecommerce-project-three-peach.vercel.app", RENDER_SERVICE_NAME: "ecommerce-backend",
  AUTH_ALLOWED_ORIGINS: "https://ecommerce-project-three-peach.vercel.app",
});

describe("server.ts start-up and the cookie-session guard", () => {
  test("production with AUTH_COOKIE_SESSIONS=true refuses to start (exit 1, never listens)", async () => {
    const run = await start({ ...productionShaped(), AUTH_COOKIE_SESSIONS: "true" });
    expect(run).toMatchObject({ exitCode: 1, listening: false });
    expect(run.log()).toMatch(/AUTH_COOKIE_SESSIONS is a development feature and cannot be enabled with NODE_ENV=production yet/);
  }, 60_000);

  test("production with the staging switches copied in still refuses (service name, production origin)", async () => {
    const copied = await start({ ...productionShaped(), AUTH_COOKIE_SESSIONS: "true", DEPLOYMENT_ENVIRONMENT: "staging", AUTH_COOKIE_SESSIONS_STAGING: "true" });
    expect(copied).toMatchObject({ exitCode: 1, listening: false });
    expect(copied.log()).toMatch(/must end in "-staging"/);
    const renamed = await start({
      ...productionShaped(), AUTH_COOKIE_SESSIONS: "true", DEPLOYMENT_ENVIRONMENT: "staging", AUTH_COOKIE_SESSIONS_STAGING: "true",
      RENDER_SERVICE_NAME: "ecommerce-backend-staging",
    });
    expect(renamed).toMatchObject({ exitCode: 1, listening: false });
    expect(renamed.log()).toMatch(/production storefront/);
  }, 60_000);

  test("production without cookie sessions starts as before (the guard only concerns the switch)", async () => {
    const run = await start(productionShaped());
    try {
      expect(run.listening).toBe(true);
      expect(run.log()).not.toMatch(/Cookie sessions: enabled/);
      expect((await fetch(`http://127.0.0.1:${run.port}/readyz`)).status).toBe(200);
    } finally {
      run.stop();
    }
  }, 60_000);

  test("a staging service with every condition met starts with secure cookie sessions", async () => {
    const run = await start({
      ...productionShaped(), AUTH_COOKIE_SESSIONS: "true", DEPLOYMENT_ENVIRONMENT: "staging", AUTH_COOKIE_SESSIONS_STAGING: "true",
      RENDER_SERVICE_NAME: "ecommerce-api-staging", CLIENT_URL: "https://ecommerce-web-staging.vercel.app",
      AUTH_ALLOWED_ORIGINS: "https://ecommerce-web-staging.vercel.app",
    });
    try {
      expect(run.listening).toBe(true);
      expect(run.log()).toMatch(/Cookie sessions: enabled for STAGING \(service ecommerce-api-staging; production refuses this\) \(Secure __Host- cookie\)/);
      const login = await fetch(`http://127.0.0.1:${run.port}/api/auth/session`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: "https://ecommerce-web-staging.vercel.app" },
        body: JSON.stringify({ email: "nobody@example.com", password: "wrong-password-0" }),
      });
      expect(login.status).toBe(401); // the cookie-session route exists and answers
    } finally {
      run.stop();
    }
  }, 60_000);
});
