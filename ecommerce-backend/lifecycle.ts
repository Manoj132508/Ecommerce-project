// Graceful shutdown (Phase 7A reliability review). Render, like most hosts,
// sends SIGTERM before a deploy or restart replaces the instance and kills it
// some seconds later. Without a handler the process stopped at once: requests
// in flight (a checkout among them) were cut off and pooled connections were
// dropped without closing.
//
// On SIGTERM or SIGINT: readiness reports 503, the server stops accepting
// connections and closes idle keep-alive ones, requests in flight may finish
// for SHUTDOWN_TIMEOUT_MS (default 10000; Render waits 30 s by default), any
// still open after that are closed, then the database connections are closed
// (PostgreSQL pool, MongoDB) and the process exits.
import type { Server } from "node:http";
import { errorMessage } from "./utils/errors.js";

export interface Closer {
  name: string;
  close: () => Promise<void>;
}

export interface ShutdownOptions {
  server: Server;
  /** Closed in order once no request is left (pool.end(), mongoose.disconnect()). */
  closers: Closer[];
  timeoutMs: number;
  log?: (message: string) => void;
}

export class ShutdownConfigError extends Error {
  override name = "ShutdownConfigError";
}

export function loadShutdownTimeout(env: Record<string, string | undefined>): number {
  const value = env.SHUTDOWN_TIMEOUT_MS?.trim();
  if (value === undefined || value === "") return 10_000;
  if (!/^[0-9]+$/.test(value) || Number(value) < 100 || Number(value) > 120_000) {
    throw new ShutdownConfigError("SHUTDOWN_TIMEOUT_MS must be a whole number from 100 to 120000.");
  }
  return Number(value);
}

export interface Shutdown {
  shuttingDown: () => boolean;
  /** Idempotent: a second signal waits for the same shutdown. Resolves false if anything failed to close. */
  shutdown: (reason: string) => Promise<boolean>;
}

export function createShutdown({ server, closers, timeoutMs, log = console.log }: ShutdownOptions): Shutdown {
  let started: Promise<boolean> | undefined;

  const drain = () => new Promise<boolean>((resolve) => {
    // Stops accepting; resolves once every connection has closed.
    server.close(() => resolve(true));
    // server.close() only closes connections idle at this moment. A keep-alive
    // connection whose request finishes later would stay open until the force
    // timeout (CI run 40341123629), so idle ones are closed until none is left,
    // and responses to requests that still arrive on them ask the client to close.
    const closeAfterResponse = (_request: unknown, response: { setHeader: (name: string, value: string) => void }) => {
      response.setHeader("Connection", "close");
    };
    server.on("request", closeAfterResponse);
    server.closeIdleConnections();
    const sweep = setInterval(() => server.closeIdleConnections(), 100);
    sweep.unref();
    const force = setTimeout(() => {
      log(`Shutdown: requests still open after ${timeoutMs} ms, closing them`);
      server.closeAllConnections();
      resolve(false);
    }, timeoutMs);
    force.unref();
    server.once("close", () => {
      clearTimeout(force);
      clearInterval(sweep);
      server.off("request", closeAfterResponse);
    });
  });

  const run = async (reason: string) => {
    log(`Shutdown (${reason}): no new connections; waiting for requests in flight`);
    let clean = await drain();
    for (const { name, close } of closers) {
      try {
        await close();
        log(`Shutdown: ${name} closed`);
      } catch (error) {
        clean = false;
        console.error(`Shutdown: closing ${name} failed:`, errorMessage(error));
      }
    }
    log(`Shutdown: complete${clean ? "" : " (with errors or forced closes)"}`);
    return clean;
  };

  return {
    shuttingDown: () => started !== undefined,
    shutdown: (reason) => (started ??= run(reason)),
  };
}
