// Pure validation for environment values (no process.env access here, so it
// can be unit-tested and shared by the server and test code).

export class EnvironmentError extends Error {
  override name = "EnvironmentError";
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The Express API origin that /api/* is forwarded to. It must be an exact
 * origin (scheme, host, optional port) with no credentials, path, query or
 * fragment. Plain http is accepted only for loopback hosts (local development
 * and tests); anything reachable over a network must use https.
 */
export function parseBackendOrigin(value: string | undefined): URL {
  if (!value?.trim()) {
    throw new EnvironmentError("BACKEND_ORIGIN is not set (for example http://127.0.0.1:3000).");
  }
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new EnvironmentError("BACKEND_ORIGIN is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new EnvironmentError("BACKEND_ORIGIN must use http or https.");
  }
  if (url.username || url.password) {
    throw new EnvironmentError("BACKEND_ORIGIN must not contain credentials.");
  }
  if (url.origin !== value.trim()) {
    throw new EnvironmentError("BACKEND_ORIGIN must be an exact origin, with no path, query or trailing slash.");
  }
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new EnvironmentError("BACKEND_ORIGIN must use https unless it is a loopback address.");
  }
  return url;
}

export function parseAppName(value: string | undefined): string {
  const name = value?.trim();
  return name && name.length <= 60 ? name : "Ecommerce";
}
