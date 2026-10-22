// The client address used for rate limiting, without trusting spoofable headers.
//
//   TRUST_PROXY_HOPS        number of reverse proxies in front of Express that
//                           append to X-Forwarded-For (Render: 1). Default 0:
//                           X-Forwarded-For is ignored and the socket address
//                           is used. Express then takes the address that many
//                           hops from the right, so a client-supplied leftmost
//                           value is never believed.
//   PROXY_CLIENT_IP_SECRET  optional shared secret (at least 32 characters)
//                           between the Next.js /api proxy and Express. Only a
//                           request carrying it may state the browser's address
//                           in X-Client-IP; without it that header is ignored.
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";

export const CLIENT_IP_HEADER = "X-Client-IP";
export const PROXY_SECRET_HEADER = "X-Proxy-Secret";

export interface ClientIpConfig {
  trustProxyHops: number;
  proxySecret?: string;
}

export class ClientIpConfigError extends Error {
  override name = "ClientIpConfigError";
}

export function loadClientIpConfig(env: Record<string, string | undefined>): ClientIpConfig {
  const hops = env.TRUST_PROXY_HOPS?.trim() || "0";
  if (!/^(10|[0-9])$/.test(hops)) {
    throw new ClientIpConfigError("TRUST_PROXY_HOPS must be a whole number from 0 to 10.");
  }
  const secret = env.PROXY_CLIENT_IP_SECRET?.trim();
  if (secret !== undefined && secret !== "" && secret.length < 32) {
    throw new ClientIpConfigError("PROXY_CLIENT_IP_SECRET must be at least 32 characters.");
  }
  return { trustProxyHops: Number(hops), ...(secret ? { proxySecret: secret } : {}) };
}

// Compare digests so the comparison takes the same time whatever the lengths.
const sameSecret = (presented: string, expected: string) => timingSafeEqual(
  createHash("sha256").update(presented).digest(),
  createHash("sha256").update(expected).digest(),
);

/** The browser's address as far as it can be trusted. */
export function clientAddress(req: Request, config: ClientIpConfig): string {
  if (config.proxySecret) {
    const presented = req.get(PROXY_SECRET_HEADER);
    const stated = req.get(CLIENT_IP_HEADER)?.trim();
    if (presented && stated && isIP(stated) && sameSecret(presented, config.proxySecret)) {
      return stated;
    }
  }
  // req.ip honours the app's "trust proxy" hop count (set in app.ts).
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

/** Upper 64 bits of an IPv6 address: one subscriber usually controls a whole /64. */
function ipv6Prefix64(address: string): string {
  const [withoutZone = ""] = address.split("%");
  const split = withoutZone.split("::");
  const toParts = (text: string | undefined) => (text ? text.split(":") : []).flatMap((part) => (part.includes(".") ? ["0", "0"] : [part]));
  const head = toParts(split[0]);
  const tail = toParts(split[1]);
  const parts = split.length === 2 ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail] : head;
  return parts.slice(0, 4).map((part) => Number.parseInt(part || "0", 16).toString(16)).join(":");
}

/** What a rate limit counts: an IPv4 address, or an IPv6 /64. */
export function rateLimitSubject(address: string): string {
  let value = address.trim();
  if (/^::ffff:/i.test(value) && isIP(value.slice(7)) === 4) value = value.slice(7);
  const version = isIP(value.split("%")[0] ?? "");
  if (version === 4) return value;
  if (version === 6) return `${ipv6Prefix64(value)}::/64`;
  return "unknown";
}
