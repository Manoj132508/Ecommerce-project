// R18 regression suite: MongoDB operator injection and malformed identifiers.
// Every identifier taken from a request must be rejected with a 400 before it
// reaches Mongoose, without changing data or exposing internal errors.
import { beforeEach, describe, expect, test, vi } from "vitest";
import CartItem from "../models/CartItem.js";
import DeliveryOption from "../models/DeliveryOption.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import {
  api,
  bearer,
  createAdmin,
  createUser,
  insertCartItem,
  PRODUCTS,
  seedCatalog,
  UNKNOWN_UUID,
  validCustomer,
} from "./helpers.js";

const { socks, tshirt } = PRODUCTS;

// JSON body values that must never be treated as identifiers.
const OPERATOR_AND_TYPE_PAYLOADS = [
  { $ne: null },
  { $gt: "" },
  { $regex: ".*" },
  { $where: "return true" },
  { $in: [socks._id, tshirt._id] },
  { $exists: true },
  { nested: { $ne: null } },
  { _id: { $ne: null } },
  [socks._id],
  [{ $ne: null }],
  12345,
  true,
  null,
];

// Strings that are not in the entity's identifier format.
const MALFORMED_PRODUCT_IDS = [
  "",
  "not-a-uuid",
  "$ne",
  `${socks._id} `,
  `${socks._id}\n`,
  `${socks._id}x`,
  socks._id.slice(0, -1),
  "6ad8b3e08afe6f8ad3173cad", // an ObjectId is not a product id
  "' || '1'=='1",
];

// Path parameters always arrive as strings; these are URL-encoded attempts.
const MALFORMED_PATH_SEGMENTS = [
  "not-a-uuid",
  encodeURIComponent('{"$ne":null}'),
  "%24ne",
  "123",
  encodeURIComponent(`${socks._id} `),
];

const INVALID_PRODUCT_ID = { message: "Invalid product id" };
const INVALID_DELIVERY_OPTION = { message: "Invalid delivery option" };
const INVALID_ORDER_ID = { message: "Invalid order id" };

const snapshot = async () => ({
  cart: await CartItem.find().sort({ productId: 1 }).lean(),
  products: await Product.find().sort({ _id: 1 }).lean(),
  orders: await Order.find().sort({ _id: 1 }).lean(),
});

// Call-through spies: they record whether a value reached Mongoose.
const spyOnQueries = () => ({
  productFindById: vi.spyOn(Product, "findById"),
  productUpdate: vi.spyOn(Product, "findByIdAndUpdate"),
  productDelete: vi.spyOn(Product, "findByIdAndDelete"),
  cartFindOne: vi.spyOn(CartItem, "findOne"),
  cartCreate: vi.spyOn(CartItem, "create"),
  deliveryFindById: vi.spyOn(DeliveryOption, "findById"),
  orderFindById: vi.spyOn(Order, "findById"),
});

const expectNoQueries = (spies) => {
  for (const [name, spy] of Object.entries(spies)) {
    expect(spy, `${name} must not be called`).not.toHaveBeenCalled();
  }
};

const label = (value) => JSON.stringify(value) ?? String(value);

beforeEach(async () => {
  await seedCatalog();
  await insertCartItem({ productId: tshirt._id, quantity: 1, deliveryOptionId: "2" });
});

