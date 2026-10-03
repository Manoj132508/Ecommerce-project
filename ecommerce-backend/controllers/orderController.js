import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";

const addProductDetails = async (order) => {
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
export const getOrders = async (req, res) => {
  try {
    const filter = req.user.isAdmin ? {} : { userId: String(req.user._id) };
    let orders = await Order.find(filter).sort({ orderTimeMs: -1 });

    // console.log("Fetching orders:", orders);

    if (req.query.expand === "products") {
      orders = await Promise.all(orders.map(addProductDetails));
    }

    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/orders/:orderId
export const getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);

    if (
      !order ||
      (!req.user.isAdmin && order.userId !== String(req.user._id))
    ) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (req.query.expand === "products") {
      return res.json(await addProductDetails(order));
    }

    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/orders
export const createOrder = async (req, res) => {
  try {
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
      return res.status(400).json({ message: "Please provide complete customer details" });
    }

    const cartItems = await CartItem.find().sort({ createdAt: 1 });

    if (cartItems.length === 0) {
      return res.status(400).json({ message: "Cart is empty" });
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
      return res.status(400).json({ message: "A cart item has an invalid delivery option" });
    }

    let totalCostBeforeTaxCents = 0;

    const products = cartDetails.map(({ cartItem, product, deliveryOption }) => {
      totalCostBeforeTaxCents +=
        product.priceCents * cartItem.quantity + deliveryOption.priceCents;

      return {
        productId: cartItem.productId,
        product: {
          id: product.id,
          image: product.image,
          name: product.name,
          priceCents: product.priceCents,
          description: product.description,
          category: product.category
        },
        quantity: cartItem.quantity,
        estimatedDeliveryTimeMs:
          Date.now() + deliveryOption.deliveryDays * 24 * 60 * 60 * 1000
      };
    });

    const order = await Order.create({
      userId: String(req.user._id),
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
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
