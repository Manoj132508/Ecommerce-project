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
import { createRepositories } from "./repositories/index.js";
import { errorMessage } from "./utils/errors.js";

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
      pool = (await import("./config/postgres.js")).default;
    }

    const dataSources = loadDataSources(process.env);

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

    const app = createApp({ repositories: createRepositories(dataSources, pool), sessionAuth });

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error(`Error: ${String(errorMessage(error))}`);
    process.exitCode = 1;
  }
}

startServer();
