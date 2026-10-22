// Server-only settings. Importing this from a Client Component fails the build.
import "server-only";
import { parseBackendOrigin } from "./parse";

export interface ServerEnvironment {
  backendOrigin: URL;
}

let cached: ServerEnvironment | undefined;

/** Read at request time (not inlined at build time), validated once. */
export function serverEnv(): ServerEnvironment {
  cached ??= { backendOrigin: parseBackendOrigin(process.env.BACKEND_ORIGIN) };
  return cached;
}
