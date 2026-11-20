// Container integration checks for docker/compose.yaml (docs/DOCKER_SETUP.md).
// Runs against the RUNNING stack, through the storefront's published origin only,
// as a browser would: every /api call goes through the Next.js same-origin proxy.
// In-container facts (health endpoints, database rows) come from `docker compose exec`.
// Needs the stack up and the seed loaded. Uses only throwaway accounts it creates.
//
//   node docker/test/container-integration.mjs            # functional checks
//   node docker/test/container-integration.mjs --restart  # plus graceful stop/restart checks
//
// Prints PASS/FAIL per check and exits 1 on any failure. Never prints cookie or token values.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ORIGIN = process.env.STACK_ORIGIN ?? "http://localhost:8080";
const COMPOSE = ["compose", "-f", fileURLToPath(new URL("../compose.yaml", import.meta.url))];
const RUN = Date.now().toString(36);
const PASSWORD = "container-test-password-1";
const TRACKED_PRODUCT = "5968897c-4d33-4aa0-9c5b-f7e1d8b7fc43"; // seed: 2 in stock, inventory tracked
const PRODUCT = "15b6fc6f-327a-4ec4-896f-486349e85a3d";
const CUSTOMER = { fullName: "Test Customer", email: "customer@example.com", phone: "0123 456 789", address: "1 Test Street", city: "London", postalCode: "N1 1AA", country: "United Kingdom" };

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? ` - ${detail}` : ""}`);
};

const docker = (args, input) => execFileSync("docker", [...COMPOSE, ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
const sql = (query) => docker(["exec", "-T", "postgres", "psql", "-U", "ecommerce", "-d", "ecommerce", "-Atc", query]).trim();
const inApi = (path) => {
  const script = `fetch('http://127.0.0.1:4000${path}').then(async r=>console.log(r.status, (await r.text()).slice(0,200)),e=>console.log('ERR',e.message))`;
  return docker(["exec", "-T", "api", "/nodejs/bin/node", "-e", script]).trim();
};

/** One browser tab: keeps the session cookie the server sets, sends it back like a browser. */
function browser() {
  const cookies = new Map();
  let csrf;
  const call = async (method, path, { body, headers = {}, origin = ORIGIN } = {}) => {
    const response = await fetch(ORIGIN + path, {
      method,
      redirect: "manual",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(origin ? { Origin: origin } : {}),
        ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(";");
      const [name, ...rest] = pair.split("=");
      const value = rest.join("=");
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || value === "") cookies.delete(name.trim()); else cookies.set(name.trim(), value);
    }
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (json?.csrfToken) csrf = json.csrfToken;
    return { status: response.status, headers: response.headers, text, json };
  };
  return {
    call,
    write: (method, path, body, headers = {}) => call(method, path, { body, headers: { "X-CSRF-Token": csrf ?? "", ...headers } }),
    get cookieNames() { return [...cookies.keys()]; },
    get cookieValues() { return [...cookies.values()]; },
  };
}

async function signUp(label) {
  const tab = browser();
  const email = `${label}-${RUN}@example.com`;
  const created = await tab.call("POST", "/api/auth/accounts", { body: { name: `Test ${label}`, email, password: PASSWORD } });
  const session = await tab.call("POST", "/api/auth/session", { body: { email, password: PASSWORD } });
  return { tab, email, created, session };
}

// --- Containers and health -------------------------------------------------------------
const ps = docker(["ps", "--format", "{{.Service}} {{.State}} {{.Health}}"]);
for (const service of ["postgres", "api", "web"]) {
  check(`container ${service} running and healthy`, new RegExp(`^${service} running healthy$`, "m").test(ps), ps);
}
check("API /healthz answers inside the container", inApi("/healthz").startsWith("200"));
check("API /readyz: database reachable", inApi("/readyz").startsWith("200"));
const published = docker(["ps", "--format", "{{.Ports}}"]).match(/[^\s,]+->\d+\/tcp/g) ?? [];
check("only the storefront is published, on 127.0.0.1 (API and database not)", published.length > 0 && published.every((p) => /^127\.0\.0\.1:\d+->3000\/tcp$/.test(p)), published.join(" "));
check("migrations: 6 applied, recorded once each", sql("SELECT count(*), count(DISTINCT version) FROM schema_migrations") === "6|6");

// --- Pages, CSP and security headers ---------------------------------------------------
const home = await fetch(`${ORIGIN}/`);
const homeHtml = await home.text();
const csp = home.headers.get("content-security-policy") ?? "";
const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
const scriptNonces = [...homeHtml.matchAll(/<script[^>]*\snonce="([^"]+)"/g)].map((m) => m[1]);
check("home page 200, server-rendered with the catalogue", home.status === 200 && homeHtml.includes("Luxury Towel Set"));
check("CSP: nonce + strict-dynamic, no unsafe-eval in production", Boolean(nonce) && csp.includes("'strict-dynamic'") && !csp.includes("unsafe-eval"), csp);
check("every <script> carries this response's nonce", scriptNonces.length > 0 && scriptNonces.every((n) => n === nonce), `${scriptNonces.length} scripts`);
const second = await fetch(`${ORIGIN}/`);
check("a fresh nonce per response", /'nonce-([^']+)'/.exec(second.headers.get("content-security-policy") ?? "")?.[1] !== nonce);
check("security headers: nosniff, DENY, no X-Powered-By", home.headers.get("x-content-type-options") === "nosniff" && home.headers.get("x-frame-options") === "DENY" && !home.headers.has("x-powered-by"));
const search = await (await fetch(`${ORIGIN}/products?q=sun`)).text();
check("product search /products?q=sun lists only matching products", search.includes("Round Sunglasses") && search.includes("Straw Sunhat") && !search.includes("Luxury Towel Set"));
const details = await fetch(`${ORIGIN}/products/${PRODUCT}`);
check("product details page", details.status === 200 && (await details.text()).includes("Six soft cotton towels."));
const missing = await fetch(`${ORIGIN}/products/${randomUUID()}`);
check("unknown product: 404 page", missing.status === 404);
const image = await fetch(`${ORIGIN}/_next/image?url=%2Fimages%2Fproducts%2Fluxury-towel-set.jpg&w=640&q=75`);
check("image optimiser serves catalogue photos (sharp in the image)", image.status === 200 && /image\//.test(image.headers.get("content-type") ?? ""));
const remoteImage = await fetch(`${ORIGIN}/_next/image?url=https%3A%2F%2Fexample.com%2Fx.jpg&w=640&q=75`);
check("image optimiser refuses remote hosts", remoteImage.status >= 400);

// --- API through the same-origin proxy -------------------------------------------------
const products = await fetch(`${ORIGIN}/api/products`);
check("GET /api/products via the proxy", products.status === 200 && (await products.json()).length >= 6);
const notFound = await fetch(`${ORIGIN}/api/does-not-exist`);
const notFoundBody = await notFound.text();
check("unknown API route: JSON 404 without stack trace", notFound.status === 404 && notFoundBody.startsWith("{") && !/at .*\.js:\d+/.test(notFoundBody));
const malformed = await fetch(`${ORIGIN}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: "{not json" });
const malformedBody = await malformed.text();
check("malformed JSON: 400 JSON, no stack or parser detail", malformed.status === 400 && !/SyntaxError|at JSON|node_modules/.test(malformedBody), malformedBody.slice(0, 120));
const traversal = await fetch(`${ORIGIN}/api/..%2f..%2fetc%2fpasswd`);
check("encoded traversal on /api refused", traversal.status >= 400 && traversal.status < 500);

