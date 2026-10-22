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

/**
 * Client-address forwarding for rate limiting: both settings or neither.
 * TRUSTED_CLIENT_IP_HEADER must be a header the hosting platform overwrites.
 */
export function parseClientIpForwarding(header: string | undefined, secret: string | undefined): { header: string; secret: string } | undefined {
  const name = header?.trim().toLowerCase();
  const value = secret?.trim();
  if (!name && !value) return undefined;
  if (!name || !value) {
    throw new EnvironmentError("Set both TRUSTED_CLIENT_IP_HEADER and PROXY_CLIENT_IP_SECRET, or neither.");
  }
  if (!/^[a-z0-9-]+$/.test(name)) throw new EnvironmentError("TRUSTED_CLIENT_IP_HEADER must be a header name.");
  if (value.length < 32) throw new EnvironmentError("PROXY_CLIENT_IP_SECRET must be at least 32 characters.");
  return { header: name, secret: value };
}

/** The public site origin for absolute canonical/Open Graph URLs; undefined when unset or invalid. */
export function parseSiteUrl(value: string | undefined): URL | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === value.trim() ? url : undefined;
  } catch {
    return undefined;
  }
}

export function parseAppName(value: string | undefined): string {
  const name = value?.trim();
  return name && name.length <= 60 ? name : "Ecommerce";
}
