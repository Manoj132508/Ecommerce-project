import type { RequestHandler } from "express";
import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Product from "../models/Product.js";
import type { ErrorResponse, PaymentSummary } from "../types/api.js";
import { errorMessage } from "../utils/errors.js";

type NoParams = Record<string, string>;
type CartItemParams = { productId: string };

interface AddCartItemBody {
  // Deliberately unknown and passed through unchanged: see MIGRATION_PLAN.md
  // R18. Narrowing it to a string here would silently change behaviour.
  productId?: unknown;
  quantity?: unknown;
}

interface UpdateCartItemBody {
  quantity?: unknown;
  deliveryOptionId?: unknown;
}

// GET /api/cart-items
export const getCartItems: RequestHandler<NoParams> = async (req, res) => {
  try {
    const cartItems = await CartItem.find().sort({ createdAt: 1 });

    if (req.query.expand === "product") {
      const cartWithProducts = await Promise.all(
        cartItems.map(async (cartItem) => {
          const product = await Product.findById(cartItem.productId);

          return {
            ...cartItem.toJSON(),
            product,
            unavailable: !product
          };
        })
      );

      return res.json(cartWithProducts);
    }

    return res.json(cartItems);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};

// POST /api/cart-items
export const addCartItem: RequestHandler<NoParams, unknown, AddCartItemBody> = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (typeof quantity !== "number" || quantity < 1 || quantity > 10) {
      return res.status(400).json({
        message: "Quantity must be between 1 and 10"
      } satisfies ErrorResponse);
    }

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" } satisfies ErrorResponse);
    }

    // where().equals() and new + save() are the typed forms of the original
    // findOne({ productId }) and create(); they accept the unvalidated value
    // unchanged, so behaviour (including R18) is identical.
    let cartItem = await CartItem.findOne().where("productId").equals(productId);

    if (cartItem) {
      cartItem.quantity += quantity;
      await cartItem.save();
    } else {
      cartItem = new CartItem({
        productId,
        quantity,
        deliveryOptionId: "1"
      });
      await cartItem.save();
    }

    return res.status(201).json(cartItem);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};

// PUT /api/cart-items/:productId
export const updateCartItem: RequestHandler<CartItemParams, unknown, UpdateCartItemBody> = async (req, res) => {
  try {
    const cartItem = await CartItem.findOne({
      productId: req.params.productId
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found" } satisfies ErrorResponse);
    }

    const { quantity, deliveryOptionId } = req.body;

    if (quantity !== undefined) {
      if (typeof quantity !== "number" || quantity < 1) {
        return res.status(400).json({
          message: "Quantity must be greater than 0"
        } satisfies ErrorResponse);
      }

      cartItem.quantity = quantity;
    }

    if (deliveryOptionId !== undefined) {
      const deliveryOption = await DeliveryOption.findById(deliveryOptionId);

      if (!deliveryOption) {
        return res.status(400).json({ message: "Invalid delivery option" } satisfies ErrorResponse);
      }

      // The request value as sent (cast by Mongoose), exactly like the original assignment.
      cartItem.set("deliveryOptionId", deliveryOptionId);
    }

    await cartItem.save();
    return res.json(cartItem);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};

// DELETE /api/cart-items/:productId
export const deleteCartItem: RequestHandler<CartItemParams> = async (req, res) => {
  try {
    const cartItem = await CartItem.findOne({
      productId: req.params.productId
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found" } satisfies ErrorResponse);
    }

    await cartItem.deleteOne();
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};

// GET /api/payment-summary
export const getPaymentSummary: RequestHandler<NoParams> = async (req, res) => {
  try {
    const cartItems = await CartItem.find();
    let totalItems = 0;
    let productCostCents = 0;
    let shippingCostCents = 0;
    const unavailableProductIds: string[] = [];

    for (const cartItem of cartItems) {
      const product = await Product.findById(cartItem.productId);

      if (!product) {
        unavailableProductIds.push(cartItem.productId);
        continue;
      }

      const deliveryOption = await DeliveryOption.findById(
        cartItem.deliveryOptionId
      );

      if (!deliveryOption) {
        throw new Error(`Invalid delivery option: ${cartItem.deliveryOptionId}`);
      }

      totalItems += cartItem.quantity;
      productCostCents += product.priceCents * cartItem.quantity;
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
