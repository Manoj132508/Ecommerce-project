import type { Request, RequestHandler } from "express";
import { requireUser } from "../middleware/authMiddleware.js";
import {
  CartQuantityError,
  type CartOwner,
  type CartRepository,
  type DeliveryOptionRepository,
  type ProductRepository,
} from "../repositories/types.js";
import type { ErrorResponse, PaymentSummary } from "../types/api.js";
import { errorMessage } from "../utils/errors.js";
import { isDeliveryOptionId, isProductId } from "../utils/identifiers.js";

type NoParams = Record<string, string>;
type CartItemParams = { productId: string };

// Request bodies are untrusted JSON; identifiers are checked with the guards
// in utils/identifiers.ts before any query (R18).
interface AddCartItemBody {
  productId?: unknown;
  quantity?: unknown;
}

interface UpdateCartItemBody {
  quantity?: unknown;
  deliveryOptionId?: unknown;
}

const invalidProductId: ErrorResponse = { message: "Invalid product id" };
const invalidDeliveryOption: ErrorResponse = { message: "Invalid delivery option" };
const quantityRange: ErrorResponse = { message: "Quantity must be between 1 and 10" };

// FD1, for per-user carts: an integer from 1 to 10.
const isCartQuantity = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10
);

export function createCartController(
  carts: CartRepository,
  products: ProductRepository,
  deliveryOptions: DeliveryOptionRepository,
) {
  const perUser = carts.ownership === "per-user";

  // D1: per-user carts belong to the authenticated user; the legacy shared
  // MongoDB cart has no owner.
  const ownerOf = (req: Request<CartItemParams> | Request<NoParams>): CartOwner => (perUser ? requireUser(req).id : null);

  // GET /api/cart-items
  const getCartItems: RequestHandler<NoParams> = async (req, res) => {
    try {
      const lines = await carts.list(ownerOf(req));

      if (req.query.expand === "product") {
        const cartWithProducts = await Promise.all(
          lines.map(async (line) => {
            const product = await products.findById(line.productId);

            return {
              ...line,
              product,
              unavailable: !product
            };
          })
        );

        return res.json(cartWithProducts);
      }

      return res.json(lines);
    } catch (error) {
      return res.status(500).json({ message: errorMessage(error) });
    }
  };

  // POST /api/cart-items
  const addCartItem: RequestHandler<NoParams, unknown, AddCartItemBody> = async (req, res) => {
    try {
      const { productId, quantity } = req.body;
      const validQuantity = perUser
        ? isCartQuantity(quantity)
        : typeof quantity === "number" && quantity >= 1 && quantity <= 10;

      if (!validQuantity || typeof quantity !== "number") {
        return res.status(400).json(quantityRange);
      }

      if (!isProductId(productId)) {
        return res.status(400).json(invalidProductId);
      }

      const product = await products.findById(productId);

      if (!product) {
        return res.status(404).json({ message: "Product not found" } satisfies ErrorResponse);
      }

      return res.status(201).json(await carts.add(ownerOf(req), productId, quantity));
    } catch (error) {
      if (error instanceof CartQuantityError) {
        return res.status(400).json(quantityRange);
      }
      return res.status(500).json({ message: errorMessage(error) });
    }
  };

  // PUT /api/cart-items/:productId
  const updateCartItem: RequestHandler<CartItemParams, unknown, UpdateCartItemBody> = async (req, res) => {
    try {
      if (!isProductId(req.params.productId)) {
        return res.status(400).json(invalidProductId);
      }

      const owner = ownerOf(req);
      const line = await carts.find(owner, req.params.productId);

      if (!line) {
        return res.status(404).json({ message: "Cart item not found" } satisfies ErrorResponse);
      }

      const { quantity, deliveryOptionId } = req.body;
      const changes: { quantity?: number; deliveryOptionId?: string } = {};

      if (quantity !== undefined) {
        if (perUser) {
          if (!isCartQuantity(quantity)) {
            return res.status(400).json(quantityRange);
          }
        } else if (typeof quantity !== "number" || quantity < 1) {
          return res.status(400).json({
            message: "Quantity must be greater than 0"
          } satisfies ErrorResponse);
        }

        changes.quantity = quantity;
      }

      if (deliveryOptionId !== undefined) {
        if (!isDeliveryOptionId(deliveryOptionId)) {
          return res.status(400).json(invalidDeliveryOption);
        }

        const deliveryOption = await deliveryOptions.findById(deliveryOptionId);

        if (!deliveryOption) {
          return res.status(400).json(invalidDeliveryOption);
        }

        changes.deliveryOptionId = deliveryOptionId;
      }

      const updated = await carts.update(owner, req.params.productId, changes);

      if (!updated) {
        return res.status(404).json({ message: "Cart item not found" } satisfies ErrorResponse);
      }

      return res.json(updated);
    } catch (error) {
      if (error instanceof CartQuantityError) {
        return res.status(400).json(quantityRange);
      }
      return res.status(500).json({ message: errorMessage(error) });
    }
  };

  // DELETE /api/cart-items/:productId
  const deleteCartItem: RequestHandler<CartItemParams> = async (req, res) => {
    try {
      if (!isProductId(req.params.productId)) {
        return res.status(400).json(invalidProductId);
      }

      if (!(await carts.remove(ownerOf(req), req.params.productId))) {
        return res.status(404).json({ message: "Cart item not found" } satisfies ErrorResponse);
      }

      return res.status(204).send();
    } catch (error) {
      return res.status(500).json({ message: errorMessage(error) });
    }
  };

  // GET /api/payment-summary
  const getPaymentSummary: RequestHandler<NoParams> = async (req, res) => {
    try {
      const lines = await carts.list(ownerOf(req));
      let totalItems = 0;
      let productCostCents = 0;
      let shippingCostCents = 0;
      const unavailableProductIds: string[] = [];

      for (const line of lines) {
        const product = await products.findById(line.productId);

        if (!product) {
          unavailableProductIds.push(line.productId);
          continue;
        }

        const deliveryOption = await deliveryOptions.findById(line.deliveryOptionId);

        if (!deliveryOption) {
          throw new Error(`Invalid delivery option: ${line.deliveryOptionId}`);
        }

        totalItems += line.quantity;
        productCostCents += product.priceCents * line.quantity;
        shippingCostCents += deliveryOption.priceCents;
      }

      const totalCostBeforeTaxCents = productCostCents + shippingCostCents;
      const taxCents = Math.round(totalCostBeforeTaxCents * 0.1);

      const summary: PaymentSummary = {
        totalItems,
        productCostCents,
        shippingCostCents,
        totalCostBeforeTaxCents,
        taxCents,
        totalCostCents: totalCostBeforeTaxCents + taxCents,
        unavailableProductIds
      };

      return res.json(summary);
    } catch (error) {
      return res.status(500).json({ message: errorMessage(error) });
    }
  };

  return { getCartItems, addCartItem, updateCartItem, deleteCartItem, getPaymentSummary };
}
