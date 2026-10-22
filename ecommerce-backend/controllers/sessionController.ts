import type { Request, RequestHandler, Response } from "express";
import { requireUser } from "../middleware/authMiddleware.js";
import type { AuthUser, UserRepository } from "../repositories/types.js";
import {
  clearSessionCookie,
  originAllowed,
  readSessionCookie,
  requireSession,
  setSessionCookie,
  type SessionAuth,
} from "../auth/sessionAuth.js";
import { csrfTokenFor } from "../auth/tokens.js";
import type { ErrorResponse, SessionResponse, UserProfile } from "../types/api.js";
import { errorMessage } from "../utils/errors.js";

type NoParams = Record<string, string>;

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

const profile = (user: AuthUser): UserProfile => ({ _id: user.id, name: user.name, email: user.email, isAdmin: user.isAdmin });

export function createSessionController(users: UserRepository, auth: SessionAuth) {
  const { config, sessions } = auth;

  /** Starts a session for an authenticated user, rotating any session the browser presented. */
  const startSession = async (req: Request, res: Response<SessionResponse>, user: AuthUser) => {
    const { token, session } = await sessions.create(user.id, req.get("User-Agent"), readSessionCookie(req, config.cookieName));
    setSessionCookie(res, config, token, session);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ user: profile(user), csrfToken: csrfTokenFor(token) });
  };

  // @desc Sign in with email and password; sets the session cookie
  // @route POST /api/auth/session
  const login: RequestHandler<NoParams, SessionResponse | ErrorResponse, LoginBody | undefined> = async (req, res) => {
    // There is no session yet to carry a CSRF token, so login CSRF is stopped
    // by the Origin allow-list and by accepting JSON only (no form posts).
    if (!originAllowed(req, config)) {
      return res.status(403).json({ message: "Origin not allowed" });
    }
    if (!req.is("application/json")) {
      return res.status(415).json({ message: "Send the credentials as JSON" });
    }

    const { email, password } = req.body ?? {};
    if (
      typeof email !== "string" || !email.trim() ||
      typeof password !== "string" || !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({ message: "Provide an email and password" });
    }

    try {
      // The same password check as the legacy login (bcrypt in the user repository).
      const user = await users.authenticate(email.trim().toLowerCase(), password);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      return await startSession(req, res, user);
    } catch (error) {
      console.error("Session login failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }
  };

  // @desc Exchange a legacy bearer token for a session cookie (migration path)
  // @route POST /api/auth/session/exchange  (bearer-only protect runs first)
  const exchange: RequestHandler<NoParams, SessionResponse | ErrorResponse> = async (req, res) => {
    try {
      return await startSession(req, res, requireUser(req));
    } catch (error) {
      console.error("Session exchange failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }
  };

  // @desc The signed-in user and the CSRF token for this session
  // @route GET /api/auth/session
  const current: RequestHandler<NoParams, SessionResponse> = (req, res) => {
    res.set("Cache-Control", "no-store");
    return res.status(200).json({ user: profile(requireUser(req)), csrfToken: requireSession(req).csrfToken });
  };

  // @desc Sign out this browser
  // @route DELETE /api/auth/session
  const logout: RequestHandler<NoParams, ErrorResponse> = async (req, res) => {
    try {
      await sessions.revoke(requireSession(req).id, "logout");
      clearSessionCookie(res, config);
      return res.status(204).end();
    } catch (error) {
      console.error("Logout failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }
  };

  // @desc Sign out every session of this user
  // @route DELETE /api/auth/sessions
  const logoutAll: RequestHandler<NoParams, ErrorResponse> = async (req, res) => {
    try {
      await sessions.revokeAllForUser(requireUser(req).id, "logout_all");
      clearSessionCookie(res, config);
      return res.status(204).end();
    } catch (error) {
      console.error("Logout everywhere failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }
  };

  /** Login CSRF guard for the exchange endpoint, before the bearer token is checked. */
  const requireAllowedOrigin: RequestHandler = (req, res, next) => (
    originAllowed(req, config) ? next() : res.status(403).json({ message: "Origin not allowed" })
  );

  return { login, exchange, current, logout, logoutAll, requireAllowedOrigin };
}
