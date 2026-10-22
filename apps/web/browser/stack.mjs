// Playwright global setup: the same throwaway stack as the pages e2e run —
// a migrated PostgreSQL container with the test catalogue, the compiled
// Express API with cookie sessions, and `next start` (production build).
// Nothing here touches the development database or an existing browser:
// Playwright launches its own isolated browsers against this origin.
//
// Prerequisites: Docker; `npm run build` in ecommerce-backend and apps/web;
// `npx playwright install chromium firefox webkit`.
import { randomBytes } from "node:crypto";
import {
  ALL_POSTGRES, BACKEND, freePort, requireBuilds, seedCatalog, start, startThrowawayPostgres, stop, waitFor, WEB,
} from "../scripts/e2e-support.mjs";

export default async function globalSetup() {
  requireBuilds();
  const database = await startThrowawayPostgres("browser-e2e");
  const children = [];
  const teardown = async () => {
    for (const child of children) await stop(child);
    await database.stop();
  };
  try {
    await seedCatalog(database.pool);
    const port = await freePort();
    const apiPort = await freePort();
    const origin = `http://127.0.0.1:${port}`;
    children.push(start(process.execPath, ["dist/server.js"], {
      cwd: BACKEND,
      env: {
        ...process.env, NODE_ENV: "development", PORT: String(apiPort), DATABASE_URL: database.databaseUrl,
        JWT_SECRET: randomBytes(32).toString("hex"), ...ALL_POSTGRES,
        AUTH_COOKIE_SESSIONS: "true", AUTH_COOKIE_SECURE: "false", AUTH_ALLOWED_ORIGINS: origin,
        // Many accounts are registered from one address; limits are covered by the other suites.
        AUTH_RATE_LIMIT: "false",
      },
    }));
    children.push(start(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: WEB,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", BACKEND_ORIGIN: `http://127.0.0.1:${apiPort}` },
    }));
    await waitFor(`http://127.0.0.1:${apiPort}/`);
    await waitFor(`${origin}/login`);
    // Read by the tests (workers inherit the environment set here).
    process.env.BROWSER_E2E_BASE_URL = origin;
    process.env.BROWSER_E2E_DATABASE_URL = database.databaseUrl;
  } catch (error) {
    for (const child of children) console.log(child.log().slice(-2000));
    await teardown();
    throw error;
  }
  return teardown;
}
