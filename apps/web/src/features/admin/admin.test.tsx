// @vitest-environment jsdom
// Admin rules, screens and server guard. Express enforces the same rules again
// (ecommerce-backend/test/db/api.postgres.test.ts); these tests cover what the
// screens offer, send and show.
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { Order } from "@/features/orders/api";
import { changesCatalog } from "@/lib/proxy/catalogWrites";
import { navigation, NotFoundSignal, RedirectSignal } from "@/test/navigation";
import { PRODUCTS } from "@/test/products";
import { ALICE, fakeApi, renderWithProviders, SESSION } from "@/test/render";
import { AdminProductsClient } from "./AdminProductsClient";
import { dashboardStatistics, nextStatuses, productToForm, validateProductForm, EMPTY_PRODUCT_FORM } from "./api";
import { OrderStatusForm } from "./OrderStatusForm";
import { ProductFormClient } from "./ProductFormClient";

const serverSession = vi.hoisted(() => ({ getServerSessionUser: vi.fn(), getServerSessionCookieHeader: vi.fn() }));
vi.mock("@/lib/server/session", () => serverSession);

const ADMIN_SESSION = { ...SESSION, user: { ...ALICE, isAdmin: true } };
const product = PRODUCTS[0]!;
const DAY = 86_400_000;

const order = (overrides: Partial<Order> = {}): Order => ({
  id: "11111111-1111-4111-8111-111111111111",
  userId: ALICE._id,
  customer: { fullName: "Nora", email: "nora@example.com", phone: "07123", address: "1 High Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" },
  orderTimeMs: Date.UTC(2026, 9, 20),
  totalCostCents: 1000,
  products: [],
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
  status: "placed",
  ...overrides,
});

