// @vitest-environment jsdom
// Phase 6C: the redesigned cart drawer, cart page, checkout and order views.
// Business rules (idempotency keys, deleted products, snapshots) are covered
// in commerce.pages.test.tsx; these tests pin the presentation and feedback.
import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CartDrawer } from "@/features/cart/CartDrawer";
import { CartPageClient } from "@/features/cart/CartPageClient";
import { CheckoutPageClient, placeOrderMessage } from "@/features/checkout/CheckoutPageClient";
import { validateCustomer } from "@/features/checkout/customer";
import { OrderCard } from "@/features/orders/OrderCard";
import { OrderDetailsClient } from "@/features/orders/OrderDetailsClient";
import type { Order } from "@/features/orders/api";
import { ApiError } from "@/lib/api/client";
import { cartDrawerOpened } from "@/store/uiSlice";
import { navigation } from "@/test/navigation";
import { PRODUCTS } from "@/test/products";
import { ALICE, fakeApi, renderWithProviders, SESSION } from "@/test/render";

const product = PRODUCTS[0]!;
const cartLine = { id: "line-1", productId: product.id, quantity: 2, deliveryOptionId: "1", product, unavailable: false };
const day = 86_400_000;
const delivery = [
  { id: "1", deliveryDays: 7, priceCents: 0, estimatedDeliveryTimeMs: Date.now() + 7 * day },
  { id: "2", deliveryDays: 3, priceCents: 499, estimatedDeliveryTimeMs: Date.now() + 3 * day },
];
// Deliberately not price × quantity: the page must show what the API computed.
const summary = {
  totalItems: 2,
  productCostCents: 6780,
  shippingCostCents: 0,
  totalCostBeforeTaxCents: 6780,
  taxCents: 678,
  totalCostCents: 12345,
  unavailableProductIds: [],
};
const routes = (cart: unknown = [cartLine], paymentSummary: unknown = summary) => ({
  "GET /api/cart-items?expand=product": { status: 200, body: cart },
  "GET /api/delivery-options?expand=estimatedDeliveryTime": { status: 200, body: delivery },
  "GET /api/payment-summary": { status: 200, body: paymentSummary },
});

async function fillDetails(user: ReturnType<typeof renderWithProviders>["user"]) {
  await screen.findByRole("heading", { name: "Customer and delivery details" });
  for (const [label, value] of [["Phone", "07123"], ["Address", "1 High Street"], ["City", "London"], ["Postal code", "N1 1AA"]] as const) {
    await user.type(screen.getByLabelText(label), value);
  }
}

