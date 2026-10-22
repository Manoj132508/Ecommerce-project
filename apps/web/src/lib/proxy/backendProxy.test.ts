// The /api proxy against a real local HTTP upstream that records exactly what
// it receives and can answer with arbitrary headers.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { backendUrlFor, isAllowedSetCookie, proxyToBackend, sessionCookiesOnly } from "./backendProxy";

interface Received {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let backendOrigin: URL;
let received: Received[] = [];
/** The upstream's next answer. */
let reply: { status: number; headers: [string, string][]; body: string } = { status: 200, headers: [], body: "" };

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.statusCode = reply.status;
      for (const [name, value] of reply.headers) response.appendHeader(name, value);
      response.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  backendOrigin = new URL(`http://127.0.0.1:${port}`);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received = [];
  reply = { status: 200, headers: [["Content-Type", "application/json; charset=utf-8"]], body: "{\"ok\":true}" };
});

const browserRequest = (path: string, init: RequestInit = {}) => new Request(`https://shop.example.test${path}`, init);
const proxy = (request: Request, options: { maxBodyBytes?: number; timeoutMs?: number } = {}) => proxyToBackend(request, { backendOrigin, ...options });

describe("forwarding", () => {
  test("preserves method, path, query, JSON body and status", async () => {
    reply = { status: 201, headers: [["Content-Type", "application/json"]], body: "{\"id\":\"line-1\"}" };
    const response = await proxy(browserRequest("/api/cart-items?expand=product&x=%20y", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://shop.example.test", "X-CSRF-Token": "csrf-value" },
      body: JSON.stringify({ productId: "p1", quantity: 2 }),
    }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "line-1" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      method: "POST",
      url: "/api/cart-items?expand=product&x=%20y",
      body: "{\"productId\":\"p1\",\"quantity\":2}",
    });
    expect(received[0]?.headers).toMatchObject({
      "content-type": "application/json",
      origin: "https://shop.example.test",
      "x-csrf-token": "csrf-value",
      host: backendOrigin.host,
    });
  });

  test.each(["GET", "PUT", "PATCH", "DELETE"])("forwards %s", async (method) => {
    const response = await proxy(browserRequest("/api/orders/1", { method }));
    expect(response.status).toBe(200);
    expect(received[0]?.method).toBe(method);
  });

  test("HEAD and 204 responses have no body", async () => {
    expect(await (await proxy(browserRequest("/api/products", { method: "HEAD" }))).text()).toBe("");
    reply = { status: 204, headers: [], body: "" };
    const deleted = await proxy(browserRequest("/api/auth/session", { method: "DELETE" }));
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe("");
  });

  test.each([400, 401, 403, 404, 409, 413, 500, 501])("passes status %i and its JSON message through", async (status) => {
    reply = { status, headers: [["Content-Type", "application/json"]], body: JSON.stringify({ message: `status ${status}` }) };
    const response = await proxy(browserRequest("/api/orders"));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ message: `status ${status}` });
  });
});

describe("request headers", () => {
  test("only allow-listed headers reach the API: no hop-by-hop, forwarded or unrelated headers", async () => {
    await proxy(browserRequest("/api/products", {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-GB",
        Authorization: "Bearer legacy",
        "User-Agent": "test-agent",
        "X-Forwarded-For": "6.6.6.6",
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "http",
        Forwarded: "for=6.6.6.6;host=evil.example",
        "X-Real-IP": "6.6.6.6",
        "Proxy-Authorization": "Basic secret",
        "X-Custom": "nope",
        Referer: "https://shop.example.test/private?token=abc",
      },
    }));
    const headers = received[0]?.headers ?? {};
    expect(headers).toMatchObject({ accept: "application/json", "accept-language": "en-GB", authorization: "Bearer legacy", "user-agent": "test-agent" });
    for (const name of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "forwarded", "x-real-ip", "proxy-authorization", "x-custom", "referer"]) {
      expect(headers).not.toHaveProperty(name);
    }
  });

  test("only the session cookies are forwarded", async () => {
    await proxy(browserRequest("/api/auth/session", {
      headers: { Cookie: "_ga=GA1.2; __Host-ecom_session=abc; theme=dark; ecom_dev_session=def; __Host-other=x" },
    }));
    expect(received[0]?.headers.cookie).toBe("__Host-ecom_session=abc; ecom_dev_session=def");
    expect(sessionCookiesOnly("_ga=1; theme=dark")).toBeNull();
    expect(sessionCookiesOnly(null)).toBeNull();
  });
});

