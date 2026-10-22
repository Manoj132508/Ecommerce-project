import express, { type RequestHandler } from "express";
import { createProductController } from "../controllers/productController.js";
import { adminOnly } from "../middleware/authMiddleware.js";
import type { Repositories } from "../repositories/types.js";
import { privateNoStore } from "../middleware/privateCache.js";

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
  // Admin writes: responses are never stored by browsers or shared caches.
  router.post("/products", privateNoStore, protect, adminOnly, createProduct);
  router.put("/products/:productId", privateNoStore, protect, adminOnly, updateProduct);
  router.delete("/products/:productId", privateNoStore, protect, adminOnly, deleteProduct);
  router.get("/delivery-options", getDeliveryOptions);

  return router;
}
