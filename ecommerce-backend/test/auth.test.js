// Ported from the node:test suite at commit 4e622f5 (test/auth.test.js) to
// Vitest + Supertest, running against an in-memory MongoDB instead of a
// mocked collection. Every original case is preserved.
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { describe, expect, test, vi } from "vitest";
import User from "../models/User.js";
import { api } from "./helpers.js";

const secret = () => process.env.JWT_SECRET;
const validUser = {
  name: "Test User",
  email: "test@example.com",
  password: "test-password-123",
};

const post = (endpoint, body) => api().post(`/api/auth/${endpoint}`).send(body);

const getProfile = (authorization) => {
  const req = api().get("/api/auth/profile");
  return authorization === undefined ? req : req.set("Authorization", authorization);
};

// Counts reads and keeps the call arguments without changing behaviour.
const spyReads = () => vi.spyOn(User.collection, "findOne");

const storedUsers = () => User.collection.find({}).toArray();

async function expectUserResponse(body, storedUser) {
  expect(Object.keys(body).sort()).toEqual(["_id", "email", "isAdmin", "name", "token"]);
  expect(body._id).toBe(String(storedUser._id));
  expect(body.name).toBe(storedUser.name);
  expect(body.email).toBe(storedUser.email);
  expect(body.isAdmin).toBe(false);
  const claims = jwt.verify(body.token, secret(), { algorithms: ["HS256"] });
  expect(claims.id).toBe(String(storedUser._id));
  expect(claims.exp - claims.iat).toBe(30 * 24 * 60 * 60);
  expect(Math.abs(claims.iat - Date.now() / 1000)).toBeLessThan(5);
}

describe("POST /api/auth/register", () => {
  test("normalizes user data, hashes the password, and issues a 30-day JWT", async () => {
    const response = await post("register", {
      ...validUser,
      name: "  Test User  ",
      email: "  TEST@EXAMPLE.COM  ",
      isAdmin: true,
    });

    expect(response.status).toBe(201);
    const users = await storedUsers();
    expect(users).toHaveLength(1);
    const [storedUser] = users;
    expect(storedUser.name).toBe(validUser.name);
    expect(storedUser.email).toBe(validUser.email);
    expect(storedUser.isAdmin).toBe(false);
    expect(storedUser.password).not.toBe(validUser.password);
    expect(storedUser.password).toMatch(/^\$2[aby]\$12\$/);
    expect(await User.hydrate(storedUser).matchPassword(validUser.password)).toBe(true);
    await expectUserResponse(response.body, storedUser);
  });

  test("duplicate registration returns 409 without creating another user", async () => {
    await User.create(validUser);
    const response = await post("register", { ...validUser, email: "TEST@EXAMPLE.COM" });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ message: "User already exists" });
    expect(await storedUsers()).toHaveLength(1);
  });

  test("handles a duplicate-key race as a conflict without leaking details", async () => {
    vi.spyOn(User.collection, "insertOne").mockRejectedValueOnce(
      Object.assign(new Error("Internal duplicate-key details"), { code: 11000 }),
    );
    const response = await post("register", validUser);
    expect(response.status).toBe(409);
    expect(await storedUsers()).toHaveLength(0);
    expect(JSON.stringify(response.body)).not.toMatch(/Internal duplicate-key details/);
  });

  test("rejects invalid data and query-shaped inputs before querying MongoDB", async () => {
    const reads = spyReads();
    const invalidBodies = [
      {},
      [],
      { ...validUser, name: "   " },
      { ...validUser, name: { $ne: null } },
      { ...validUser, email: "invalid-email" },
      { ...validUser, email: { $ne: null } },
      { ...validUser, password: "short" },
      { ...validUser, password: { $ne: null } },
      { ...validUser, password: "a".repeat(73) },
      { ...validUser, password: "é".repeat(37) },
    ];
    for (const body of invalidBodies) {
      const response = await post("register", body);
      expect(response.status, `Expected rejection for ${JSON.stringify(body)}`).toBe(400);
      expect(response.body).toEqual({
        message: "Provide a name, valid email, and password of at least 8 characters (maximum 72 bytes)",
      });
    }
    expect(reads).not.toHaveBeenCalled();
    expect(await storedUsers()).toHaveLength(0);
  });

  test("accepts a password at bcrypt's 72-byte limit", async () => {
    const password = "é".repeat(36);
    const response = await post("register", { ...validUser, password });
    expect(response.status).toBe(201);
    const [storedUser] = await storedUsers();
    expect(await User.hydrate(storedUser).matchPassword(password)).toBe(true);
  });

  test("returns 400 for model validation errors", async () => {
    vi.spyOn(User.collection, "insertOne").mockRejectedValueOnce(new mongoose.Error.ValidationError());
    const response = await post("register", validUser);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ message: "Invalid user data" });
  });

  test("returns a generic response when saving fails", async () => {
    vi.spyOn(User.collection, "insertOne").mockRejectedValueOnce(new Error("Private write details"));
    const response = await post("register", validUser);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
  });
});

