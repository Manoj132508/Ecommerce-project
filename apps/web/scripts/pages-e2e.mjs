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
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import {
  ALL_POSTGRES, BACKEND, createChecker, freePort, request, requireBuilds, start, startThrowawayPostgres, stop, waitFor, WEB,
} from "./e2e-support.mjs";

const VITE_IMAGES = path.resolve(WEB, "../../ecommerce-project/public");
const PROXY_SECRET = randomBytes(24).toString("hex");
const PRODUCTS = [
  ["e43638ce-6aa0-4b85-b27f-e1d07eb678c6", "Athletic Skateboard Shoes", "athletic-skateboard-shoes-gray.jpg", "Footwear", "{shoes,sports}"],
  ["15b6fc6f-327a-4ec4-896f-486349e85a3d", "Luxury Towel Set", "luxury-towel-set.jpg", "Home", "{bathroom,towels}"],
  ["83d4ca15-0f35-48f5-b7a3-1ea210004f2e", "Espresso Maker", "black-and-silver-espresso-maker.jpg", "Kitchen", "{coffee,appliances}"],
  ["54e0eccd-8f36-462b-b68a-8182611d9add", "Round Sunglasses", "round-sunglasses-gold.jpg", "Accessories", "{sunglasses}"],
  ["3ebe75dc-64d2-4137-8860-1f5a963e534b", "Straw Sunhat", "straw-sunhat.jpg", "Accessories", "{hats,summer}"],
  ["5968897c-4d33-4aa0-9c5b-f7e1d8b7fc43", "Bathroom Mat", "bathroom-mat.jpg", "Home", "{bathroom}"],
];
const NAMES = PRODUCTS.map(([, name]) => name);

const { check, result } = createChecker();

async function main() {
  requireBuilds();
  const database = await startThrowawayPostgres("pages-e2e");
  const { pool, databaseUrl } = database;
  const children = [];
  try {
    await pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0)");
    for (const [index, [id, name, file, category, keywords]] of PRODUCTS.entries()) {
      await pool.query(
        `INSERT INTO products (id, image, name, description, how_it_works, highlights, care_instructions, category,
                               stock, rating_stars, rating_count, price_cents, keywords, created_at)
         VALUES ($1, $2, $3, $4, 'Use it.', '{Durable}', 'Keep clean.', $5, 0, 4.5, 10, $6, $7, now() + make_interval(secs => $8))`,
        [id, `images/products/${file}`, name, `${name} description.`, category, 1000 + index * 250, keywords, index],
      );
    }

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

  const signedOut = await api("DELETE", "/auth/session", undefined, { "X-CSRF-Token": signedIn.json?.csrfToken ?? "" });
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