describe("response headers and cookies", () => {
  test("Set-Cookie for the session passes through unchanged, several at once", async () => {
    const issued = "__Host-ecom_session=tok; Path=/; Expires=Wed, 21 Oct 2099 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax";
    const cleared = "ecom_dev_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax";
    reply = { status: 200, headers: [["Set-Cookie", issued], ["Set-Cookie", cleared], ["Content-Type", "application/json"]], body: "{}" };
    const response = await proxy(browserRequest("/api/auth/session", { method: "POST", body: "{}" }));
    expect(response.headers.getSetCookie()).toEqual([issued, cleared]);
  });

  test.each([
    ["a Domain attribute (would not be host-only)", "__Host-ecom_session=t; Domain=example.test; Path=/; Secure; HttpOnly"],
    ["a dev cookie with a Domain", "ecom_dev_session=t; domain=.shop.example.test; Path=/; HttpOnly"],
    ["__Host- without Secure", "__Host-ecom_session=t; Path=/; HttpOnly"],
    ["__Host- with a narrower Path", "__Host-ecom_session=t; Path=/api; Secure; HttpOnly"],
    ["an unrelated cookie", "tracking=1; Path=/"],
  ])("drops a Set-Cookie with %s", async (_label, line) => {
    reply = { status: 200, headers: [["Set-Cookie", line]], body: "" };
    const response = await proxy(browserRequest("/api/auth/session"));
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(isAllowedSetCookie(line)).toBe(false);
  });

  test("hop-by-hop, encoding, server and redirect headers are not passed back", async () => {
    reply = {
      status: 200,
      headers: [
        ["Content-Type", "application/json"], ["Cache-Control", "no-store"], ["ETag", "W/\"1\""], ["Vary", "Origin"],
        ["Connection", "keep-alive, X-Secret"], ["Keep-Alive", "timeout=5"], ["X-Secret", "1"], ["Proxy-Authenticate", "Basic"],
        ["X-Powered-By", "Express"], ["Access-Control-Allow-Origin", "*"], ["Location", "https://evil.example"], ["Server", "Express"],
      ],
      body: "{}",
    };
    const response = await proxy(browserRequest("/api/products"));
    expect(Object.fromEntries(response.headers)).toEqual({
      "cache-control": "no-store", "content-type": "application/json", etag: "W/\"1\"", vary: "Origin",
    });
  });

  test("a redirect from the API is not followed or passed on", async () => {
    reply = { status: 302, headers: [["Location", "https://evil.example/phish"]], body: "" };
    const response = await proxy(browserRequest("/api/products"));
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    expect(received).toHaveLength(1);
  });
});

describe("restrictions", () => {
  test.each([
    "/api",
    "/apix/products",
    "/other/path",
    "/api//evil.example/x",
    "/api/%2e%2e/admin",
    "/api/..%2fadmin",
    "/api/%2F%2Fevil.example",
    "/api/a%5c..%5cb",
    "/api/a%00b",
  ])("refuses %s without contacting the API", async (path) => {
    const response = await proxy(browserRequest(path));
    expect(response.status).toBe(404);
    expect(received).toEqual([]);
  });

  test("a URL-normalised traversal still cannot leave /api", async () => {
    // The URL parser resolves "/api/../admin" to "/admin" before the proxy sees it.
    expect((await proxy(browserRequest("/api/../admin"))).status).toBe(404);
    expect(received).toEqual([]);
  });

  test("the target is always the configured origin, whatever the request host", () => {
    const target = backendUrlFor(new URL("https://attacker.example/api/products?x=1"), backendOrigin);
    expect(target?.origin).toBe(backendOrigin.origin);
    expect(target?.pathname).toBe("/api/products");
    expect(backendUrlFor(new URL("https://shop.example.test/api/@evil.example/x"), backendOrigin)?.origin).toBe(backendOrigin.origin);
  });

  test("methods outside the allow-list are refused", async () => {
    const response = await proxy(browserRequest("/api/products", { method: "PROPFIND" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST, PUT, PATCH, DELETE");
    expect(received).toEqual([]);
  });

  test("oversized bodies are refused before contacting the API", async () => {
    const response = await proxy(browserRequest("/api/products", { method: "POST", body: "x".repeat(2048) }), { maxBodyBytes: 1024 });
    expect(response.status).toBe(413);
    expect(received).toEqual([]);
  });

  test("an unreachable API gives a generic 502 with no details", async () => {
    const response = await proxyToBackend(browserRequest("/api/products"), { backendOrigin: new URL("http://127.0.0.1:1") });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ message: "The API is unavailable" });
  });

  test("a slow API times out with 502", async () => {
    const hanging = createServer(() => undefined);
    await new Promise<void>((resolve) => hanging.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = hanging.address() as AddressInfo;
      const response = await proxyToBackend(browserRequest("/api/products"), { backendOrigin: new URL(`http://127.0.0.1:${port}`), timeoutMs: 200 });
      expect(response.status).toBe(502);
    } finally {
      hanging.closeAllConnections();
      await new Promise((resolve) => hanging.close(resolve));
    }
  });
});
