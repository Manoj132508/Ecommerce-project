// Connection settings for the API's PostgreSQL pool (Phase 7A reliability
// review). Without them pg waits for a free or new connection indefinitely and
// lets a statement run for as long as it takes, so one slow query or a database
// that stopped answering ties up requests until the 15 s proxy timeout and beyond.
//
//   PG_POOL_MAX                         connections per API instance (default 10)
//   PG_CONNECT_TIMEOUT_MS               wait for a connection (default 5000)
//   PG_STATEMENT_TIMEOUT_MS             server-side limit per statement (default 10000,
//                                       below the Next.js proxy's 15 s upstream timeout)
//   PG_IDLE_IN_TRANSACTION_TIMEOUT_MS   ends a session left idle inside a transaction,
//                                       releasing its locks (default 10000)
//
// Only the API uses these limits. db:migrate, data:* and sessions:cleanup keep
// the plain pool from config/postgres.ts: a migration may legitimately run long.
import pg, { type PoolConfig } from "pg";
import { errorMessage } from "../utils/errors.js";

export const API_APPLICATION_NAME = "ecommerce-api";

export interface PostgresTimeouts {
  max: number;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
}

export class PostgresOptionsError extends Error {
  override name = "PostgresOptionsError";
}

type Environment = Record<string, string | undefined>;

function whole(env: Environment, variable: string, fallback: number, min: number, max: number): number {
  const value = env[variable]?.trim();
  if (value === undefined || value === "") return fallback;
  if (!/^[0-9]+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new PostgresOptionsError(`${variable} must be a whole number from ${min} to ${max}.`);
  }
  return Number(value);
}

export function loadPostgresTimeouts(env: Environment): PostgresTimeouts {
  return {
    max: whole(env, "PG_POOL_MAX", 10, 1, 100),
    connectTimeoutMs: whole(env, "PG_CONNECT_TIMEOUT_MS", 5_000, 100, 60_000),
    statementTimeoutMs: whole(env, "PG_STATEMENT_TIMEOUT_MS", 10_000, 100, 120_000),
    idleInTransactionTimeoutMs: whole(env, "PG_IDLE_IN_TRANSACTION_TIMEOUT_MS", 10_000, 100, 120_000),
  };
}

export function apiPoolConfig(connectionString: string, timeouts: PostgresTimeouts): PoolConfig {
  return {
    connectionString,
    max: timeouts.max,
    connectionTimeoutMillis: timeouts.connectTimeoutMs,
    // Sent as session parameters when each connection starts.
    statement_timeout: timeouts.statementTimeoutMs,
    idle_in_transaction_session_timeout: timeouts.idleInTransactionTimeoutMs,
    application_name: API_APPLICATION_NAME,
    // Notices a peer that vanished (network loss) instead of waiting on a dead socket.
    keepAlive: true,
  };
}

/**
 * An idle pooled connection that fails (database restart, network loss) emits
 * "error" on the pool; without a listener Node treats it as uncaught and the
 * process exits. The pool discards that connection and opens a new one on demand.
 */
export function logIdleClientErrors(pool: pg.Pool, label: string): pg.Pool {
  pool.on("error", (error) => {
    console.error(`PostgreSQL (${label}) idle connection lost:`, errorMessage(error));
  });
  return pool;
}

export const createApiPoolFor = (connectionString: string, timeouts: PostgresTimeouts): pg.Pool => (
  logIdleClientErrors(new pg.Pool(apiPoolConfig(connectionString, timeouts)), "api")
);
