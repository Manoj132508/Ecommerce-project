// Regression baseline for O1–O3 (MIGRATION_PLAN.md §2): checkout, order
// history, ownership, legacy orders (D4) and unavailable-product blocking (D3).
import { beforeEach, describe, expect, test } from "vitest";
import CartItem from "../models/CartItem.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import {
  api,
  bearer,
  createAdmin,
  createUser,
  DAY_MS,
  insertCartItem,
  insertLegacyOrder,
  ISO_DATE,
  PRODUCTS,
  seedCatalog,
  UUID,
  validCustomer,
} from "./helpers.js";

const ORDER_KEYS = ["createdAt", "customer", "id", "orderTimeMs", "products", "totalCostCents", "updatedAt", "userId"];
const SNAPSHOT_KEYS = ["category", "description", "id", "image", "name", "priceCents"];
const { socks, basketball, tshirt } = PRODUCTS;

const placeOrder = (token, body = { customer: validCustomer }) => (
  api().post("/api/orders").set(bearer(token)).send(body)
);

let shopper;

beforeEach(async () => {
  await seedCatalog();
  shopper = await createUser();
});

describe("authentication", () => {
  test.each([
    ["GET", "/api/orders"],
    ["GET", "/api/orders/any-id"],
    ["POST", "/api/orders"],
  ])("%s %s requires a valid bearer token", async (method, path) => {
    for (const headers of [{}, bearer("not-a-jwt")]) {
      const response = await api()[method.toLowerCase()](path).set(headers);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Not authorized" });
    }
  });
});

