import express from "express";
import { createSessionController } from "../controllers/sessionController.js";
import { createProtect } from "../middleware/authMiddleware.js";
import { limitPerIp, type AuthRateLimiter } from "../auth/rateLimit.js";
import { createSessionGuard, type SessionAuth } from "../auth/sessionAuth.js";
import type { Repositories } from "../repositories/types.js";

// Mounted only when AUTH_COOKIE_SESSIONS is enabled (otherwise these paths are 404).
export default function sessionRoutes(repositories: Repositories, auth: SessionAuth, rateLimiter?: AuthRateLimiter) {
  const { login, createAccount, exchange, current, logout, logoutAll, requireAllowedOrigin } = createSessionController(repositories.users, auth, rateLimiter);
  const sessionGuard = createSessionGuard(repositories.users, auth);
  // Bearer tokens only: the legacy protect, without the cookie path.
  const bearerOnly = createProtect(repositories.users);
  const router = express.Router();

  // The per-IP rules are shared with the legacy endpoints: one budget per client.
  router.post("/session", ...limitPerIp(rateLimiter, (rules) => rules.loginPerIp), login);
  router.post("/accounts", ...limitPerIp(rateLimiter, (rules) => rules.registerPerIp), createAccount);
  router.get("/session", sessionGuard, current);
  router.delete("/session", sessionGuard, logout);
  router.delete("/sessions", sessionGuard, logoutAll);
  router.post("/session/exchange", ...limitPerIp(rateLimiter, (rules) => rules.exchangePerIp), requireAllowedOrigin, bearerOnly, exchange);

  return router;
}
