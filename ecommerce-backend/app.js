import express from "express";
import cors from "cors";

import productRoutes from "./routes/productRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import authRoutes from "./routes/authRoutes.js";

// Builds the Express app without connecting to a database or opening a port,
// so tests can exercise it in-process. Call after environment variables load.
export function createApp() {
  const app = express();

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
  app.use("/api/auth", authRoutes);
  app.use("/api", productRoutes);
  app.use("/api", cartRoutes);
  app.use("/api", orderRoutes);

  return app;
}
