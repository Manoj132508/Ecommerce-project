import express, { type Express } from "express";
import cors from "cors";

import { createProtect } from "./middleware/authMiddleware.js";
import { createRepositories } from "./repositories/index.js";
import type { Repositories } from "./repositories/types.js";
import productRoutes from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import type { SessionAuth } from "./auth/sessionAuth.js";

export interface AppOptions {
  /** Data access per domain. Defaults to MongoDB for every domain. */
  repositories?: Repositories;
  /** Cookie sessions (AUTH_COOKIE_SESSIONS). Absent: bearer tokens only, as before. */
  sessionAuth?: SessionAuth;
}

// Builds the Express app without connecting to a database or opening a port,
// so tests can exercise it in-process. Call after environment variables load.
export function createApp({ repositories = createRepositories(), sessionAuth }: AppOptions = {}): Express {
  const app = express();
  const protect = createProtect(repositories.users, sessionAuth);

  // Permit the local Vite app and the deployed storefront to call this API.
  // CLIENT_URL can contain a comma-separated list when more frontends are added.
  const allowedOrigins = new Set([
    "http://localhost:5173",
    "http://localhost:5174",
    "https://ecommerce-project-three-peach.vercel.app",
    ...(process.env.CLIENT_URL || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    // The Next.js host forwards the browser's Origin through its /api proxy.
    ...(sessionAuth?.config.allowedOrigins ?? []),
  ]);

  app.use(
    cors({
      origin(origin, callback) {
        // Requests without an Origin header include server-to-server calls and
        // health checks, which are safe to allow through the CORS middleware.
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
    }),
  );

  app.use(express.json());

  app.get("/", (req, res) => {
    res.send("Ecommerce API is running");
  });

  app.get("/getjson", (req, res) => {
    res.json({ msg: "Hello from the ecommerce API" });
  });

  // Routes
  if (sessionAuth) {
    app.use("/api/auth", sessionRoutes(repositories, sessionAuth));
  }
  app.use("/api/auth", authRoutes(repositories, protect));
  app.use("/api", productRoutes(repositories, protect));
  app.use("/api", cartRoutes(repositories, protect));
  app.use("/api", orderRoutes(repositories, protect));

  return app;
}
