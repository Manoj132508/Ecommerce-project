import { expect, expectCleanPage, expectNoHorizontalScroll, expectSeededCatalogue, PRODUCT_COUNT, PRODUCTS, test } from "./support";

test.describe("catalogue", () => {
  test("home lists every product with working images, without script or hydration errors", async ({ page, problems }) => {
    const images: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname.startsWith("/_next/image") || pathname.startsWith("/images/")) images.push({ url: response.url(), status: response.status() });
    });
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
    await expectSeededCatalogue(page);
    await expectNoHorizontalScroll(page);

    // Load the lazy images too, then every product and rating image must have decoded.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => page.evaluate(() => [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length)).toBe(0);
    expect(images.length).toBeGreaterThanOrEqual(PRODUCT_COUNT);
    expect(images.filter((image) => image.status !== 200)).toEqual([]);
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
  });

  test("search and filters live in the URL and survive back navigation", async ({ page, problems }) => {
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Search products" });
    await search.fill("sun");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/products\?q=sun$/);
    await expect(page.getByRole("status").filter({ hasText: "results" })).toHaveText("2 results for “sun”");
    await expect(search).toHaveValue("sun");

    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "Accessories" }).click();
    await expect(page).toHaveURL(/\/products\?q=sun&category=Accessories$/);
    await expect(page.getByRole("link", { name: "Accessories" })).toHaveAttribute("aria-current", "page");

    await page.goBack();
    await expect(page).toHaveURL(/\/products\?q=sun$/);
    await expect(page.getByRole("searchbox", { name: "Search products" })).toHaveValue("sun");
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("searchbox", { name: "Search products" })).toHaveValue("");

    await page.goto("/products?q=no-such-thing");
    await expect(page.getByText("No products match your search.")).toBeVisible();
    await page.getByRole("link", { name: "Show all products" }).click();
    await expectSeededCatalogue(page);
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
  });

  test("product details, and real 404 pages for unknown products and URLs", async ({ page, problems }) => {
    await page.goto("/products?q=sunglasses");
    await page.getByRole("link", { name: PRODUCTS.sunglasses.name }).click();
    await expect(page).toHaveURL(`/products/${PRODUCTS.sunglasses.id}`);
    await expect(page.getByRole("heading", { level: 1, name: PRODUCTS.sunglasses.name })).toBeVisible();
    await expect(page.getByRole("img", { name: PRODUCTS.sunglasses.name })).toBeVisible();
    await expect(page.getByLabel("Quantity:")).toHaveValue("1");
    await expectNoHorizontalScroll(page);

    const missing = await page.goto("/products/00000000-0000-4000-8000-000000000000");
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Product not found" })).toBeVisible();
    const unknown = await page.goto("/no-such-page");
    expect(unknown?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/, /404 \(Not Found\)/] });
  });

  test("Vite-only routes redirect to their new home", async ({ page }) => {
    await page.goto("/order-confirmation");
    await expect(page).toHaveURL(/\/login\?from=%2Fcheckout$/);
    await page.goto("/product-unavailable");
    await expect(page).toHaveURL(/\/login\?from=%2Forders$/);
  });
});
