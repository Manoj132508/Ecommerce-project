import {
  expect, expectCartCount, expectCleanPage, expectNoHorizontalScroll, newCustomer, openCartDrawer, PRODUCTS, signInThroughApi, snapshot, test,
  testDatabase,
} from "./support";

test.describe("cart, checkout and orders", () => {
  test("cart drawer: focus moves in, stays in, and returns to the opener", async ({ page, browserName }) => {
    await signInThroughApi(page.request, newCustomer("Drawer"));
    await page.goto(`/products/${PRODUCTS.shoes.id}`);
    await page.getByRole("button", { name: "Add to Cart" }).click();
    await expectCartCount(page, 1);

    const opener = await openCartDrawer(page);
    const dialog = page.getByRole("dialog", { name: "Your cart" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect(dialog.getByText(PRODUCTS.shoes.name)).toBeVisible();
    if (browserName !== "webkit") {
      // Tab cycles inside the dialog (WebKit skips links on Tab by default).
      for (let step = 0; step < 5; step += 1) {
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("full checkout from the cart page to tracking, with form validation", async ({ page, problems }, testInfo) => {
    const customer = newCustomer("Buyer");
    await signInThroughApi(page.request, customer);
    const project = testInfo.project.name;

    await page.goto(`/products/${PRODUCTS.sunhat.id}`);
    await page.getByLabel("Quantity", { exact: true }).selectOption("2");
    await page.getByRole("button", { name: "Add to Cart" }).click();
    await expectCartCount(page, 2);
    await snapshot(page, project, "02-product");

    await page.goto("/cart");
    await expect(page.getByRole("heading", { level: 1, name: "Your cart" })).toBeVisible();
    const total = page.getByRole("definition").last();
    const before = await total.textContent();
    await page.getByRole("combobox", { name: "Quantity" }).selectOption("3");
    await expect(total).not.toHaveText(before ?? "");
    await expectNoHorizontalScroll(page);
    await snapshot(page, project, "03-cart");

    await page.getByRole("link", { name: "Continue to checkout" }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(page.getByLabel("Full name")).toHaveValue(customer.name);
    await expect(page.getByLabel("Email")).toHaveValue(customer.email);

    // Native validation keeps the visitor on step 1 and explains the missing field.
    await page.getByRole("button", { name: "Review order" }).click();
    await expect(page.getByText("Step 1 of 2")).toBeVisible();
    const phone = page.getByLabel("Phone");
    expect(await phone.evaluate((input: HTMLInputElement) => input.validity.valueMissing && input.validationMessage.length > 0)).toBe(true);
    await expectNoHorizontalScroll(page);
    await snapshot(page, project, "04-checkout-details");

    await phone.fill("07123 456789");
    await page.getByLabel("Address").fill("1 High Street");
    await page.getByLabel("City").fill("London");
    await page.getByLabel("Postal code").fill("N1 1AA");
    await page.getByRole("button", { name: "Review order" }).click();
    await expect(page.getByRole("heading", { name: "Final review" })).toBeVisible();
    await expect(page.getByRole("main").getByText(/No payment provider is connected/)).toBeVisible();
    await snapshot(page, project, "05-checkout-review");

    await page.getByRole("button", { name: "Confirm and place order" }).click();
    await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}\?placed=1$/);
    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible();
    await expect(page.getByText(`Quantity: 3`)).toBeVisible();
    await snapshot(page, project, "06-order-confirmed");

    await page.getByRole("link", { name: "Back to orders" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Your orders" })).toBeVisible();
    await expect(page.getByRole("article")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    // Line images stay thumbnails on every viewport (the Vite limit was 150 px).
    const thumbnail = await page.getByRole("article").getByRole("img", { name: PRODUCTS.sunhat.name }).evaluate((image) => image.getBoundingClientRect().width);
    expect(thumbnail).toBeLessThanOrEqual(150);
    await snapshot(page, project, "07-orders");

    await page.getByRole("button", { name: `Buy ${PRODUCTS.sunhat.name} again` }).click();
    await expectCartCount(page, 1);

    await page.getByRole("link", { name: `Track package for ${PRODUCTS.sunhat.name}` }).click();
    await expect(page).toHaveURL(/\/tracking\?orderId=/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Arriving on /);
    await expect(page.getByRole("progressbar", { name: "Delivery progress" })).toHaveAttribute("aria-valuetext", "Preparing");
    await snapshot(page, project, "08-tracking");
    expectCleanPage(problems);
  });

  test("checkout is refused while a deleted product is in the cart, and the product stays visible", async ({ page }) => {
    // A cart line whose product was deleted (D3: no foreign key, the line stays).
    // Inserted directly so the shared catalogue never changes under other tests.
    const customer = newCustomer("Gone");
    const csrf = await signInThroughApi(page.request, customer);
    expect((await page.request.post("/api/cart-items", { headers: { Origin: process.env.BROWSER_E2E_BASE_URL ?? "", "X-CSRF-Token": csrf }, data: { productId: PRODUCTS.shoes.id, quantity: 1 } })).status()).toBe(201);
    await testDatabase((query) => query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, delivery_option_id)
       SELECT c.id, gen_random_uuid(), 1, '1' FROM carts c JOIN users u ON u.id = c.user_id WHERE u.email = $1`, [customer.email]));

    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "This product is no longer available" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue to checkout" })).toHaveCount(0);
    await page.goto("/checkout");
    await expect(page.getByRole("heading", { name: "Checkout is not available yet" })).toBeVisible();
    await page.goto("/cart");
    await page.getByRole("button", { name: "Remove unavailable item" }).click();
    await expect(page.getByRole("heading", { name: "This product is no longer available" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Continue to checkout" })).toBeVisible();
  });
});
