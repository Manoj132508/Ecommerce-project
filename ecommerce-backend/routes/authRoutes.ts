import express, { type RequestHandler } from "express";
import { createAuthController } from "../controllers/authController.js";
import type { Repositories } from "../repositories/types.js";

export default function authRoutes(repositories: Repositories, protect: RequestHandler) {
  const { getUserProfile, loginUser, registerUser } = createAuthController(repositories.users);
  const router = express.Router();

  router.post("/register", registerUser);
  router.post("/login", loginUser);
  router.get("/profile", protect, getUserProfile);

  return router;
}
