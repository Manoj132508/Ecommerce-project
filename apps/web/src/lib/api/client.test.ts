import { describe, expect, test, vi } from "vitest";
import { parseSession } from "@/features/auth/api";
import { safeReturnPath } from "@/lib/returnPath";
import { ApiError, apiFetch, apiPath } from "./client";

const fakeFetch = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(
  status === 204 ? null : JSON.stringify(body),
  { status, headers: { "Content-Type": "application/json" } },
));

describe("apiFetch", () => {
  test("GET: same-origin /api path, cookies sent, no CSRF header", async () => {
    const fetchImpl = fakeFetch(200, [{ id: "1" }]);
    expect(await apiFetch("/products", {}, fetchImpl)).toEqual([{ id: "1" }]);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/api/products");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(init?.headers).toEqual({ Accept: "application/json" });
  });

  test("unsafe methods carry the CSRF token and a JSON body", async () => {
    const fetchImpl = fakeFetch(201, { ok: true });
    await apiFetch("/cart-items", { method: "POST", body: { productId: "p" }, csrfToken: "csrf-1" }, fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: "{\"productId\":\"p\"}",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-CSRF-Token": "csrf-1" },
    });
  });

  test("checkout carries its idempotency key with the CSRF token", async () => {
    const fetchImpl = fakeFetch(201, { id: "order-1" });
    await apiFetch("/orders", { method: "POST", body: { fullName: "Manoj" }, csrfToken: "csrf-1", idempotencyKey: "912e7b90-8185-45c7-b6c5-aed8db9db513" }, fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "912e7b90-8185-45c7-b6c5-aed8db9db513",
      "X-CSRF-Token": "csrf-1",
    });
  });

  test("an unsafe request without a CSRF token is not sent", async () => {
    const fetchImpl = fakeFetch(200, {});
    await expect(apiFetch("/cart-items", { method: "DELETE" }, fetchImpl)).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("sign-in and account creation are the only unsafe requests without a CSRF token", async () => {
    const fetchImpl = fakeFetch(200, {});
    await apiFetch("/auth/session", { method: "POST", body: {}, noSession: true }, fetchImpl);
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).not.toHaveProperty("X-CSRF-Token");
  });

  test("errors carry the status and the server's message; 204 has no body", async () => {
    await expect(apiFetch("/orders", {}, fakeFetch(401, { message: "Not authorized" }))).rejects.toMatchObject({ status: 401, message: "Not authorized" });
    await expect(apiFetch("/orders", {}, fakeFetch(500, "oops"))).rejects.toMatchObject({ status: 500, message: "Something went wrong. Please try again." });
    expect(await apiFetch("/auth/session", { method: "DELETE", csrfToken: "c" }, fakeFetch(204, null))).toBeUndefined();
  });

  test.each(["products", "//evil.example/x", "/a\\b"])("refuses the path %j", (path) => {
    expect(() => apiPath(path)).toThrow();
  });
});

describe("session responses", () => {
  test("only a well-formed session is accepted", () => {
    const user = { _id: "6ad8b3e08afe6f8ad3173cac", name: "Alice", email: "alice@example.com", isAdmin: false };
    expect(parseSession({ user, csrfToken: "c" })).toEqual({ user, csrfToken: "c" });
    expect(() => parseSession({ user, token: "leak" })).toThrow(ApiError);
    expect(() => parseSession({ user: { ...user, isAdmin: "yes" }, csrfToken: "c" })).toThrow(ApiError);
    // Extra fields are dropped, never kept in the cache.
    expect(parseSession({ user: { ...user, password: "x" }, csrfToken: "c", token: "t" })).toEqual({ user, csrfToken: "c" });
  });
});

describe("safeReturnPath", () => {
  test.each([["/orders", "/orders"], ["/products/1?x=2", "/products/1?x=2"]])("keeps %j", (value, expected) => {
    expect(safeReturnPath(value)).toBe(expected);
  });
  test.each(["//evil.example", "/\\evil.example", "\\\\evil", "https://evil.example", "javascript:alert(1)", "/login", "/register?x", "/a\tb", null])("rejects %j", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});