// --- Accounts, sessions, CSRF ----------------------------------------------------------
const alice = await signUp("alice");
check("register: 201", alice.created.status === 201, `${alice.created.status} ${alice.created.text.slice(0, 120)}`);
check("sign in: 200 with CSRF token, session cookie set, no token in the body",
  alice.session.status === 200 && typeof alice.session.json?.csrfToken === "string" && alice.tab.cookieNames.join() === "ecom_dev_session"
  && !alice.tab.cookieValues.some((v) => alice.session.text.includes(v)));
const duplicate = await browser().call("POST", "/api/auth/accounts", { body: { name: "Dup", email: alice.email, password: PASSWORD } });
check("register an existing email: 409", duplicate.status === 409);
const wrong = browser();
check("wrong password: 401, no cookie", (await wrong.call("POST", "/api/auth/session", { body: { email: alice.email, password: "wrong-password-9" } })).status === 401 && wrong.cookieNames.length === 0);
check("session check", (await alice.tab.call("GET", "/api/auth/session")).json?.user?.email === alice.email);
check("cart write without CSRF token: 403", (await alice.tab.call("POST", "/api/cart-items", { body: { productId: PRODUCT, quantity: 1 } })).status === 403);
check("cart write from a foreign Origin: refused", (await alice.tab.call("POST", "/api/cart-items", { body: { productId: PRODUCT, quantity: 1 }, origin: "https://evil.example", headers: { "X-CSRF-Token": alice.session.json?.csrfToken ?? "" } })).status === 403);
check("cart write without Origin: 403", (await alice.tab.call("POST", "/api/cart-items", { body: { productId: PRODUCT, quantity: 1 }, origin: null, headers: { "X-CSRF-Token": alice.session.json?.csrfToken ?? "" } })).status === 403);

