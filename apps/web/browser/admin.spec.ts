import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import {
  expect, expectCleanPage, expectNoHorizontalScroll, isCompact, newCustomer, placeOrderThroughApi, PRODUCTS, settle, signInAsAdmin, signInThroughApi, snapshot, test,
  testDatabase,
} from "./support";

async function expectNoSeriousAxeViolations(page: Parameters<typeof settle>[0]) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test.describe("admin", () => {
  test("customers cannot open the admin area, and see no admin link", async ({ page }) => {
    await signInThroughApi(page.request, newCustomer("Shopper"));
    const response = await page.goto("/admin");
    expect(response?.status()).toBe(404);
    await page.goto("/");
    if (isCompact(page)) await page.getByRole("button", { name: /^Menu/ }).click();
    await expect(page.getByRole("link", { name: "Admin", exact: true })).toHaveCount(0);
  });

  test("product lifecycle: validated form, create with keywords, edit keeps them, confirmed delete", async ({ page, problems, browserName }, testInfo) => {
    const name = `Desk Lamp ${randomUUID().slice(0, 6)}`;
    await signInAsAdmin(page.request);
    await page.goto("/");
    if (isCompact(page)) await page.getByRole("button", { name: /^Menu/ }).click();
    await page.getByRole("link", { name: "Admin", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await settle(page);
    await expectNoSeriousAxeViolations(page);
    await expectNoHorizontalScroll(page);
    await snapshot(page, testInfo.project.name, "20-admin-dashboard");

    await page.getByRole("navigation", { name: "Admin sections" }).getByRole("link", { name: "Products" }).click();
    await page.getByRole("link", { name: "Add product" }).click();
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByLabel("Product name")).toBeFocused();
    await expect(page.getByLabel("Product name")).toHaveAccessibleDescription("Enter the product name.");
    await expectNoHorizontalScroll(page);
    await snapshot(page, testInfo.project.name, "21-admin-product-form");
    await expectNoSeriousAxeViolations(page);

    for (const [label, value] of [
      ["Product name", name], ["Category", "Home"], ["Price (USD)", "24.50"], ["Stock", "4"], ["Image path", "images/products/luxury-towel-set.jpg"],
      ["About this product", "A warm desk lamp."], ["How it works", "Switch it on."], ["Care and guidance", "Dust it."],
      ["Highlights", "Warm light, Low energy"], ["Search keywords (optional)", "lamp, reading"],
    ] as const) await page.getByLabel(label).fill(value);
    await page.getByRole("button", { name: "Create product" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${name} was created.` })).toBeVisible();

    // On the storefront straight away, and found by a keyword.
    await page.goto("/products?q=reading");
    await expect(page.getByRole("link", { name })).toBeVisible();

    await page.goto("/admin/products");
    await page.getByRole("searchbox", { name: "Filter the product list" }).fill(name);
    await page.getByRole("link", { name: `Edit ${name}` }).click();
    await expect(page.getByLabel("Search keywords (optional)")).toHaveValue("lamp, reading");
    await page.getByLabel("Price (USD)").fill("26.00");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: `${name} was saved.` })).toBeVisible();
    const stored = await testDatabase((query) => query("SELECT price_cents, keywords FROM products WHERE name = $1", [name]));
    expect(stored.rows).toEqual([{ price_cents: 2600, keywords: ["lamp", "reading"] }]);

    await page.getByRole("searchbox", { name: "Filter the product list" }).fill(name);
    const deleteButton = page.getByRole("button", { name: `Delete ${name}` });
    await deleteButton.click();
    const dialog = page.getByRole("alertdialog", { name: `Delete ${name}?` });
    // A real modal (native <dialog>, showModal): the rest of the page is inert.
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(page.getByRole("button", { name: "Keep product" })).toBeFocused();
    await expectNoSeriousAxeViolations(page);
    // Escape keeps the product and returns focus to the button that opened the dialog.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(deleteButton).toBeFocused();
    await deleteButton.click();
    if (browserName === "webkit") {
      // WebKit does not Tab to buttons by default (Safari preference): confirm with a click.
      await page.getByRole("button", { name: "Delete permanently" }).click();
    } else {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Delete permanently" })).toBeFocused();
      await page.keyboard.press("Enter");
    }
    await expect(page.getByRole("status").filter({ hasText: `${name} was deleted.` })).toBeVisible();
    await expect(page.getByRole("table", { name: "Products in the store" }).getByRole("row").filter({ hasText: name })).toHaveCount(0);
    // The row is gone, so focus moves to the filter field.
    await expect(page.getByRole("searchbox", { name: "Filter the product list" })).toBeFocused();
    await page.goto("/products?q=reading");
    await expect(page.getByRole("link", { name })).toHaveCount(0);
    expectCleanPage(problems, { allow: [/404 \(Not Found\)/] });
  });

  test("order status: allowed choices only, reason required, history recorded; 'Your orders' stays personal", async ({ page, browser, problems }, testInfo) => {
    // A customer order, in a separate browser context.
    const shopperContext = await browser.newContext({ baseURL: process.env.BROWSER_E2E_BASE_URL });
    const shopper = newCustomer("Buyer");
    const csrf = await signInThroughApi(shopperContext.request, shopper);
    const orderId = await placeOrderThroughApi(shopperContext.request, csrf, PRODUCTS.shoes.id, shopper);
    await shopperContext.close();

    await signInAsAdmin(page.request);
    await page.goto("/orders");
    await expect(page.getByRole("heading", { name: "No orders yet" })).toBeVisible();

    await page.goto("/admin/orders?status=placed");
    await page.getByRole("link", { name: shopper.name }).click();
    await expect(page).toHaveURL(`/admin/orders/${orderId}`);
    const select = page.getByLabel("New status");
    await expect(select.locator("option")).toHaveText(["Choose…", "Processing", "Cancelled"]);
    await select.selectOption("processing");
    await page.getByRole("button", { name: "Change status" }).click();
    await expect(page.getByLabel("Reason")).toBeFocused();
    await expect(page.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("Reason").fill("Picked and packed");
    await page.getByRole("button", { name: "Change status" }).click();
    await expect(page.getByText("Picked and packed")).toBeVisible();
    await expect(page.getByLabel("New status").locator("option")).toHaveText(["Choose…", "Shipped", "Cancelled"]);
    await expectNoHorizontalScroll(page);
    await snapshot(page, testInfo.project.name, "22-admin-order");

    await expectNoSeriousAxeViolations(page);
    expectCleanPage(problems);
  });
});
