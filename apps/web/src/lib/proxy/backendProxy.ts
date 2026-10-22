// Backend-for-frontend proxy: the browser calls /api/* on the Next.js host and
// this forwards the request to the one configured Express origin.
//
// Restrictions (MIGRATION_PLAN.md, Phase 5 "Same-origin API proxy"):
// - Only /api/* paths, mapped onto the fixed BACKEND_ORIGIN. The target URL is
//   built from the path alone and must stay on that origin; traversal and
//   encoded separators are refused. It can never reach another host.
// - Only listed methods and request headers are forwarded. Hop-by-hop headers
//   (Connection, Keep-Alive, TE, Transfer-Encoding, Upgrade, Proxy-*), Host and
//   client-supplied X-Forwarded-* headers are never passed on.
// - Only the session cookies are forwarded, and only session cookies may be
//   set. A Set-Cookie with a Domain attribute is dropped, so every cookie stays
//   host-only on the browser-facing origin.
// - Redirects from the API are not followed or passed on.
// Pure Web APIs (Request, Response, fetch): no Next.js imports, so it is
// testable on its own.

/**
 * Optional: pass the browser address to Express for rate limiting. The value
 * is read from a header the hosting platform sets and overwrites (for example
 * x-real-ip on Vercel), never from one a client can add, and is sent with the
 * shared secret that Express requires before believing it.
 */
export interface ClientIpForwarding {
  /** Lower-case name of the platform header carrying the client address. */
  header: string;
  secret: string;
}

export interface ProxyOptions {
  backendOrigin: URL;
  clientIp?: ClientIpForwarding;
  fetchImpl?: typeof fetch;
  /** Request bodies above this are refused with 413 (default 1 MiB; Express accepts 100 kB of JSON). */
  maxBodyBytes?: number;
  /** Upstream time limit (default 15 s). */
  timeoutMs?: number;
}

export const ALLOWED_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;
const METHODS: ReadonlySet<string> = new Set(ALLOWED_METHODS);

/** The only cookies that pass through, in either direction (Express auth/config.ts). */
export const SESSION_COOKIE_NAMES: ReadonlySet<string> = new Set(["__Host-ecom_session", "ecom_dev_session"]);

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  // Legacy bearer tokens, for the token-to-cookie exchange during migration.
  "authorization",
  "content-type",
  "if-modified-since",
  "if-none-match",
  // The browser's Origin: Express checks it for CSRF protection.
  "origin",
  "user-agent",
  "x-csrf-token",
];

const FORWARDED_RESPONSE_HEADERS = [
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "expires",
  "last-modified",
  "vary",
  "x-content-type-options",
];

const message = (status: number, text: string, headers: Record<string, string> = {}) => Response.json(
  { message: text },
  { status, headers: { "Cache-Control": "no-store", ...headers } },
);

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+(%[0-9a-z]+)?$/i;

/** A plain IPv4 or IPv6 address (Express validates again). */
export const isIpAddress = (value: string) => IPV4.test(value) || (value.includes(":") && value.length <= 45 && IPV6.test(value));

/** The Express URL for a browser request, or null when the path is not allowed. */
export function backendUrlFor(requestUrl: URL, backendOrigin: URL): URL | null {
  const path = requestUrl.pathname;
  if (!path.startsWith("/api/")) return null;
  // Empty segments, backslashes, encoded dots/slashes/backslashes/NUL, control characters.
  if (/\/\/|\\|%2e|%2f|%5c|%00|[\u0000-\u001f\u007f]/i.test(path)) return null;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;

  const target = new URL(`${path}${requestUrl.search}`, backendOrigin);
  return target.origin === backendOrigin.origin && target.pathname === path ? target : null;
}

/** Keeps only the session cookies from a Cookie header. */
export function sessionCookiesOnly(header: string | null): string | null {
  if (!header) return null;
  const kept = header.split(";").map((pair) => pair.trim()).filter((pair) => {
    const separator = pair.indexOf("=");
    return separator > 0 && SESSION_COOKIE_NAMES.has(pair.slice(0, separator));
  });
  return kept.length > 0 ? kept.join("; ") : null;
}

/** A session cookie, host-only (no Domain), and __Host- rules respected. */
export function isAllowedSetCookie(line: string): boolean {
  const [pair = "", ...rawAttributes] = line.split(";");
  const name = pair.slice(0, Math.max(pair.indexOf("="), 0)).trim();
  if (!SESSION_COOKIE_NAMES.has(name)) return false;

  const attributes = new Map(rawAttributes.map((attribute) => {
    const [key = "", ...rest] = attribute.split("=");
    return [key.trim().toLowerCase(), rest.join("=").trim()];
  }));
  if (attributes.has("domain")) return false;
  if (name.startsWith("__Host-") && (!attributes.has("secure") || attributes.get("path") !== "/")) return false;
  return true;
}

export async function proxyToBackend(request: Request, options: ProxyOptions): Promise<Response> {
  const { backendOrigin, fetchImpl = fetch, maxBodyBytes = 1024 * 1024, timeoutMs = 15_000 } = options;

  const method = request.method.toUpperCase();
  if (!METHODS.has(method)) {
    return message(405, "Method not allowed", { Allow: ALLOWED_METHODS.join(", ") });
  }

  const target = backendUrlFor(new URL(request.url), backendOrigin);
  if (!target) {
    return message(404, "Not found");
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const cookies = sessionCookiesOnly(request.headers.get("cookie"));
  if (cookies) headers.set("cookie", cookies);
  if (options.clientIp) {
    const address = request.headers.get(options.clientIp.header)?.trim();
    if (address && isIpAddress(address)) {
      headers.set("x-client-ip", address);
      headers.set("x-proxy-secret", options.clientIp.secret);
    }
  }

  let body: ArrayBuffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    if (Number(request.headers.get("content-length") ?? 0) > maxBodyBytes) {
      return message(413, "Request body too large");
    }
    body = await request.arrayBuffer();
    if (body.byteLength > maxBodyBytes) {
      return message(413, "Request body too large");
    }
    if (body.byteLength === 0) body = undefined;
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // No upstream details reach the browser.
    return message(502, "The API is unavailable");
  }

  if (upstream.status >= 300 && upstream.status < 400 && upstream.status !== 304) {
    await upstream.body?.cancel();
    return message(502, "Unexpected redirect from the API");
  }

  const responseHeaders = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  for (const line of upstream.headers.getSetCookie()) {
    if (isAllowedSetCookie(line)) responseHeaders.append("set-cookie", line);
  }

  const bodyless = method === "HEAD" || upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
  if (bodyless) await upstream.body?.cancel();

  return new Response(bodyless ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
