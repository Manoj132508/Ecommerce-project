import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { config, proxy } from "@/proxy";
import { contentSecurityPolicy, createNonce } from "./csp";

const directives = (policy: string) => new Map(policy.split("; ").map((directive) => {
  const [name = "", ...values] = directive.split(" ");
  return [name, values];
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("contentSecurityPolicy", () => {
  test("production: scripts and style elements only with the nonce; no inline script, no eval, no other origin", () => {
    const policy = directives(contentSecurityPolicy("abc123", { development: false }));
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'nonce-abc123'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    const text = contentSecurityPolicy("abc123", { development: false });
    expect(text).not.toContain("unsafe-eval");
    // The only 'unsafe-inline' is for style attributes (next/image), which cannot run script.
    expect([...policy].filter(([, values]) => values.includes("'unsafe-inline'")).map(([name]) => name)).toEqual(["style-src-attr"]);
    expect(text).not.toMatch(/https?:\/\//);
  });

  test("development: eval and inline styles for the dev server and its overlay, a WebSocket for reloads", () => {
    const policy = directives(contentSecurityPolicy("abc123", { development: true }));
    expect(policy.get("script-src")).toEqual(["'self'", "'nonce-abc123'", "'strict-dynamic'", "'unsafe-eval'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("connect-src")).toEqual(["'self'", "ws:"]);
  });

  test("nonces are 128 random bits, different every time", () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    expect(nonces.size).toBe(100);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("proxy", () => {
  test("puts the same fresh policy on the request (for rendering) and on the response (for the browser)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = proxy(new NextRequest("http://shop.test/products"));
    const second = proxy(new NextRequest("http://shop.test/products"));
    const policy = first.headers.get("content-security-policy") ?? "";
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
    expect(policy).not.toContain("unsafe-eval");
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(second.headers.get("content-security-policy")).not.toBe(policy);
  });

  test("runs for pages, not for the API proxy, build assets, images or prefetches", () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher!.source}$`);
    for (const path of ["/", "/products", "/products/abc", "/login", "/admin/orders/1", "/no-such-page"]) expect(path).toMatch(pattern);
    for (const path of ["/api/products", "/_next/static/chunks/a.js", "/_next/image", "/images/products/socks.jpg", "/favicon.ico"]) expect(path).not.toMatch(pattern);
    expect(matcher!.missing.map((header) => header.key)).toEqual(["next-router-prefetch", "purpose"]);
  });
});
