import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoHorizontalScroll, newCustomer, placeOrderThroughApi, PRODUCTS, settle, signInThroughApi, snapshot, test } from "./support";

// Automated WCAG 2.1 A/AA rules (axe-core). They find a subset of problems
// only; they do not replace a keyboard pass or a screen-reader test.
const AXE_PROJECTS = ["chromium-desktop", "chromium-mobile", "firefox-desktop", "webkit-mobile"];

test.describe("accessibility and layout", () => {
  test("public and private pages: axe finds no serious or critical WCAG A/AA problems; no sideways scrolling", async ({ page }, testInfo) => {
    test.skip(!AXE_PROJECTS.includes(testInfo.project.name), "axe runs on one engine per layout family");
    const customer = newCustomer("Axe");
    const pages: [string, string][] = [
      ["home", "/"], ["search", "/products?q=sun"], ["product", `/products/${PRODUCTS.shoes.id}`],
      ["sign-in", "/login"], ["register", "/register"], ["not-found", "/no-such-page"],
    ];
    const report: Record<string, { id: string; impact: string | null | undefined; help: string; nodes: string[] }[]> = {};
    const scan = async (name: string) => {
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      report[name] = result.violations.map((violation) => ({
        id: violation.id, impact: violation.impact, help: violation.help, nodes: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")),
      }));
    };
    for (const [name, path] of pages) {
      await page.goto(path);
      await settle(page);
      await scan(name);
      await expectNoHorizontalScroll(page);
    }

    const csrf = await signInThroughApi(page.request, customer);
    const orderId = await placeOrderThroughApi(page.request, csrf, PRODUCTS.sunhat.id, customer);
    await page.request.post("/api/cart-items", { headers: { Origin: process.env.BROWSER_E2E_BASE_URL ?? "", "X-CSRF-Token": csrf }, data: { productId: PRODUCTS.shoes.id, quantity: 1 } });
    for (const [name, path] of [
      ["cart", "/cart"], ["checkout", "/checkout"], ["orders", "/orders"], ["order", `/orders/${orderId}`],
      ["tracking", `/tracking?orderId=${orderId}&productId=${PRODUCTS.sunhat.id}`], ["account", "/account"],
    ] as const) {
      await page.goto(path);
      await settle(page);
      await scan(name);
      await expectNoHorizontalScroll(page);
    }

    await testInfo.attach("axe-violations.json", { body: JSON.stringify(report, null, 2), contentType: "application/json" });
    const blocking = Object.entries(report).flatMap(([name, violations]) => violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${name}: ${violation.id} (${violation.impact}) ${violation.nodes.join(", ")}`));
    expect(blocking).toEqual([]);
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
    // 1366×900 at 200 % zoom is a 683×450 CSS viewport; WCAG 1.4.10 reflow is 320 CSS px wide.
    for (const viewport of [{ width: 683, height: 450 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      for (const path of ["/", `/products/${PRODUCTS.shoes.id}`, "/cart", "/checkout", "/orders", "/account"]) {
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

  test("Windows high contrast (forced colours): every button and field keeps a visible border (Chromium)", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "forced-colours emulation is Chromium-only");
    await page.emulateMedia({ forcedColors: "active" });
    for (const [name, path] of [["home", "/"], ["product", `/products/${PRODUCTS.shoes.id}`], ["sign-in", "/login"], ["register", "/register"]] as const) {
      await page.goto(path);
      await settle(page);
      const borderless = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("button, input, select, textarea")]
        .filter((element) => element.offsetParent !== null && getComputedStyle(element).borderTopWidth === "0px")
        .map((element) => element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName));
      expect(borderless, `${name}: controls without a border in forced colours`).toEqual([]);
      await snapshot(page, testInfo.project.name, `31-forced-colors-${name}`);
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
