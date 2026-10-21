// CURRENT BEHAVIOUR — KNOWN SECURITY FLAW. NOT THE TARGET CONTRACT.
//
// There is one global cart. Cart routes do not authenticate, any visitor can
// read and change every item, and checkout empties the cart for everyone.
// These tests exist so the flaw is visible and so nothing changes it by
// accident before the approved D1 change. When D1 is implemented, delete this
// file and turn the it.todo entries at the bottom into real tests.
import { beforeEach, describe, expect, it, test } from "vitest";
import CartItem from "../models/CartItem.js";
import Order from "../models/Order.js";
import {
  api,
  bearer,
  createUser,
  PRODUCTS,
  seedCatalog,
  validCustomer,
} from "./helpers.js";

const { socks, basketball } = PRODUCTS;

let alice;
let bob;

beforeEach(async () => {
  await seedCatalog();
  alice = await createUser({ name: "Alice", email: "alice@example.com" });
  bob = await createUser({ name: "Bob", email: "bob@example.com" });
});

describe("current flaw: the cart is shared and unauthenticated", () => {
  test("every cart endpoint works without any token", async () => {
    expect((await api().post("/api/cart-items").send({ productId: socks._id, quantity: 1 })).status).toBe(201);
    expect((await api().get("/api/cart-items")).status).toBe(200);
    expect((await api().put(`/api/cart-items/${socks._id}`).send({ quantity: 2 })).status).toBe(200);
    expect((await api().get("/api/payment-summary")).status).toBe(200);
    expect((await api().delete(`/api/cart-items/${socks._id}`)).status).toBe(204);
  });

  test("an invalid token is ignored rather than rejected", async () => {
    const response = await api().get("/api/cart-items").set(bearer("not-a-real-token"));
    expect(response.status).toBe(200);
  });

  test("one user sees, changes and deletes another user's cart items", async () => {
    await api().post("/api/cart-items").set(bearer(alice.token)).send({ productId: socks._id, quantity: 1 });

    const bobsView = await api().get("/api/cart-items").set(bearer(bob.token));
    expect(bobsView.body.map((item) => item.productId)).toEqual([socks._id]);

    await api().put(`/api/cart-items/${socks._id}`).set(bearer(bob.token)).send({ quantity: 9 });
    const alicesView = await api().get("/api/cart-items").set(bearer(alice.token));
    expect(alicesView.body[0].quantity).toBe(9);

    expect((await api().delete(`/api/cart-items/${socks._id}`).set(bearer(bob.token))).status).toBe(204);
    expect((await api().get("/api/cart-items").set(bearer(alice.token))).body).toEqual([]);
  });

  test("two users adding the same product merge into a single line (productId is globally unique)", async () => {
    await api().post("/api/cart-items").set(bearer(alice.token)).send({ productId: socks._id, quantity: 1 });
    await api().post("/api/cart-items").set(bearer(bob.token)).send({ productId: socks._id, quantity: 2 });
    expect(await CartItem.countDocuments()).toBe(1);
    expect((await CartItem.findOne()).quantity).toBe(3);
  });

  test("checkout orders everyone's items for the buyer and empties the cart for everyone", async () => {
    await api().post("/api/cart-items").send({ productId: socks._id, quantity: 1 }); // anonymous visitor
    await api().post("/api/cart-items").set(bearer(bob.token)).send({ productId: basketball._id, quantity: 1 });

    const order = await api().post("/api/orders").set(bearer(alice.token)).send({ customer: validCustomer });
    expect(order.status).toBe(201);
    expect(order.body.userId).toBe(String(alice.user._id));
    expect(order.body.products.map((line) => line.productId).sort()).toEqual([socks._id, basketball._id].sort());

    expect((await api().get("/api/cart-items").set(bearer(bob.token))).body).toEqual([]);
    expect(await Order.countDocuments({ userId: String(bob.user._id) })).toBe(0);
  });
});

// Approved D1 target contract (MIGRATION_PLAN.md §4). Implemented in Phase 4.4.
describe("D1 target contract: user-specific carts (not implemented yet)", () => {
  it.todo("cart endpoints return 401 without a valid bearer token");
  it.todo("cart endpoints reject invalid, expired or wrongly signed tokens with 401");
  it.todo("each user sees only their own cart items");
  it.todo("a user cannot update or delete another user's cart line (404, not 403, to avoid disclosure)");
  it.todo("two users can hold the same product in their carts as separate lines");
  it.todo("payment summary covers only the authenticated user's cart");
  it.todo("checkout orders only the authenticated user's items");
  it.todo("checkout clears only the authenticated user's cart, inside the same transaction as the order insert");
  it.todo("D3 still applies per user: deleted-product lines stay visible as unavailable and block that user's checkout");
});
