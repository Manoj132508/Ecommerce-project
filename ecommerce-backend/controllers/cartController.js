import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Product from "../models/Product.js";

// GET /api/cart-items
export const getCartItems = async (req, res) => {
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
       console.log("Cart item:", cartWithProducts);
      return res.json(cartWithProducts);
    }

    res.json(cartItems);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/cart-items
export const addCartItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (typeof quantity !== "number" || quantity < 1 || quantity > 10) {
      return res.status(400).json({
        message: "Quantity must be between 1 and 10"
      });
    }

    const product = await Product.findById(productId);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    let cartItem = await CartItem.findOne({ productId });

    if (cartItem) {
      cartItem.quantity += quantity;
      await cartItem.save();
    } else {
      cartItem = await CartItem.create({
        productId,
        quantity,
        deliveryOptionId: "1"
      });
    }

    res.status(201).json(cartItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// PUT /api/cart-items/:productId
export const updateCartItem = async (req, res) => {
  try {
    const cartItem = await CartItem.findOne({
      productId: req.params.productId
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    const { quantity, deliveryOptionId } = req.body;

    if (quantity !== undefined) {
      if (typeof quantity !== "number" || quantity < 1) {
        return res.status(400).json({
          message: "Quantity must be greater than 0"
        });
      }

      cartItem.quantity = quantity;
    }

    if (deliveryOptionId !== undefined) {
      const deliveryOption = await DeliveryOption.findById(deliveryOptionId);

      if (!deliveryOption) {
        return res.status(400).json({ message: "Invalid delivery option" });
      }

      cartItem.deliveryOptionId = deliveryOptionId;
    }

    await cartItem.save();
    res.json(cartItem);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/cart-items/:productId
export const deleteCartItem = async (req, res) => {
  try {
    const cartItem = await CartItem.findOne({
      productId: req.params.productId
    });

    if (!cartItem) {
      return res.status(404).json({ message: "Cart item not found" });
    }

    await cartItem.deleteOne();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/payment-summary
export const getPaymentSummary = async (req, res) => {
  try {
    const cartItems = await CartItem.find();
    let totalItems = 0;
    let productCostCents = 0;
    let shippingCostCents = 0;
    const unavailableProductIds = [];

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

    res.json({
      totalItems,
      productCostCents,
      shippingCostCents,
      totalCostBeforeTaxCents,
      taxCents,
      totalCostCents: totalCostBeforeTaxCents + taxCents,
      unavailableProductIds
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