describe("admin rules", () => {
  test("status choices mirror the database transitions, including legacy orders", () => {
    expect(nextStatuses("placed")).toEqual(["processing", "cancelled"]);
    expect(nextStatuses("processing")).toEqual(["shipped", "cancelled"]);
    expect(nextStatuses("shipped")).toEqual(["delivered"]);
    expect(nextStatuses("delivered")).toEqual([]);
    expect(nextStatuses("cancelled")).toEqual([]);
    expect(nextStatuses(null)).toEqual(["delivered", "cancelled"]);
  });

  test("the edit form starts from every stored field, keywords included", () => {
    expect(productToForm(product)).toMatchObject({
      name: product.name, price: (product.priceCents / 100).toFixed(2), category: product.category,
      description: product.description, highlights: product.highlights.join(", "), keywords: product.keywords.join(", "),
    });
  });

  test("validation matches the API rules, per field", () => {
    expect(validateProductForm(EMPTY_PRODUCT_FORM)).toMatchObject({
      name: expect.any(String), category: expect.any(String), image: expect.any(String), price: expect.any(String),
      description: expect.any(String), howItWorks: expect.any(String), careInstructions: expect.any(String), highlights: expect.any(String),
    });
    const valid = { ...productToForm(product), price: "19.99", stock: "3" };
    expect(validateProductForm(valid)).toEqual({});
    expect(validateProductForm({ ...valid, price: "$19.99" }).price).toBeDefined();
    expect(validateProductForm({ ...valid, price: "1.999" }).price).toBeDefined();
    expect(validateProductForm({ ...valid, stock: "-1" }).stock).toBeDefined();
    expect(validateProductForm({ ...valid, keywords: "x".repeat(41) }).keywords).toBeDefined();
    expect(validateProductForm({ ...valid, keywords: Array.from({ length: 21 }, (_, index) => `k${index}`).join(",") }).keywords).toBeDefined();
  });

  test("dashboard figures: counts by status, value without cancelled orders, last 30 days", () => {
    const now = Date.UTC(2026, 9, 22);
    const stats = dashboardStatistics(PRODUCTS, [
      order({ id: "a", totalCostCents: 1000, orderTimeMs: now - DAY }),
      order({ id: "b", totalCostCents: 500, status: "cancelled", orderTimeMs: now - DAY }),
      order({ id: "c", totalCostCents: 250, status: "delivered", orderTimeMs: now - 40 * DAY }),
      order({ id: "d", totalCostCents: 100, status: null, customer: undefined, orderTimeMs: now - 400 * DAY }),
    ], now);
    expect(stats).toMatchObject({
      products: PRODUCTS.length, orders: 4, orderValueCents: 1350,
      last30Days: { orders: 1, valueCents: 1000 },
      byStatus: { placed: 1, cancelled: 1, delivered: 1, none: 1, processing: 0, shipped: 0 },
    });
    expect(stats.recent.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("only successful product writes refresh the storefront catalogue cache", () => {
    const at = (method: string, path: string) => new Request(`http://shop.test${path}`, { method });
    expect(changesCatalog(at("POST", "/api/products"), 201)).toBe(true);
    expect(changesCatalog(at("PUT", `/api/products/${product.id}`), 200)).toBe(true);
    expect(changesCatalog(at("DELETE", `/api/products/${product.id}`), 200)).toBe(true);
    expect(changesCatalog(at("POST", "/api/products"), 403)).toBe(false);
    expect(changesCatalog(at("GET", "/api/products"), 200)).toBe(false);
    expect(changesCatalog(at("POST", "/api/cart-items"), 201)).toBe(false);
  });
});

describe("admin server guard", () => {
  test("signed out → sign-in with the return path; customers → 404; administrators pass", async () => {
    const { requireAdmin } = await import("@/lib/server/admin");
    serverSession.getServerSessionUser.mockResolvedValueOnce(null);
    await expect(requireAdmin("/admin/orders")).rejects.toEqual(new RedirectSignal("/login?from=%2Fadmin%2Forders"));
    serverSession.getServerSessionUser.mockResolvedValueOnce(ALICE);
    await expect(requireAdmin("/admin")).rejects.toBeInstanceOf(NotFoundSignal);
    serverSession.getServerSessionUser.mockResolvedValueOnce(ADMIN_SESSION.user);
    await expect(requireAdmin("/admin")).resolves.toEqual(ADMIN_SESSION.user);
  });

  test("every admin page checks the role itself (a layout alone is not re-run on client navigation)", async () => {
    const pages = await Promise.all([
      import("@/app/admin/page"), import("@/app/admin/products/page"), import("@/app/admin/products/new/page"),
      import("@/app/admin/products/[id]/page"), import("@/app/admin/orders/page"), import("@/app/admin/orders/[id]/page"),
    ]);
    const props = { params: Promise.resolve({ id: product.id }), searchParams: Promise.resolve({}) };
    for (const { default: Page } of pages) {
      serverSession.getServerSessionUser.mockResolvedValueOnce(ALICE);
      await expect((Page as (props: object) => Promise<unknown>)(props)).rejects.toBeInstanceOf(NotFoundSignal);
    }
  });
});

describe("product form", () => {
  test("problems are listed on their fields, linked and focused; nothing is sent", async () => {
    const { requests } = fakeApi({});
    const { user } = renderWithProviders(<ProductFormClient />, { session: ADMIN_SESSION });
    await user.click(screen.getByRole("button", { name: "Create product" }));
    expect(screen.getByRole("alert")).toHaveTextContent("fields need attention");
    const name = screen.getByLabelText("Product name");
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter the product name.");
    expect(screen.getByLabelText("Price (USD)")).toHaveAccessibleDescription("For example 19.99. Enter a price such as 19.99 (no currency sign).");
    expect(requests).toEqual([]);
  });

  test("creates with every field, keywords as a list, and the CSRF token", async () => {
    const { requests } = fakeApi({ "POST /api/products": { status: 201, body: { ...product, name: "Kettle" } } });
    const { user } = renderWithProviders(<ProductFormClient />, { session: ADMIN_SESSION });
    const values: [string, string][] = [
      ["Product name", "Kettle"], ["Category", "Kitchen"], ["Price (USD)", "19.99"], ["Image path", "images/products/kettle.jpg"],
      ["About this product", "Boils water."], ["How it works", "Fill it."], ["Care and guidance", "Descale."],
      ["Highlights", "1.7 l, Auto off"], ["Search keywords (optional)", "kettle, tea"],
    ];
    for (const [label, value] of values) await user.type(screen.getByLabelText(label), value);
    await user.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/admin/products?saved=created&name=Kettle"));
    expect(requests).toEqual([expect.objectContaining({
      method: "POST", path: "/api/products", headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }),
      body: expect.objectContaining({ name: "Kettle", price: "19.99", stock: "0", category: "Kitchen", highlights: "1.7 l, Auto off", keywords: ["kettle", "tea"] }),
    })]);
  });

  test("edits keep the stored keywords and show the server's refusal", async () => {
    const { requests } = fakeApi({ [`PUT /api/products/${product.id}`]: { status: 403, body: { message: "Not authorized as an admin" } } });
    const { user } = renderWithProviders(<ProductFormClient product={product} />, { session: ADMIN_SESSION });
    expect(screen.getByLabelText("Search keywords (optional)")).toHaveValue(product.keywords.join(", "));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not authorized as an admin");
    expect(requests[0]?.body).toMatchObject({ keywords: product.keywords, description: product.description });
    expect(navigation.push).not.toHaveBeenCalled();
  });
});

describe("product list", () => {
  test("delete asks first, can be cancelled with focus returned, then deletes with the CSRF token", async () => {
    const { requests } = fakeApi({ [`DELETE /api/products/${product.id}`]: { status: 200, body: { id: product.id } } });
    const { user } = renderWithProviders(<AdminProductsClient products={PRODUCTS} />, { session: ADMIN_SESSION });
    const deleteButton = screen.getByRole("button", { name: `Delete ${product.name}` });
    await user.click(deleteButton);
    expect(screen.getByRole("alertdialog", { name: `Delete ${product.name}?` })).toBeInTheDocument();
    // Focus starts on the least destructive choice: a stray Enter keeps the product.
    expect(screen.getByRole("button", { name: "Keep product" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep product" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(deleteButton).toHaveFocus();
    expect(requests).toEqual([]);

    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(await screen.findByText(/was deleted\. Existing orders keep their saved copy/)).toBeInTheDocument();
    expect(requests).toEqual([expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }) })]);
    expect(navigation.refresh).toHaveBeenCalled();
  });

  test("search filters by name, description, category or keywords", async () => {
    fakeApi({});
    const { user } = renderWithProviders(<AdminProductsClient products={PRODUCTS} />, { session: ADMIN_SESSION });
    await user.type(screen.getByRole("searchbox", { name: "Filter the product list" }), product.keywords[0]!);
    const rows = within(screen.getByRole("table", { name: "Products in the store" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]?.textContent)).toEqual([product.name]);
    expect(screen.getByText(new RegExp(`of ${PRODUCTS.length} products`))).toBeInTheDocument();
  });
});

