import type { Request, RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import User, { type UserDocument } from "../models/User.js";
import { errorMessage } from "../utils/errors.js";
import { isUserId } from "../utils/identifiers.js";

/** Claims issued by authController's generateToken. */
export interface AuthTokenPayload extends JwtPayload {
  id: string;
}

const hasUserId = (decoded: string | JwtPayload): decoded is AuthTokenPayload => (
  typeof decoded !== "string" && typeof decoded.id === "string"
);

export const protect: RequestHandler = async (req, res, next) => {
  const authorization = req.get("Authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];

  if (!bearerToken) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret?.trim()) {
    return res.status(500).json({ message: "Server error" });
  }

  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(bearerToken, secret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Not authorized" });
  }

  if (!hasUserId(decoded) || !isUserId(decoded.id)) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }
    req.user = user;
  } catch (error) {
    console.error("Authentication failed:", errorMessage(error));
    return res.status(500).json({ message: "Server error" });
  }

  return next();
};

/**
 * Returns the user attached by protect. Routes that call this always run
 * protect first; the throw only replaces the TypeError the JavaScript
 * handlers would have raised reading a property of a missing req.user.
 */
export function requireUser(req: Request): UserDocument {
  if (!req.user) {
    throw new Error("Authenticated user missing: protect must run before this handler");
  }

  return req.user;
}

export const adminOnly: RequestHandler = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  return next();
};
