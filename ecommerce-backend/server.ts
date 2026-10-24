import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import connectDB from "./config/db.js";
import { createApp } from "./app.js";
import {
  DATA_SOURCE_VARIABLES,
  describeDataSources,
  loadDataSources,
  usesMongo,
  usesPostgres,
} from "./config/dataSources.js";
import { verifySchemaCurrent } from "./db/pool.js";
import { loadSessionAuthConfig } from "./auth/config.js";
import type { SessionAuth } from "./auth/sessionAuth.js";
import { PostgresSessionRepository } from "./auth/sessionRepository.js";
import { loadClientIpConfig } from "./auth/clientIp.js";
import { AuthRateLimiter, loadAuthRateLimitRules } from "./auth/rateLimit.js";
import { MongoRateLimitStore, PostgresRateLimitStore } from "./auth/rateLimitStores.js";
import mongoose from "mongoose";
import { createRepositories } from "./repositories/index.js";
import { errorMessage } from "./utils/errors.js";
import { mongoReadiness, postgresReadiness, type ReadinessCheck } from "./health.js";
import { createShutdown, loadShutdownTimeout, type Closer } from "./lifecycle.js";

dotenv.config();

const PORT = process.env.PORT || 3000;

// db/migrations from source, dist/db/migrations when compiled.
const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("./db/migrations", import.meta.url));

async function startServer() {
  try {
    if (!process.env.JWT_SECRET?.trim()) {
      throw new Error("JWT_SECRET is missing from .env");
    }

    // MongoDB is the default for every domain. PostgreSQL connection settings
    // (.env.postgres) are only loaded when a domain explicitly selects it.
    let pool: Pool | undefined;
    if (Object.values(DATA_SOURCE_VARIABLES).some((variable) => process.env[variable]?.trim() === "postgres")) {
      // The API's pool, with connection and statement timeouts (config/postgresOptions.ts).
      pool = (await import("./config/postgres.js")).createApiPool();
    }

    const dataSources = loadDataSources(process.env);
    const shutdownTimeoutMs = loadShutdownTimeout(process.env);

    if (usesMongo(dataSources)) {
      await connectDB();
    }

    if (usesPostgres(dataSources)) {
      if (!pool) throw new Error("PostgreSQL pool missing");
      await verifySchemaCurrent(pool, MIGRATIONS_DIRECTORY);
      console.log(`Data sources: ${describeDataSources(dataSources)}`);
    }

    // Cookie sessions: development only, off unless AUTH_COOKIE_SESSIONS=true.
    let sessionAuth: SessionAuth | undefined;
    const sessionConfig = loadSessionAuthConfig(process.env, dataSources);
    if (sessionConfig) {
      if (!pool) throw new Error("PostgreSQL pool missing");
      sessionAuth = { config: sessionConfig, sessions: new PostgresSessionRepository(pool, sessionConfig) };
      console.log(`Cookie sessions: enabled (${sessionConfig.secureCookie ? "Secure __Host- cookie" : "local HTTP development cookie"})`);
    }

    // Authentication rate limits (R37): counters in the database that holds the
    // users, shared by every instance. Only development may turn them off.
    const clientIp = loadClientIpConfig(process.env);
    const rateLimitRules = loadAuthRateLimitRules(process.env);
    let rateLimiter: AuthRateLimiter | undefined;
    if (rateLimitRules) {
      const store = dataSources.users === "postgres" && pool
        ? new PostgresRateLimitStore(pool)
        : new MongoRateLimitStore(() => mongoose.connection.db);
      rateLimiter = new AuthRateLimiter(store, rateLimitRules, clientIp);
    } else {
      console.log("Authentication rate limits: OFF (AUTH_RATE_LIMIT=false, development only)");
    }

    // Readiness covers exactly the stores this configuration uses (health.ts).
    const checks: ReadinessCheck[] = [];
    const closers: Closer[] = [];
    if (pool) {
      const postgres = pool;
      checks.push(postgresReadiness(postgres));
      closers.push({ name: "PostgreSQL pool", close: () => postgres.end() });
    }
    if (usesMongo(dataSources)) {
      checks.push(mongoReadiness(mongoose.connection));
      closers.push({ name: "MongoDB connection", close: () => mongoose.disconnect() });
    }
    let shuttingDown = () => false;

    const app = createApp({
      repositories: createRepositories(dataSources, pool),
      sessionAuth,
      rateLimiter,
      trustProxyHops: clientIp.trustProxyHops,
      readiness: { shuttingDown: () => shuttingDown(), checks },
    });

    const server = app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });

    // Graceful shutdown (lifecycle.ts): drain requests, then close the databases.
    const lifecycle = createShutdown({ server, closers, timeoutMs: shutdownTimeoutMs });
    shuttingDown = lifecycle.shuttingDown;
    for (const signal of ["SIGTERM", "SIGINT"] as const) {
      process.on(signal, () => {
        void lifecycle.shutdown(signal).then((clean) => process.exit(clean ? 0 : 1));
      });
    }
  } catch (error) {
    console.error(`Error: ${String(errorMessage(error))}`);
    process.exitCode = 1;
  }
}

startServer();