describe("POST /api/orders", () => {
  test("rejects missing or incomplete customer details and leaves the cart untouched", async () => {
    await insertCartItem({ productId: socks._id });
    const invalidBodies = [
      {},
      { customer: null },
      ...Object.keys(validCustomer).map((field) => ({ customer: { ...validCustomer, [field]: "  " } })),
      ...Object.keys(validCustomer).map((field) => ({ customer: { ...validCustomer, [field]: undefined } })),
      { customer: { ...validCustomer, email: "not-an-email" } },
      { customer: { ...validCustomer, phone: 123456 } },
    ];
    for (const body of invalidBodies) {
      const response = await placeOrder(shopper.token, body);
      expect(response.status, `Expected rejection for ${JSON.stringify(body)}`).toBe(400);
      expect(response.body).toEqual({ message: "Please provide complete customer details" });
    }
    expect(await Order.countDocuments()).toBe(0);
    expect(await CartItem.countDocuments()).toBe(1);
  });

  test("rejects an empty cart", async () => {
    const response = await placeOrder(shopper.token);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Cart is empty" });
  });

  test("D3: blocks checkout with 409 while the cart holds deleted products, without deleting them", async () => {
    await insertCartItem({ productId: socks._id, minutesAgo: 2 });
    await insertCartItem({ productId: tshirt._id, minutesAgo: 1 });
    await Product.deleteOne({ _id: socks._id });

    const response = await placeOrder(shopper.token);
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: "Remove unavailable products from your cart before placing the order",
      unavailableProductIds: [socks._id],
    });
    expect(await Order.countDocuments()).toBe(0);
    expect(await CartItem.countDocuments()).toBe(2);
  });

  test("checks unavailable products before invalid delivery options", async () => {
    await insertCartItem({ productId: socks._id, deliveryOptionId: "9" });
    await Product.deleteOne({ _id: socks._id });
    expect((await placeOrder(shopper.token)).status).toBe(409);
  });

  test("rejects a cart line with an invalid delivery option", async () => {
    await insertCartItem({ productId: socks._id, deliveryOptionId: "9" });
    const response = await placeOrder(shopper.token);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "A cart item has an invalid delivery option" });
    expect(await CartItem.countDocuments()).toBe(1);
  });

  test("creates the order with normalised customer, product snapshots and delivery estimates, then empties the cart", async () => {
    await insertCartItem({ productId: socks._id, quantity: 2, deliveryOptionId: "1", minutesAgo: 2 });
    await insertCartItem({ productId: basketball._id, quantity: 1, deliveryOptionId: "3", minutesAgo: 1 });

    const before = Date.now();
    const response = await placeOrder(shopper.token);
    const after = Date.now();

    expect(response.status).toBe(201);
    const order = response.body;
    expect(Object.keys(order).sort()).toEqual(ORDER_KEYS);
    expect(order.id).toMatch(UUID);
    expect(order.userId).toBe(String(shopper.user._id));
    expect(order.customer).toEqual({
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "0123 456",
      address: "1 Analytical Way",
      city: "London",
      postalCode: "N1 1AA",
      country: "UK",
    });
    expect(order.orderTimeMs).toBeGreaterThanOrEqual(before);
    expect(order.orderTimeMs).toBeLessThanOrEqual(after);
    expect(order.createdAt).toMatch(ISO_DATE);

    // Lines follow cart order (createdAt ascending).
    expect(order.products.map((line) => line.productId)).toEqual([socks._id, basketball._id]);
    for (const line of order.products) {
      expect(Object.keys(line).sort()).toEqual(["estimatedDeliveryTimeMs", "product", "productId", "quantity"]);
      expect(Object.keys(line.product).sort()).toEqual(SNAPSHOT_KEYS);
    }
    expect(order.products[0]).toMatchObject({
      quantity: 2,
      product: {
        id: socks._id,
        image: socks.image,
        name: socks.name,
        priceCents: socks.priceCents,
        description: socks.description,
        category: socks.category,
      },
    });
    const [sevenDay, oneDay] = order.products.map((line) => line.estimatedDeliveryTimeMs);
    expect(sevenDay).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(sevenDay).toBeLessThanOrEqual(after + 7 * DAY_MS);
    expect(oneDay).toBeGreaterThanOrEqual(before + DAY_MS);
    expect(oneDay).toBeLessThanOrEqual(after + DAY_MS);

    // (1090*2 + 0) + (2095 + 999) = 5274 before tax; round(5274 * 1.1) = 5801
    expect(order.totalCostCents).toBe(5801);
    expect(await CartItem.countDocuments()).toBe(0);
  });

  test("the order total equals the payment summary total shown at checkout", async () => {
    await insertCartItem({ productId: socks._id, quantity: 3, deliveryOptionId: "2", minutesAgo: 3 });
    await insertCartItem({ productId: basketball._id, quantity: 2, deliveryOptionId: "3", minutesAgo: 2 });
    await insertCartItem({ productId: tshirt._id, quantity: 1, deliveryOptionId: "1", minutesAgo: 1 });

    const summary = (await api().get("/api/payment-summary")).body;
    const order = (await placeOrder(shopper.token)).body;
    expect(order.totalCostCents).toBe(summary.totalCostCents);
  });

  test("D4: snapshots are immutable after the product is edited or deleted", async () => {
    const admin = await createAdmin();
    await insertCartItem({ productId: socks._id, quantity: 1 });
    const { body: placed } = await placeOrder(shopper.token);

    await api().put(`/api/products/${socks._id}`).set(bearer(admin.token)).send({
      name: "Renamed Socks",
      price: "99.99",
      description: "Changed.",
      howItWorks: "Changed.",
      highlights: "Changed",
      careInstructions: "Changed.",
      image: "images/products/changed.jpg",
      category: "Changed",
      stock: "1",
    });
    for (const path of [`/api/orders/${placed.id}`, `/api/orders/${placed.id}?expand=products`]) {
      const { body } = await api().get(path).set(bearer(shopper.token));
      expect(body.products[0].product).toEqual(placed.products[0].product);
    }

    await api().delete(`/api/products/${socks._id}`).set(bearer(admin.token));
    const { body: afterDelete } = await api().get(`/api/orders/${placed.id}?expand=products`).set(bearer(shopper.token));
    expect(afterDelete.products[0].product).toEqual(placed.products[0].product);
  });
});

