import express from "express";
import {
  addCartItem,
  deleteCartItem,
  getCartItems,
  getPaymentSummary,
  updateCartItem
} from "../controllers/cartController.js";

const router = express.Router();

router.route("/cart-items")
  .get(getCartItems)
  .post(addCartItem);

router.route("/cart-items/:productId")
  .put(updateCartItem)
  .delete(deleteCartItem);

router.get("/payment-summary", getPaymentSummary);

export default router;
