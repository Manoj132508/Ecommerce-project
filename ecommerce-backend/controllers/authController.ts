import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { requireUser } from "../middleware/authMiddleware.js";
import { authenticateWithOptionalLimit, sendTooManyAttempts, type AuthRateLimiter } from "../auth/rateLimit.js";
import type { AuthUser, UserRepository } from "../repositories/types.js";
import type { AuthResponse, ErrorResponse, UserProfile } from "../types/api.js";
import { errorCode, errorMessage, errorName } from "../utils/errors.js";

type NoParams = Record<string, string>;

// Request bodies are untrusted JSON: every field is validated before use.
export interface RegisterBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}

type LoginBody = Omit<RegisterBody, "name">;

export type RegistrationResult =
  | { kind: "created"; user: AuthUser }
  | { kind: "invalid"; message: string }
  | { kind: "exists" };

/**
 * Registration rules and account creation, shared by the legacy endpoint and
 * the cookie-session flow (POST /api/auth/accounts) so both behave the same.
 */
export async function registerAccount(users: UserRepository, body: RegisterBody | undefined): Promise<RegistrationResult> {
  const { name, email, password } = body || {};

  if (
    typeof name !== "string" || !name.trim() ||
    typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
    typeof password !== "string" || password.length < 8 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return { kind: "invalid", message: "Provide a name, valid email, and password of at least 8 characters (maximum 72 bytes)" };
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (await users.findByEmail(normalizedEmail)) {
    return { kind: "exists" };
  }

  try {
    return { kind: "created", user: await users.create({ name: name.trim(), email: normalizedEmail, password }) };
  } catch (error) {
    // The unique email index also handles simultaneous registrations.
    if (errorCode(error) === 11000) return { kind: "exists" };
    if (errorName(error) === "ValidationError") return { kind: "invalid", message: "Invalid user data" };
    throw error;
  }
}

/** Login body checks shared by the legacy and the cookie-session login. */
export function loginCredentials(body: LoginBody | undefined): { email: string; password: string } | null {
  const { email, password } = body ?? {};
  if (
    typeof email !== "string" || !email.trim() ||
    typeof password !== "string" || !password ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return null;
  }
  return { email: email.trim().toLowerCase(), password };
}

const generateToken = (id: string) => {
  const secret = process.env.JWT_SECRET;
  // Same failure as jsonwebtoken's own "secretOrPrivateKey must have a value".
  if (!secret) {
    throw new Error("JWT_SECRET is missing");
  }

  return jwt.sign({ id }, secret, {
    expiresIn: "30d"
  });
};

const userResponse = (user: AuthUser): AuthResponse => ({
  _id: user.id,
  name: user.name,
  email: user.email,
  isAdmin: user.isAdmin,
  token: generateToken(user.id)
});

export function createAuthController(users: UserRepository, rateLimiter?: AuthRateLimiter) {
  // @desc Register user
  // @route POST /api/auth/register
  const registerUser: RequestHandler<NoParams, AuthResponse | ErrorResponse, RegisterBody | undefined> = async (req, res) => {
    try {
      const result = await registerAccount(users, req.body);

      if (result.kind === "invalid") {
        return res.status(400).json({ message: result.message });
      }
      if (result.kind === "exists") {
        return res.status(409).json({ message: "User already exists" });
      }

      return res.status(201).json(userResponse(result.user));
    } catch (error) {
      console.error("Registration failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }
  };

  // @desc Login user
  // @route POST /api/auth/login
  const loginUser: RequestHandler<NoParams, AuthResponse | ErrorResponse, LoginBody | undefined> = async (req, res) => {
    try {
      const credentials = loginCredentials(req.body);

      if (!credentials) {
        return res.status(400).json({ message: "Provide an email and password" });
      }

      const result = await authenticateWithOptionalLimit(users, rateLimiter, credentials.email, credentials.password);

      if (result.kind === "limited") {
        return sendTooManyAttempts(res, result.retryAfterSeconds);
      }
      if (result.kind === "invalid") {
        return res.status(401).json({ message: "Invalid email or password" });
      }

      return res.status(200).json(userResponse(result.user));
    } catch (error) {
      console.error("Login failed:", errorMessage(error));
      return res.status(500).json({ message: "Server error" });
    }
  };

  // @desc Get the authenticated user's current profile
  // @route GET /api/auth/profile
  const getUserProfile: RequestHandler<NoParams, UserProfile> = (req, res) => {
    const user = requireUser(req);
    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      _id: user.id,
      name: user.name,
      email: user.email,
      isAdmin: user.isAdmin
    });
  };

  return { registerUser, loginUser, getUserProfile };
}
