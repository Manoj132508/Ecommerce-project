import type { RequestHandler } from "express";
import { requireUser } from "../middleware/authMiddleware.js";
import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Order, { type OrderDocument } from "../models/Order.js";
import Product from "../models/Product.js";
import type { CustomerDetails, ErrorResponse, ProductSnapshot } from "../types/api.js";
import { errorMessage } from "../utils/errors.js";

type NoParams = Record<string, string>;
type OrderParams = { orderId: string };

// Untrusted checkout form; every field is validated before use.
type CustomerBody = { [Field in keyof CustomerDetails]?: unknown };

interface CreateOrderBody {
  customer?: CustomerBody | null;
}

const addProductDetails = async (order: OrderDocument) => {
  const products = await Promise.all(
    order.products.map(async (orderProduct) => {
      const storedOrderProduct = orderProduct.toObject();

      if (storedOrderProduct.product) {
        return storedOrderProduct;
      }

      // Older orders created before product snapshots still get a best-effort lookup.
      const legacyProduct = await Product.findById(orderProduct.productId);

      return {
        ...storedOrderProduct,
        product: legacyProduct
      };
    })
  );

  return { ...order.toJSON(), products };
};

// GET /api/orders
export const getOrders: RequestHandler<NoParams> = async (req, res) => {
  try {
    const user = requireUser(req);
    const filter = user.isAdmin ? {} : { userId: String(user._id) };
    const orders = await Order.find(filter).sort({ orderTimeMs: -1 });

    // console.log("Fetching orders:", orders);

    if (req.query.expand === "products") {
      return res.json(await Promise.all(orders.map(addProductDetails)));
    }

    return res.json(orders);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};

// GET /api/orders/:orderId
export const getOrder: RequestHandler<OrderParams> = async (req, res) => {
  try {
    const user = requireUser(req);
    const order = await Order.findById(req.params.orderId);

    if (
      !order ||
      (!user.isAdmin && order.userId !== String(user._id))
    ) {
      return res.status(404).json({ message: "Order not found" } satisfies ErrorResponse);
    }

    if (req.query.expand === "products") {
      return res.json(await addProductDetails(order));
    }

    return res.json(order);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};

// POST /api/orders
export const createOrder: RequestHandler<NoParams, unknown, CreateOrderBody | undefined> = async (req, res) => {
  try {
    const user = requireUser(req);
    const customer = req.body?.customer;

    if (
      !customer ||
      typeof customer.fullName !== "string" || !customer.fullName.trim() ||
      typeof customer.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim()) ||
      typeof customer.phone !== "string" || !customer.phone.trim() ||
      typeof customer.address !== "string" || !customer.address.trim() ||
      typeof customer.city !== "string" || !customer.city.trim() ||
      typeof customer.postalCode !== "string" || !customer.postalCode.trim() ||
      typeof customer.country !== "string" || !customer.country.trim()
    ) {
      return res.status(400).json({ message: "Please provide complete customer details" } satisfies ErrorResponse);
    }

    const cartItems = await CartItem.find().sort({ createdAt: 1 });

    if (cartItems.length === 0) {
      return res.status(400).json({ message: "Cart is empty" } satisfies ErrorResponse);
    }

    const cartDetails = await Promise.all(
      cartItems.map(async (cartItem) => {
        const [product, deliveryOption] = await Promise.all([
          Product.findById(cartItem.productId),
          DeliveryOption.findById(cartItem.deliveryOptionId)
        ]);

        return { cartItem, product, deliveryOption };
      })
    );

    const unavailableProductIds = cartDetails
      .filter(({ product }) => !product)
      .map(({ cartItem }) => cartItem.productId);

    if (unavailableProductIds.length > 0) {
      return res.status(409).json({
        message: "Remove unavailable products from your cart before placing the order",
        unavailableProductIds
      });
    }

    if (cartDetails.some(({ deliveryOption }) => !deliveryOption)) {
      return res.status(400).json({ message: "A cart item has an invalid delivery option" } satisfies ErrorResponse);
    }

    // Both checks above guarantee every line has a product and a delivery
    // option; this narrows the types without dropping or reordering lines.
    const checkedDetails = cartDetails.flatMap(({ cartItem, product, deliveryOption }) => (
      product && deliveryOption ? [{ cartItem, product, deliveryOption }] : []
    ));

    let totalCostBeforeTaxCents = 0;

    const products = checkedDetails.map(({ cartItem, product, deliveryOption }) => {
      totalCostBeforeTaxCents +=
        product.priceCents * cartItem.quantity + deliveryOption.priceCents;

      const snapshot: ProductSnapshot = {
        id: product.id,
        image: product.image,
        name: product.name,
        priceCents: product.priceCents,
        description: product.description,
        category: product.category
      };

      return {
        productId: cartItem.productId,
        product: snapshot,
        quantity: cartItem.quantity,
        estimatedDeliveryTimeMs:
          Date.now() + deliveryOption.deliveryDays * 24 * 60 * 60 * 1000
      };
    });

    const order = await Order.create({
      userId: String(user._id),
      customer: {
        fullName: customer.fullName.trim(),
        email: customer.email.trim().toLowerCase(),
        phone: customer.phone.trim(),
        address: customer.address.trim(),
        city: customer.city.trim(),
        postalCode: customer.postalCode.trim(),
        country: customer.country.trim()
      },
      orderTimeMs: Date.now(),
      totalCostCents: Math.round(totalCostBeforeTaxCents * 1.1),
      products
    });

    await CartItem.deleteMany();
    return res.status(201).json(order);
  } catch (error) {
    return res.status(500).json({ message: errorMessage(error) });
  }
};