// --- Cart, delivery, checkout, idempotency ---------------------------------------------
check("add to cart: 201", (await alice.tab.write("POST", "/api/cart-items", { productId: PRODUCT, quantity: 2 })).status === 201);
check("choose delivery option 2", (await alice.tab.write("PUT", `/api/cart-items/${PRODUCT}`, { deliveryOptionId: "2" })).status === 200);
const summary = await alice.tab.call("GET", "/api/payment-summary");
check("payment summary: 2 items, 4.99 shipping", summary.json?.totalItems === 2 && summary.json?.shippingCostCents === 499, summary.text.slice(0, 160));
const key = randomUUID();
const attempts = await Promise.all(Array.from({ length: 5 }, () => alice.tab.write("POST", "/api/orders", { customer: CUSTOMER }, { "Idempotency-Key": key })));
const orderIds = new Set(attempts.filter((a) => a.status === 201).map((a) => a.json?.id));
check("5 simultaneous checkouts with one Idempotency-Key: one order", orderIds.size === 1 && attempts.every((a) => a.status === 201 || a.status === 409), attempts.map((a) => a.status).join(","));
const [orderId] = orderIds;
check("exactly one order row for that key", sql(`SELECT count(*) FROM orders WHERE user_id = (SELECT id FROM users WHERE email = '${alice.email}')`) === "1");
check("cart emptied after checkout", (await alice.tab.call("GET", "/api/cart-items")).json?.length === 0);
// A key replays the request it was first used with (the customer details are the request body).
await alice.tab.write("POST", "/api/cart-items", { productId: PRODUCT, quantity: 1 });
const replayed = await alice.tab.write("POST", "/api/orders", { customer: CUSTOMER }, { "Idempotency-Key": key });
check("same key, same details: replays the original order, places nothing new",
  replayed.status === 201 && replayed.json?.id === [...orderIds][0] && (await alice.tab.call("GET", "/api/cart-items")).json?.length === 1);
const reused = await alice.tab.write("POST", "/api/orders", { customer: { ...CUSTOMER, city: "Leeds" } }, { "Idempotency-Key": key });
check("same key, different details: 422", reused.status === 422, `${reused.status}`);
await alice.tab.write("DELETE", `/api/cart-items/${PRODUCT}`);
check("orders list and order details", (await alice.tab.call("GET", "/api/orders")).json?.length === 1 && (await alice.tab.call("GET", `/api/orders/${orderId}`)).status === 200);
const tracking = await fetch(`${ORIGIN}/tracking?orderId=${orderId}&productId=${PRODUCT}`, { headers: { Cookie: `ecom_dev_session=${alice.tab.cookieValues[0]}` }, redirect: "manual" });
check("tracking page for the owner", tracking.status === 200 && (await tracking.text()).includes("Luxury Towel Set"));

// --- Ownership isolation ---------------------------------------------------------------
const bob = await signUp("bob");
check("second customer signs in", bob.session.status === 200);
check("Bob cannot read Alice's order (404)", (await bob.tab.call("GET", `/api/orders/${orderId}`)).status === 404);
check("Bob sees no orders and an empty cart", (await bob.tab.call("GET", "/api/orders")).json?.length === 0 && (await bob.tab.call("GET", "/api/cart-items")).json?.length === 0);
check("Bob cannot use admin endpoints (403)", (await bob.tab.write("PATCH", `/api/orders/${orderId}/status`, { status: "processing", reason: "x" })).status === 403);
check("signed out: orders 401", (await browser().call("GET", "/api/orders")).status === 401);

// --- Stock protection under concurrency ------------------------------------------------
const carol = await signUp("carol");
await bob.tab.write("POST", "/api/cart-items", { productId: TRACKED_PRODUCT, quantity: 2 });
await carol.tab.write("POST", "/api/cart-items", { productId: TRACKED_PRODUCT, quantity: 2 });
const stockBefore = Number(sql(`SELECT stock FROM products WHERE id = '${TRACKED_PRODUCT}'`));
const race = await Promise.all([bob, carol].map((who) => who.tab.write("POST", "/api/orders", { customer: CUSTOMER }, { "Idempotency-Key": randomUUID() })));
const statuses = race.map((r) => r.status).sort().join(",");
const stockAfter = Number(sql(`SELECT stock FROM products WHERE id = '${TRACKED_PRODUCT}'`));
if (stockBefore >= 2) {
  check("2 in stock, 2 customers buy 2 at once: one 201, one 409", statuses === (stockBefore >= 4 ? "201,201" : "201,409"), statuses);
  check("stock decremented exactly once, never negative", stockAfter === stockBefore - 2 * race.filter((r) => r.status === 201).length && stockAfter >= 0, `${stockBefore} -> ${stockAfter}`);
} else {
  check("tracked product sold out (earlier run): both refused with 409, stock unchanged", statuses === "409,409" && stockAfter === stockBefore, `${statuses}, stock ${stockAfter}`);
}

