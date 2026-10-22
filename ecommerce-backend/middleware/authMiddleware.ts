import type { Request, RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { AuthUser, UserRepository } from "../repositories/types.js";
import { createSessionGuard, readSessionCookie, type SessionAuth } from "../auth/sessionAuth.js";
import { errorMessage } from "../utils/errors.js";
import { isUserId } from "../utils/identifiers.js";

/** Claims issued by authController's generateToken. */
export interface AuthTokenPayload extends JwtPayload {
  id: string;
}

const hasUserId = (decoded: string | JwtPayload): decoded is AuthTokenPayload => (
  typeof decoded !== "string" && typeof decoded.id === "string"
);

/**
 * Verifies the bearer token and attaches the user, from whichever store holds users.
 * With cookie sessions enabled, a request that has no bearer token but has a
 * session cookie is authenticated by the session guard instead (CSRF-checked).
 * A bearer token always takes the legacy path, so the Vite app is unaffected.
 */
export const createProtect = (users: UserRepository, sessionAuth?: SessionAuth): RequestHandler => {
  const sessionGuard = sessionAuth ? createSessionGuard(users, sessionAuth) : undefined;
  return (req, res, next) => {
    const hasBearer = /^Bearer\s+\S+$/i.test(req.get("Authorization") ?? "");
    if (!hasBearer && sessionGuard && sessionAuth && readSessionCookie(req, sessionAuth.config.cookieName)) {
      return sessionGuard(req, res, next);
    }
    return protectWithBearer(users, req, res, next);
  };
};

const protectWithBearer = async (users: UserRepository, ...[req, res, next]: Parameters<RequestHandler>) => {
  const authorization = req.get("Authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!bearerToken) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret?.trim()) {
    return res.status(500).json({ message: "Server error" });
  }

  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(bearerToken, secret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Not authorized" });
  }

  if (!hasUserId(decoded) || !isUserId(decoded.id)) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const user = await users.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }
    req.user = user;
  } catch (error) {
    console.error("Authentication failed:", errorMessage(error));
    return res.status(500).json({ message: "Server error" });
  }

  return next();
};

/**
 * Returns the user attached by protect. Routes that call this always run
 * protect first; the throw only replaces the TypeError the JavaScript
 * handlers would have raised reading a property of a missing req.user.
 */
export function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error("Authenticated user missing: protect must run before this handler");
  }

  return req.user;
}

export const adminOnly: RequestHandler = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  return next();
};
