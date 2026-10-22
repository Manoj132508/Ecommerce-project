import express, { type RequestHandler } from "express";
import { createProductController } from "../controllers/productController.js";
import { adminOnly } from "../middleware/authMiddleware.js";
import type { Repositories } from "../repositories/types.js";

export default function productRoutes(repositories: Repositories, protect: RequestHandler) {
  const {
    createProduct,
    deleteProduct,
    getDeliveryOptions,
    getProducts,
    updateProduct
  } = createProductController(repositories.products, repositories.deliveryOptions);
  const router = express.Router();

  router.get("/products", getProducts);
  router.post("/products", protect, adminOnly, createProduct);
  router.put("/products/:productId", protect, adminOnly, updateProduct);
  router.delete("/products/:productId", protect, adminOnly, deleteProduct);
  router.get("/delivery-options", getDeliveryOptions);

  return router;
}