describe("cart drawer", () => {
  test("lists each line with its photo, quantity and delivery date, and the API's total", async () => {
    fakeApi(routes());
    const { store } = renderWithProviders(<CartDrawer />, { session: SESSION });
    act(() => { store.dispatch(cartDrawerOpened()); });
    const dialog = await screen.findByRole("dialog", { name: "Your cart" });
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveFocus();
    expect(await within(dialog).findByText("2 items")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: product.name })).toHaveAttribute("href", `/products/${product.id}`);
    expect(within(dialog).getByText(/Quantity: 2 · Arrives /)).toBeInTheDocument();
    expect(await within(dialog).findByText("$123.45")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Checkout" })).toHaveAttribute("href", "/checkout");
  });

  test("empty and failing carts explain themselves", async () => {
    fakeApi(routes([]));
    const { store, unmount } = renderWithProviders(<CartDrawer />, { session: SESSION });
    act(() => { store.dispatch(cartDrawerOpened()); });
    expect(await screen.findByText("Your cart is empty.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse products" })).toHaveAttribute("href", "/products");
    unmount();

    fakeApi({ "GET /api/cart-items?expand=product": { status: 500, body: { message: "Cart service unavailable" } } });
    const failing = renderWithProviders(<CartDrawer />, { session: SESSION });
    act(() => { failing.store.dispatch(cartDrawerOpened()); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Cart service unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  test("an unavailable line blocks checkout from the drawer", async () => {
    fakeApi(routes([{ ...cartLine, product: null, unavailable: true }]));
    const { store } = renderWithProviders(<CartDrawer />, { session: SESSION });
    act(() => { store.dispatch(cartDrawerOpened()); });
    expect(await screen.findByText("Product no longer available")).toBeInTheDocument();
    expect(screen.getByText("Checkout blocked")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("link", { name: "Checkout" })).not.toBeInTheDocument();
  });
});

describe("cart page", () => {
  test("the summary shows the API's figures; shipping 0 reads Free", async () => {
    fakeApi(routes());
    renderWithProviders(<CartPageClient />, { session: SESSION });
    const totals = await screen.findByRole("region", { name: "Order summary" });
    await waitFor(() => expect(within(totals).getAllByRole("definition").map((cell) => cell.textContent)).toEqual(["$67.80", "Free", "$67.80", "$6.78", "$123.45"]));
    expect(screen.getByText("2 items")).toBeInTheDocument();
    // The line total is labelled as such (display only; the order total stays the API's).
    expect(screen.getByText("Item total:").parentElement).toHaveTextContent("$67.80");
  });

  test("a delivery option and a removal are sent with the CSRF token, and the result is announced", async () => {
    const { requests } = fakeApi({
      ...routes(),
      [`PUT /api/cart-items/${product.id}`]: { status: 200, body: cartLine },
      [`DELETE /api/cart-items/${product.id}`]: { status: 204 },
    });
    const { user } = renderWithProviders(<CartPageClient />, { session: SESSION });
    const options = await screen.findByRole("group", { name: /Delivery option for/ });
    await user.click(within(options).getByRole("radio", { name: /Free shipping|\$4\.99 shipping/, checked: false }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: "PUT", body: { deliveryOptionId: "2" }, headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) })));
    expect(await screen.findByText("Your cart has been updated.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: `Remove ${product.name}` }));
    await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) })));
  });

  test("an empty cart offers Continue shopping", async () => {
    fakeApi(routes([]));
    renderWithProviders(<CartPageClient />, { session: SESSION });
    expect(await screen.findByRole("heading", { level: 1, name: "Your cart is empty" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue shopping" })).toHaveAttribute("href", "/products");
  });
});

describe("checkout", () => {
  test("validation: errors beside each field, linked and marked invalid, focus on the first; nothing is sent", async () => {
    const { requests } = fakeApi(routes());
    const { user } = renderWithProviders(<CheckoutPageClient user={{ ...ALICE, email: "" }} />, { session: SESSION });
    await screen.findByRole("heading", { name: "Customer and delivery details" });
    expect(screen.getByText("Step 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Checkout steps" }).querySelector('[aria-current="step"]')).toHaveTextContent("Details");
    expect(screen.queryByText(/No payment provider is connected/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Review order" }));
    const email = screen.getByLabelText("Email");
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter your email address.");
    expect(screen.getByLabelText("Phone")).toHaveAccessibleDescription("Include the country code if you are outside the United Kingdom. Enter your phone number.");
    expect(screen.getByLabelText("Full name")).not.toHaveAttribute("aria-invalid");

    await user.type(email, "alice-at-example");
    expect(email).not.toHaveAttribute("aria-invalid");
    await user.click(screen.getByRole("button", { name: "Review order" }));
    expect(email).toHaveAccessibleDescription("Enter an email address in the format name@example.com.");
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  test("the review step takes focus, names step 2, and carries the no-payment notice", async () => {
    fakeApi(routes());
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderWithProviders(<CheckoutPageClient user={ALICE} />, { session: SESSION });
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: "Review order" }));
    expect(screen.getByRole("heading", { name: "Final review" })).toHaveFocus();
    expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Checkout steps" }).querySelector('[aria-current="step"]')).toHaveTextContent("Review");
    expect(screen.getByText("(completed)").parentElement).toHaveTextContent("Details (completed)");
    expect(screen.getByText(/No payment provider is connected/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change items in your cart" })).toHaveAttribute("href", "/cart");
    await user.click(screen.getByRole("button", { name: "Change delivery details" }));
    expect(screen.getByRole("heading", { name: "Customer and delivery details" })).toHaveFocus();
  });

  test("a second click while the order is being placed sends nothing more", async () => {
    let release: () => void = () => {};
    const { requests, fetchMock } = fakeApi(routes());
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/orders" && init?.method === "POST") {
        requests.push({ method: "POST", path: "/api/orders", headers: {}, body: undefined });
        await new Promise<void>((resolve) => { release = resolve; });
        return new Response(JSON.stringify({ message: "Unable to place the order" }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return answer(input, init);
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderWithProviders(<CheckoutPageClient user={ALICE} />, { session: SESSION });
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: "Review order" }));
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    const pending = await screen.findByRole("button", { name: "Placing order…" });
    expect(pending).toBeDisabled();
    expect(pending).toHaveAttribute("aria-busy", "true");
    await user.click(pending);
    release();
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to place the order");
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  test("a network failure is explained and the retry reuses the same key", async () => {
    const keys: string[] = [];
    const { fetchMock } = fakeApi(routes());
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === "/api/orders") {
        keys.push(new Headers(init?.headers).get("idempotency-key") ?? "");
        throw new TypeError("Failed to fetch");
      }
      return answer(input, init);
    });
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    const { user } = renderWithProviders(<CheckoutPageClient user={ALICE} />, { session: SESSION });
    await fillDetails(user);
    await user.click(screen.getByRole("button", { name: "Review order" }));
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The store could not be reached. Check your connection and try again — the order will not be placed twice.");
    await user.click(screen.getByRole("button", { name: "Confirm and place order" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
  });

  test("each failure class gets its own message", () => {
    expect(placeOrderMessage(new ApiError(409, "Remove unavailable products from your cart before placing the order"))).toEqual({
      text: "Remove unavailable products from your cart before placing the order Review your cart and try again.", cartLink: true,
    });
    expect(placeOrderMessage(new ApiError(422, "This checkout request was already used with different details. Review your order and try again.")).text)
      .toBe("This checkout request was already used with different details. Review your order and try again.");
    expect(placeOrderMessage(new ApiError(400, "Please provide complete customer details")).text).toBe("Please provide complete customer details");
    expect(placeOrderMessage(new ApiError(401, "Not authorized")).text).toBe("Your session has ended. Sign in again to place the order.");
    expect(placeOrderMessage(new ApiError(403, "Invalid CSRF token")).text).toBe("Your session changed. Refresh the page and try again.");
    expect(placeOrderMessage(new TypeError("NetworkError when attempting to fetch resource.")).text).toMatch(/^The store could not be reached/);
  });

  test("client checks mirror the API: trimmed values must not be empty; email has one @ and a dotted domain", () => {
    const base = { fullName: "A", email: "a@b.co", phone: "1", address: "x", city: "y", postalCode: "z", country: "UK" };
    expect(validateCustomer(base)).toEqual({});
    expect(validateCustomer({ ...base, city: "   ", email: "a@b" })).toEqual({ city: "Enter your town or city.", email: "Enter an email address in the format name@example.com." });
  });
});

describe("orders", () => {
  const legacyOrder: Order = {
    id: "33333333-3333-4333-8333-333333333333",
    orderTimeMs: Date.now() - 30 * day,
    totalCostCents: 2500,
    products: [
      // An older MongoDB order: the API returns today's catalogue product, not a snapshot.
      { productId: product.id, product, quantity: 1, estimatedDeliveryTimeMs: Date.now() - 20 * day },
      { productId: "77777777-7777-4777-8777-777777777777", product: null, quantity: 2, estimatedDeliveryTimeMs: Date.now() - 20 * day },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: null,
  };

  test("legacy lines never present today's price as the price paid; missing details are said plainly", () => {
    fakeApi({});
    renderWithProviders(<OrderCard order={legacyOrder} />, { session: SESSION });
    const lines = within(screen.getByRole("list", { name: "Products in this order" })).getAllByRole("listitem");
    expect(lines[0]).toHaveTextContent("Price paid not recorded");
    expect(lines[0]).toHaveTextContent(`Current price $33.90 (not the price paid)`);
    expect(lines[1]).toHaveTextContent("Product details not recorded");
    expect(lines[1]).toHaveTextContent("Image not available");
    expect(lines[1]).not.toHaveTextContent("Current price");
    expect(screen.getByText("Status:").parentElement).toHaveTextContent("Status: Not recorded (older order)");
    expect(screen.getByText("3 items")).toBeInTheDocument();
  });

  test("details page: one h1, a status-role confirmation with no payment claim, the stored total and address", () => {
    navigation.reset("/orders/33333333-3333-4333-8333-333333333333", "placed=1");
    fakeApi({});
    const order = { ...legacyOrder, status: "shipped" as const, customer: { fullName: "Alice", email: "alice@example.com", phone: "07123", address: "1 High Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" } };
    renderWithProviders(<OrderDetailsClient initialOrder={order} />, { session: SESSION });
    expect(screen.getAllByRole("heading", { level: 1 }).map((heading) => heading.textContent)).toEqual(["Order details"]);
    expect(screen.getByRole("status")).toHaveTextContent("Order confirmedYour order was recorded successfully. No payment was processed.");
    expect(screen.getAllByText("Status:").map((label) => label.parentElement?.textContent)).toEqual(["Status: Shipped"]);
    expect(screen.getByRole("heading", { name: "Order total" }).parentElement).toHaveTextContent("$25.00");
    expect(screen.getByText(/1 High Street/)).toBeInTheDocument();
  });
});

describe("footer", () => {
  test("no longer repeats the no-payment notice on every page", () => {
    renderWithProviders(<SiteFooter />);
    expect(screen.getByRole("contentinfo")).not.toHaveTextContent(/payment/i);
  });
});
