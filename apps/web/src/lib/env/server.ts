// Server-only settings. Importing this from a Client Component fails the build.
import "server-only";
import { parseBackendOrigin, parseClientIpForwarding } from "./parse";

export interface ServerEnvironment {
  backendOrigin: URL;
  clientIp?: { header: string; secret: string };
}

let cached: ServerEnvironment | undefined;

/** Read at request time (not inlined at build time), validated once. */
export function serverEnv(): ServerEnvironment {
  if (!cached) {
    const clientIp = parseClientIpForwarding(process.env.TRUSTED_CLIENT_IP_HEADER, process.env.PROXY_CLIENT_IP_SECRET);
    cached = { backendOrigin: parseBackendOrigin(process.env.BACKEND_ORIGIN), ...(clientIp ? { clientIp } : {}) };
  }
  return cached;
}
