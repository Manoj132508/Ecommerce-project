import express, { type RequestHandler } from "express";
import { createCartController } from "../controllers/cartController.js";
import type { Repositories } from "../repositories/types.js";
import { privateNoStore } from "../middleware/privateCache.js";

export default function cartRoutes(repositories: Repositories, protect: RequestHandler) {
  const {
    addCartItem,
    deleteCartItem,
    getCartItems,
    getPaymentSummary,
    updateCartItem
  } = createCartController(repositories.carts, repositories.products, repositories.deliveryOptions);
  const router = express.Router();

  // D1: per-user carts (PostgreSQL) require authentication. The legacy shared
  // MongoDB cart stays public, as it always was.
  const auth: RequestHandler[] = repositories.carts.ownership === "per-user" ? [privateNoStore, protect] : [];

  router.route("/cart-items")
    .get(...auth, getCartItems)
    .post(...auth, addCartItem);

  router.route("/cart-items/:productId")
    .put(...auth, updateCartItem)
    .delete(...auth, deleteCartItem);

  router.get("/payment-summary", ...auth, getPaymentSummary);

  return router;
}
