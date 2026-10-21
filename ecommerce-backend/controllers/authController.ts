import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { requireUser } from "../middleware/authMiddleware.js";
import User, { type UserDocument } from "../models/User.js";
import type { AuthResponse, ErrorResponse, UserProfile } from "../types/api.js";
import { errorCode, errorMessage, errorName } from "../utils/errors.js";

type NoParams = Record<string, string>;

// Request bodies are untrusted JSON: every field is validated before use.
interface RegisterBody {
  name?: unknown;
  email?: unknown;
  password?: unknown;
}

type LoginBody = Omit<RegisterBody, "name">;

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

const userResponse = (user: UserDocument): AuthResponse => ({
  _id: String(user._id),
  name: user.name,
  email: user.email,
  isAdmin: user.isAdmin,
  token: generateToken(String(user._id))
});

// @desc Register user
// @route POST /api/auth/register
export const registerUser: RequestHandler<NoParams, AuthResponse | ErrorResponse, RegisterBody | undefined> = async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (
      typeof name !== "string" || !name.trim() ||
      typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== "string" || password.length < 8 ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({
        message: "Provide a name, valid email, and password of at least 8 characters (maximum 72 bytes)"
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const userExists = await User.findOne({ email: normalizedEmail });

    if (userExists) {
      return res.status(409).json({ message: "User already exists" });
    }

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password
    });

    return res.status(201).json(userResponse(user));
  } catch (error) {
    // The unique email index also handles simultaneous registrations.
    if (errorCode(error) === 11000) {
      return res.status(409).json({ message: "User already exists" });
    }

    if (errorName(error) === "ValidationError") {
      return res.status(400).json({ message: "Invalid user data" });
    }

    console.error("Registration failed:", errorMessage(error));
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc Login user
// @route POST /api/auth/login
export const loginUser: RequestHandler<NoParams, AuthResponse | ErrorResponse, LoginBody | undefined> = async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (
      typeof email !== "string" || !email.trim() ||
      typeof password !== "string" || !password ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return res.status(400).json({ message: "Provide an email and password" });
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() })
      .select("+password");

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    return res.status(200).json(userResponse(user));
  } catch (error) {
    console.error("Login failed:", errorMessage(error));
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc Get the authenticated user's current profile
// @route GET /api/auth/profile
export const getUserProfile: RequestHandler<NoParams, UserProfile> = (req, res) => {
  const user = requireUser(req);
  res.set("Cache-Control", "no-store");
  return res.status(200).json({
    _id: String(user._id),
    name: user.name,
    email: user.email,
    isAdmin: user.isAdmin
  });
};
