// Liveness and readiness (Phase 7A reliability review).
//
//   GET /healthz  the process is up and answering. Touches no database, so a
//                 database outage does not get a healthy instance restarted.
//   GET /readyz   this instance can serve: every data store it uses answers
//                 within READINESS_TIMEOUT_MS, and it is not shutting down.
//                 503 otherwise. The body never says which store failed or why;
//                 the server log does.
//
// GET / keeps its plain-text answer for existing health checks.
import type mongoose from "mongoose";
import type { Pool } from "pg";
import { errorMessage } from "./utils/errors.js";

export const READINESS_TIMEOUT_MS = 2_000;

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
}

export interface Readiness {
  /** True while the instance drains before exit (lifecycle.ts). */
  shuttingDown: () => boolean;
  checks: ReadinessCheck[];
  timeoutMs?: number;
}

export const postgresReadiness = (pool: Pool): ReadinessCheck => ({
  name: "postgres",
  check: async () => {
    await pool.query("SELECT 1");
  },
});

export const mongoReadiness = (connection: mongoose.Connection): ReadinessCheck => ({
  name: "mongodb",
  check: async () => {
    // 1 = connected. Mongoose would otherwise buffer the ping until it reconnects.
    if (connection.readyState !== 1 || !connection.db) throw new Error(`not connected (state ${connection.readyState})`);
    await connection.db.admin().ping();
  },
});

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** True when every check passes in time; failures are logged with their reason. */
export async function isReady({ shuttingDown, checks, timeoutMs = READINESS_TIMEOUT_MS }: Readiness): Promise<boolean> {
  if (shuttingDown()) return false;
  const results = await Promise.allSettled(checks.map(({ check }) => within(check(), timeoutMs)));
  let ready = true;
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      ready = false;
      console.error(`Readiness: ${checks[index]?.name} unavailable:`, errorMessage(result.reason));
    }
  });
  return ready;
}
