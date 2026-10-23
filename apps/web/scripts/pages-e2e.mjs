// End-to-end check of the migrated pages: real `next start` (production build)
// and `next dev`, in front of the compiled Express API on a throwaway
// PostgreSQL container (removed afterwards).
//
// Covers server rendering, search and filters, 404s, product images (static
// and optimised, in production and development), the register → sign in →
// account → sign out flow, rate limiting per forwarded client address, and
// rejected origins. No browser is driven: page behaviour in a real browser is
// covered by the component tests and still needs a manual/visual check.
//
// Prerequisites: Docker; `npm run build` in ecommerce-backend and apps/web.
//   npm run test:pages     (from apps/web)
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import {
  ALL_POSTGRES, BACKEND, createChecker, freePort, request, requireBuilds, SEED_PRODUCTS as PRODUCTS, seedCatalog, start,
  startThrowawayPostgres, stop, waitFor, WEB,
} from "./e2e-support.mjs";

const VITE_IMAGES = path.resolve(WEB, "../../ecommerce-project/public");
const PROXY_SECRET = randomBytes(24).toString("hex");
const NAMES = PRODUCTS.map(([, name]) => name);

const { check, result } = createChecker();

async function main() {
  requireBuilds();
  const database = await startThrowawayPostgres("pages-e2e");
  const { pool, databaseUrl } = database;
  const children = [];
  try {
    await seedCatalog(pool);

    for (const mode of ["production", "development"]) {
      const port = await freePort();
      const apiPort = await freePort();
      const origin = `http://127.0.0.1:${port}`;
      // AUTH_ALLOWED_ORIGINS is fixed at start-up, so each mode gets its own API process.
      const api = start(process.execPath, ["dist/server.js"], {
        cwd: BACKEND,
        env: {
          ...process.env, NODE_ENV: "development", PORT: String(apiPort), DATABASE_URL: databaseUrl,
          JWT_SECRET: randomBytes(32).toString("hex"), ...ALL_POSTGRES,
          AUTH_COOKIE_SESSIONS: "true", AUTH_COOKIE_SECURE: "false", AUTH_ALLOWED_ORIGINS: origin,
          AUTH_RATE_LIMIT_LOGIN_PER_IP: "3", PROXY_CLIENT_IP_SECRET: PROXY_SECRET,
        },
      });
      const next = start(process.execPath, ["node_modules/next/dist/bin/next", mode === "production" ? "start" : "dev", "-p", String(port), "-H", "127.0.0.1"], {
        cwd: WEB,
        env: {
          ...process.env, NEXT_TELEMETRY_DISABLED: "1", BACKEND_ORIGIN: `http://127.0.0.1:${apiPort}`,
          // Simulates the hosting edge: here the test client plays the platform that sets x-real-ip.
          TRUSTED_CLIENT_IP_HEADER: "x-real-ip", PROXY_CLIENT_IP_SECRET: PROXY_SECRET,
        },
      });
      children.push(api, next);
      console.log(`\n-- ${mode}: ${origin} --`);
      try {
        await waitFor(`http://127.0.0.1:${apiPort}/`);
        await waitFor(`${origin}/login`);
        if (mode === "production") await productionChecks(origin, pool);
        else await developmentChecks(origin);
      } catch (error) {
        check(`${mode} run completed`, false, error.message);
        console.log(next.log().slice(-2000));
      } finally {
        await stop(next);
        await stop(api);
      }
    }
  } finally {
    for (const child of children) await stop(child);
    await database.stop();
  }

  console.log(`\n${result.passed}/${result.passed + result.failed} page checks passed`);
  if (result.failed > 0) process.exitCode = 1;
}


const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
const names = (html) => NAMES.filter((name) => html.includes(`>${name}<`));
/** The names if their first appearances in the HTML follow this order (all present), else null. */
const inOrder = (html, expected) => {
  const positions = expected.map((name) => html.indexOf(`>${name}<`));
  return positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])) ? expected : null;
};