describe("order status form", () => {
  test("offers only allowed statuses, requires a reason, and sends both with the CSRF token", async () => {
    const changed = { ...order(), status: "processing" as const };
    const { requests } = fakeApi({ [`PATCH /api/orders/${changed.id}/status`]: { status: 200, body: changed } });
    const { user } = renderWithProviders(<OrderStatusForm order={order()} />, { session: ADMIN_SESSION });
    const select = screen.getByLabelText("New status");
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual(["Choose…", "Processing", "Cancelled"]);

    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(select).toHaveFocus();
    expect(select).toHaveAccessibleDescription("Choose the new status.");
    await user.selectOptions(select, "processing");
    await user.click(screen.getByRole("button", { name: "Change status" }));
    const reason = screen.getByLabelText("Reason");
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute("aria-invalid", "true");
    expect(requests).toEqual([]);

    await user.type(reason, "  Picked and packed  ");
    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(await screen.findByText(/Status changed to Processing/)).toBeInTheDocument();
    expect(requests).toEqual([expect.objectContaining({
      method: "PATCH", body: { status: "processing", reason: "Picked and packed" }, headers: expect.objectContaining({ "x-csrf-token": SESSION.csrfToken }),
    })]);
  });

  test("shows the server's refusal (for example a transition made meanwhile in another tab)", async () => {
    fakeApi({ "PATCH /api/orders/11111111-1111-4111-8111-111111111111/status": { status: 409, body: { message: "Order status transition cancelled -> processing is not allowed" } } });
    const { user } = renderWithProviders(<OrderStatusForm order={order()} />, { session: ADMIN_SESSION });
    await user.selectOptions(screen.getByLabelText("New status"), "processing");
    await user.type(screen.getByLabelText("Reason"), "packed");
    await user.click(screen.getByRole("button", { name: "Change status" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cancelled -> processing is not allowed");
  });

  test("a delivered or cancelled order offers no change", () => {
    fakeApi({});
    renderWithProviders(<OrderStatusForm order={order({ status: "delivered" })} />, { session: ADMIN_SESSION });
    expect(screen.queryByLabelText("New status")).not.toBeInTheDocument();
    expect(screen.getByText(/can no longer change/)).toBeInTheDocument();
  });
});
