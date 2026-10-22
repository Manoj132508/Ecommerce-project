// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CartPageClient } from "@/features/cart/CartPageClient";
import { CheckoutPageClient } from "@/features/checkout/CheckoutPageClient";
import { OrderDetailsClient } from "@/features/orders/OrderDetailsClient";
import type { Order } from "@/features/orders/api";
import { navigation } from "@/test/navigation";
import { PRODUCTS } from "@/test/products";
import { ALICE, fakeApi, renderWithProviders, SESSION } from "@/test/render";

const product = PRODUCTS[0]!;
const cartLine = { id: "line-1", productId: product.id, quantity: 2, deliveryOptionId: "1", product, unavailable: false };
const delivery = [{ id: "1", deliveryDays: 7, priceCents: 0, estimatedDeliveryTimeMs: Date.now() + 604_800_000 }];
const summary = {
  totalItems: 2,
  productCostCents: product.priceCents * 2,
  shippingCostCents: 0,
  totalCostBeforeTaxCents: product.priceCents * 2,
  taxCents: 678,
  totalCostCents: product.priceCents * 2 + 678,
  unavailableProductIds: [],
};

const routes = (cart: unknown = [cartLine]) => ({
  "GET /api/cart-items?expand=product": { status: 200, body: cart },
  "GET /api/delivery-options?expand=estimatedDeliveryTime": { status: 200, body: delivery },
  "GET /api/payment-summary": { status: 200, body: summary },
});

describe("cart", () => {
  test("keeps a deleted product visible, blocks checkout, and lets the user remove it", async () => {
    const unavailable = [{ ...cartLine, product: null, unavailable: true }];
    const { requests } = fakeApi({
      ...routes(unavailable),
      "DELETE /api/cart-items/e43638ce-6aa0-4b85-b27f-e1d07eb678c6": { status: 204 },
    });
    const { user } = renderWithProviders(<CartPageClient />, { session: SESSION });
    expect(await screen.findByRole("heading", { name: "This product is no longer available" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue to checkout" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove unavailable item" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE" && request.headers["x-csrf-token"] === SESSION.csrfToken)).toBe(true));
  });

  test("uses quantities 1 through 10 and sends an authenticated update", async () => {
    const { requests } = fakeApi({ ...routes(), [`PUT /api/cart-items/${product.id}`]: { status: 200, body: cartLine } });
    const { user } = renderWithProviders(<CartPageClient />, { session: SESSION });
    const select = await screen.findByRole("combobox", { name: "Quantity" });
    expect(screen.getAllByRole("option")).toHaveLength(10);
    await user.selectOptions(select, "10");
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: "PUT", body: { quantity: 10 }, headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) })));
  });
});

describe("checkout", () => {
  test("reviews details, sends one idempotency key, and confirms without claiming payment", async () => {
    const order: Order = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: ALICE._id,
      customer: { fullName: ALICE.name, email: ALICE.email, phone: "07123", address: "1 High Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" },
      orderTimeMs: Date.now(),
      totalCostCents: summary.totalCostCents,
      products: [{ productId: product.id, product: { id: product.id, image: product.image, name: product.name, priceCents: product.priceCents, description: product.description, category: product.category }, quantity: 2, estimatedDeliveryTimeMs: delivery[0]!.estimatedDeliveryTimeMs }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "placed",
    };
    const { requests } = fakeApi({ ...routes(), "POST /api/orders": { status: 201, body: order } });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderWithProviders(<CheckoutPageClient user={ALICE} />, { session: SESSION });
    await screen.findByRole("heading", { name: "Customer and delivery details" });
    await user.type(screen.getByLabelText("Phone"), "07123");
    await user.type(screen.getByLabelText("Address"), "1 High Street");
    await user.type(screen.getByLabelText("City"), "London");
    await user.type(screen.getByLabelText("Postal code"), "N1 1AA");
    await user.click(screen.getByRole("button", { name: "Review order" }));
    expect(screen.getByText(/No payment provider is connected/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith(`/orders/${order.id}?placed=1`));
    const checkoutRequest = requests.find((request) => request.method === "POST" && request.path === "/api/orders");
    expect(checkoutRequest?.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(checkoutRequest?.body).toEqual({ customer: order.customer });
  });
});

describe("orders", () => {
  test("shows stored snapshot prices and truthful post-checkout feedback", () => {
    navigation.reset(`/orders/11111111-1111-4111-8111-111111111111`, "placed=1");
    fakeApi({});
    const order: Order = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: ALICE._id,
      orderTimeMs: Date.now(),
      totalCostCents: 4407,
      products: [{ productId: product.id, product: { id: product.id, image: product.image, name: product.name, priceCents: product.priceCents, description: product.description, category: product.category }, quantity: 1, estimatedDeliveryTimeMs: Date.now() + 86_400_000 }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "placed",
    };
    renderWithProviders(<OrderDetailsClient initialOrder={order} />, { session: SESSION });
    expect(screen.getByRole("heading", { name: "Order confirmed" })).toBeInTheDocument();
    expect(screen.getByText("Your order was recorded successfully. No payment was processed.")).toBeInTheDocument();
    expect(screen.getByText(/Saved unit price:/)).toHaveTextContent("$33.90");
  });
});