async function imageChecks(origin, label) {
  const [, , file] = PRODUCTS[2];
  const original = readFileSync(path.join(VITE_IMAGES, "images/products", file));
  const staticImage = await request(`${origin}/images/products/${file}`, { raw: true });
  check(`${label}: product image served unchanged from public/`, staticImage.status === 200 && staticImage.headers["content-type"] === "image/jpeg" && staticImage.buffer.equals(original));
  const optimised = await request(`${origin}/_next/image?url=${encodeURIComponent(`/images/products/${file}`)}&w=384&q=75`, { raw: true, headers: { Accept: "image/webp,image/*" } });
  check(`${label}: optimised image (WebP, smaller than the 720 px original)`, optimised.status === 200 && optimised.headers["content-type"] === "image/webp" && optimised.buffer.length < original.length, `${optimised.status} ${optimised.headers["content-type"]} ${optimised.buffer.length} bytes`);
  const rating = await request(`${origin}/_next/image?url=${encodeURIComponent("/images/ratings/rating-45.png")}&w=256&q=75`, { raw: true, headers: { Accept: "image/webp,image/*" } });
  check(`${label}: rating image through the optimiser`, rating.status === 200);
}

async function productionChecks(origin, pool) {
  const home = await request(`${origin}/`);
  // React separates adjacent text with <!-- --> in server HTML.
  const homeText = home.text.replaceAll("<!-- -->", "");
  check("home: 200, server-rendered hero, categories and top-rated row from the catalogue", home.status === 200
    && home.text.includes(">Shop everyday essentials<") && homeText.includes(`${NAMES.length} products · 4 categories`)
    && home.text.includes('href="/products?category=Accessories"') && home.text.includes(">Top rated<"), String(home.status));
  // Every seeded product has the same rating, so the top four are decided by name.
  check("home: top rated ties broken by name", JSON.stringify(inOrder(home.text, ["Athletic Skateboard Shoes", "Bathroom Mat", "Espresso Maker", "Luxury Towel Set"])) !== "null"
    && !home.text.includes(">Straw Sunhat<"), "");
  check("home: product images use the optimiser (srcset)", home.text.includes("/_next/image?url=%2Fimages%2Fproducts%2F"));
  check("home: only the hero image is preloaded", (home.text.match(/rel="preload" as="image"/g) ?? []).length === 1, `${(home.text.match(/rel="preload" as="image"/g) ?? []).length}`);
  const legacy = await request(`${origin}/?q=towel&category=Home`);
  check("home: old listing links → 307 to /products with the same settings", legacy.status === 307 && legacy.headers.location === "/products?q=towel&category=Home", `${legacy.status} ${legacy.headers.location}`);
  const legacySort = await request(`${origin}/?sort=price-asc`);
  check("home: old ?sort= link → 307 to /products?sort=", legacySort.status === 307 && legacySort.headers.location === "/products?sort=price-asc", `${legacySort.status} ${legacySort.headers.location}`);

  const listing = await request(`${origin}/products`);
  check("listing: 200, server-rendered with every product", listing.status === 200 && names(listing.text).length === NAMES.length, `${names(listing.text).length}/${NAMES.length}`);
  const lazy = (listing.text.match(/loading="lazy"/g) ?? []).length;
  check("listing: first row preloaded, later images lazy", listing.text.includes('rel="preload"') && lazy >= NAMES.length - 4, `${lazy} lazy`);
  const byPrice = await request(`${origin}/products?sort=price-desc`);
  check("sort: ?sort=price-desc renders the dearest first (server HTML)", inOrder(byPrice.text, [...NAMES].reverse()) !== null, "");
  const byName = await request(`${origin}/products?category=Home&sort=name-asc`);
  check("sort: combined with a category", JSON.stringify(inOrder(byName.text, ["Bathroom Mat", "Luxury Towel Set"])) !== "null" && names(byName.text).length === 2);
  check("sort: works without JavaScript (GET form, selected option, <noscript> Apply button)",
    /<form[^>]*action="\/products"/.test(byPrice.text) && /<option value="price-desc" selected="">/.test(byPrice.text)
    && /<noscript><button[^>]*type="submit"[^>]*>Apply<\/button><\/noscript>/.test(byPrice.text));
  check("sort: canonical URL is the plain listing", /<link rel="canonical" href="[^"]*\/products"/.test(byPrice.text));
  const unknownSort = await request(`${origin}/products?sort=cheapest`);
  check("sort: an unknown value is ignored (200, catalogue order)", unknownSort.status === 200 && inOrder(unknownSort.text, NAMES) !== null);

  const search = await request(`${origin}/products?q=towel`);
  check("search: /products?q=towel lists only matches", search.status === 200 && JSON.stringify(names(search.text)) === JSON.stringify(["Luxury Towel Set"]));
  const category = await request(`${origin}/products?category=Accessories`);
  check("filter: /products?category=Accessories", JSON.stringify(names(category.text).sort()) === JSON.stringify(["Round Sunglasses", "Straw Sunhat"]));
  check("search results are not indexed", search.text.includes('name="robots" content="noindex, follow"'));

  const [id] = PRODUCTS[2];
  const detail = await request(`${origin}/products/${id}`);
  const canonicalHref = /<link rel="canonical" href="([^"]+)"/.exec(detail.text)?.[1] ?? "";
  check("product page: 200 with title, canonical URL, preview image and structured data",
    detail.status === 200 && titleOf(detail.text).startsWith("Espresso Maker") && canonicalHref.endsWith(`/products/${id}`)
    && detail.text.includes('property="og:image"') && detail.text.includes("application/ld+json"), canonicalHref);

  for (const [label, url, text] of [
    ["unknown product id", "/products/00000000-0000-4000-8000-000000000000", "Product not found"],
    ["malformed product id", "/products/not-a-product", "Product not found"],
    ["unknown page", "/no-such-page", "Page not found"],
  ]) {
    const response = await request(`${origin}${url}`);
    check(`404: ${label}`, response.status === 404 && response.text.includes(text), String(response.status));
  }

  await imageChecks(origin, "production");
  for (const [label, url] of [
    ["a query-string variant", `/images/products/${PRODUCTS[0][2]}?v=1`],
    ["a remote URL", "https://evil.example/x.jpg"],
    ["a path outside /images", "/_next/static/chunks/main.js"],
  ]) {
    const refused = await request(`${origin}/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`, { raw: true });
    check(`optimiser refuses ${label}`, refused.status === 400, String(refused.status));
  }
  check("unused images were not copied", (await request(`${origin}/images/products/2-slot-toaster-white.jpg`, { raw: true })).status === 404);

  // Register → sign in → account → sign out, as the browser does it (cookie jar, same origin).
  const browser = new CookieJar(undefined, { prefixSecurity: "strict" });
  const api = (method, apiPath, body, headers = {}) => request(`${origin}/api${apiPath}`, { method, body, jar: browser, headers: { Origin: origin, ...headers } });
  const email = `nora-${Date.now()}@example.com`;
  const created = await api("POST", "/auth/accounts", { name: "Nora", email, password: "nora-password-1" });
  check("register: 201, no cookie, no token", created.status === 201 && created.setCookies.length === 0 && !created.text.includes("token"));
  check("register: duplicate email is a 409", (await api("POST", "/auth/accounts", { name: "Nora", email, password: "nora-password-1" })).status === 409);

  const guard = await request(`${origin}/account`, { jar: browser });
  check("account: signed out → redirect to sign-in with return path", [303, 307, 308].includes(guard.status) && guard.headers.location?.includes("/login?from=%2Faccount"), `${guard.status} ${guard.headers.location}`);

  const signedIn = await api("POST", "/auth/session", { email, password: "nora-password-1" });
  check("sign in after registering", signedIn.status === 200 && (await browser.getCookies(origin)).length === 1);
  const account = await request(`${origin}/account`, { jar: browser });
  check("account page shows the profile (server-rendered with the session cookie)", account.status === 200 && account.text.includes("Your account") && account.text.includes(email));

  // Cart, checkout and orders through the real proxy and compiled API.
  const csrf = signedIn.json?.csrfToken ?? "";
  const added = await api("POST", "/cart-items", { productId: PRODUCTS[0][0], quantity: 2 }, { "X-CSRF-Token": csrf });
  check("cart: authenticated add with CSRF", added.status === 201 && added.json?.quantity === 2);
  const cart = await api("GET", "/cart-items?expand=product");
  check("cart: private no-store response and expanded product", cart.status === 200 && cart.json?.[0]?.product?.name === PRODUCTS[0][1]
    && cart.headers["cache-control"]?.includes("private") && cart.headers["cache-control"]?.includes("no-store"));
  check("cart page: authenticated direct URL", (await request(`${origin}/cart`, { jar: browser })).status === 200);
  check("checkout page: authenticated direct URL", (await request(`${origin}/checkout`, { jar: browser })).status === 200);

  // A second browser has its own empty cart and cannot access Nora's orders.
  const bob = new CookieJar(undefined, { prefixSecurity: "strict" });
  const bobApi = (method, apiPath, body, headers = {}) => request(`${origin}/api${apiPath}`, { method, body, jar: bob, headers: { Origin: origin, ...headers } });
  const bobEmail = `bob-${Date.now()}@example.com`;
  await bobApi("POST", "/auth/accounts", { name: "Bob", email: bobEmail, password: "bob-password-1" });
  const bobSession = await bobApi("POST", "/auth/session", { email: bobEmail, password: "bob-password-1" });
  check("two users: second user starts with a separate empty cart", bobSession.status === 200 && (await bobApi("GET", "/cart-items")).json?.length === 0);

  const checkoutKey = randomUUID();
  const place = () => api("POST", "/orders", { customer: { fullName: "Nora", email, phone: "07123", address: "1 High Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" } }, { "X-CSRF-Token": csrf, "Idempotency-Key": checkoutKey });
  const placed = await Promise.all([place(), place(), place()]);
  const orderIds = placed.map((response) => response.json?.id);
  check("checkout: simultaneous same-key requests create/replay one order", placed.every((response) => response.status === 201) && new Set(orderIds).size === 1, JSON.stringify(placed.map((response) => response.status)));
  const orderId = orderIds[0];
  const orderRows = await pool.query("SELECT count(*)::int AS count FROM orders WHERE checkout_key = $1", [checkoutKey]);
  check("checkout: exactly one database order for the key", orderRows.rows[0]?.count === 1);
  const reused = await api("POST", "/orders", { customer: { fullName: "Nora", email, phone: "07123", address: "9 Other Road", city: "London", postalCode: "N1 1AA", country: "United Kingdom" } }, { "X-CSRF-Token": csrf, "Idempotency-Key": checkoutKey });
  check("checkout: the key reused with different details is refused (422), nothing added", reused.status === 422
    && (await pool.query("SELECT count(*)::int AS count FROM orders WHERE customer_email = lower($1)", [email])).rows[0]?.count === 1, String(reused.status));
  const orders = await api("GET", "/orders?expand=products");
  check("orders: owner sees stored snapshot and private no-store response", orders.status === 200 && orders.json?.[0]?.products?.[0]?.product?.priceCents === 1000
    && orders.headers["cache-control"]?.includes("no-store"));
  const orderPage = await request(`${origin}/orders/${orderId}?placed=1`, { jar: browser });
  check("order detail: owner gets server-checked page", orderPage.status === 200 && orderPage.text.includes("Order details") && orderPage.text.includes(String(orderId)));
  const guessed = await request(`${origin}/orders/${orderId}`, { jar: bob });
  check("order detail: another user gets a real 404", guessed.status === 404 && guessed.text.includes("Order not found"), String(guessed.status));

  // Package tracking (the Vite /tracking page): owner only, server-checked.
  const trackingPath = `/tracking?orderId=${orderId}&productId=${PRODUCTS[0][0]}`;
  const tracking = await request(`${origin}${trackingPath}`, { jar: browser });
  check("tracking: owner sees the package and its progress", tracking.status === 200 && tracking.text.includes("Arriving on") && tracking.text.includes('role="progressbar"'), String(tracking.status));
  check("tracking: another user gets a real 404", (await request(`${origin}${trackingPath}`, { jar: bob })).status === 404);
  const trackingSignedOut = await request(`${origin}${trackingPath}`);
  check("tracking: signed out → sign-in with the full return path", trackingSignedOut.status === 307
    && trackingSignedOut.headers.location?.includes(`from=${encodeURIComponent(trackingPath)}`), `${trackingSignedOut.status} ${trackingSignedOut.headers.location}`);

  // Authenticated HTML is never stored by browsers or shared caches.
  for (const pagePath of ["/account", "/cart", "/checkout", "/orders", `/orders/${orderId}`, trackingPath]) {
    const page = await request(`${origin}${pagePath}`, { jar: browser });
    check(`private page ${pagePath.split("?")[0]}: Cache-Control no-store`, page.status === 200 && /no-store/.test(page.headers["cache-control"] ?? "") && !/public|s-maxage/.test(page.headers["cache-control"] ?? ""), `${page.status} ${page.headers["cache-control"]}`);
  }

  // Admin (Phase 5G): role checks on the pages and the API, private responses,
  // catalogue refresh after a product change, audited status changes.
  check("admin page: signed out → sign-in with return path", (await request(`${origin}/admin`)).headers.location?.includes("/login?from=%2Fadmin"));
  check("admin page: a customer gets a 404", (await request(`${origin}/admin/orders`, { jar: browser })).status === 404);
  check("admin API: a customer cannot create products (403)", (await api("POST", "/products", { name: "x" }, { "X-CSRF-Token": csrf })).status === 403);
  check("admin API: a customer cannot change order status (403)", (await api("PATCH", `/orders/${orderId}/status`, { status: "processing", reason: "x" }, { "X-CSRF-Token": csrf })).status === 403);
  check("admin API: a customer cannot read the order history (403)", (await api("GET", `/orders/${orderId}/status-events`)).status === 403);

  const admin = new CookieJar(undefined, { prefixSecurity: "strict" });
  const adminApi = (method, apiPath, body, headers = {}) => request(`${origin}/api${apiPath}`, { method, body, jar: admin, headers: { Origin: origin, ...headers } });
  const adminEmail = `admin-${Date.now()}@example.com`;
  await adminApi("POST", "/auth/accounts", { name: "Ada Admin", email: adminEmail, password: "admin-password-1" });
  await pool.query("UPDATE users SET is_admin = true WHERE email = $1", [adminEmail]);
  const adminCsrf = (await adminApi("POST", "/auth/session", { email: adminEmail, password: "admin-password-1" })).json?.csrfToken ?? "";
  for (const adminPath of ["/admin", "/admin/products", "/admin/products/new", `/admin/products/${PRODUCTS[0][0]}`, "/admin/orders", `/admin/orders/${orderId}`]) {
    const page = await request(`${origin}${adminPath}`, { jar: admin });
    check(`admin page ${adminPath.replace(/[0-9a-f-]{36}/, ":id")}: 200, private, noindex`, page.status === 200 && /no-store/.test(page.headers["cache-control"] ?? "")
      && page.text.includes('name="robots" content="noindex, nofollow"'), `${page.status} ${page.headers["cache-control"]}`);
  }
  const dashboard = await request(`${origin}/admin`, { jar: admin });
  check("admin dashboard shows live counts", dashboard.text.includes(">Products<") && dashboard.text.includes(`>${PRODUCTS.length}<`));

  await request(`${origin}/`); // fill the storefront's 60 s catalogue cache
  const lamp = await adminApi("POST", "/products", {
    name: "E2E Lamp", price: "12.34", category: "Home", stock: "3", image: "images/products/luxury-towel-set.jpg",
    description: "A lamp.", howItWorks: "Switch it on.", highlights: "Warm light", careInstructions: "Dust it.", keywords: "lamp, light",
  }, { "X-CSRF-Token": adminCsrf });
  check("admin creates a product with keywords through the proxy", lamp.status === 201 && JSON.stringify(lamp.json?.keywords) === '["lamp","light"]'
    && /no-store/.test(lamp.headers["cache-control"] ?? ""));
  const refreshed = await request(`${origin}/products?q=light`);
  check("the storefront shows the new product at once (catalogue cache refreshed), found by its keyword", refreshed.text.includes(">E2E Lamp<"));
  const edited = await adminApi("PUT", `/products/${lamp.json?.id}`, {
    name: "E2E Lamp", price: "15.00", category: "Home", stock: "3", image: "images/products/luxury-towel-set.jpg",
    description: "A lamp.", howItWorks: "Switch it on.", highlights: "Warm light", careInstructions: "Dust it.",
  }, { "X-CSRF-Token": adminCsrf });
  check("an edit without keywords keeps them", edited.status === 200 && JSON.stringify(edited.json?.keywords) === '["lamp","light"]' && edited.json?.priceCents === 1500);
  check("admin deletes the product; the storefront drops it at once",
    (await adminApi("DELETE", `/products/${lamp.json?.id}`, undefined, { "X-CSRF-Token": adminCsrf })).status === 200
    && !(await request(`${origin}/`)).text.includes(">E2E Lamp<"));

  check("status change without a reason is refused (400)", (await adminApi("PATCH", `/orders/${orderId}/status`, { status: "processing", reason: " " }, { "X-CSRF-Token": adminCsrf })).status === 400);
  check("a skipped transition is refused (409)", (await adminApi("PATCH", `/orders/${orderId}/status`, { status: "delivered", reason: "skip" }, { "X-CSRF-Token": adminCsrf })).status === 409);
  const moved = await adminApi("PATCH", `/orders/${orderId}/status`, { status: "processing", reason: "Packed" }, { "X-CSRF-Token": adminCsrf });
  const events = await adminApi("GET", `/orders/${orderId}/status-events`);
  check("admin status change is audited with the reason and keeps the total", moved.status === 200 && moved.json?.totalCostCents === orders.json?.[0]?.totalCostCents
    && events.json?.at(-1)?.reason === "Packed" && events.json?.at(-1)?.changedBy?.name === "Ada Admin" && /no-store/.test(events.headers["cache-control"] ?? ""));
  check("'Your orders' for an admin lists only their own orders", (await adminApi("GET", "/orders?scope=own")).json?.length === 0
    && (await adminApi("GET", "/orders")).json?.some((item) => item.id === orderId));
  check("admin signs out cleanly", (await adminApi("DELETE", "/auth/session", undefined, { "X-CSRF-Token": adminCsrf })).status === 204);

  const bobSignedOut = await bobApi("DELETE", "/auth/session", undefined, { "X-CSRF-Token": bobSession.json?.csrfToken ?? "" });
  check("second user signs out cleanly", bobSignedOut.status === 204);

  const signedOut = await api("DELETE", "/auth/session", undefined, { "X-CSRF-Token": csrf });
  check("sign out (CSRF-protected)", signedOut.status === 204 && (await browser.getCookies(origin)).length === 0);
  const after = await request(`${origin}/account`, { jar: browser });
  check("account after sign-out redirects again", [303, 307, 308].includes(after.status));
  const { rows: [sessions] } = await pool.query("SELECT count(*)::int AS live FROM auth_sessions WHERE revoked_at IS NULL");
  check("no live session left in the database", sessions.live === 0);

  // Rate limiting per client address through the proxy (x-real-ip as the platform would set it).
  const attempt = (ip, n) => request(`${origin}/api/auth/login`, { method: "POST", body: { email: `brute${n}@example.com`, password: "wrong-password-1" }, headers: { "X-Real-IP": ip } });
  const statuses = [];
  for (let n = 0; n < 4; n += 1) statuses.push((await attempt("203.0.113.10", n)).status);
  const other = await attempt("203.0.113.20", 99);
  check("per-address login limit through the proxy (4th attempt → 429)", JSON.stringify(statuses) === "[401,401,401,429]", JSON.stringify(statuses));
  check("another client address is not affected", other.status === 401);
  const spoofed = await request(`${origin}/api/auth/login`, { method: "POST", body: { email: "spoof@example.com", password: "wrong-password-1" }, headers: { "X-Real-IP": "203.0.113.10", "X-Client-IP": "198.51.100.1", "X-Proxy-Secret": "guess" } });
  check("client-supplied X-Client-IP/X-Proxy-Secret do not bypass the limit", spoofed.status === 429);

  const foreign = await request(`${origin}/api/products`, { headers: { Origin: "https://evil.example" } });
  check("rejected origin through the proxy: JSON 403", foreign.status === 403 && foreign.json?.message === "Origin not allowed");

  // Vite routes whose job moved, and crawler files.
  for (const [from, to] of [["/order-confirmation", "/checkout"], ["/product-unavailable", "/orders"]]) {
    const moved = await request(`${origin}${from}`);
    check(`legacy ${from} → temporary redirect to ${to}`, moved.status === 307 && moved.headers.location === to, `${moved.status} ${moved.headers.location}`);
  }
  const robots = await request(`${origin}/robots.txt`);
  check("robots.txt keeps crawlers out of private pages and the API", robots.status === 200
    && ["/api/", "/account", "/cart", "/checkout", "/orders", "/tracking", "/admin"].every((path) => robots.text.includes(`Disallow: ${path}`)), robots.text);
  const sitemap = await request(`${origin}/sitemap.xml`);
  // NEXT_PUBLIC_SITE_URL is inlined at build time and this build has none: a
  // valid, empty sitemap and no Sitemap line (the listed case is a unit test).
  check("sitemap.xml without a public origin: valid and empty", sitemap.status === 200 && sitemap.text.includes("<urlset") && !sitemap.text.includes("<loc>")
    && !robots.text.includes("Sitemap:"), `${sitemap.status}`);
}

async function developmentChecks(origin) {
  const home = await request(`${origin}/`);
  check("dev: home renders", home.status === 200 && home.text.includes(">Shop everyday essentials<"), `${home.status}`);
  const listing = await request(`${origin}/products`);
  check("dev: listing renders every product", listing.status === 200 && names(listing.text).length === NAMES.length, `${listing.status} ${names(listing.text).length}`);
  const [id] = PRODUCTS[0];
  check("dev: product page", (await request(`${origin}/products/${id}`)).status === 200);
  check("dev: unknown page is a 404", (await request(`${origin}/no-such-page`)).status === 404);
  await imageChecks(origin, "development");
}

main().catch((error) => {
  console.error(`PAGES E2E FAILED: ${error.message}`);
  process.exitCode = 1;
});
