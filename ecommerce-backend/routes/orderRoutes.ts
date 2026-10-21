import express from "express";
import {
  createOrder,
  getOrder,
  getOrders
} from "../controllers/orderController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.route("/orders")
  .get(protect, getOrders)
  .post(protect, createOrder);

router.get("/orders/:orderId", protect, getOrder);

export default router;
