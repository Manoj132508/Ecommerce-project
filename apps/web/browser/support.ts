// Shared fixtures and helpers for the browser tests.
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

export const PRODUCTS = {
  shoes: { id: "e43638ce-6aa0-4b85-b27f-e1d07eb678c6", name: "Athletic Skateboard Shoes" },
  sunglasses: { id: "54e0eccd-8f36-462b-b68a-8182611d9add", name: "Round Sunglasses" },
  sunhat: { id: "3ebe75dc-64d2-4137-8860-1f5a963e534b", name: "Straw Sunhat" },
} as const;
export const PRODUCT_COUNT = 6;

/** Every seeded product is listed. Admin tests may add a product meanwhile, so the count is a minimum. */
export async function expectSeededCatalogue(page: Page) {
  await expect(page.getByRole("article").first()).toBeVisible();
  expect(await page.getByRole("article").count()).toBeGreaterThanOrEqual(PRODUCT_COUNT);
  for (const { name } of Object.values(PRODUCTS)) await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
}

const baseURL = () => {
  const url = process.env.BROWSER_E2E_BASE_URL;
  if (!url) throw new Error("BROWSER_E2E_BASE_URL is not set: run through `npm run test:browser`");
  return url;
};

/** Console errors and failed page requests, collected for every test. */
export interface PageProblems {
  consoleErrors: string[];
  failedRequests: string[];
}

export const test = base.extend<{ problems: PageProblems }>({
  baseURL: async ({}, provide) => provide(baseURL()),
  problems: async ({ page }, provide) => {
    const problems: PageProblems = { consoleErrors: [], failedRequests: [] };
    page.on("console", (message) => {
      if (message.type() === "error") problems.consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => problems.consoleErrors.push(`pageerror: ${error.message}`));
    page.on("response", (response) => {
      const url = new URL(response.url());
      // Expected answers: 401 from the session check while signed out, 404 pages and refused requests under test.
      if (response.status() >= 500 || (response.status() >= 400 && url.pathname.startsWith("/_next/"))) {
        problems.failedRequests.push(`${response.status()} ${url.pathname}`);
      }
    });
    await provide(problems);
  },
});
export { expect };

/** Nothing went wrong in the page: no script errors, hydration warnings or broken assets. */
export function expectCleanPage(problems: PageProblems, { allow = [] as RegExp[] } = {}) {
  // WebKit reports a same-origin request that a navigation cancels (a route
  // prefetch, a query still loading) as "… due to access control checks".
  // The app makes no cross-origin requests, so only that case is ignored.
  const host = new URL(baseURL()).host.replaceAll(".", "\\.");
  const webkitCancelled = new RegExp(`^pageerror: /${host}/\\S* due to access control checks\\.$`);
  const errors = problems.consoleErrors.filter((text) => !webkitCancelled.test(text) && !allow.some((pattern) => pattern.test(text)));
  expect(errors, "console errors").toEqual([]);
  expect(problems.failedRequests, "failed requests").toEqual([]);
}

/** The desktop header shows its links inline; narrower layouts put them behind "Menu". */
export const isCompact = (page: Page) => (page.viewportSize()?.width ?? 0) < 1280;

/** The header's cart count (the lasting result of adding, unlike the 2-second confirmation). */
export async function expectCartCount(page: Page, count: number) {
  await expect(page.getByRole(isCompact(page) ? "button" : "link", { name: isCompact(page) ? `Menu (${count})` : `Cart (${count})` })).toBeVisible();
}

export interface Customer {
  name: string;
  email: string;
  password: string;
}

export const newCustomer = (label: string): Customer => ({
  name: `${label} ${randomUUID().slice(0, 4)}`,
  email: `${label.toLowerCase()}-${randomUUID()}@example.com`,
  password: `pw-${randomUUID()}`,
});

/** Creates the account and signs this browser context in through the same-origin API (cookie set in the context). */
export async function signInThroughApi(request: APIRequestContext, customer: Customer, { register = true } = {}) {
  const headers = { Origin: baseURL() };
  if (register) expect((await request.post("/api/auth/accounts", { headers, data: customer })).status()).toBe(201);
  const session = await request.post("/api/auth/session", { headers, data: { email: customer.email, password: customer.password } });
  expect(session.status()).toBe(200);
  return (await session.json()).csrfToken as string;
}

/** Places an order through the API for a signed-in context; returns its id. */
export async function placeOrderThroughApi(request: APIRequestContext, csrfToken: string, productId: string, customer: Customer) {
  const headers = { Origin: baseURL(), "X-CSRF-Token": csrfToken };
  expect((await request.post("/api/cart-items", { headers, data: { productId, quantity: 1 } })).status()).toBe(201);
  const order = await request.post("/api/orders", {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { customer: { fullName: customer.name, email: customer.email, phone: "07123 456789", address: "1 High Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" } },
  });
  expect(order.status()).toBe(201);
  return (await order.json()).id as string;
}

/** Opens the cart drawer the way a visitor would at this viewport; returns the control that opened it. */
export async function openCartDrawer(page: Page) {
  if (isCompact(page)) {
    const menu = page.getByRole("button", { name: /^Menu/ });
    await menu.click();
    await page.getByRole("button", { name: "Cart preview" }).click();
    return menu;
  }
  const preview = page.getByRole("button", { name: /Open cart drawer/ });
  await preview.click();
  return preview;
}

/** Signs out from the header at this viewport. */
export async function signOutFromHeader(page: Page) {
  if (isCompact(page)) await page.getByRole("button", { name: /^Menu/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

/** Runs SQL against the throwaway test database (never the development database). */
export async function testDatabase<T>(work: (query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>) {
  const url = process.env.BROWSER_E2E_DATABASE_URL;
  if (!url) throw new Error("BROWSER_E2E_DATABASE_URL is not set");
  const backendRequire = createRequire(path.resolve(process.cwd(), "../../ecommerce-backend/package.json"));
  const { Pool } = backendRequire("pg") as { Pool: new (options: { connectionString: string }) => { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> } };
  const pool = new Pool({ connectionString: url });
  try {
    return await work((text, values) => pool.query(text, values));
  } finally {
    await pool.end();
  }
}

/**
 * The page has finished rendering: its main heading is shown, the header knows
 * the session, client data has replaced every loading message, and loaded
 * images are decoded. (Used instead of "networkidle", which Playwright
 * discourages and which stalled intermittently in Firefox.)
 */
export async function settle(page: Page) {
  await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByText(/^(Loading|Calculating)/)).toHaveCount(0);
  await page.evaluate(() => Promise.race([
    Promise.all([...document.images].filter((image) => image.loading !== "lazy" || image.complete).map((image) => image.decode().catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]));
}

/** Full-page screenshot for the visual review, per project. */
export async function snapshot(page: Page, project: string, name: string) {
  await page.screenshot({ path: path.join("test-results", "screenshots", project, `${name}.png`), fullPage: true, animations: "disabled" });
}

/** The page never scrolls sideways at this viewport. */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}