describe("GET /api/orders", () => {
  const LEGACY_WITH_PRODUCT = "11111111-1111-4111-8111-111111111111";
  const LEGACY_DELETED_PRODUCT = "22222222-2222-4222-8222-222222222222";
  const OWNED_LEGACY = "33333333-3333-4333-8333-333333333333";

  let other;
  let placedId;

  beforeEach(async () => {
    other = await createUser({ name: "Other", email: "other@example.com" });
    await insertLegacyOrder({ id: LEGACY_WITH_PRODUCT, productId: basketball._id, orderTimeMs: 1_700_000_000_000 });
    await insertLegacyOrder({
      id: LEGACY_DELETED_PRODUCT,
      productId: "99999999-9999-4999-8999-999999999999",
      orderTimeMs: 1_700_000_100_000,
    });
    await insertLegacyOrder({
      id: OWNED_LEGACY,
      productId: tshirt._id,
      orderTimeMs: 1_600_000_000_000,
      userId: String(shopper.user._id),
    });
    await insertCartItem({ productId: socks._id });
    placedId = (await placeOrder(other.token)).body.id;
  });

  test("a regular user sees only their own orders, newest first", async () => {
    const response = await api().get("/api/orders").set(bearer(shopper.token));
    expect(response.status).toBe(200);
    expect(response.body.map((order) => order.id)).toEqual([OWNED_LEGACY]);

    const others = await api().get("/api/orders").set(bearer(other.token));
    expect(others.body.map((order) => order.id)).toEqual([placedId]);
  });

  test("an admin sees every order, including legacy orders without a userId, newest first", async () => {
    const admin = await createAdmin();
    const response = await api().get("/api/orders").set(bearer(admin.token));
    expect(response.body.map((order) => order.id)).toEqual([
      placedId,
      LEGACY_DELETED_PRODUCT,
      LEGACY_WITH_PRODUCT,
      OWNED_LEGACY,
    ]);
  });

  test("D4: legacy orders keep their original shape — no userId, customer or product snapshot", async () => {
    const admin = await createAdmin();
    const { body } = await api().get("/api/orders").set(bearer(admin.token));
    const legacy = body.find((order) => order.id === LEGACY_WITH_PRODUCT);
    expect(Object.keys(legacy).sort()).toEqual(["createdAt", "id", "orderTimeMs", "products", "totalCostCents", "updatedAt"]);
    expect(legacy.products).toEqual([{
      productId: basketball._id,
      quantity: 1,
      estimatedDeliveryTimeMs: 1_700_000_000_000 + 3 * DAY_MS,
    }]);
  });

  test("D4: ?expand=products looks up current products for legacy lines and returns null when deleted", async () => {
    const admin = await createAdmin();
    const { body } = await api().get("/api/orders?expand=products").set(bearer(admin.token));
    const currentBasketball = (await api().get("/api/products")).body.find((product) => product.id === basketball._id);

    expect(body.find((order) => order.id === LEGACY_WITH_PRODUCT).products[0].product).toEqual(currentBasketball);
    expect(body.find((order) => order.id === LEGACY_DELETED_PRODUCT).products[0].product).toBeNull();
    // Snapshot lines are returned as stored, not replaced by the current product.
    expect(Object.keys(body.find((order) => order.id === placedId).products[0].product).sort()).toEqual(SNAPSHOT_KEYS);
  });
});

describe("GET /api/orders/:orderId", () => {
  const LEGACY = "44444444-4444-4444-8444-444444444444";
  let orderId;

  beforeEach(async () => {
    await insertCartItem({ productId: socks._id });
    orderId = (await placeOrder(shopper.token)).body.id;
    await insertLegacyOrder({ id: LEGACY, productId: basketball._id, orderTimeMs: 1_700_000_000_000 });
  });

  test("returns the owner's order, with or without expand", async () => {
    const plain = await api().get(`/api/orders/${orderId}`).set(bearer(shopper.token));
    expect(plain.status).toBe(200);
    expect(Object.keys(plain.body).sort()).toEqual(ORDER_KEYS);
    expect(plain.body.id).toBe(orderId);

    const expanded = await api().get(`/api/orders/${orderId}?expand=products`).set(bearer(shopper.token));
    expect(expanded.status).toBe(200);
    expect(expanded.body).toEqual(plain.body);
  });

  test("returns 404, not 403, for another user's order or a legacy order without an owner", async () => {
    const intruder = await createUser({ name: "Intruder", email: "intruder@example.com" });
    for (const [token, id] of [[intruder.token, orderId], [shopper.token, LEGACY]]) {
      const response = await api().get(`/api/orders/${id}`).set(bearer(token));
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "Order not found" });
    }
  });

  test("lets an admin read any order, including legacy ones", async () => {
    const admin = await createAdmin();
    for (const id of [orderId, LEGACY]) {
      const response = await api().get(`/api/orders/${id}?expand=products`).set(bearer(admin.token));
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(id);
    }
  });

  test("returns 404 for an unknown order id", async () => {
    const response = await api().get("/api/orders/does-not-exist").set(bearer(shopper.token));
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Order not found" });
  });
});
