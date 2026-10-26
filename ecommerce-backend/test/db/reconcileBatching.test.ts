// Batched writes in applyReconciliation (Phase 7A): an interruption between
// batches leaves a whole-batch prefix, the gate stays closed, and a re-run
// completes without duplicates. Disposable databases only.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { applyReconciliation, verifyRollbackTarget, WRITE_BATCH } from "../../db/reconciliation/reverse.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const USERS = WRITE_BATCH * 2 + 200; // three batches
let mongo: MongoMemoryServer;
let db: TestDatabase;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
}, 120_000);

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  await db.pool.query(`INSERT INTO users (id, name, email, password_hash)
    SELECT lpad(to_hex(n), 24, '0'), 'User ' || n, 'user' || n || '@example.com', '$2b$12$' || left(md5(n::text) || md5((n + 1)::text), 53)
      FROM generate_series(1, $1) n`, [USERS]);
  await mongoose.connect(mongo.getUri(`batching_${db.name}`));
});

afterEach(async () => {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
  await db.drop();
});

describe("batched reconciliation writes", () => {
  test("interrupted after the first users batch: exactly one batch written, not ready; a re-run completes without duplicates", async () => {
    const mongoDb = mongoose.connection.db!;
    let userBatches = 0;
    await expect(applyReconciliation(db.pool, mongoDb, {
      beforeWrite: (step) => {
        if (step !== "users") return;
        userBatches += 1;
        if (userBatches === 2) throw new Error("connection lost");
      },
    })).rejects.toThrow("connection lost");
    expect(await mongoDb.collection("users").countDocuments()).toBe(WRITE_BATCH);
    expect((await verifyRollbackTarget(db.pool, mongoDb)).ready).toBe(false);

    const report = await applyReconciliation(db.pool, mongoDb);
    expect(report.outcome).toBe("completed");
    expect(await mongoDb.collection("users").countDocuments()).toBe(USERS);
    expect(new Set((await mongoDb.collection("users").find({}, { projection: { email: 1 } }).toArray()).map((user) => user.email)).size).toBe(USERS);
    expect(await verifyRollbackTarget(db.pool, mongoDb)).toMatchObject({ ready: true, reasons: [] });
  }, 120_000);
});
