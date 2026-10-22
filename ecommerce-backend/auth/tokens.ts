// Opaque session tokens. The browser holds the token (HttpOnly cookie); the
// database holds only its SHA-256. The CSRF token is derived from the session
// token, so it needs no storage and cannot be computed without the cookie.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes (256 bits), base64url without padding: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const generateSessionToken = (): string => randomBytes(32).toString("base64url");

export const isWellFormedToken = (value: string): boolean => TOKEN_PATTERN.test(value);

/** What PostgreSQL stores. A copy of the table cannot be replayed as a cookie. */
export const hashSessionToken = (token: string): Buffer => createHash("sha256").update(token, "utf8").digest();

/** Domain-separated from the stored hash, so a database copy does not reveal it either. */
export const csrfTokenFor = (sessionToken: string): string => (
  createHmac("sha256", sessionToken).update("ecommerce csrf v1").digest("base64url")
);

export function csrfTokenMatches(sessionToken: string, presented: string | undefined): boolean {
  if (typeof presented !== "string") return false;
  const expected = Buffer.from(csrfTokenFor(sessionToken));
  const actual = Buffer.from(presented);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
