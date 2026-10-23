// @vitest-environment jsdom
// Phase 6D: sign-in, registration, account and admin screens. The rules behind
// them (validation, return paths, roles, transitions) are covered in
// auth.pages.test.tsx and admin.test.tsx; these tests pin the new UI.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { AdminProductsClient } from "@/features/admin/AdminProductsClient";
import { ProductFormClient } from "@/features/admin/ProductFormClient";
import { AccountActions } from "@/features/auth/AccountActions";
import { sessionQueryKey } from "@/lib/queryKeys";
import { LoginForm } from "@/features/auth/LoginForm";
import { NOTICES } from "@/features/auth/notices";
import { RegisterForm } from "@/features/auth/RegisterForm";
import type { Order } from "@/features/orders/api";
import { noticeShown } from "@/store/uiSlice";
import { navigation } from "@/test/navigation";
import { PRODUCTS } from "@/test/products";
import { ALICE, browserStorageSnapshot, fakeApi, renderWithProviders, SESSION } from "@/test/render";

const serverSession = vi.hoisted(() => ({ getServerSessionUser: vi.fn(), getServerSessionCookieHeader: vi.fn() }));
vi.mock("@/lib/server/session", () => serverSession);
const serverAdmin = vi.hoisted(() => ({
  requireAdmin: vi.fn(), getAdminProducts: vi.fn(), getAdminOrders: vi.fn(), getAdminOrder: vi.fn(), getOrderStatusEvents: vi.fn(),
}));
vi.mock("@/lib/server/admin", () => serverAdmin);

const ADMIN = { ...ALICE, isAdmin: true };
const DAY = 86_400_000;
const order = (overrides: Partial<Order> = {}): Order => ({
  id: "11111111-1111-4111-8111-111111111111",
  userId: ALICE._id,
  customer: { fullName: "Nora", email: "nora@example.com", phone: "07123", address: "1 High Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" },
  orderTimeMs: Date.now() - DAY,
  totalCostCents: 2500,
  products: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  status: "placed",
  ...overrides,
});

beforeEach(() => {
  serverAdmin.requireAdmin.mockResolvedValue(ADMIN);
  serverAdmin.getAdminProducts.mockResolvedValue(PRODUCTS);
});

describe("password visibility", () => {
  test("a pressed toggle shows the password, submitting hides it again, and it is never stored", async () => {
    fakeApi({ "POST /api/auth/session": { status: 401, body: { message: "Invalid email or password" } } });
    const { user, queryClient, store } = renderWithProviders(<LoginForm />, { session: null });
    const password = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(password).toHaveAttribute("type", "password");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-controls", password.id);

    await user.type(screen.getByLabelText("Email"), "alice@example.com");
    await user.type(password, "secret-visible-1");
    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    // The name stays the same; the pressed state carries the change.
    expect(toggle).toHaveAccessibleName("Show password");

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(password).toHaveAttribute("type", "password");
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(browserStorageSnapshot(queryClient, store)).not.toContain("secret-visible-1");
  });

  test("registration: each password field has its own toggle name", () => {
    fakeApi({});
    renderWithProviders(<RegisterForm />, { session: null });
    expect(screen.getByRole("button", { name: "Show password" })).toHaveAttribute("aria-controls", "register-password");
    expect(screen.getByRole("button", { name: "Show confirmed password" })).toHaveAttribute("aria-controls", "register-confirmPassword");
  });

  test("the sign-in notice is a status message, styled by what it says", () => {
    fakeApi({});
    const { store } = renderWithProviders(<LoginForm />, { session: null });
    // A notice arrives from another page through Redux (UI state), never the URL.
    fireEvent.focus(document.body);
    store.dispatch(noticeShown(NOTICES.accountCreated));
    return waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Your account has been created. Sign in to continue."));
  });
});

