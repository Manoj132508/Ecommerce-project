// @vitest-environment jsdom
import { screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CartPageClient } from "@/features/cart/CartPageClient";
import { CheckoutPageClient } from "@/features/checkout/CheckoutPageClient";
import { OrderDetailsClient } from "@/features/orders/OrderDetailsClient";
import { OrderCard } from "@/features/orders/OrderCard";
import { OrdersPageClient } from "@/features/orders/OrdersPageClient";
import type { Order } from "@/features/orders/api";
import { trackPackage } from "@/features/orders/tracking";
import { navigation, NotFoundSignal, RedirectSignal } from "@/test/navigation";
import { PRODUCTS } from "@/test/products";
import { ALICE, fakeApi, renderWithProviders, SESSION } from "@/test/render";

const serverOrders = vi.hoisted(() => ({ getServerOrder: vi.fn() }));
vi.mock("@/lib/server/orders", () => serverOrders);

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

const snapshotOrder = (productId: string, name: string): Order => ({
  id: "22222222-2222-4222-8222-222222222222",
  userId: ALICE._id,
  orderTimeMs: Date.now(),
  totalCostCents: 1000,
  products: [{ productId, product: { id: productId, image: product.image, name, priceCents: 1000, description: "", category: "" }, quantity: 1, estimatedDeliveryTimeMs: Date.now() + 86_400_000 }],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: "placed",
});

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

  test("a removal while the first total is still loading never leaves the old total behind", async () => {
    const gone = { ...cartLine, productId: "99999999-9999-4999-8999-999999999999", id: "line-2", product: null, unavailable: true };
    let cart: unknown[] = [cartLine, gone];
    let releaseFirstSummary: () => void = () => {};
    const firstSummary = new Promise<void>((resolve) => { releaseFirstSummary = resolve; });
    let summaryCalls = 0;
    const { fetchMock } = fakeApi({
      ...routes(),
      "GET /api/cart-items?expand=product": () => ({ status: 200, body: cart }),
      [`DELETE /api/cart-items/${gone.productId}`]: () => { cart = [cartLine]; return { status: 204 }; },
    });
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) !== "/api/payment-summary") return answer(input, init);
      summaryCalls += 1;
      const stale = summaryCalls === 1;
      if (stale) await firstSummary;
      return new Response(JSON.stringify({ ...summary, unavailableProductIds: stale ? [gone.productId] : [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const { user } = renderWithProviders(<CartPageClient />, { session: SESSION });
    await user.click(await screen.findByRole("button", { name: "Remove unavailable item" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "This product is no longer available" })).not.toBeInTheDocument());
    releaseFirstSummary();
    expect(await screen.findByRole("link", { name: "Continue to checkout" })).toBeInTheDocument();
    expect(summaryCalls).toBe(2);
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

  test("a retry reuses its key; edited details get a fresh key", async () => {
    const { requests } = fakeApi({ ...routes(), "POST /api/orders": { status: 500, body: { message: "Unable to place the order" } } });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderWithProviders(<CheckoutPageClient user={ALICE} />, { session: SESSION });
    await screen.findByRole("heading", { name: "Customer and delivery details" });
    for (const [label, value] of [["Phone", "07123"], ["Address", "1 High Street"], ["City", "London"], ["Postal code", "N1 1AA"]] as const) {
      await user.type(screen.getByLabelText(label), value);
    }
    const keys = () => requests.filter((request) => request.method === "POST").map((request) => request.headers["idempotency-key"]);

    await user.click(screen.getByRole("button", { name: "Review order" }));
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to place the order");
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    await waitFor(() => expect(keys()).toHaveLength(2));
    expect(keys()[1]).toBe(keys()[0]);

    // Going back without changing anything keeps the attempt.
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.click(screen.getByRole("button", { name: "Review order" }));
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    await waitFor(() => expect(keys()).toHaveLength(3));
    expect(keys()[2]).toBe(keys()[0]);

    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.type(screen.getByLabelText("Address"), ", Flat 2");
    await user.click(screen.getByRole("button", { name: "Review order" }));
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    await waitFor(() => expect(keys()).toHaveLength(4));
    expect(keys()[3]).not.toBe(keys()[0]);
    expect(requests.filter((request) => request.method === "POST").at(-1)?.body).toMatchObject({ customer: { address: "1 High Street, Flat 2" } });
  });

  test("after a failed attempt and an emptied cart, points the customer to their orders", async () => {
    let cart: unknown = [cartLine];
    fakeApi({
      ...routes(),
      "GET /api/cart-items?expand=product": () => ({ status: 200, body: cart }),
      "POST /api/orders": () => { cart = []; return { status: 502, body: { message: "The API could not be reached." } }; },
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderWithProviders(<CheckoutPageClient user={ALICE} />, { session: SESSION });
    await screen.findByRole("heading", { name: "Customer and delivery details" });
    for (const [label, value] of [["Phone", "07123"], ["Address", "1 High Street"], ["City", "London"], ["Postal code", "N1 1AA"]] as const) {
      await user.type(screen.getByLabelText(label), value);
    }
    await user.click(screen.getByRole("button", { name: "Review order" }));
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    expect(await screen.findByRole("heading", { name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check your orders" })).toHaveAttribute("href", "/orders");
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
    expect(screen.getByText(/Price paid:/)).toHaveTextContent("$33.90 each");
  });

  test("buy again adds one to the cart with the CSRF token, and every line can be tracked", async () => {
    const order = snapshotOrder(product.id, product.name);
    const { requests } = fakeApi({ ...routes(), "POST /api/cart-items": { status: 201, body: cartLine }, "GET /api/orders?scope=own&expand=products": { status: 200, body: [order] } });
    const { user } = renderWithProviders(<OrdersPageClient />, { session: SESSION });
    await user.click(await screen.findByRole("button", { name: `Buy ${product.name} again` }));
    expect(await screen.findByText("Added to your cart")).toBeInTheDocument();
    expect(requests).toContainEqual(expect.objectContaining({ method: "POST", path: "/api/cart-items", body: { productId: product.id, quantity: 1 }, headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) }));
    expect(screen.getByRole("link", { name: `Track package for ${product.name}` })).toHaveAttribute("href", `/tracking?orderId=${order.id}&productId=${product.id}`);
    expect(screen.getByRole("link", { name: /^View order/ })).toHaveAttribute("href", `/orders/${order.id}`);
  });

  test("a click before the session check finishes waits for it instead of signing the visitor out", async () => {
    const order = snapshotOrder(product.id, product.name);
    let releaseSession: () => void = () => {};
    const sessionChecked = new Promise<void>((resolve) => { releaseSession = resolve; });
    const { requests, fetchMock } = fakeApi({ "POST /api/cart-items": { status: 201, body: cartLine } });
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/auth/session") {
        await sessionChecked;
        return new Response(JSON.stringify(SESSION), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return answer(input, init);
    });
    const { user } = renderWithProviders(<OrderCard order={order} />);
    await user.click(screen.getByRole("button", { name: `Buy ${product.name} again` }));
    releaseSession();
    expect(await screen.findByText("Added to your cart")).toBeInTheDocument();
    expect(requests.find((request) => request.method === "POST")?.headers["x-csrf-token"]).toBe(SESSION.csrfToken);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  test("buying a deleted product again explains it on the order line", async () => {
    const gone = "99999999-9999-4999-8999-999999999999";
    const order = snapshotOrder(gone, "Retired Kettle");
    fakeApi({ "POST /api/cart-items": { status: 404, body: { message: "Product not found" } }, "GET /api/orders?scope=own&expand=products": { status: 200, body: [order] } });
    const { user } = renderWithProviders(<OrdersPageClient />, { session: SESSION });
    expect(await screen.findByRole("heading", { name: "Retired Kettle" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Buy Retired Kettle again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Retired Kettle is no longer available and cannot be added to your cart.");
  });
});

describe("package tracking", () => {
  const day = 86_400_000;
  const ordered = Date.UTC(2026, 9, 1);

  test("follows the Vite stages: preparing, shipped after a third of the window, delivered on the date", () => {
    const delivery = ordered + 3 * day;
    expect(trackPackage({ orderTimeMs: ordered, status: "placed" }, delivery, ordered)).toEqual({ cancelled: false, stage: "Preparing", percent: 5 });
    expect(trackPackage({ orderTimeMs: ordered, status: "placed" }, delivery, ordered + 1.5 * day)).toEqual({ cancelled: false, stage: "Shipped", percent: 50 });
    expect(trackPackage({ orderTimeMs: ordered, status: null }, delivery, delivery)).toEqual({ cancelled: false, stage: "Delivered", percent: 100 });
  });

  test("a recorded status that is further along wins; cancelled orders show no progress", () => {
    const delivery = ordered + 3 * day;
    expect(trackPackage({ orderTimeMs: ordered, status: "shipped" }, delivery, ordered)).toEqual({ cancelled: false, stage: "Shipped", percent: 33 });
    expect(trackPackage({ orderTimeMs: ordered, status: "delivered" }, delivery, ordered)).toEqual({ cancelled: false, stage: "Delivered", percent: 100 });
    expect(trackPackage({ orderTimeMs: ordered, status: "cancelled" }, delivery, ordered + day)).toEqual({ cancelled: true });
  });

  test("the page needs a session, answers 404 for bad or foreign ids, and shows the package", async () => {
    const { default: TrackingPage } = await import("@/app/tracking/page");
    const order = snapshotOrder(product.id, product.name);
    const query = (orderId: string, productId: string) => ({ searchParams: Promise.resolve({ orderId, productId }) });

    await expect(TrackingPage(query("not-a-uuid", product.id))).rejects.toBeInstanceOf(NotFoundSignal);
    expect(serverOrders.getServerOrder).not.toHaveBeenCalled();

    serverOrders.getServerOrder.mockResolvedValueOnce({ kind: "signed-out" });
    await expect(TrackingPage(query(order.id, product.id))).rejects.toEqual(new RedirectSignal(`/login?from=${encodeURIComponent(`/tracking?orderId=${order.id}&productId=${product.id}`)}`));

    serverOrders.getServerOrder.mockResolvedValueOnce({ kind: "not-found" });
    await expect(TrackingPage(query(order.id, product.id))).rejects.toBeInstanceOf(NotFoundSignal);

    serverOrders.getServerOrder.mockResolvedValueOnce({ kind: "found", order });
    await expect(TrackingPage(query(order.id, "88888888-8888-4888-8888-888888888888"))).rejects.toBeInstanceOf(NotFoundSignal);

    serverOrders.getServerOrder.mockResolvedValueOnce({ kind: "found", order });
    renderWithProviders(await TrackingPage(query(order.id, product.id)), { session: SESSION });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Arriving on /);
    expect(screen.getByRole("progressbar", { name: "Delivery progress" })).toHaveAttribute("aria-valuetext", "Preparing");
    expect(screen.getByRole("link", { name: "View all orders" })).toHaveAttribute("href", "/orders");
  });
});
