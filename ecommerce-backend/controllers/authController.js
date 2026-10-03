import User from "../models/User.js";
import jwt from "jsonwebtoken";

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: "30d"
  });
};

const userResponse = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  isAdmin: user.isAdmin,
  token: generateToken(user._id)
});

// @desc Register user
// @route POST /api/auth/register
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {};

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
    if (error.code === 11000) {
      return res.status(409).json({ message: "User already exists" });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Invalid user data" });
    }

    console.error("Registration failed:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc Login user
// @route POST /api/auth/login
export const loginUser = async (req, res) => {
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
    console.error("Login failed:", error.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// @desc Get the authenticated user's current profile
// @route GET /api/auth/profile
export const getUserProfile = (req, res) => {
  res.set("Cache-Control", "no-store");
  return res.status(200).json({
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    isAdmin: req.user.isAdmin
  });
};
