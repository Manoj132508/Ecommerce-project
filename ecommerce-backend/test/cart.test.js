// Regression baseline for C1–C5 (MIGRATION_PLAN.md §2): cart mechanics,
// validation and totals. Requests here carry no token because the current
// API does not require one; that ownership flaw is pinned separately in
// cart.shared-cart.current-flaw.test.js and is NOT the target contract (D1).
import { beforeEach, describe, expect, test } from "vitest";
import CartItem from "../models/CartItem.js";
import Product from "../models/Product.js";
import {
  api,
  insertCartItem,
  ISO_DATE,
  OBJECT_ID,
  PRODUCTS,
  seedCatalog,
} from "./helpers.js";

const CART_ITEM_KEYS = ["createdAt", "deliveryOptionId", "id", "productId", "quantity", "updatedAt"];
const { socks, basketball, tshirt } = PRODUCTS;

const addToCart = (productId, quantity) => api().post("/api/cart-items").send({ productId, quantity });
const cartPath = (productId) => `/api/cart-items/${productId}`;

beforeEach(seedCatalog);

describe("GET /api/cart-items", () => {
  test("returns an empty list for an empty cart", async () => {
    const response = await api().get("/api/cart-items");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  test("returns items sorted by createdAt with id instead of _id", async () => {
    await insertCartItem({ productId: basketball._id, minutesAgo: 1 });
    await insertCartItem({ productId: socks._id, quantity: 3, deliveryOptionId: "2", minutesAgo: 5 });

    const response = await api().get("/api/cart-items");
    expect(response.status).toBe(200);
    expect(response.body.map((item) => item.productId)).toEqual([socks._id, basketball._id]);
    const [item] = response.body;
    expect(Object.keys(item).sort()).toEqual(CART_ITEM_KEYS);
    expect(item).toMatchObject({ productId: socks._id, quantity: 3, deliveryOptionId: "2" });
    expect(item.id).toMatch(OBJECT_ID);
    expect(item.createdAt).toMatch(ISO_DATE);
  });

  test("?expand=product embeds the full product and unavailable: false", async () => {
    await insertCartItem({ productId: socks._id });
    const [item] = (await api().get("/api/cart-items?expand=product")).body;
    expect(Object.keys(item).sort()).toEqual([...CART_ITEM_KEYS, "product", "unavailable"].sort());
    expect(item.unavailable).toBe(false);
    expect(item.product).toEqual((await api().get("/api/products")).body[0]);
  });

  test("D3: keeps items whose product was deleted and marks them unavailable", async () => {
    await insertCartItem({ productId: socks._id, minutesAgo: 2 });
    await insertCartItem({ productId: tshirt._id, minutesAgo: 1 });
    await Product.deleteOne({ _id: socks._id });

    const response = await api().get("/api/cart-items?expand=product");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body[0]).toMatchObject({ productId: socks._id, product: null, unavailable: true });
    expect(response.body[1]).toMatchObject({ productId: tshirt._id, unavailable: false });
    expect(await CartItem.countDocuments()).toBe(2);
  });

  test("ignores unknown expand values", async () => {
    await insertCartItem({ productId: socks._id });
    const [item] = (await api().get("/api/cart-items?expand=products")).body;
    expect(Object.keys(item).sort()).toEqual(CART_ITEM_KEYS);
  });
});

describe("POST /api/cart-items", () => {
  test("rejects a missing body and quantities outside 1–10 or not numbers", async () => {
    const missingBody = await api().post("/api/cart-items");
    expect(missingBody.status).toBe(400);
    for (const quantity of [undefined, 0, -1, 11, "2", null]) {
      const response = await addToCart(socks._id, quantity);
      expect(response.status, `Expected rejection for quantity ${quantity}`).toBe(400);
      expect(response.body).toEqual({ message: "Quantity must be between 1 and 10" });
    }
    expect(await CartItem.countDocuments()).toBe(0);
  });

  test("returns 404 for an unknown or missing product", async () => {
    for (const productId of ["00000000-0000-4000-8000-000000000000", undefined]) {
      const response = await addToCart(productId, 1);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ message: "Product not found" });
    }
    expect(await CartItem.countDocuments()).toBe(0);
  });

  test("creates a new line with delivery option '1' and returns 201", async () => {
    const response = await addToCart(socks._id, 2);
    expect(response.status).toBe(201);
    expect(Object.keys(response.body).sort()).toEqual(CART_ITEM_KEYS);
    expect(response.body).toMatchObject({ productId: socks._id, quantity: 2, deliveryOptionId: "1" });
    expect((await api().get("/api/cart-items")).body).toEqual([response.body]);
  });

  test("adding an existing product increments quantity, keeps its delivery option, and can exceed 10", async () => {
    await addToCart(socks._id, 8);
    await api().put(cartPath(socks._id)).send({ deliveryOptionId: "3" });

    const response = await addToCart(socks._id, 8);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ productId: socks._id, quantity: 16, deliveryOptionId: "3" });
    expect(await CartItem.countDocuments()).toBe(1);
  });

  test("validation gap: accepts a fractional quantity", async () => {
    // A PostgreSQL integer column would reject this; Phase 3 must decide explicitly.
    const response = await addToCart(socks._id, 1.5);
    expect(response.status).toBe(201);
    expect(response.body.quantity).toBe(1.5);
  });
});

