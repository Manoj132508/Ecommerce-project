import express from "express";
import {
  createProduct,
  deleteProduct,
  getDeliveryOptions,
  getProducts,
  updateProduct
} from "../controllers/productController.js";
import { adminOnly, protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/products", getProducts);
router.post("/products", protect, adminOnly, createProduct);
router.put("/products/:productId", protect, adminOnly, updateProduct);
router.delete("/products/:productId", protect, adminOnly, deleteProduct);
router.get("/delivery-options", getDeliveryOptions);

export default router;
