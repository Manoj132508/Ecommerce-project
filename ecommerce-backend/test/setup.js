import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";

// Tests must never reach a real database. Remove any inherited connection
// strings before application code runs; app.js never loads .env itself.
delete process.env.MONGODB_URI;
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = "vitest-only-secret-not-used-anywhere-else";

let mongoServer;

beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    throw new Error("Refusing to run: Mongoose was connected before the test database started.");
  }

  // One private, throwaway mongod per test file.
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  const { hostname, port } = new URL(uri);

  if (!["127.0.0.1", "localhost"].includes(hostname) || Number(port) === 27017) {
    throw new Error(`Refusing to run: unexpected test database address ${hostname}:${port}`);
  }

  await mongoose.connect(uri, { dbName: "vitest_ecommerce" });

  if (mongoose.connection.port !== Number(port) || mongoose.connection.name !== "vitest_ecommerce") {
    throw new Error("Refusing to run: Mongoose is not connected to the in-memory test database.");
  }

  // Build unique indexes (users.email, cartItems.productId) before tests rely on them.
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
});

beforeEach(async () => {
  process.env.JWT_SECRET = "vitest-only-secret-not-used-anywhere-else";
  vi.restoreAllMocks();
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});
