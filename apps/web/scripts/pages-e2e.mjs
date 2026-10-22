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
  check("home: 200, server-rendered with every product", home.status === 200 && names(home.text).length === NAMES.length, `${names(home.text).length}/${NAMES.length}`);
  check("home: product images use the optimiser (srcset)", home.text.includes("/_next/image?url=%2Fimages%2Fproducts%2F"));
  const lazy = (home.text.match(/loading="lazy"/g) ?? []).length;
  check("home: first row preloaded, later images lazy", home.text.includes('rel="preload"') && lazy >= NAMES.length - 4, `${lazy} lazy`);

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
    && ["/api/", "/account", "/cart", "/checkout", "/orders", "/tracking"].every((path) => robots.text.includes(`Disallow: ${path}`)), robots.text);
  const sitemap = await request(`${origin}/sitemap.xml`);
  // NEXT_PUBLIC_SITE_URL is inlined at build time and this build has none: a
  // valid, empty sitemap and no Sitemap line (the listed case is a unit test).
  check("sitemap.xml without a public origin: valid and empty", sitemap.status === 200 && sitemap.text.includes("<urlset") && !sitemap.text.includes("<loc>")
    && !robots.text.includes("Sitemap:"), `${sitemap.status}`);
}

async function developmentChecks(origin) {
  const home = await request(`${origin}/`);
  check("dev: home renders every product", home.status === 200 && names(home.text).length === NAMES.length, `${home.status} ${names(home.text).length}`);
  const [id] = PRODUCTS[0];
  check("dev: product page", (await request(`${origin}/products/${id}`)).status === 200);
  check("dev: unknown page is a 404", (await request(`${origin}/no-such-page`)).status === 404);
  await imageChecks(origin, "development");
}

main().catch((error) => {
  console.error(`PAGES E2E FAILED: ${error.message}`);
  process.exitCode = 1;
});