describe("POST /api/auth/login", () => {
  test("explicitly loads the hidden password and issues a JWT", async () => {
    const storedUser = await User.create(validUser);
    const reads = spyReads();
    const response = await post("login", {
      email: "  TEST@EXAMPLE.COM  ",
      password: validUser.password,
    });
    expect(response.status).toBe(200);
    await expectUserResponse(response.body, storedUser);
    expect(reads.mock.calls.at(-1)[1]?.projection?.password === 0).toBe(false);
  });

  test("gives the same response for an unknown user and a wrong password", async () => {
    await User.create(validUser);
    const wrongPassword = await post("login", { email: validUser.email, password: "wrong-password" });
    const unknownUser = await post("login", { email: "unknown@example.com", password: validUser.password });
    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownUser.body);
    expect(wrongPassword.body).toEqual({ message: "Invalid email or password" });
  });

  test("rejects missing credentials, query-shaped values, and oversized passwords", async () => {
    const reads = spyReads();
    const invalidBodies = [
      {},
      [],
      { email: validUser.email },
      { email: " ", password: validUser.password },
      { email: { $ne: null }, password: validUser.password },
      { email: validUser.email, password: "" },
      { email: validUser.email, password: { $ne: null } },
      { email: validUser.email, password: "é".repeat(37) },
    ];
    for (const body of invalidBodies) {
      const response = await post("login", body);
      expect(response.status, `Expected rejection for ${JSON.stringify(body)}`).toBe(400);
      expect(response.body).toEqual({ message: "Provide an email and password" });
    }
    expect(reads).not.toHaveBeenCalled();
  });
});

describe.each(["register", "login"])("POST /api/auth/%s database failure", (endpoint) => {
  test("returns a generic response when a database query fails", async () => {
    vi.spyOn(User.collection, "findOne").mockRejectedValueOnce(new Error("Private connection details"));
    const response = await post(endpoint, validUser);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
  });
});

describe("User model", () => {
  test("ordinary queries and JSON serialization exclude the password", async () => {
    const created = await User.create(validUser);
    expect("password" in created.toJSON()).toBe(false);
    const reads = spyReads();
    const selected = await User.findOne({ email: validUser.email });
    expect(selected.password).toBeUndefined();
    expect(reads.mock.calls.at(-1)[1].projection.password).toBe(0);
    expect(await selected.matchPassword(validUser.password)).toBe(false);
  });

  test("saving without changing the password preserves its hash", async () => {
    const created = await User.create(validUser);
    const { password: originalHash } = await User.collection.findOne({ _id: created._id });
    const selected = await User.findOne({ email: validUser.email });
    selected.name = "Updated User";
    await selected.save();
    const storedUser = await User.collection.findOne({ _id: created._id });
    expect(storedUser.name).toBe("Updated User");
    expect(storedUser.password).toBe(originalHash);
    expect(await User.hydrate(storedUser).matchPassword(validUser.password)).toBe(true);
  });

  test("rejects oversized passwords before writing", async () => {
    await expect(User.create({ ...validUser, password: "é".repeat(37) }))
      .rejects.toMatchObject({ name: "ValidationError" });
    expect(await storedUsers()).toHaveLength(0);
  });

  test("hashes a changed password and stops accepting the old one", async () => {
    const user = await User.create(validUser);
    user.password = "replacement-password";
    await user.save();
    const storedUser = User.hydrate(await User.collection.findOne({ _id: user._id }));
    expect(await storedUser.matchPassword("replacement-password")).toBe(true);
    expect(await storedUser.matchPassword(validUser.password)).toBe(false);
  });
});

