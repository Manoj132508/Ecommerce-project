import { expect, expectCleanPage, PRODUCTS, settle, signInAsAdmin, test } from "./support";

// Content-Security-Policy (src/proxy.ts, lib/security/csp.ts). The rest of the
// suite runs under the same policy and fails on any console error, which
// includes the browser's CSP violation reports; this file checks the policy
// itself: it is present, the nonce changes per page, the app's own pages raise
// no violation, and a script the page did not ship is refused.

/** Collects securitypolicyviolation events from the moment the document starts. */
async function recordViolations(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __cspViolations: string[] }).__cspViolations = seen;
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI || "inline"}`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
}

test("pages are served with a nonce-based policy that changes on every request", async ({ page }) => {
  const policies = [];
  for (const path of ["/", "/products", `/products/${PRODUCTS.shoes.id}`, "/login", "/no-such-page"]) {
    const response = await page.goto(path);
    const policy = response?.headers()["content-security-policy"] ?? "";
    expect(policy, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
    expect(policy, path).toContain("frame-ancestors 'none'");
    expect(policy, path).not.toContain("unsafe-eval");
    policies.push(policy);
  }
  expect(new Set(policies).size).toBe(policies.length);
});

test("the app's own pages raise no violation, signed out and as an administrator", async ({ page, problems }) => {
  const violations = await recordViolations(page);
  const visit = async (path: string) => {
    await page.goto(path);
    await settle(page);
    expect(await violations(), path).toEqual([]);
  };
  for (const path of ["/", "/products?q=sun", `/products/${PRODUCTS.sunhat.id}`, "/cart", "/login", "/register"]) await visit(path);
  await signInAsAdmin(page.request);
  for (const path of ["/account", "/orders", "/admin", "/admin/products", "/admin/orders"]) await visit(path);
  // Client navigation and interaction under the policy.
  await page.goto("/products");
  await page.getByRole("link", { name: PRODUCTS.shoes.name, exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: PRODUCTS.shoes.name })).toBeVisible();
  expect(await violations()).toEqual([]);
  // The signed-out session check answers 401 (expected); nothing else may be logged.
  expectCleanPage(problems, { allow: [/401 \(Unauthorized\)/] });
});

// Markup injected into a page (the usual XSS shape) cannot run script. (A script
// element created through DOM APIs by already-trusted code is allowed by
// 'strict-dynamic' by design, so that is not what this checks.)
test("injected event-handler markup does not run", async ({ page }) => {
  const violations = await recordViolations(page);
  await page.goto("/");
  await settle(page);
  const ran = await page.evaluate(async () => {
    const flags = window as unknown as { __handler?: boolean };
    document.body.insertAdjacentHTML("beforeend", '<img src="/no-such-image.png" onerror="window.__handler = true" alt="">');
    await new Promise((resolve) => setTimeout(resolve, 500));
    return flags.__handler === true;
  });
  expect(ran).toBe(false);
  expect(await violations()).toEqual(expect.arrayContaining([expect.stringMatching(/^script-src(-attr)? inline$/)]));
});