describe("account", () => {
  test("signing out everywhere asks first; cancelling keeps the session and returns focus", async () => {
    const { requests } = fakeApi({});
    const { user, queryClient } = renderWithProviders(<AccountActions />, { session: SESSION });
    const opener = screen.getByRole("button", { name: "Sign out on all devices" });
    await user.click(opener);
    expect(screen.getByRole("alertdialog", { name: "Sign out on all devices?" })).toHaveAccessibleDescription(/including this one/);
    await user.click(screen.getByRole("button", { name: "Stay signed in" }));
    expect(opener).toHaveFocus();
    expect(requests).toEqual([]);
    expect(queryClient.getQueryData(sessionQueryKey)).toEqual(SESSION);
  });

  test("when ending the other sessions fails, this device is signed out and the sign-in page says the others may not be", async () => {
    fakeApi({ "DELETE /api/auth/sessions": { status: 500, body: { message: "Server error" } } });
    const { user, queryClient, store } = renderWithProviders(<AccountActions />, { session: SESSION });
    await user.click(screen.getByRole("button", { name: "Sign out on all devices" }));
    await user.click(screen.getByRole("button", { name: "Sign out everywhere" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?from=%2Faccount"));
    expect(store.getState().ui.notice).toBe(NOTICES.otherDevicesNotSignedOut);
    expect(queryClient.getQueryData(sessionQueryKey)).toBeNull();
  });

  test("the profile shows only the API's fields; administrators also get an Admin link", async () => {
    const { default: AccountLayout } = await import("@/app/account/layout");
    const { default: AccountPage } = await import("@/app/account/page");
    serverSession.getServerSessionUser.mockResolvedValue(ADMIN);
    fakeApi({});
    renderWithProviders(await AccountLayout({ children: await AccountPage() }), { session: { ...SESSION, user: ADMIN } });
    expect(screen.getByText("Administrator")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Account sections" })).getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(screen.getByText(/Changing them is not available/)).toBeInTheDocument();
    expect(screen.queryByText(/address book|payment method/i)).not.toBeInTheDocument();
  });
});

describe("confirm dialog", () => {
  test("while the action runs, both buttons are disabled and Escape does not close it", () => {
    const onCancel = vi.fn();
    renderWithProviders(
      <ConfirmDialog open title="Delete it?" confirmLabel="Delete" pendingLabel="Deleting…" pending onConfirm={() => {}} onCancel={onCancel}><p>Gone for good.</p></ConfirmDialog>,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Delete it?" });
    expect(screen.getByRole("button", { name: "Deleting…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("admin screens", () => {
  test("dashboard: real counts, recorded value never called revenue, recent orders in a table", async () => {
    serverAdmin.getAdminOrders.mockResolvedValue([
      order(), order({ id: "22222222-2222-4222-8222-222222222222", status: "cancelled", totalCostCents: 9999 }), order({ id: "33333333-3333-4333-8333-333333333333", status: null, customer: undefined }),
    ]);
    const { default: Dashboard } = await import("@/app/admin/page");
    renderWithProviders(await Dashboard(), { session: { ...SESSION, user: ADMIN } });
    const totals = screen.getByRole("region", { name: "Totals" });
    expect(within(totals).getByText("Recorded order value").nextElementSibling).toHaveTextContent("$50.00");
    expect(totals).toHaveTextContent("not money received");
    expect(document.body.textContent).not.toMatch(/revenue/i);
    const byStatus = screen.getByRole("region", { name: "Orders by status" });
    expect(within(byStatus).getByRole("link", { name: /Cancelled 1 order/ })).toHaveAttribute("href", "/admin/orders?status=cancelled");
    expect(within(byStatus).getByRole("link", { name: /Not recorded \(legacy\) 1 order/ })).toHaveAttribute("href", "/admin/orders?status=none");
    expect(within(screen.getByRole("table", { name: "The five most recent orders" })).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByRole("region", { name: "Products by category" })).toHaveTextContent("Accessories2");
  });

  test("orders list: chips count each status and mark the current one; the table lists the filtered orders", async () => {
    serverAdmin.getAdminOrders.mockResolvedValue([order(), order({ id: "22222222-2222-4222-8222-222222222222", status: "shipped", customer: { ...order().customer!, fullName: "Omar" } })]);
    const { default: Orders } = await import("@/app/admin/orders/page");
    renderWithProviders(await Orders({ searchParams: Promise.resolve({ status: "shipped" }) }), { session: { ...SESSION, user: ADMIN } });
    const filters = screen.getByRole("navigation", { name: "Filter by status" });
    expect(within(filters).getByRole("link", { name: "All 2" })).not.toHaveAttribute("aria-current");
    expect(within(filters).getByRole("link", { name: "Shipped 1" })).toHaveAttribute("aria-current", "page");
    const rows = within(screen.getByRole("table", { name: "Orders with status Shipped" })).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByRole("link", { name: "Omar" })).toHaveAttribute("href", "/admin/orders/22222222-2222-4222-8222-222222222222");
  });

  test("order details: price paid vs current price, cancellation is not a refund, the audit trail as a timeline", async () => {
    const product = PRODUCTS[0]!;
    serverAdmin.getAdminOrder.mockResolvedValue(order({
      status: "shipped",
      products: [
        { productId: product.id, product: { id: product.id, image: product.image, name: product.name, priceCents: 3390, description: "", category: "" }, quantity: 2, estimatedDeliveryTimeMs: Date.now() + DAY },
        { productId: PRODUCTS[1]!.id, product: PRODUCTS[1]!, quantity: 1, estimatedDeliveryTimeMs: Date.now() + DAY },
      ],
    }));
    serverAdmin.getOrderStatusEvents.mockResolvedValue([
      { fromStatus: "placed", toStatus: "processing", reason: "Packed", changedAt: "2026-10-21T09:00:00.000Z", changedBy: { id: "a", name: "Ada" } },
      { fromStatus: "processing", toStatus: "shipped", reason: "With the courier", changedAt: "2026-10-22T09:00:00.000Z", changedBy: { id: "a", name: "Ada" } },
    ]);
    const { default: OrderPage } = await import("@/app/admin/orders/[id]/page");
    renderWithProviders(await OrderPage({ params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) }), { session: { ...SESSION, user: ADMIN } });
    const items = within(screen.getByRole("region", { name: "Items" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("$33.90 each (price when ordered)");
    expect(items[1]).toHaveTextContent("Price paid not recorded · current catalogue price $22.99");
    expect(screen.getByRole("region", { name: "Order record" })).toHaveTextContent("Cancelling an order does not refund anything");
    const timeline = within(screen.getByRole("region", { name: "Status history" })).getAllByRole("listitem");
    expect(timeline.map((entry) => entry.textContent)).toEqual([
      expect.stringMatching(/^Status: Placed →to Status: Processing.*by Ada“Packed”$/),
      expect.stringMatching(/^Status: Processing →to Status: Shipped.*by Ada“With the courier”$/),
    ]);
  });

  test("product form: the error summary links to each problem field", async () => {
    fakeApi({});
    const { user } = renderWithProviders(<ProductFormClient />, { session: { ...SESSION, user: ADMIN } });
    await user.click(screen.getByRole("button", { name: "Create product" }));
    const summary = screen.getByRole("alert");
    const link = within(summary).getByRole("link", { name: "Product name: Enter the product name." });
    expect(link.getAttribute("href")).toBe(`#${screen.getByLabelText("Product name").id}`);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["Basics", "Image", "Product information", "Search"]);
  });

  test("product table: one row per product with labelled actions; the list is a real table", () => {
    fakeApi({});
    renderWithProviders(<AdminProductsClient products={PRODUCTS} />, { session: { ...SESSION, user: ADMIN } });
    const table = screen.getByRole("table", { name: "Products in the store" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Product", "Category", "Price", "Stock", "Search keywords", "Actions"]);
    expect(within(table).getAllByRole("row")).toHaveLength(PRODUCTS.length + 1);
    expect(within(table).getByRole("link", { name: `Edit ${PRODUCTS[2]!.name}` })).toHaveAttribute("href", `/admin/products/${PRODUCTS[2]!.id}`);
  });
});