describe("GET /api/auth/profile (and the protect middleware)", () => {
  test("accepts the issued bearer token and returns only current public user fields", async () => {
    const registration = await post("register", validUser);
    expect(registration.status).toBe(201);
    await User.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(registration.body._id) },
      { $set: { name: "Updated Profile", isAdmin: true } },
    );

    const reads = spyReads();
    const response = await getProfile(`Bearer ${registration.body.token}`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      _id: registration.body._id,
      name: "Updated Profile",
      email: validUser.email,
      isAdmin: true,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    const [filter, options] = reads.mock.calls.at(-1);
    expect(options.projection.password).toBe(0);
    expect(String(filter._id)).toBe(registration.body._id);
  });

  test("accepts the case-insensitive bearer authentication scheme", async () => {
    const user = await User.create(validUser);
    const token = jwt.sign({ id: user.id }, secret(), { expiresIn: "30d" });
    const response = await getProfile(`bearer ${token}`);
    expect(response.status).toBe(200);
    expect(response.body._id).toBe(user.id);
  });

  test("rejects missing and malformed authorization headers before querying MongoDB", async () => {
    const reads = spyReads();
    for (const authorization of [undefined, "", "Bearer", "Basic credentials", "Bearer one two"]) {
      const response = await getProfile(authorization);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Not authorized" });
    }
    expect(reads).not.toHaveBeenCalled();
  });

  test("rejects invalid signatures, expired or future tokens, and unapproved algorithms", async () => {
    const reads = spyReads();
    const id = new mongoose.Types.ObjectId().toString();
    const invalidTokens = [
      "not-a-jwt",
      jwt.sign({ id }, "different-secret", { expiresIn: "30d" }),
      jwt.sign({ id }, secret(), { expiresIn: -1 }),
      jwt.sign({ id }, secret(), { notBefore: "1h", expiresIn: "30d" }),
      jwt.sign({ id }, secret(), { algorithm: "HS384", expiresIn: "30d" }),
      jwt.sign({ id }, null, { algorithm: "none", expiresIn: "30d" }),
    ];
    for (const token of invalidTokens) {
      const response = await getProfile(`Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Not authorized" });
    }
    expect(reads).not.toHaveBeenCalled();
  });

  test("rejects missing, malformed, and query-shaped user IDs in signed tokens", async () => {
    const reads = spyReads();
    for (const payload of [{}, { id: "invalid" }, { id: { $ne: null } }, { id: 123 }]) {
      const token = jwt.sign(payload, secret(), { expiresIn: "30d" });
      const response = await getProfile(`Bearer ${token}`);
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ message: "Not authorized" });
    }
    expect(reads).not.toHaveBeenCalled();
  });

  test("rejects a valid token when its user no longer exists", async () => {
    const reads = spyReads();
    const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, secret(), { expiresIn: "30d" });
    const response = await getProfile(`Bearer ${token}`);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ message: "Not authorized" });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  test("reports database failures as generic server errors", async () => {
    vi.spyOn(User.collection, "findOne").mockRejectedValueOnce(new Error("Private connection details"));
    const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, secret(), { expiresIn: "30d" });
    const response = await getProfile(`Bearer ${token}`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
  });

  test("reports missing server signing configuration as a generic server error", async () => {
    const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, secret(), { expiresIn: "30d" });
    delete process.env.JWT_SECRET;
    const reads = spyReads();
    const response = await getProfile(`Bearer ${token}`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ message: "Server error" });
    expect(reads).not.toHaveBeenCalled();
  });
});
