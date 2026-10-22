import type { RequestHandler } from "express";
import { requireUser } from "../middleware/authMiddleware.js";
import { ORDER_STATUSES, type CartRepository, type OrderRepository, type OrderStatus } from "../repositories/types.js";
import type { CustomerDetails, ErrorResponse } from "../types/api.js";
import { errorMessage } from "../utils/errors.js";
import { isOrderId } from "../utils/identifiers.js";

type NoParams = Record<string, string>;
type OrderParams = { orderId: string };

// Untrusted checkout form; every field is validated before use.
type CustomerBody = { [Field in keyof CustomerDetails]?: unknown };

interface CreateOrderBody {
  customer?: CustomerBody | null;
}

interface StatusBody {
  status?: unknown;
  reason?: unknown;
}

const invalidOrderId: ErrorResponse = { message: "Invalid order id" };
const isOrderStatus = (value: unknown): value is OrderStatus => ORDER_STATUSES.some((status) => status === value);

export function createOrderController(orders: OrderRepository, carts: CartRepository) {
  // GET /api/orders
  const getOrders: RequestHandler<NoParams> = async (req, res) => {
    try {
      const user = requireUser(req);
      return res.json(await orders.list({ id: user.id, isAdmin: user.isAdmin }, req.query.expand === "products"));
    } catch (error) {
      console.error("Order list failed:", errorMessage(error));
      return res.status(500).json({ message: "Unable to load orders" } satisfies ErrorResponse);
    }
  };

  // GET /api/orders/:orderId
  const getOrder: RequestHandler<OrderParams> = async (req, res) => {
    try {
      const user = requireUser(req);

      if (!isOrderId(req.params.orderId)) {
        return res.status(400).json(invalidOrderId);
      }

      const order = await orders.get(req.params.orderId, { id: user.id, isAdmin: user.isAdmin }, req.query.expand === "products");

      if (!order) {
        return res.status(404).json({ message: "Order not found" } satisfies ErrorResponse);
      }

      return res.json(order);
    } catch (error) {
      console.error("Order lookup failed:", errorMessage(error));
      return res.status(500).json({ message: "Unable to load the order" } satisfies ErrorResponse);
    }
  };

  // POST /api/orders
  const createOrder: RequestHandler<NoParams, unknown, CreateOrderBody | undefined> = async (req, res) => {
    try {
      const user = requireUser(req);
      const customer = req.body?.customer;
      const idempotencyKey = req.get("Idempotency-Key");

      if (idempotencyKey !== undefined && !isOrderId(idempotencyKey)) {
        return res.status(400).json({ message: "Invalid Idempotency-Key" } satisfies ErrorResponse);
      }

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

      const result = await orders.checkout(carts.ownership === "per-user" ? user.id : null, user, {
        fullName: customer.fullName.trim(),
        email: customer.email.trim().toLowerCase(),
        phone: customer.phone.trim(),
        address: customer.address.trim(),
        city: customer.city.trim(),
        postalCode: customer.postalCode.trim(),
        country: customer.country.trim()
      }, idempotencyKey);

      switch (result.kind) {
        case "empty":
          return res.status(400).json({ message: "Cart is empty" } satisfies ErrorResponse);
        case "unavailable":
          return res.status(409).json({
            message: "Remove unavailable products from your cart before placing the order",
            unavailableProductIds: result.productIds
          });
        case "invalid-delivery":
          return res.status(400).json({ message: "A cart item has an invalid delivery option" } satisfies ErrorResponse);
        case "insufficient-stock":
          return res.status(409).json({
            message: "Some products do not have enough stock for this order",
            insufficientStockProductIds: result.productIds
          });
        case "placed":
          return res.status(201).json(result.order);
      }
    } catch (error) {
      console.error("Checkout failed:", errorMessage(error));
      return res.status(500).json({ message: "Unable to place the order" } satisfies ErrorResponse);
    }
  };

  // PATCH /api/orders/:orderId/status (admin). Audited; only allowed transitions.
  // Cancelling never changes the order total; refunds are a separate process.
  const updateOrderStatus: RequestHandler<OrderParams, unknown, StatusBody | undefined> = async (req, res) => {
    try {
      const admin = requireUser(req);

      if (!isOrderId(req.params.orderId)) {
        return res.status(400).json(invalidOrderId);
      }

      const status = req.body?.status;
      const reason = req.body?.reason;

      if (!isOrderStatus(status)) {
        return res.status(400).json({ message: `Status must be one of ${ORDER_STATUSES.join(", ")}` } satisfies ErrorResponse);
      }

      if (typeof reason !== "string" || !reason.trim() || reason.length > 500) {
        return res.status(400).json({ message: "Provide a reason for the status change (at most 500 characters)" } satisfies ErrorResponse);
      }

      const result = await orders.changeStatus(req.params.orderId, status, admin, reason.trim());

      switch (result.kind) {
        case "changed":
          return res.json(result.order);
        case "not-found":
          return res.status(404).json({ message: "Order not found" } satisfies ErrorResponse);
        case "not-allowed":
          return res.status(409).json({ message: result.message } satisfies ErrorResponse);
        case "unsupported":
          return res.status(501).json({
            message: "Order status changes need the PostgreSQL order store (DATA_SOURCE_ORDERS=postgres)"
          } satisfies ErrorResponse);
      }
    } catch (error) {
      console.error("Order status change failed:", errorMessage(error));
      return res.status(500).json({ message: "Unable to change the order status" } satisfies ErrorResponse);
    }
  };

  return { getOrders, getOrder, createOrder, updateOrderStatus };
}
