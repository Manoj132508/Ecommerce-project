import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import {
  expect, expectNoHorizontalScroll, isCompact, newCustomer, placeOrderThroughApi, PRODUCTS, settle, signInAsAdmin, signInThroughApi, snapshot, test,
} from "./support";

// Automated WCAG 2.1 A/AA rules (axe-core). They find a subset of problems
// only; they do not replace a keyboard pass or a screen-reader test.
const AXE_PROJECTS = ["chromium-desktop", "chromium-mobile", "firefox-desktop", "webkit-mobile"];

test.describe("accessibility and layout", () => {
  /**
   * Scans each page with axe and checks it does not scroll sideways; fails on
   * serious or critical violations. Per-page scan times are recorded: each axe
   * call costs about 2 s in Firefox whatever the page (MIGRATION_PLAN.md 6B),
   * so public and signed-in pages are separate tests.
   */
  const scanPages = async (page: Page, testInfo: TestInfo, pages: readonly (readonly [string, string])[]) => {
    const report: Record<string, { id: string; impact: string | null | undefined; help: string; nodes: string[] }[]> = {};
    const timings: string[] = [];
    for (const [name, path] of pages) {
      await page.goto(path);
      await settle(page);
      const started = Date.now();
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      timings.push(`${name} ${((Date.now() - started) / 1000).toFixed(1)}s`);
      report[name] = result.violations.map((violation) => ({
        id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
      }));
      await expectNoHorizontalScroll(page);
    }
    testInfo.annotations.push({ type: "axe scan time", description: timings.join(", ") });
    await testInfo.attach("axe-violations.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    const blocking = Object.entries(report).flatMap(([name, violations]) => violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${name}: ${violation.id} (${violation.impact}) ${violation.nodes.join(", ")}`));
    expect(blocking).toEqual([]);
  };

  test("public pages: axe finds no serious or critical WCAG A/AA problems; no sideways scrolling", async ({ page }, testInfo) => {
    test.skip(!AXE_PROJECTS.includes(testInfo.project.name), "axe runs on one engine per layout family");
    await scanPages(page, testInfo, [
      ["home", "/"], ["listing", "/products?sort=price-asc"], ["search", "/products?q=sun"], ["product", `/products/${PRODUCTS.shoes.id}`],
      ["sign-in", "/login"], ["register", "/register"], ["not-found", "/no-such-page"],
    ]);
  });

  test("signed-in pages: axe finds no serious or critical WCAG A/AA problems; no sideways scrolling", async ({ page }, testInfo) => {
    test.skip(!AXE_PROJECTS.includes(testInfo.project.name), "axe runs on one engine per layout family");
    const customer = newCustomer("Axe");
    const csrf = await signInThroughApi(page.request, customer);
    const orderId = await placeOrderThroughApi(page.request, csrf, PRODUCTS.sunhat.id, customer);
    await page.request.post("/api/cart-items", { headers: { Origin: process.env.BROWSER_E2E_BASE_URL ?? "", "X-CSRF-Token": csrf }, data: { productId: PRODUCTS.shoes.id, quantity: 1 } });
    await scanPages(page, testInfo, [
      ["cart", "/cart"], ["checkout", "/checkout"], ["orders", "/orders"], ["order", `/orders/${orderId}`],
      ["tracking", `/tracking?orderId=${orderId}&productId=${PRODUCTS.sunhat.id}`], ["account", "/account"],
    ]);
  });

  test("representative screenshots for the visual review", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    await page.goto("/");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await snapshot(page, project, "01-home");
    await page.goto("/products?q=sun&category=Accessories");
    await settle(page);
    await snapshot(page, project, "01b-search");
    await page.goto("/products?sort=price-desc");
    await settle(page);
    await snapshot(page, project, "01c-listing-sorted");
    await page.goto(`/products/${PRODUCTS.sunglasses.id}`);
    await settle(page);
    await snapshot(page, project, "02b-product-details");
    await page.goto("/login");
    await settle(page);
    await snapshot(page, project, "09-sign-in");
    await page.goto("/register");
    await settle(page);
    await snapshot(page, project, "10-register");
    await page.goto("/no-such-page");
    await settle(page);
    await snapshot(page, project, "11-not-found");
  });

  test("200 % zoom and 320 px reflow: no sideways scrolling, controls still reachable (Chromium)", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium-desktop", "one desktop engine is enough: zoom is emulated by the CSS viewport");
    const customer = newCustomer("Zoom");
    const csrf = await signInThroughApi(page.request, customer);
    await page.request.post("/api/cart-items", { headers: { Origin: process.env.BROWSER_E2E_BASE_URL ?? "", "X-CSRF-Token": csrf }, data: { productId: PRODUCTS.shoes.id, quantity: 1 } });
    // 1366×900 at 200 % zoom is a 683×450 CSS viewport; WCAG 1.4.10 reflow is 320 CSS px wide;
    // 375 and 768 are the small-phone and tablet widths of the Phase 6 layout review.
    for (const viewport of [{ width: 683, height: 450 }, { width: 320, height: 568 }, { width: 375, height: 667 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/products?sort=name-asc", `/products/${PRODUCTS.sunglasses.id}`, "/cart", "/checkout", "/orders", "/account"]) {
        await page.goto(path);
        await settle(page);
        await expectNoHorizontalScroll(page);
      }
      await snapshot(page, testInfo.project.name, `30-reflow-${viewport.width}-account`);
      await page.goto("/checkout");
      await settle(page);
      await page.getByRole("button", { name: "Review order" }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Review order" })).toBeInViewport();
    }
  });

  test("admin pages reflow at 320, 375 and 768 px and at 200 % zoom (Chromium)", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium" || testInfo.project.name !== "chromium-desktop", "one desktop engine is enough: zoom is emulated by the CSS viewport");
    const shopper = newCustomer("Reflow");
    const csrf = await signInThroughApi(page.request, shopper);
    const orderId = await placeOrderThroughApi(page.request, csrf, PRODUCTS.sunhat.id, shopper);
    await page.context().clearCookies();
    await signInAsAdmin(page.request);
    const paths = ["/admin", "/admin/products", "/admin/products/new", `/admin/products/${PRODUCTS.shoes.id}`, "/admin/orders", `/admin/orders/${orderId}`];
    for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 683, height: 450 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      for (const path of paths) {
        await page.goto(path);
        await settle(page);
        await expectNoHorizontalScroll(page);
      }
    }
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`/admin/orders/${orderId}`);
    await settle(page);
    await snapshot(page, testInfo.project.name, "32-reflow-320-admin-order");
  });

  test("signed-in header: mobile menu opens as a panel, Escape closes it and returns focus; footer is present", async ({ page }, testInfo) => {
    await signInThroughApi(page.request, newCustomer("Header"));
    await page.goto("/");
    await settle(page);
    await expect(page.getByRole("contentinfo")).toContainText("No payment provider is connected");
    await expect(page.getByRole("navigation", { name: "Shop" }).getByRole("link", { name: "All products" })).toHaveAttribute("href", "/products");
    if (!isCompact(page)) {
      await expect(page.getByRole("link", { name: "Cart (0)" })).toBeVisible();
      await snapshot(page, testInfo.project.name, "03-header-signed-in");
      return;
    }
    const menu = page.getByRole("button", { name: "Menu (0)" });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator("#mobile-navigation");
    await expect(panel.getByRole("link", { name: "Orders" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await snapshot(page, testInfo.project.name, "03-header-menu-open");
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(menu).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
  });

  test("Windows high contrast (forced colours): every button and field keeps a visible border (Chromium)", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "forced-colours emulation is Chromium-only");
    await page.emulateMedia({ forcedColors: "active" });
    for (const [name, path] of [["home", "/"], ["listing", "/products"], ["product", `/products/${PRODUCTS.shoes.id}`], ["sign-in", "/login"], ["register", "/register"]] as const) {
      await page.goto(path);
      await settle(page);
      const borderless = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, input, select, textarea")]
        .filter((element) => element.offsetParent !== null && getComputedStyle(element).borderTopWidth === "0px")
        .map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName));
      expect(borderless, `${name}: controls without a border in forced colours`).toEqual([]);
      await snapshot(page, testInfo.project.name, `31-forced-colors-${name}`);
    }
  });

  test("layout stability of the listing and product pages (Chromium only: layout-shift entries)", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "the Layout Instability API is Chromium-only");
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    for (const path of ["/products?sort=price-asc", `/products/${PRODUCTS.sunglasses.id}`]) {
      await page.goto(path);
      await settle(page);
      await page.waitForTimeout(500);
      const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
      testInfo.annotations.push({ type: "measured", description: `${testInfo.project.name} ${path}: CLS ${cls.toFixed(4)} (local next start)` });
      expect(cls, path).toBeLessThan(0.1);
    }
  });

  test("layout stability of the home page (Chromium only: layout-shift entries)", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "the Layout Instability API is Chromium-only");
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
          if (!entry.hadRecentInput) (window as unknown as { __cls: number }).__cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto("/");
    await settle(page);
    await page.waitForTimeout(500);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    const scriptBytes = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).encodedBodySize, 0));
    testInfo.annotations.push({ type: "measured", description: `${testInfo.project.name}: CLS ${cls.toFixed(4)}, script transfer ${(scriptBytes / 1024).toFixed(1)} KiB (encoded, local next start)` });
    // 0.1 is the published "good" threshold for Cumulative Layout Shift.
    expect(cls).toBeLessThan(0.1);
  });
});
