import jwt from "jsonwebtoken";
import User from "../models/User.js";

export const protect = async (req, res, next) => {
  const authorization = req.get("Authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(\S+)$/i);

  if (!bearerToken) {
    return res.status(401).json({ message: "Not authorized" });
  }

  const secret = process.env.JWT_SECRET;
  if (!secret?.trim()) {
    return res.status(500).json({ message: "Server error" });
  }

  let decoded;
  try {
    decoded = jwt.verify(bearerToken[1], secret, { algorithms: ["HS256"] });
  } catch {
    return res.status(401).json({ message: "Not authorized" });
  }

  if (typeof decoded?.id !== "string" || !/^[a-f\d]{24}$/i.test(decoded.id)) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }
    req.user = user;
  } catch (error) {
    console.error("Authentication failed:", error.message);
    return res.status(500).json({ message: "Server error" });
  }

  next();
};

export const adminOnly = (req, res, next) => {
  if (!req.user?.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }

  next();
};
