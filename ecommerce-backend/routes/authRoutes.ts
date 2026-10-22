import express, { type RequestHandler } from "express";
import { createAuthController } from "../controllers/authController.js";
import { limitPerIp, type AuthRateLimiter } from "../auth/rateLimit.js";
import type { Repositories } from "../repositories/types.js";

export default function authRoutes(repositories: Repositories, protect: RequestHandler, rateLimiter?: AuthRateLimiter) {
  const { getUserProfile, loginUser, registerUser } = createAuthController(repositories.users, rateLimiter);
  const router = express.Router();

  router.post("/register", ...limitPerIp(rateLimiter, (rules) => rules.registerPerIp), registerUser);
  router.post("/login", ...limitPerIp(rateLimiter, (rules) => rules.loginPerIp), loginUser);
  router.get("/profile", protect, getUserProfile);

  return router;
}
