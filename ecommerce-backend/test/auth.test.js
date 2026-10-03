import assert from "node:assert/strict";
import { after, before, beforeEach, mock, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import authRoutes from "../routes/authRoutes.js";

const secret = "authentication-tests-only-secret";
const validUser = {
  name: "Test User",
  email: "test@example.com",
  password: "test-password-123"
};

let previousSecret;
let server;
let baseUrl;
let records;
let reads;
let readError;
let insertError;

// Stub only MongoDB transport so Mongoose validation, selection, and save hooks run.
before(async () => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;

  mock.method(User.collection, "findOne", async (filter, options = {}) => {
    reads.push({ filter, options });
    if (readError) throw readError;

    const document = [...records.values()].find((record) =>
      Object.entries(filter).every(([key, value]) => String(record[key]) === String(value))
    );
    if (!document) return null;

    const result = { ...document };
    if (options.projection?.password === 0) delete result.password;
    return result;
  });

  mock.method(User.collection, "insertOne", async (document) => {
    if (insertError) throw insertError;
    if ([...records.values()].some((record) => record.email === document.email)) {
      throw Object.assign(new Error("Duplicate email"), { code: 11000 });
    }
    records.set(String(document._id), { ...document });
    return { acknowledged: true, insertedId: document._id };
  });

  mock.method(User.collection, "updateOne", async (filter, update) => {
    const document = records.get(String(filter._id));
    if (!document) return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    Object.assign(document, update.$set);
    for (const key of Object.keys(update.$unset ?? {})) delete document[key];
    return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
  });

  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  server = await new Promise((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    listener.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

beforeEach(() => {
  records = new Map();
  reads = [];
  readError = undefined;
  insertError = undefined;
  process.env.JWT_SECRET = secret;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
  mock.restoreAll();
  if (previousSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

async function post(endpoint, body) {
  const response = await fetch(`${baseUrl}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function getProfile(authorization) {
  const response = await fetch(`${baseUrl}/profile`, {
    headers: authorization === undefined ? {} : { Authorization: authorization }
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function assertUserResponse(body, storedUser) {
  assert.deepEqual(Object.keys(body).sort(), ["_id", "email", "isAdmin", "name", "token"]);
  assert.equal(body._id, String(storedUser._id));
  assert.equal(body.name, storedUser.name);
  assert.equal(body.email, storedUser.email);
  assert.equal(body.isAdmin, false);
  const claims = jwt.verify(body.token, secret, { algorithms: ["HS256"] });
  assert.equal(claims.id, String(storedUser._id));
  assert.equal(claims.exp - claims.iat, 30 * 24 * 60 * 60);
  assert.ok(Math.abs(claims.iat - Date.now() / 1000) < 5);
}

test("registration normalizes user data, hashes the password, and issues a 30-day JWT", async () => {
  const response = await post("register", {
    ...validUser,
    name: "  Test User  ",
    email: "  TEST@EXAMPLE.COM  ",
    isAdmin: true
  });

  assert.equal(response.status, 201);
  assert.equal(records.size, 1);
  const storedUser = [...records.values()][0];
  assert.equal(storedUser.name, validUser.name);
  assert.equal(storedUser.email, validUser.email);
  assert.equal(storedUser.isAdmin, false);
  assert.notEqual(storedUser.password, validUser.password);
  assert.match(storedUser.password, /^\$2[aby]\$12\$/);
  assert.equal(await User.hydrate(storedUser).matchPassword(validUser.password), true);
  assertUserResponse(response.body, storedUser);
});

test("duplicate registration returns 409 without creating another user", async () => {
  await User.create(validUser);
  const response = await post("register", { ...validUser, email: "TEST@EXAMPLE.COM" });
  assert.equal(response.status, 409);
  assert.equal(records.size, 1);
  assert.equal(typeof response.body.message, "string");
});

test("registration handles a duplicate-key race as a conflict", async () => {
  insertError = Object.assign(new Error("Internal duplicate-key details"), { code: 11000 });
  const response = await post("register", validUser);
  assert.equal(response.status, 409);
  assert.equal(records.size, 0);
  assert.doesNotMatch(JSON.stringify(response.body), /Internal duplicate-key details/);
});

test("registration rejects invalid data and query-shaped inputs before querying MongoDB", async () => {
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
    { ...validUser, password: "é".repeat(37) }
  ];
  for (const body of invalidBodies) {
    const response = await post("register", body);
    assert.equal(response.status, 400, `Expected rejection for ${JSON.stringify(body)}`);
    assert.equal(typeof response.body.message, "string");
  }
  assert.equal(reads.length, 0);
  assert.equal(records.size, 0);
});

test("registration accepts a password at bcrypt's 72-byte limit", async () => {
  const password = "é".repeat(36);
  const response = await post("register", { ...validUser, password });
  assert.equal(response.status, 201);
  const storedUser = [...records.values()][0];
  assert.equal(await User.hydrate(storedUser).matchPassword(password), true);
});

test("login explicitly loads the hidden password and issues a JWT", async () => {
  const storedUser = await User.create(validUser);
  const response = await post("login", {
    email: "  TEST@EXAMPLE.COM  ",
    password: validUser.password
  });
  assert.equal(response.status, 200);
  assertUserResponse(response.body, storedUser);
  assert.equal(reads.at(-1).options.projection?.password === 0, false);
});

test("login gives the same response for an unknown user and a wrong password", async () => {
  await User.create(validUser);
  const wrongPassword = await post("login", { email: validUser.email, password: "wrong-password" });
  const unknownUser = await post("login", { email: "unknown@example.com", password: validUser.password });
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
  assert.deepEqual(wrongPassword.body, { message: "Invalid email or password" });
});

test("login rejects missing credentials, query-shaped values, and oversized passwords", async () => {
  const invalidBodies = [
    {},
    [],
    { email: validUser.email },
    { email: " ", password: validUser.password },
    { email: { $ne: null }, password: validUser.password },
    { email: validUser.email, password: "" },
    { email: validUser.email, password: { $ne: null } },
    { email: validUser.email, password: "é".repeat(37) }
  ];
  for (const body of invalidBodies) {
    const response = await post("login", body);
    assert.equal(response.status, 400, `Expected rejection for ${JSON.stringify(body)}`);
  }
  assert.equal(reads.length, 0);
});

for (const endpoint of ["register", "login"]) {
  test(`${endpoint} returns a generic response when a database query fails`, async () => {
    readError = new Error("Private connection details");
    const response = await post(endpoint, validUser);
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { message: "Server error" });
  });
}

test("registration returns 400 for model validation errors", async () => {
  insertError = new mongoose.Error.ValidationError();
  const response = await post("register", validUser);
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { message: "Invalid user data" });
});

test("registration returns a generic response when saving fails", async () => {
  insertError = new Error("Private write details");
  const response = await post("register", validUser);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "Server error" });
});

test("ordinary user queries and JSON serialization exclude the password", async () => {
  const created = await User.create(validUser);
  assert.equal("password" in created.toJSON(), false);
  const selected = await User.findOne({ email: validUser.email });
  assert.equal(selected.password, undefined);
  assert.equal(reads.at(-1).options.projection.password, 0);
  assert.equal(await selected.matchPassword(validUser.password), false);
});

test("saving a user without changing the password preserves its hash", async () => {
  const created = await User.create(validUser);
  const originalHash = records.get(String(created._id)).password;
  const selected = await User.findOne({ email: validUser.email });
  selected.name = "Updated User";
  await selected.save();
  const storedUser = records.get(String(created._id));
  assert.equal(storedUser.name, "Updated User");
  assert.equal(storedUser.password, originalHash);
  assert.equal(await User.hydrate(storedUser).matchPassword(validUser.password), true);
});

test("the model rejects oversized passwords before writing", async () => {
  await assert.rejects(User.create({ ...validUser, password: "é".repeat(37) }), {
    name: "ValidationError"
  });
  assert.equal(records.size, 0);
});

test("the model hashes a changed password and stops accepting the old one", async () => {
  const user = await User.create(validUser);
  user.password = "replacement-password";
  await user.save();
  const storedUser = User.hydrate(records.get(String(user._id)));
  assert.equal(await storedUser.matchPassword("replacement-password"), true);
  assert.equal(await storedUser.matchPassword(validUser.password), false);
});

test("profile accepts the issued bearer token and returns only current public user fields", async () => {
  const registration = await post("register", validUser);
  assert.equal(registration.status, 201);
  const storedUser = records.get(registration.body._id);
  storedUser.name = "Updated Profile";
  storedUser.isAdmin = true;

  const response = await getProfile(`Bearer ${registration.body.token}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    _id: registration.body._id,
    name: "Updated Profile",
    email: validUser.email,
    isAdmin: true
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(reads.at(-1).options.projection.password, 0);
  assert.equal(String(reads.at(-1).filter._id), registration.body._id);
});

test("profile accepts the case-insensitive bearer authentication scheme", async () => {
  const user = await User.create(validUser);
  const token = jwt.sign({ id: user.id }, secret, { expiresIn: "30d" });
  const response = await getProfile(`bearer ${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.body._id, user.id);
});

test("profile rejects missing and malformed authorization headers before querying MongoDB", async () => {
  for (const authorization of [undefined, "", "Bearer", "Basic credentials", "Bearer one two"]) {
    const response = await getProfile(authorization);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { message: "Not authorized" });
  }
  assert.equal(reads.length, 0);
});

test("profile rejects invalid signatures, expired or future tokens, and unapproved algorithms", async () => {
  const id = new mongoose.Types.ObjectId().toString();
  const invalidTokens = [
    "not-a-jwt",
    jwt.sign({ id }, "different-secret", { expiresIn: "30d" }),
    jwt.sign({ id }, secret, { expiresIn: -1 }),
    jwt.sign({ id }, secret, { notBefore: "1h", expiresIn: "30d" }),
    jwt.sign({ id }, secret, { algorithm: "HS384", expiresIn: "30d" }),
    jwt.sign({ id }, null, { algorithm: "none", expiresIn: "30d" })
  ];
  for (const token of invalidTokens) {
    const response = await getProfile(`Bearer ${token}`);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { message: "Not authorized" });
  }
  assert.equal(reads.length, 0);
});

test("profile rejects missing, malformed, and query-shaped user IDs in signed tokens", async () => {
  for (const payload of [{}, { id: "invalid" }, { id: { $ne: null } }, { id: 123 }]) {
    const token = jwt.sign(payload, secret, { expiresIn: "30d" });
    const response = await getProfile(`Bearer ${token}`);
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { message: "Not authorized" });
  }
  assert.equal(reads.length, 0);
});

test("profile rejects a valid token when its user no longer exists", async () => {
  const id = new mongoose.Types.ObjectId().toString();
  const token = jwt.sign({ id }, secret, { expiresIn: "30d" });
  const response = await getProfile(`Bearer ${token}`);
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, { message: "Not authorized" });
  assert.equal(reads.length, 1);
});

test("profile reports database failures as generic server errors", async () => {
  readError = new Error("Private connection details");
  const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, secret, { expiresIn: "30d" });
  const response = await getProfile(`Bearer ${token}`);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "Server error" });
});

test("profile reports missing server signing configuration as a generic server error", async () => {
  const token = jwt.sign({ id: new mongoose.Types.ObjectId().toString() }, secret, { expiresIn: "30d" });
  delete process.env.JWT_SECRET;
  const response = await getProfile(`Bearer ${token}`);
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { message: "Server error" });
  assert.equal(reads.length, 0);
});
