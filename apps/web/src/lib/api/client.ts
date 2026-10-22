// Browser API client. Every call goes to /api on this same origin, so the
// HttpOnly session cookie is sent automatically and no token is ever handled
// by JavaScript. POST, PUT, PATCH and DELETE carry the session's CSRF token.

export class ApiError extends Error {
  override name = "ApiError";
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequest {
  method?: Method;
  body?: unknown;
  /** Required by the API for every method except GET. */
  csrfToken?: string;
  /**
   * Sign-in and account creation only: there is no session (and so no CSRF
   * token) yet; the API checks the Origin header and accepts JSON only.
   */
  noSession?: boolean;
}

/** Same-origin paths only: "/products" → "/api/products". */
export function apiPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error(`API paths must be relative to /api and start with a single "/": ${path}`);
  }
  return `/api${path}`;
}

/**
 * Returns the parsed JSON (undefined for 204). The result is untrusted:
 * callers validate its shape (see the api.ts file of each feature).
 */
export async function apiFetch(path: string, { method = "GET", body, csrfToken, noSession = false }: ApiRequest = {}, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && !noSession) {
    if (!csrfToken) throw new ApiError(0, "Sign in again to continue.");
    headers["X-CSRF-Token"] = csrfToken;
  }

  const response = await fetchImpl(apiPath(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
    cache: "no-store",
  });

  if (response.status === 204) {
    return undefined;
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const text = typeof data === "object" && data !== null && "message" in data && typeof data.message === "string"
      ? data.message
      : "Something went wrong. Please try again.";
    throw new ApiError(response.status, text);
  }
  return data;
}
