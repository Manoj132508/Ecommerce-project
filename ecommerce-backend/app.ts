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
import type { AuthRateLimiter } from "./auth/rateLimit.js";

export interface AppOptions {
  /** Data access per domain. Defaults to MongoDB for every domain. */
  repositories?: Repositories;
  /** Cookie sessions (AUTH_COOKIE_SESSIONS). Absent: bearer tokens only, as before. */
  sessionAuth?: SessionAuth;
  /**
   * Shared-store rate limits for authentication endpoints (R37). server.ts
   * always provides one (unless AUTH_RATE_LIMIT=false in development); tests
   * that do not pass one run without limits, as before.
   */
  rateLimiter?: AuthRateLimiter;
  /** Reverse proxies in front of Express (TRUST_PROXY_HOPS). 0: X-Forwarded-For is ignored. */
  trustProxyHops?: number;
}

// Builds the Express app without connecting to a database or opening a port,
// so tests can exercise it in-process. Call after environment variables load.
export function createApp({ repositories = createRepositories(), sessionAuth, rateLimiter, trustProxyHops = 0 }: AppOptions = {}): Express {
  const app = express();
  // Only the configured number of hops is believed; a client cannot add more.
  app.set("trust proxy", trustProxyHops);
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

  // R36: a request from any other origin is refused with a JSON 403 before
  // CORS headers, body parsing or any route runs, so it can change nothing.
  // Requests without an Origin header (server-to-server calls, health checks,
  // same-origin GETs) are not cross-origin and continue as before.
  app.use((req, res, next) => {
    const origin = req.get("Origin");
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      res.set("Cache-Control", "no-store");
      return res.status(403).json({ message: "Origin not allowed" });
    }
    return next();
  });

  app.use(cors({ origin: (origin, callback) => callback(null, origin === undefined || allowedOrigins.has(origin)) }));

  app.use(express.json());

  app.get("/", (req, res) => {
    res.send("Ecommerce API is running");
  });

  app.get("/getjson", (req, res) => {
    res.json({ msg: "Hello from the ecommerce API" });
  });

  // Routes
  if (sessionAuth) {
    app.use("/api/auth", sessionRoutes(repositories, sessionAuth, rateLimiter));
  }
  app.use("/api/auth", authRoutes(repositories, protect, rateLimiter));
  app.use("/api", productRoutes(repositories, protect));
  app.use("/api", cartRoutes(repositories, protect));
  app.use("/api", orderRoutes(repositories, protect));

  return app;
}
