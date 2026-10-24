// The last two handlers of the app (Phase 7A security review). Without them
// Express answers unknown routes and body-parser failures with its own HTML
// page, which includes the stack trace and server file paths unless
// NODE_ENV=production. Clients now get the API's { message } envelope with a
// fixed text in every environment; the detail stays in the server log (with the
// stack outside production, where it helps; message and code only in production).
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { ErrorResponse } from "../types/api.js";
import { errorCode, errorMessage } from "../utils/errors.js";

/** body-parser's error types (`err.type`) and the status and text each one gets. */
const BODY_ERRORS: Record<string, [status: number, message: string]> = {
  "entity.parse.failed": [400, "Malformed JSON body"],
  "entity.too.large": [413, "Request body too large"],
  "encoding.unsupported": [415, "Unsupported content encoding"],
  "charset.unsupported": [415, "Unsupported charset"],
  "request.aborted": [400, "Request aborted"],
  "request.size.invalid": [400, "Request size did not match Content-Length"],
};

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ message: "Not found" } satisfies ErrorResponse);
};

const statusOf = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const status = "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined;
  return typeof status === "number" && status >= 400 && status <= 599 ? status : undefined;
};

export function errorHandler(environment: string | undefined = process.env.NODE_ENV): ErrorRequestHandler {
  const production = environment === "production";
  return (error: unknown, req, res, next) => {
    // A response already under way cannot change; Express then closes the connection.
    if (res.headersSent) return next(error);

    const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
    const known = typeof type === "string" ? BODY_ERRORS[type] : undefined;
    const status = known?.[0] ?? statusOf(error) ?? 500;
    const message = known?.[1] ?? (status < 500 ? "Bad request" : "Server error");

    if (status >= 500 || !known) {
      const detail = !production && error instanceof Error && error.stack ? error.stack : errorMessage(error);
      console.error(`Unhandled error on ${req.method} ${req.path}:`, detail, ...(errorCode(error) ? [`(code ${String(errorCode(error))})`] : []));
    }
    res.set("Cache-Control", "no-store");
    return res.status(status).json({ message } satisfies ErrorResponse);
  };
}
