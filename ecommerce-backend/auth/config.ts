// Cookie-session authentication settings (Phase 5B). Off unless
// AUTH_COOKIE_SESSIONS=true, and refused outright in production until the
// owner approves activation (MIGRATION_PLAN.md R30).
//
//   AUTH_COOKIE_SESSIONS        "true" enables; unset/"false" disables
//   AUTH_COOKIE_SECURE          "true" (default): __Host- cookie, Secure, HTTPS origins only
//                               "false": local HTTP development cookie, Secure off
//   AUTH_ALLOWED_ORIGINS        comma-separated exact browser origins (the Next.js host)
//   AUTH_SESSION_IDLE_HOURS     idle timeout, extended on use (default 168 = 7 days)
//   AUTH_SESSION_ABSOLUTE_HOURS absolute lifetime, never extended (default 720 = 30 days)
import type { DataSourceConfig } from "../config/dataSources.js";

/** The production cookie: host-only (no Domain), Secure, Path=/ (RFC 6265bis __Host- prefix). */
export const SECURE_COOKIE_NAME = "__Host-ecom_session";
/** Local HTTP development only; browsers refuse __Host- cookies without Secure. */
export const DEVELOPMENT_COOKIE_NAME = "ecom_dev_session";
/** Header carrying the CSRF token on POST, PUT, PATCH and DELETE. */
export const CSRF_HEADER = "X-CSRF-Token";

export interface SessionAuthConfig {
  cookieName: string;
  secureCookie: boolean;
  allowedOrigins: ReadonlySet<string>;
  idleSeconds: number;
  absoluteSeconds: number;
  /** A session's idle expiry is extended at most this often. */
  renewAfterSeconds: number;
}

export class SessionConfigError extends Error {
  override name = "SessionConfigError";
}

type Environment = Record<string, string | undefined>;

function flag(env: Environment, variable: string, fallback: boolean): boolean {
  const value = env[variable]?.trim();
  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new SessionConfigError(`${variable} must be "true" or "false".`);
}

function hours(env: Environment, variable: string, fallback: number): number {
  const value = env[variable]?.trim();
  if (value === undefined || value === "") return fallback * 3600;
  if (!/^[1-9][0-9]{0,4}$/.test(value)) throw new SessionConfigError(`${variable} must be a whole number of hours.`);
  return Number(value) * 3600;
}

/** An exact origin: scheme and host (and port), nothing else. */
function parseOrigin(value: string, secureCookie: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SessionConfigError(`AUTH_ALLOWED_ORIGINS: "${value}" is not a URL.`);
  }
  if (url.origin !== value) {
    throw new SessionConfigError(`AUTH_ALLOWED_ORIGINS: "${value}" must be an exact origin such as https://shop.example.com (no path or trailing slash).`);
  }
  if (secureCookie ? url.protocol !== "https:" : !["http:", "https:"].includes(url.protocol)) {
    throw new SessionConfigError(`AUTH_ALLOWED_ORIGINS: "${value}" must use https while AUTH_COOKIE_SECURE is true.`);
  }
  return url.origin;
}

/** Null when cookie sessions are disabled. Throws on any unsafe or inconsistent setting. */
export function loadSessionAuthConfig(env: Environment, dataSources: DataSourceConfig): SessionAuthConfig | null {
  if (!flag(env, "AUTH_COOKIE_SESSIONS", false)) return null;

  if (env.NODE_ENV === "production") {
    throw new SessionConfigError("AUTH_COOKIE_SESSIONS is a development feature and cannot be enabled with NODE_ENV=production yet.");
  }
  if (dataSources.users !== "postgres") {
    throw new SessionConfigError("AUTH_COOKIE_SESSIONS needs DATA_SOURCE_USERS=postgres: sessions reference users in PostgreSQL.");
  }

  const secureCookie = flag(env, "AUTH_COOKIE_SECURE", true);
  const origins = (env.AUTH_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) {
    throw new SessionConfigError("AUTH_COOKIE_SESSIONS needs AUTH_ALLOWED_ORIGINS (the browser-facing origin, for example http://localhost:3001).");
  }

  const idleSeconds = hours(env, "AUTH_SESSION_IDLE_HOURS", 168);
  const absoluteSeconds = hours(env, "AUTH_SESSION_ABSOLUTE_HOURS", 720);
  if (idleSeconds > absoluteSeconds) {
    throw new SessionConfigError("AUTH_SESSION_IDLE_HOURS cannot exceed AUTH_SESSION_ABSOLUTE_HOURS.");
  }

  return {
    cookieName: secureCookie ? SECURE_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME,
    secureCookie,
    allowedOrigins: new Set(origins.map((origin) => parseOrigin(origin, secureCookie))),
    idleSeconds,
    absoluteSeconds,
    renewAfterSeconds: Math.min(15 * 60, idleSeconds),
  };
}
