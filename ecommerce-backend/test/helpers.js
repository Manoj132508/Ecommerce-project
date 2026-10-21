import jwt from "jsonwebtoken";
import request from "supertest";
import { createApp } from "../app.js";
import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import User from "../models/User.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const OBJECT_ID = /^[a-f\d]{24}$/i;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const api = () => request(createApp());

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

// Mirrors authController's generateToken so tests can authenticate without bcrypt round-trips.
export const tokenFor = (user) => jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, {
  expiresIn: "30d",
});

export async function createUser({
  name = "Regular User",
  email = "user@example.com",
  password = "user-password-123",
  isAdmin = false,
} = {}) {
  const user = await User.create({ name, email, password, isAdmin });
  return { user, token: tokenFor(user), password };
}

export const createAdmin = () => createUser({
  name: "Admin User",
  email: "admin@example.com",
  password: "admin-password-123",
  isAdmin: true,
});

// Same ids, days and prices as the live deliveryOptions collection.
export const DELIVERY_OPTIONS = [
  { _id: "1", deliveryDays: 7, priceCents: 0 },
  { _id: "2", deliveryDays: 3, priceCents: 499 },
  { _id: "3", deliveryDays: 1, priceCents: 999 },
];

export const PRODUCTS = {
  socks: {
    _id: "e43638ce-6aa0-4b85-b27f-e1d07eb678c6",
    image: "images/products/athletic-cotton-socks-6-pairs.jpg",
    name: "Black and Gray Athletic Cotton Socks - 6 Pairs",
    description: "Comfortable socks.",
    howItWorks: "Wear them.",
    highlights: ["Cotton", "6 pairs"],
    careInstructions: "Machine wash.",
    category: "Clothing",
    rating: { stars: 4.5, count: 87 },
    priceCents: 1090,
    keywords: ["socks", "sports", "apparel"],
  },
  basketball: {
    _id: "15b6fc6f-327a-4ec4-896f-486349e85a3d",
    image: "images/products/intermediate-composite-basketball.jpg",
    name: "Intermediate Size Basketball",
    description: "A composite basketball.",
    howItWorks: "Bounce it.",
    highlights: ["Composite leather"],
    careInstructions: "Wipe clean.",
    category: "Sports",
    rating: { stars: 4, count: 127 },
    priceCents: 2095,
    keywords: ["sports", "basketballs"],
  },
  tshirt: {
    _id: "83d4ca15-0f35-48f5-b7a3-1ea210004f2e",
    image: "images/products/adults-plain-cotton-tshirt-2-pack-teal.jpg",
    name: "Adults Plain Cotton T-Shirt - 2 Pack",
    description: "Plain t-shirts.",
    howItWorks: "Wear it.",
    highlights: ["2 pack"],
    careInstructions: "Wash cold.",
    category: "Clothing",
    rating: { stars: 4.5, count: 56 },
    priceCents: 799,
    keywords: ["tshirts", "apparel", "mens"],
  },
};

const at = (minutesAgo) => new Date(Date.UTC(2026, 0, 1) - minutesAgo * 60_000);

// Raw inserts bypass Mongoose defaults so documents look like the live data
// (for example, no product has a stored `stock` field).
export async function seedCatalog() {
  await DeliveryOption.collection.insertMany(
    DELIVERY_OPTIONS.map((option, index) => ({
      ...option,
      createdAt: at(30 - index),
      updatedAt: at(30 - index),
    })),
  );
  await Product.collection.insertMany(
    Object.values(PRODUCTS).map((product, index) => ({
      ...product,
      createdAt: at(20 - index),
      updatedAt: at(20 - index),
    })),
  );
}

export async function insertCartItem({ productId, quantity = 1, deliveryOptionId = "1", minutesAgo = 10 }) {
  await CartItem.collection.insertOne({
    productId,
    quantity,
    deliveryOptionId,
    createdAt: at(minutesAgo),
    updatedAt: at(minutesAgo),
  });
}

// A pre-snapshot order exactly like the six legacy orders in the live data:
// no userId, no customer, no product snapshots.
export async function insertLegacyOrder({ id, productId, orderTimeMs, quantity = 1, userId }) {
  await Order.collection.insertOne({
    _id: id,
    ...(userId ? { userId } : {}),
    orderTimeMs,
    totalCostCents: 1199,
    products: [{ productId, quantity, estimatedDeliveryTimeMs: orderTimeMs + 3 * DAY_MS }],
    createdAt: new Date(orderTimeMs),
    updatedAt: new Date(orderTimeMs),
  });
}

export const validCustomer = {
  fullName: "  Ada Lovelace  ",
  email: "  ADA@Example.COM ",
  phone: " 0123 456 ",
  address: " 1 Analytical Way ",
  city: " London ",
  postalCode: " N1 1AA ",
  country: " UK ",
};