// --- Admin -------------------------------------------------------------------------------
const admin = await signUp("admin");
sql(`UPDATE users SET is_admin = true WHERE email = '${admin.email}'`);
const adminTab = browser();
await adminTab.call("POST", "/api/auth/session", { body: { email: admin.email, password: PASSWORD } });
const form = { name: `Container Kettle ${RUN}`, price: "19.99", description: "Boils.", howItWorks: "Fill.", highlights: "1.7 l, Auto off", careInstructions: "Descale.", image: "images/products/luxury-towel-set.jpg", category: "Kitchen", stock: "12" };
const created = await adminTab.write("POST", "/api/products", form);
check("admin creates a product", created.status === 201, `${created.status} ${created.text.slice(0, 120)}`);
const createdId = created.json?.id ?? created.json?._id;
check("admin updates it", (await adminTab.write("PUT", `/api/products/${createdId}`, { ...form, name: `${form.name} 2` })).status === 200);
const listing = await (await fetch(`${ORIGIN}/products?q=${encodeURIComponent(`Container Kettle ${RUN} 2`)}`)).text();
check("storefront shows the change at once (catalogue cache revalidated)", listing.includes(`Container Kettle ${RUN} 2`));
check("admin changes an order status with a reason", (await adminTab.write("PATCH", `/api/orders/${orderId}/status`, { status: "processing", reason: "Container test" })).status === 200);
check("status history recorded", Number(sql(`SELECT count(*) FROM order_status_events WHERE order_id = '${orderId}'`)) >= 1);
check("admin deletes the product", (await adminTab.write("DELETE", `/api/products/${createdId}`)).status === 200);
const adminPage = await fetch(`${ORIGIN}/admin`, { redirect: "manual" });
check("admin pages need a signed-in admin (signed out: redirect)", [302, 303, 307, 308].includes(adminPage.status));

// --- Sign-out and logs ---------------------------------------------------------------
const stolen = alice.tab.cookieValues[0];
check("sign out: 204, cookie dropped", (await alice.tab.write("DELETE", "/api/auth/session")).status === 204 && alice.tab.cookieNames.length === 0);
const replay = await fetch(`${ORIGIN}/api/orders`, { headers: { Cookie: `ecom_dev_session=${stolen}` } });
check("a copied session cookie stops working after sign-out", replay.status === 401);
const logs = docker(["logs", "--no-color", "api", "web"]);
check("no session token, password or JWT secret in the container logs", !logs.includes(stolen) && !logs.includes(PASSWORD) && !/JWT_SECRET=|POSTGRES_PASSWORD=/.test(logs));
check("sessions stored hashed (no raw token in the database)", sql(`SELECT count(*) FROM auth_sessions WHERE token_hash = '${stolen}'`) === "0");

// --- Graceful shutdown and restart (optional, --restart) -----------------------------------
if (process.argv.includes("--restart")) {
  try {
    // Bob's cart depends on whether he won the stock race above: compare it with itself.
    const bobCartBefore = JSON.stringify((await bob.tab.call("GET", "/api/cart-items")).json?.map((line) => [line.productId, line.quantity]));
    const ordersBefore = sql("SELECT count(*) FROM orders");
    const since = new Date().toISOString();
    docker(["stop", "api"]);
    const exitCode = execFileSync("docker", ["inspect", "-f", "{{.State.ExitCode}}", docker(["ps", "-aq", "api"]).trim()], { encoding: "utf8" }).trim();
    const shutdownLog = docker(["logs", "--no-color", "--since", since, "api"]);
    check("API stops on SIGTERM with exit code 0 (clean drain)", exitCode === "0", `exit ${exitCode}: ${shutdownLog.slice(-300)}`);
    // web lives in the API's network namespace, so it is restarted with the API. Newer Compose does
    // that itself (depends_on restart: true); restarting it explicitly works on every version.
    docker(["restart", "api"]);
    docker(["restart", "web"]);
    docker(["up", "-d", "--wait"]);
    const after = browser();
    const back = await after.call("POST", "/api/auth/session", { body: { email: bob.email, password: PASSWORD } });
    const bobCartAfter = JSON.stringify((await after.call("GET", "/api/cart-items")).json?.map((line) => [line.productId, line.quantity]));
    check("after an API restart: data kept, Bob signs in, his cart unchanged", back.status === 200 && bobCartAfter === bobCartBefore, `${back.status} ${bobCartBefore} -> ${bobCartAfter}`);
    docker(["restart", "postgres"]);
    docker(["up", "-d", "--wait"]);
    check("after a database restart: API ready again, orders intact", inApi("/readyz").startsWith("200") && sql("SELECT count(*) FROM orders") === ordersBefore, `orders ${ordersBefore} -> ${sql("SELECT count(*) FROM orders")}`);
  } catch (error) {
    check("restart sequence completed", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
