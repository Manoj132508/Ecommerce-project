import express from "express";
import { createSessionController } from "../controllers/sessionController.js";
import { createProtect } from "../middleware/authMiddleware.js";
import { createSessionGuard, type SessionAuth } from "../auth/sessionAuth.js";
import type { Repositories } from "../repositories/types.js";

// Mounted only when AUTH_COOKIE_SESSIONS is enabled (otherwise these paths are 404).
export default function sessionRoutes(repositories: Repositories, auth: SessionAuth) {
  const { login, exchange, current, logout, logoutAll, requireAllowedOrigin } = createSessionController(repositories.users, auth);
  const sessionGuard = createSessionGuard(repositories.users, auth);
  // Bearer tokens only: the legacy protect, without the cookie path.
  const bearerOnly = createProtect(repositories.users);
  const router = express.Router();

  router.post("/session", login);
  router.get("/session", sessionGuard, current);
  router.delete("/session", sessionGuard, logout);
  router.delete("/sessions", sessionGuard, logoutAll);
  router.post("/session/exchange", requireAllowedOrigin, bearerOnly, exchange);

  return router;
}
