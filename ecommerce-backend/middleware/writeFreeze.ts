// Write-freeze maintenance mode (MIGRATION_PLAN.md R31, cutover and rollback
// runbooks). While data is copied or reconciled between MongoDB and PostgreSQL,
// nothing may change it: every request that would write shop data is refused
// with 503 and Retry-After, before its body is read. Reading keeps working, and
// so do signing in and out (sessions and rate-limit counters are not shop data
// and are not copied between the databases).
//
//   WRITE_FREEZE   "true" freezes; unset/"false" (default) is normal operation.
//                  Read at start-up: set it, restart, run the data step, unset it, restart.
import type { RequestHandler } from "express";
import type { ErrorResponse } from "../types/api.js";

export const WRITE_FREEZE_MESSAGE = "The shop is read-only for a few minutes for maintenance. Please try again shortly.";
const RETRY_AFTER_SECONDS = 120;

export class WriteFreezeConfigError extends Error {
  override name = "WriteFreezeConfigError";
}

export function loadWriteFreeze(env: Record<string, string | undefined>): boolean {
  const value = env.WRITE_FREEZE?.trim();
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new WriteFreezeConfigError('WRITE_FREEZE must be "true" or "false".');
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Allowed while frozen: sign-in and sign-out only. Method and exact path (mounted under /api/auth). */
const SESSION_ONLY = new Set([
  "POST /api/auth/login",
  "POST /api/auth/session",
  "POST /api/auth/session/exchange",
  "DELETE /api/auth/session",
  "DELETE /api/auth/sessions",
]);

export const isAllowedWhileFrozen = (method: string, path: string): boolean => (
  READS.has(method) || SESSION_ONLY.has(`${method} ${path.replace(/\/+$/, "") || "/"}`)
);

export const writeFreeze: RequestHandler = (req, res, next) => {
  if (isAllowedWhileFrozen(req.method, req.path)) return next();
  res.set("Retry-After", String(RETRY_AFTER_SECONDS));
  res.set("Cache-Control", "no-store");
  return res.status(503).json({ message: WRITE_FREEZE_MESSAGE } satisfies ErrorResponse);
};