describe("POST /api/cart-items productId", () => {
  test.each([...OPERATOR_AND_TYPE_PAYLOADS, ...MALFORMED_PRODUCT_IDS].map((value) => [label(value), value]))(
    "rejects %s with 400 before any query, leaving the cart unchanged",
    async (_label, productId) => {
      const before = await snapshot();
      const spies = spyOnQueries();

      const response = await api().post("/api/cart-items").send({ productId, quantity: 1 });

      expect(response.status).toBe(400);
      expect(response.body).toEqual(INVALID_PRODUCT_ID);
      expectNoQueries(spies);
      expect(await snapshot()).toEqual(before);
    },
  );

  test("still adds a valid product id", async () => {
    const response = await api().post("/api/cart-items").send({ productId: socks._id, quantity: 1 });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ productId: socks._id, quantity: 1 });
  });

  test("a well-formed but unknown id is a 404, not a 400", async () => {
    const response = await api().post("/api/cart-items").send({ productId: UNKNOWN_UUID, quantity: 1 });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ message: "Product not found" });
  });

  test("an uppercase UUID passes the format check but matches nothing (ids are case-sensitive)", async () => {
    const response = await api().post("/api/cart-items").send({ productId: socks._id.toUpperCase(), quantity: 1 });
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/cart-items/:productId deliveryOptionId", () => {
  const MALFORMED_DELIVERY_OPTION_IDS = [
    ...OPERATOR_AND_TYPE_PAYLOADS.filter((value) => value !== null),
    3, // ids are strings: "3", not 3
    "",
    "abc",
    "1 ",
    "-1",
    "1.5",
    "12345678901",
    UNKNOWN_UUID,
  ];

  test.each(MALFORMED_DELIVERY_OPTION_IDS.map((value) => [label(value), value]))(
    "rejects %s with 400 before the delivery-option lookup, leaving the line unchanged",
    async (_label, deliveryOptionId) => {
      const before = await snapshot();
      const deliveryFindById = vi.spyOn(DeliveryOption, "findById");

      const response = await api().put(`/api/cart-items/${tshirt._id}`).send({ quantity: 7, deliveryOptionId });

      expect(response.status).toBe(400);
      expect(response.body).toEqual(INVALID_DELIVERY_OPTION);
      expect(deliveryFindById).not.toHaveBeenCalled();
      expect(await snapshot()).toEqual(before);
    },
  );

  test("null is rejected the same way (only undefined means 'not provided')", async () => {
    const response = await api().put(`/api/cart-items/${tshirt._id}`).send({ deliveryOptionId: null });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_DELIVERY_OPTION);
  });

  test("a well-formed but unknown delivery option is still rejected after the lookup", async () => {
    const response = await api().put(`/api/cart-items/${tshirt._id}`).send({ deliveryOptionId: "9" });
    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_DELIVERY_OPTION);
  });

  test("still accepts every real delivery option id", async () => {
    for (const deliveryOptionId of ["1", "2", "3"]) {
      const response = await api().put(`/api/cart-items/${tshirt._id}`).send({ deliveryOptionId });
      expect(response.status).toBe(200);
      expect(response.body.deliveryOptionId).toBe(deliveryOptionId);
    }
  });
});

describe("cart path parameter :productId", () => {
  test.each(MALFORMED_PATH_SEGMENTS)("PUT and DELETE reject %s with 400 before any query", async (segment) => {
    const before = await snapshot();
    const spies = spyOnQueries();

    const put = await api().put(`/api/cart-items/${segment}`).send({ quantity: 3 });
    const del = await api().delete(`/api/cart-items/${segment}`);

    for (const response of [put, del]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(INVALID_PRODUCT_ID);
    }
    expectNoQueries(spies);
    expect(await snapshot()).toEqual(before);
  });

  test("well-formed ids that are not in the cart are still 404", async () => {
    expect((await api().put(`/api/cart-items/${UNKNOWN_UUID}`).send({ quantity: 1 })).status).toBe(404);
    expect((await api().delete(`/api/cart-items/${UNKNOWN_UUID}`)).status).toBe(404);
  });
});

describe("admin product path parameter :productId", () => {
  let adminToken;

  beforeEach(async () => {
    adminToken = (await createAdmin()).token;
  });

  test.each(MALFORMED_PATH_SEGMENTS)("PUT and DELETE reject %s with 400 before any query", async (segment) => {
    const before = await snapshot();
    const spies = spyOnQueries();

    const put = await api().put(`/api/products/${segment}`).set(bearer(adminToken)).send({});
    const del = await api().delete(`/api/products/${segment}`).set(bearer(adminToken));

    for (const response of [put, del]) {
      expect(response.status).toBe(400);
      expect(response.body).toEqual(INVALID_PRODUCT_ID);
    }
    expectNoQueries(spies);
    expect(await snapshot()).toEqual(before);
  });

  test("authorisation is still checked first: a non-admin gets 403, not 400", async () => {
    const { token } = await createUser();
    const response = await api().delete("/api/products/not-a-uuid").set(bearer(token));
    expect(response.status).toBe(403);
  });
});

describe("order path parameter :orderId", () => {
  test.each(MALFORMED_PATH_SEGMENTS)("GET rejects %s with 400 before any query", async (segment) => {
    const { token } = await createUser();
    const orderFindById = vi.spyOn(Order, "findById");

    const response = await api().get(`/api/orders/${segment}`).set(bearer(token));

    expect(response.status).toBe(400);
    expect(response.body).toEqual(INVALID_ORDER_ID);
    expect(orderFindById).not.toHaveBeenCalled();
  });

  test("authentication is still checked first: no token gets 401, not 400", async () => {
    expect((await api().get("/api/orders/not-a-uuid")).status).toBe(401);
  });

  test("a real order id still works", async () => {
    const { token } = await createUser();
    await insertCartItem({ productId: socks._id });
    const { body: order } = await api().post("/api/orders").set(bearer(token)).send({ customer: validCustomer });
    const response = await api().get(`/api/orders/${order.id}`).set(bearer(token));
    expect(response.status).toBe(200);
  });
});

describe("query strings never reach queries", () => {
  test("object-shaped ?expand values are ignored, not passed to MongoDB", async () => {
    // Express parses ?expand[$ne]=x into an object; handlers only compare it to string literals.
    const response = await api().get("/api/cart-items?expand[$ne]=product");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).not.toHaveProperty("product");
  });
});
