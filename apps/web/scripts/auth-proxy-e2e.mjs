// End-to-end check of cookie sessions through the Next.js /api proxy.
//
//   Real `next start` (apps/web, built) → real Express (ecommerce-backend/dist)
//   → a throwaway PostgreSQL container that is removed afterwards.
//
// Two scenarios:
//   1. Local development: http://127.0.0.1, ecom_dev_session cookie (no Secure).
//   2. HTTPS-equivalent: a local TLS terminator in front of Next.js (as Vercel
//      terminates TLS), https://localhost, __Host-ecom_session (Secure).
// A tough-cookie jar with strict prefix rules stands in for the browser:
// host-only scope, Secure, __Host- rules and expiry are applied as a browser would.
//
// Prerequisites: Docker running; `npm run build` in ecommerce-backend and in
// apps/web; openssl on PATH (Git for Windows ships one).
// Never touches the development or production databases.
//
//   npm run test:e2e        (from apps/web)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import path from "node:path";
import { CookieJar } from "tough-cookie";
import {
  ALL_POSTGRES, BACKEND, backendRequire, createChecker, freePort, opensslPath, request, requireBuilds,
  start, startThrowawayPostgres, stop, waitFor, WEB,
} from "./e2e-support.mjs";

const bcrypt = backendRequire("bcryptjs");

const PASSWORD = "e2e-password-123";
const ALICE = { id: "6ad8b3e08afe6f8ad3173cac", email: "alice@example.com" };
const BOB = { id: "6ad8b3e08afe6f8ad3173cad", email: "bob@example.com" };
const PRODUCT = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const CUSTOMER = { fullName: "Ada Lovelace", email: "ada@example.com", phone: "0123", address: "1 Way", city: "London", postalCode: "N1", country: "UK" };

const { check, result } = createChecker();