describe("PUT /api/cart-items/:productId", () => {
  beforeEach(() => insertCartItem({ productId: socks._id, quantity: 2 }));

  test("returns 404 when the product is not in the cart", async () => {
    const response = await api().put(cartPath(basketball._id)).send({ quantity: 1 });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Cart item not found" });
  });

  test("rejects quantities below 1 or not numbers", async () => {
    for (const quantity of [0, -3, "3", null]) {
      const response = await api().put(cartPath(socks._id)).send({ quantity });
      expect(response.status, `Expected rejection for quantity ${quantity}`).toBe(400);
      expect(response.body).toEqual({ message: "Quantity must be greater than 0" });
    }
    expect((await CartItem.findOne()).quantity).toBe(2);
  });

  test("has no upper quantity limit, unlike POST", async () => {
    const response = await api().put(cartPath(socks._id)).send({ quantity: 50 });
    expect(response.status).toBe(200);
    expect(response.body.quantity).toBe(50);
  });

  test("rejects an unknown delivery option and does not apply a valid quantity sent with it", async () => {
    const response = await api().put(cartPath(socks._id)).send({ quantity: 5, deliveryOptionId: "9" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid delivery option" });
    expect(await CartItem.findOne().lean()).toMatchObject({ quantity: 2, deliveryOptionId: "1" });
  });

  test("updates quantity and delivery option and returns the cart item", async () => {
    const response = await api().put(cartPath(socks._id)).send({ quantity: 4, deliveryOptionId: "2" });
    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(CART_ITEM_KEYS);
    expect(response.body).toMatchObject({ productId: socks._id, quantity: 4, deliveryOptionId: "2" });
  });

  test("an empty body is a successful no-op", async () => {
    const response = await api().put(cartPath(socks._id)).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ quantity: 2, deliveryOptionId: "1" });
  });
});

describe("DELETE /api/cart-items/:productId", () => {
  test("removes the line with 204 and an empty body; a second delete is 404", async () => {
    await insertCartItem({ productId: socks._id });
    const response = await api().delete(cartPath(socks._id));
    expect(response.status).toBe(204);
    expect(response.text).toBe("");
    expect(await CartItem.countDocuments()).toBe(0);

    const again = await api().delete(cartPath(socks._id));
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ message: "Cart item not found" });
  });

  test("D3: is how a shopper resolves an item whose product was deleted", async () => {
    await insertCartItem({ productId: socks._id });
    await Product.deleteOne({ _id: socks._id });
    expect((await api().delete(cartPath(socks._id))).status).toBe(204);
    expect((await api().get("/api/payment-summary")).body.unavailableProductIds).toEqual([]);
  });
});

describe("GET /api/payment-summary", () => {
  test("returns zeros for an empty cart", async () => {
    const response = await api().get("/api/payment-summary");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      totalItems: 0,
      productCostCents: 0,
      shippingCostCents: 0,
      totalCostBeforeTaxCents: 0,
      taxCents: 0,
      totalCostCents: 0,
      unavailableProductIds: [],
    });
  });

  test("sums quantities and prices, charges shipping once per line, and rounds 10% tax", async () => {
    await insertCartItem({ productId: socks._id, quantity: 2, deliveryOptionId: "1" });
    await insertCartItem({ productId: basketball._id, quantity: 1, deliveryOptionId: "3" });
    await insertCartItem({ productId: tshirt._id, quantity: 3, deliveryOptionId: "2" });

    const response = await api().get("/api/payment-summary");
    // products: 1090*2 + 2095 + 799*3 = 6672; shipping: 0 + 999 + 499 = 1498
    expect(response.body).toEqual({
      totalItems: 6,
      productCostCents: 6672,
      shippingCostCents: 1498,
      totalCostBeforeTaxCents: 8170,
      taxCents: 817,
      totalCostCents: 8987,
      unavailableProductIds: [],
    });
  });

  test("D3: excludes deleted products from totals and lists them as unavailable", async () => {
    await insertCartItem({ productId: socks._id, quantity: 2, deliveryOptionId: "3", minutesAgo: 2 });
    await insertCartItem({ productId: basketball._id, quantity: 1, deliveryOptionId: "1", minutesAgo: 1 });
    await Product.deleteOne({ _id: socks._id });

    const response = await api().get("/api/payment-summary");
    expect(response.body).toEqual({
      totalItems: 1,
      productCostCents: 2095,
      shippingCostCents: 0,
      totalCostBeforeTaxCents: 2095,
      taxCents: 210,
      totalCostCents: 2305,
      unavailableProductIds: [socks._id],
    });
  });

  test("a stored invalid delivery option is a 500 that leaks the internal message", async () => {
    await insertCartItem({ productId: socks._id, deliveryOptionId: "9" });
    const response = await api().get("/api/payment-summary");
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Invalid delivery option: 9" });
  });
});
