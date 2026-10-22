import { randomUUID } from "node:crypto";
import {
  expect, expectCleanPage, isCompact, newCustomer, placeOrderThroughApi, PRODUCTS, signInThroughApi, signOutFromHeader, test, testDatabase,
} from "./support";

test.describe("sessions and privacy", () => {
  test("an expired session sends the visitor to sign in with a notice and the page to return to", async ({ page }) => {
    const customer = newCustomer("Expiry");
    const csrf = await signInThroughApi(page.request, customer);
    expect((await page.request.post("/api/cart-items", { headers: { Origin: process.env.BROWSER_E2E_BASE_URL ?? "", "X-CSRF-Token": csrf }, data: { productId: PRODUCTS.shoes.id, quantity: 1 } })).status()).toBe(201);
    await page.goto("/cart");
    await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();

    // The idle timeout passes while the page is open.
    await testDatabase((query) => query(
      "UPDATE auth_sessions SET idle_expires_at = now() - interval '1 minute' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [customer.email]));
    await page.getByRole("combobox", { name: "Quantity" }).selectOption("2");

    await expect(page).toHaveURL(/\/login\?from=%2Fcart$/);
    await expect(page.getByRole("status").filter({ hasText: "Your session has expired" })).toBeVisible();
    await expect(page.getByText(PRODUCTS.shoes.name)).toHaveCount(0);

    // Reloading a guarded page is refused by the server guard as well.
    const guarded = await page.goto("/orders");
    expect(guarded?.url()).toMatch(/\/login\?from=%2Forders$/);
  });

  test("another account in the same browser sees none of the first account's data", async ({ page, problems }) => {
    const alice = newCustomer("Alice");
    const csrf = await signInThroughApi(page.request, alice);
    const aliceOrder = await placeOrderThroughApi(page.request, csrf, PRODUCTS.sunglasses.id, alice);
    await page.goto("/orders");
    await expect(page.getByText(aliceOrder)).toBeVisible();
    await signOutFromHeader(page);

    const bob = newCustomer("Bob");
    await signInThroughApi(page.request, bob);
    await page.goto("/orders");
    await expect(page.getByRole("heading", { name: "No orders yet" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(alice.email);
    await expect(page.locator("body")).not.toContainText(aliceOrder);

    const foreign = await page.goto(`/orders/${aliceOrder}`);
    expect(foreign?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Order not found" })).toBeVisible();
    const foreignTracking = await page.goto(`/tracking?orderId=${aliceOrder}&productId=${PRODUCTS.sunglasses.id}`);
    expect(foreignTracking?.status()).toBe(404);
    const api = await page.request.get(`/api/orders/${aliceOrder}`);
    expect(api.status()).toBe(404);
    expect(api.headers()["cache-control"]).toContain("no-store");
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/, /404 \(Not Found\)/] });
  });

  test("signing out in one tab signs the other tab out of its private page", async ({ page, context }) => {
    test.skip(isCompact(page), "the same flow on the desktop layout is enough");
    await signInThroughApi(page.request, newCustomer("Tabs"));
    const other = await context.newPage();
    await other.goto("/orders");
    await expect(other.getByRole("heading", { name: "No orders yet" })).toBeVisible();

    await page.goto("/");
    await signOutFromHeader(page);

    await expect(other).toHaveURL(/\/login\?from=%2Forders$/);
  });

  test("historical orders keep their stored snapshot, and legacy lines without one still render", async ({ page, problems }) => {
    const customer = newCustomer("History");
    await signInThroughApi(page.request, customer);
    const snapshotOrder = randomUUID();
    const legacyOrder = randomUUID();
    await testDatabase(async (query) => {
      const { rows: [user] } = await query("SELECT id FROM users WHERE email = $1", [customer.email]);
      await query(
        `INSERT INTO orders (id, is_legacy, user_id, customer_full_name, customer_email, customer_phone, customer_address, customer_city,
                             customer_postal_code, customer_country, ordered_at, total_cost_cents, status, status_updated_at)
         VALUES ($1, false, $2, $3, $4, '07123', '1 High Street', 'London', 'N1 1AA', 'United Kingdom', now() - interval '30 days', 4753, 'delivered', now())`,
        [snapshotOrder, user?.id, customer.name, customer.email]);
      await query(
        `INSERT INTO order_items (order_id, position, product_id, quantity, estimated_delivery_at,
                                  snapshot_name, snapshot_image, snapshot_price_cents, snapshot_description, snapshot_category)
         VALUES ($1, 0, $2, 1, now() - interval '25 days', 'Discontinued Lamp', 'images/products/straw-sunhat.jpg', 4321, 'Retired.', 'Home')`,
        [snapshotOrder, randomUUID()]);
      await query(
        "INSERT INTO orders (id, is_legacy, user_id, ordered_at, total_cost_cents) VALUES ($1, true, $2, now() - interval '400 days', 1090)",
        [legacyOrder, user?.id]);
      await query(
        "INSERT INTO order_items (order_id, position, product_id, quantity, estimated_delivery_at) VALUES ($1, 0, $2, 1, now() - interval '395 days')",
        [legacyOrder, randomUUID()]);
    });

    await page.goto(`/orders/${snapshotOrder}`);
    await expect(page.getByRole("heading", { name: "Discontinued Lamp" })).toBeVisible();
    await expect(page.getByText("Price paid: $43.21 each")).toBeVisible();
    await expect(page.getByText(/^Status: delivered$/i)).toBeVisible();
    await page.getByRole("button", { name: "Buy Discontinued Lamp again" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText("Discontinued Lamp is no longer available and cannot be added to your cart.");

    await page.goto(`/orders/${legacyOrder}`);
    await expect(page.getByRole("heading", { name: "Product details not recorded" })).toBeVisible();
    await expect(page.getByText(/^Status: not recorded \(older order\)$/i)).toBeVisible();
    await expect(page.getByText("Price paid not recorded")).toBeVisible();
    expectCleanPage(problems, { allow: [/404 \(Not Found\)/] });
  });
});
