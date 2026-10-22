import express, { type RequestHandler } from "express";
import { createOrderController } from "../controllers/orderController.js";
import { adminOnly } from "../middleware/authMiddleware.js";
import type { Repositories } from "../repositories/types.js";

export default function orderRoutes(repositories: Repositories, protect: RequestHandler) {
  const { createOrder, getOrder, getOrders, updateOrderStatus } = createOrderController(repositories.orders, repositories.carts);
  const router = express.Router();

  router.route("/orders")
    .get(protect, getOrders)
    .post(protect, createOrder);

  router.get("/orders/:orderId", protect, getOrder);
  router.patch("/orders/:orderId/status", protect, adminOnly, updateOrderStatus);

  return router;
}
