// Rate limiting for authentication endpoints (R37). Counters live in a shared
// database (auth/rateLimitStores.ts), so every API instance enforces the same
// limits; nothing is kept in process memory.
//
//   AUTH_RATE_LIMIT                              "true" (default) | "false" (refused in production)
//   AUTH_RATE_LIMIT_WINDOW_MINUTES               default 15
//   AUTH_RATE_LIMIT_LOGIN_PER_IP                 login attempts per client address (default 20)
//   AUTH_RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT   failed logins per email address (default 10)
//   AUTH_RATE_LIMIT_REGISTER_PER_IP              registrations per client address (default 10)
//   AUTH_RATE_LIMIT_EXCHANGE_PER_IP              token exchanges per client address (default 20)
//
// Every limited response is the same 429, whether or not the account exists.
// Counters are keyed by SHA-256(rule, subject): no email or address is stored.
import { createHash } from "node:crypto";
import type { RequestHandler, Response } from "express";
import type { AuthUser, UserRepository } from "../repositories/types.js";
import { errorMessage } from "../utils/errors.js";
import { clientAddress, rateLimitSubject, type ClientIpConfig } from "./clientIp.js";

export interface RateLimitRule {
  name: string;
  limit: number;
  windowSeconds: number;
}

export interface AuthRateLimitRules {
  loginPerIp: RateLimitRule;
  loginFailuresPerAccount: RateLimitRule;
  registerPerIp: RateLimitRule;
  exchangePerIp: RateLimitRule;
}

export interface RateLimitCount {
  hits: number;
  /** Seconds until the window ends (0 when there is no live window). */
  resetInSeconds: number;
}

export interface RateLimitStore {
  /** Atomically counts one hit in the key's current window, starting a new window if it expired. */
  hit(key: Buffer, windowSeconds: number): Promise<RateLimitCount>;
  /** The live count without adding to it. */
  peek(key: Buffer): Promise<RateLimitCount>;
  clear(key: Buffer): Promise<void>;
}

export const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a few minutes and try again.";
const UNAVAILABLE = "Sign-in is temporarily unavailable. Please try again shortly.";

export class RateLimitConfigError extends Error {
  override name = "RateLimitConfigError";
}

type Environment = Record<string, string | undefined>;

function count(env: Environment, variable: string, fallback: number, max = 10_000): number {
  const value = env[variable]?.trim();
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > max) {
    throw new RateLimitConfigError(`${variable} must be a whole number from 1 to ${max}.`);
  }
  return Number(value);
}

/** Null when rate limiting is turned off (development only). */
export function loadAuthRateLimitRules(env: Environment): AuthRateLimitRules | null {
  const flag = env.AUTH_RATE_LIMIT?.trim() || "true";
  if (flag !== "true" && flag !== "false") throw new RateLimitConfigError('AUTH_RATE_LIMIT must be "true" or "false".');
  if (flag === "false") {
    if (env.NODE_ENV === "production") throw new RateLimitConfigError("AUTH_RATE_LIMIT cannot be turned off with NODE_ENV=production.");
    return null;
  }
  const windowSeconds = count(env, "AUTH_RATE_LIMIT_WINDOW_MINUTES", 15, 1440) * 60;
  return {
    loginPerIp: { name: "login-ip", limit: count(env, "AUTH_RATE_LIMIT_LOGIN_PER_IP", 20), windowSeconds },
    loginFailuresPerAccount: { name: "login-account", limit: count(env, "AUTH_RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT", 10), windowSeconds },
    registerPerIp: { name: "register-ip", limit: count(env, "AUTH_RATE_LIMIT_REGISTER_PER_IP", 10), windowSeconds },
    exchangePerIp: { name: "exchange-ip", limit: count(env, "AUTH_RATE_LIMIT_EXCHANGE_PER_IP", 20), windowSeconds },
  };
}

export function sendTooManyAttempts(res: Response, retryAfterSeconds: number) {
  res.set("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.set("Cache-Control", "no-store");
  return res.status(429).json({ message: TOO_MANY_ATTEMPTS });
}

export type LimitedLogin =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "invalid" }
  | { kind: "limited"; retryAfterSeconds: number };

export class AuthRateLimiter {
  constructor(
    private readonly store: RateLimitStore,
    readonly rules: AuthRateLimitRules,
    private readonly clientIp: ClientIpConfig,
  ) {}

  private key(rule: RateLimitRule, subject: string): Buffer {
    return createHash("sha256").update(`${rule.name}\0${subject}`).digest();
  }

  /** Counts every request from the client address; 429 once over the limit, 503 if the store fails. */
  perIp(rule: RateLimitRule): RequestHandler {
    return async (req, res, next) => {
      try {
        const subject = rateLimitSubject(clientAddress(req, this.clientIp));
        const current = await this.store.hit(this.key(rule, subject), rule.windowSeconds);
        if (current.hits > rule.limit) return sendTooManyAttempts(res, current.resetInSeconds);
      } catch (error) {
        // Fail closed: without a working limiter, sign-in is not offered.
        console.error("Rate limiting unavailable:", errorMessage(error));
        res.set("Retry-After", "30");
        return res.status(503).json({ message: UNAVAILABLE });
      }
      return next();
    };
  }

  /**
   * Password check with the per-account failure limit. A locked account is
   * refused before the password is checked, even if it is right, and unknown
   * emails are counted exactly like known ones.
   *
   * The attempt is counted (one atomic increment) before the password is
   * checked, so simultaneous attempts cannot all see the count from before the
   * burst: at most `limit` checks run per window, however many arrive at once.
   * A wrong password keeps its count; the right one clears the account's count.
   * If the check itself fails, the attempt stays counted (fail closed).
   */
  async authenticate(users: UserRepository, email: string, password: string): Promise<LimitedLogin> {
    const rule = this.rules.loginFailuresPerAccount;
    const key = this.key(rule, email);
    const attempt = await this.store.hit(key, rule.windowSeconds);
    if (attempt.hits > rule.limit) return { kind: "limited", retryAfterSeconds: attempt.resetInSeconds };

    const user = await users.authenticate(email, password);
    if (!user) return { kind: "invalid" };
    await this.store.clear(key);
    return { kind: "authenticated", user };
  }
}

/** Login without a limiter (tests and development with AUTH_RATE_LIMIT=false). */
export async function authenticateWithOptionalLimit(
  users: UserRepository,
  limiter: AuthRateLimiter | undefined,
  email: string,
  password: string,
): Promise<LimitedLogin> {
  if (limiter) return limiter.authenticate(users, email, password);
  const user = await users.authenticate(email, password);
  return user ? { kind: "authenticated", user } : { kind: "invalid" };
}

/** Per-IP middleware for a rule, or nothing when rate limiting is off. */
export const limitPerIp = (limiter: AuthRateLimiter | undefined, pick: (rules: AuthRateLimitRules) => RateLimitRule): RequestHandler[] => (
  limiter ? [limiter.perIp(pick(limiter.rules))] : []
);