async function main() {
  requireBuilds();

  const database = await startThrowawayPostgres("e2e");
  const { databaseUrl, pool } = database;
  const children = [];
  const temp = mkdtempSync(path.join(tmpdir(), "web-e2e-"));
  try {
    const hash = await bcrypt.hash(PASSWORD, 4);
    await pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0)");
    await pool.query(`INSERT INTO products (id, image, name, description, how_it_works, highlights, care_instructions, category,
                                            stock, rating_stars, rating_count, price_cents, keywords)
                      VALUES ($1, 'images/products/athletic-skateboard-shoes-gray.jpg', 'Socks', 'Soft.', 'Wear.', '{Cotton}', 'Wash.', 'Clothing', 0, 4.5, 87, 1090, '{socks}')`, [PRODUCT]);
    await pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Alice', $2, $5), ($3, 'Bob', $4, $5)",
      [ALICE.id, ALICE.email, BOB.id, BOB.email, hash]);
    console.log("Throwaway PostgreSQL ready (all migrations applied, seeded).");

    const cert = path.join(temp, "cert.pem");
    const key = path.join(temp, "key.pem");
    execFileSync(opensslPath(), ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
    const ca = readFileSync(cert);

    for (const secure of [false, true]) {
      const expressPort = await freePort();
      const nextPort = await freePort();
      const tlsPort = await freePort();
      const origin = secure ? `https://localhost:${tlsPort}` : `http://127.0.0.1:${nextPort}`;
      const cookieName = secure ? "__Host-ecom_session" : "ecom_dev_session";
      console.log(`\n-- ${secure ? "HTTPS-equivalent (TLS terminator → Next.js)" : "local development (HTTP)"}: ${origin} --`);

      const express = start(process.execPath, ["dist/server.js"], {
        cwd: BACKEND,
        env: {
          ...process.env, NODE_ENV: "development", PORT: String(expressPort), DATABASE_URL: databaseUrl,
          JWT_SECRET: randomBytes(32).toString("hex"),
          ...ALL_POSTGRES,
          AUTH_COOKIE_SESSIONS: "true", AUTH_COOKIE_SECURE: String(secure), AUTH_ALLOWED_ORIGINS: origin,
        },
      });
      const next = start(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(nextPort), "-H", "127.0.0.1"], {
        cwd: WEB, env: { ...process.env, BACKEND_ORIGIN: `http://127.0.0.1:${expressPort}`, NEXT_TELEMETRY_DISABLED: "1" },
      });
      children.push(express, next);
      let terminator;
      if (secure) {
        // Terminates TLS and forwards the request unchanged, as the hosting edge does.
        terminator = https.createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
          const upstream = http.request({ host: "127.0.0.1", port: nextPort, method: incoming.method, path: incoming.url, headers: incoming.headers }, (answer) => {
            outgoing.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
            answer.pipe(outgoing);
          });
          upstream.on("error", () => { outgoing.statusCode = 502; outgoing.end(); });
          incoming.pipe(upstream);
        });
        await new Promise((resolve) => terminator.listen(tlsPort, "127.0.0.1", resolve));
      }

      try {
        await waitFor(`http://127.0.0.1:${expressPort}/`);
        await waitFor(`http://127.0.0.1:${nextPort}/`);
        check("Express started with cookie sessions", express.log().includes(secure ? "Secure __Host- cookie" : "local HTTP development cookie"));

        const tls = secure ? { ca } : {};
        const browser = () => new CookieJar(undefined, { prefixSecurity: "strict" });
        const alice = browser();
        const call = (jar, method, apiPath, body, extra = {}) => request(`${origin}${apiPath}`, { method, body, jar, ...tls, headers: { Origin: origin, ...extra } });

        const home = await request(`${origin}/`, tls);
        const login = await request(`${origin}/login`, tls);
        check("Next.js pages are served on the browser-facing origin", home.status === 200 && login.status === 200 && home.text.includes("Socks"));

        const viaProxy = await call(alice, "GET", "/api/products");
        const direct = await request(`http://127.0.0.1:${expressPort}/api/products`);
        check("GET /api/products through the proxy equals Express directly", viaProxy.status === 200 && JSON.stringify(viaProxy.json) === JSON.stringify(direct.json) && viaProxy.json.length === 1);

        const wrong = await call(alice, "POST", "/api/auth/session", { email: ALICE.email, password: "wrong-password-1" });
        check("invalid credentials: 401 and no cookie", wrong.status === 401 && (await alice.getCookies(origin)).length === 0);

        const signedIn = await call(alice, "POST", "/api/auth/session", { email: ALICE.email, password: PASSWORD });
        const [cookie, ...extra] = await alice.getCookies(origin);
        check("login through the proxy: 200 with user and CSRF token, no token in the body",
          signedIn.status === 200 && signedIn.json?.user?._id === ALICE.id && typeof signedIn.json?.csrfToken === "string"
          && cookie !== undefined && !signedIn.text.includes(cookie.value));
        check(`the browser stores exactly one cookie, ${cookieName}`, cookie?.key === cookieName && extra.length === 0);
        check("cookie attributes: HttpOnly, SameSite=Lax, Path=/, host-only (no Domain)",
          cookie?.httpOnly === true && cookie?.sameSite === "lax" && cookie?.path === "/" && cookie?.hostOnly === true
          && cookie?.domain === new URL(origin).hostname);
        check(`cookie Secure attribute is ${secure}`, cookie?.secure === secure);

        const otherHost = secure ? `https://127.0.0.1:${tlsPort}` : `http://localhost:${nextPort}`;
        check(`host-only: not sent to ${new URL(otherHost).hostname} (another host, same port)`, (await alice.getCookieString(otherHost)) === "");
        const expressOrigin = `http://127.0.0.1:${expressPort}`;
        if (secure) {
          check("not sent to the Express origin (a different host)", (await alice.getCookieString(expressOrigin)) === "");
          // localhost is a "potentially trustworthy" origin, so browsers treat http://localhost
          // as secure. Replay the exact Set-Cookie on a real hostname to check Secure there.
          const issued = signedIn.setCookies[0];
          const realHost = browser();
          await realHost.setCookie(issued, "https://shop.example.test/api/auth/session");
          check("Secure: on a real hostname the cookie is sent over https only", (await realHost.getCookieString("https://shop.example.test/")) !== ""
            && (await realHost.getCookieString("http://shop.example.test/")) === "");
          // Browsers also refuse to store a Secure cookie received over plain http
          // (RFC 6265bis); tough-cookie stores it but, like a browser, never sends it.
          const plainHttp = browser();
          await plainHttp.setCookie(issued, "http://192.168.1.20:3001/api/auth/session").catch(() => undefined);
          check("over plain http on a non-loopback host the Secure cookie is never sent (why local dev has its own cookie)",
            (await plainHttp.getCookieString("http://192.168.1.20:3001/")) === "");
        } else {
          // Cookies are not port-scoped (RFC 6265): locally the browser also sends this cookie to
          // Express on the same host. Writes there still need Origin and the CSRF token.
          const direct = await request(`${expressOrigin}/api/cart-items`, { method: "POST", body: { productId: PRODUCT, quantity: 1 }, jar: alice, headers: { Origin: origin } });
          check("same host, other port (local only): a direct write to Express without the CSRF token is refused", direct.status === 403);
        }

        const csrf = signedIn.json.csrfToken;
        check("GET /api/auth/session with the cookie", (await call(alice, "GET", "/api/auth/session")).json?.user?.email === ALICE.email);

        const noCsrf = await call(alice, "POST", "/api/cart-items", { productId: PRODUCT, quantity: 1 });
        const foreign = await call(alice, "POST", "/api/cart-items", { productId: PRODUCT, quantity: 1 }, { Origin: "https://evil.example", "X-CSRF-Token": csrf });
        const noOrigin = await request(`${origin}/api/cart-items`, { method: "POST", body: { productId: PRODUCT, quantity: 1 }, jar: alice, ...tls, headers: { "X-CSRF-Token": csrf } });
        const added = await call(alice, "POST", "/api/cart-items", { productId: PRODUCT, quantity: 2 }, { "X-CSRF-Token": csrf });
        const cart = await call(alice, "GET", "/api/cart-items");
        check("cart write without CSRF token refused (403)", noCsrf.status === 403);
        check("cart write from a foreign Origin refused", foreign.status >= 400 && foreign.status !== 404);
        check("cart write without Origin refused (403)", noOrigin.status === 403);
        check("cart write with Origin and CSRF token accepted, and only that one landed", added.status === 201 && cart.json?.length === 1 && cart.json[0].quantity === 2);

        const order = await call(alice, "POST", "/api/orders", { customer: CUSTOMER }, { "X-CSRF-Token": csrf });
        check("checkout through the proxy", order.status === 201);

        const bob = browser();
        const bobSession = await call(bob, "POST", "/api/auth/session", { email: BOB.email, password: PASSWORD });
        check("a second user signs in separately", bobSession.status === 200);
        check("Bob sees an empty cart and no orders", (await call(bob, "GET", "/api/cart-items")).json?.length === 0 && (await call(bob, "GET", "/api/orders")).json?.length === 0);
        check("Bob cannot read Alice's order (404)", (await call(bob, "GET", `/api/orders/${order.json?.id}`)).status === 404);

        const stolen = cookie?.value ?? "";
        const logout = await call(alice, "DELETE", "/api/auth/session", undefined, { "X-CSRF-Token": csrf });
        check("logout through the proxy: 204 and the browser drops the cookie", logout.status === 204 && (await alice.getCookies(origin)).length === 0);
        check("after logout: signed out", (await call(alice, "GET", "/api/auth/session")).status === 401);
        const replay = await request(`${origin}/api/orders`, { ...tls, headers: { Cookie: `${cookieName}=${stolen}` } });
        check("a copied cookie value no longer works after logout", replay.status === 401);
        check("Bob is still signed in", (await call(bob, "GET", "/api/auth/session")).status === 200);

        const { rows } = await pool.query("SELECT user_id, revoked_reason, row_to_json(auth_sessions)::text AS everything FROM auth_sessions WHERE user_id = $1", [ALICE.id]);
        check("the session lives in the throwaway database, revoked, without the raw token",
          rows.length === 1 && rows[0].revoked_reason === "logout" && !rows[0].everything.includes(stolen));
        check("no session token in the Express or Next.js logs", !express.log().includes(stolen) && !next.log().includes(stolen));
        await pool.query("DELETE FROM auth_sessions");
        await pool.query("DELETE FROM cart_items");
      } finally {
        terminator?.closeAllConnections();
        await new Promise((resolve) => (terminator ? terminator.close(resolve) : resolve()));
        await stop(next);
        await stop(express);
      }
    }
  } finally {
    for (const child of children) await stop(child);
    await database.stop();
    rmSync(temp, { recursive: true, force: true });
  }

  console.log(`\n${result.passed}/${result.passed + result.failed} end-to-end checks passed`);
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`E2E FAILED: ${error.message}`);
  process.exitCode = 1;
});
