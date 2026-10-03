import mongoose from "mongoose";
import { randomUUID } from "node:crypto";

const productSnapshotSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    image: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    priceCents: { type: Number, required: true, min: 0 },
    description: { type: String, default: "", trim: true },
    category: { type: String, default: "", trim: true }
  },
  { _id: false }
);

const orderProductSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    product: { type: productSnapshotSchema },
    quantity: { type: Number, required: true, min: 1 },
    estimatedDeliveryTimeMs: { type: Number, required: true }
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    _id: { type: String, default: randomUUID },
    userId: { type: String, required: true, index: true },
    customer: { type: customerSchema, required: true },
    orderTimeMs: { type: Number, required: true },
    totalCostCents: { type: Number, required: true, min: 0 },
    products: { type: [orderProductSchema], required: true }
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      virtuals: true,
      transform: (_document, order) => {
        order.id = order._id;
        delete order._id;
      }
    }
  }
);

const Order = mongoose.model("Order", orderSchema);

export default Order;
