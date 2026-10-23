import { expect, expectCleanPage, expectNoHorizontalScroll, expectSeededCatalogue, PRODUCT_COUNT, PRODUCTS, test } from "./support";

test.describe("catalogue", () => {
  test("home: hero, categories and top rated with working images; the listing has every product; no script or hydration errors", async ({ page, problems }) => {
    const images: { url: string; status: number }[] = [];
    page.on("response", (response) => {
      const { pathname } = new URL(response.url());
      if (pathname.startsWith("/_next/image") || pathname.startsWith("/images/")) images.push({ url: response.url(), status: response.status() });
    });
    const allDecoded = async () => {
      // Scroll through the page as a person would, so each lazy image comes near the viewport
      // (jumping straight to the end skips images in WebKit), then every image must have decoded.
      await page.evaluate(async () => {
        for (const image of document.images) {
          image.scrollIntoView({ block: "center" });
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });
      await expect.poll(() => page.evaluate(() => [...document.images]
        .filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.alt || image.currentSrc))).toEqual([]);
    };

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Shop everyday essentials" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Shop by category" }).getByRole("link")).toHaveCount(4);
    await expect(page.getByRole("region", { name: "Top rated" }).getByRole("article")).toHaveCount(4);
    await expectNoHorizontalScroll(page);
    await allDecoded();

    await page.getByRole("region", { name: "Shop by category" }).getByRole("link", { name: /^Accessories/ }).click();
    await expect(page).toHaveURL(/\/products\?category=Accessories$/);
    await expect(page.getByRole("link", { name: "Accessories" })).toHaveAttribute("aria-current", "page");

    await page.goto("/products");
    await expect(page.getByRole("heading", { level: 1, name: "All products" })).toBeVisible();
    await expectSeededCatalogue(page);
    await expectNoHorizontalScroll(page);
    await allDecoded();
    expect(images.length).toBeGreaterThanOrEqual(PRODUCT_COUNT);
    expect(images.filter((image) => image.status !== 200)).toEqual([]);
    expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
  });

  test("sorting lives in the URL, keeps focus on the control, and Back/Forward restore every setting", async ({ page, problems }) => {
    const names = () => page.getByRole("article").getByRole("heading", { level: 2 }).allTextContents();
    // A search that only the two seeded Home products match (the admin test adds a Home product meanwhile).
    await page.goto("/products?q=bath&category=Home");
    await expect(page.getByRole("status").filter({ hasText: "results" })).toHaveText("2 results for “bath”");
    const sort = page.getByRole("combobox", { name: "Sort by" });
    await expect(sort).toHaveValue("");
    // Hydrated: the no-JavaScript Apply button is gone.
    await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);

    // A person focuses the control to change it (selectOption alone does not move focus).
    await sort.focus();
    await sort.selectOption("price-desc");
    await expect(page).toHaveURL(/\/products\?q=bath&category=Home&sort=price-desc$/);
    await expect.poll(names).toEqual(["Bathroom Mat", "Luxury Towel Set"]);
    await expect(page.getByRole("status").filter({ hasText: "results" })).toHaveText("2 results for “bath”, sorted by price: high to low");
    await expect(sort).toBeFocused();

    await sort.selectOption("name-desc");
    await expect(page).toHaveURL(/sort=name-desc$/);
    await expect.poll(names).toEqual(["Luxury Towel Set", "Bathroom Mat"]);
    await expect(sort).toBeFocused();

    // A category chip keeps the order; Back walks through each earlier setting.
    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "All" }).click();
    await expect(page).toHaveURL(/\/products\?q=bath&sort=name-desc$/);
    await expect(page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: "All" })).toHaveAttribute("aria-current", "page");
    await expect.poll(names).toEqual(["Luxury Towel Set", "Bathroom Mat"]);
    await page.goBack();
    await expect(page).toHaveURL(/category=Home&sort=name-desc$/);
    await expect(sort).toHaveValue("name-desc");
    await page.goBack();
    await expect(page).toHaveURL(/category=Home&sort=price-desc$/);
    await expect(sort).toHaveValue("price-desc");
    await expect.poll(names).toEqual(["Bathroom Mat", "Luxury Towel Set"]);
    await page.goForward();
    await expect(sort).toHaveValue("name-desc");

    // A new search from the header starts from the catalogue order.
    const search = page.getByRole("searchbox", { name: "Search products" });
    await search.fill("sun");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/products\?q=sun$/);
    await expect(sort).toHaveValue("");
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
    await expect(page.getByText(/No products match “no-such-thing”/)).toBeVisible();
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
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("1");
    await expect(page.getByRole("button", { name: "Add to Cart", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Breadcrumb back to the product's category; "More in Accessories" lists the other one.
    await expect(page.getByRole("region", { name: "More in Accessories" }).getByRole("link", { name: PRODUCTS.sunhat.name })).toBeVisible();
    await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Accessories" }).click();
    await expect(page).toHaveURL(/\/products\?category=Accessories$/);

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
