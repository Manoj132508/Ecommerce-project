// Cookie-session authentication for Express (Phase 5B, behind AUTH_COOKIE_SESSIONS).
//
// - The session cookie is HttpOnly, SameSite=Lax, Path=/, never has a Domain
//   attribute (host-only), and is Secure with the __Host- name unless the
//   local development setting is chosen. Secure comes from configuration,
//   never from X-Forwarded-Proto: the API does not trust forwarded headers.
// - POST, PUT, PATCH and DELETE with a session cookie need an Origin header on
//   the allow-list and the session's CSRF token in X-CSRF-Token. Both are
//   checked before the database is touched.
// - Requests with a Bearer token keep the legacy JWT path unchanged.
import type { Request, RequestHandler, Response } from "express";
import type { UserRepository } from "../repositories/types.js";
import { errorMessage } from "../utils/errors.js";
import { CSRF_HEADER, type SessionAuthConfig } from "./config.js";
import type { SessionRecord, SessionRepository } from "./sessionRepository.js";
import { csrfTokenFor, csrfTokenMatches } from "./tokens.js";

export interface SessionAuth {
  config: SessionAuthConfig;
  sessions: SessionRepository;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const isUnsafeMethod = (method: string) => !SAFE_METHODS.has(method.toUpperCase());

/** The first cookie with this exact name, or undefined. */
export function readSessionCookie(req: Request, name: string): string | undefined {
  const header = req.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

const cookieOptions = (config: SessionAuthConfig) => ({
  httpOnly: true,
  secure: config.secureCookie,
  sameSite: "lax" as const,
  path: "/",
});

export function setSessionCookie(res: Response, config: SessionAuthConfig, token: string, session: SessionRecord) {
  // Expires follows the idle expiry, which the database extends on use.
  res.cookie(config.cookieName, token, { ...cookieOptions(config), expires: session.idleExpiresAt });
}

export function clearSessionCookie(res: Response, config: SessionAuthConfig) {
  res.clearCookie(config.cookieName, cookieOptions(config));
}

/** Exact match against the configured browser origins. A missing Origin fails. */
export function originAllowed(req: Request, config: SessionAuthConfig): boolean {
  const origin = req.get("Origin");
  return origin !== undefined && config.allowedOrigins.has(origin);
}

/** The cookie session attached by the session guard. */
export function requireSession(req: Request) {
  if (!req.authSession) {
    throw new Error("Session missing: the session guard must run before this handler");
  }
  return req.authSession;
}

/** Authenticates a request by its session cookie only (bearer tokens are not accepted here). */
export function createSessionGuard(users: UserRepository, auth: SessionAuth): RequestHandler {
  const { config, sessions } = auth;

  return async (req, res, next) => {
    const token = readSessionCookie(req, config.cookieName);
    if (!token) {
      return res.status(401).json({ message: "Not authorized" });
    }

    if (isUnsafeMethod(req.method) && (!originAllowed(req, config) || !csrfTokenMatches(token, req.get(CSRF_HEADER)))) {
      return res.status(403).json({ message: "CSRF validation failed" });
    }

    try {
      const session = await sessions.findActive(token);
      const user = session ? await users.findById(session.userId) : null;
      if (!session || !user) {
        clearSessionCookie(res, config);
        return res.status(401).json({ message: "Not authorized" });
      }

      const renewed = await sessions.renew(session.id);
      if (renewed) setSessionCookie(res, config, token, renewed);

      req.user = user;
      req.authSession = { id: session.id, csrfToken: csrfTokenFor(token), expiresAt: (renewed ?? session).idleExpiresAt };
    } catch (error) {
      console.error("Session authentication failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }

    return next();
  };
}
