// Opt-in scale measurement for the reverse reconciliation (R31): how long plan,
// apply and verify take, and how much memory they hold, at a given size.
// Synthetic data only, on the throwaway PostgreSQL container and an in-memory
// MongoDB. Skipped unless RECONCILE_SCALE is set, e.g.
//   $env:RECONCILE_SCALE = "20000"; npx vitest run --config vitest.db.config.ts test/db/reconcileScale
// N users, N legacy orders with 2 lines each, N/40 products.
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { applyReconciliation, planReconciliation, verifyRollbackTarget } from "../../db/reconciliation/reverse.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const SCALE = Number(process.env.RECONCILE_SCALE ?? 0);
let db: TestDatabase;
let mongo: MongoMemoryServer;

describe.skipIf(!SCALE)(`reconciliation at scale (${SCALE} users and orders)`, () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    await migrate(db.pool, MIGRATIONS_DIRECTORY);
    const products = Math.max(1, Math.floor(SCALE / 40));
    await db.pool.query(`INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0), ('2', 3, 499)`);
    await db.pool.query(`INSERT INTO products (image, name, description, category, price_cents, keywords, highlights)
      SELECT 'images/products/p' || n || '.jpg', 'Product ' || n, repeat('Description. ', 20), 'Category ' || (n % 12), 100 + n, '{a,b}', '{x,y}'
        FROM generate_series(1, $1) n`, [products]);
    await db.pool.query(`INSERT INTO users (id, name, email, password_hash)
      SELECT lpad(to_hex(n), 24, '0'), 'User ' || n, 'user' || n || '@example.com', '$2b$12$' || left(md5(n::text) || md5((n + 1)::text), 53)
        FROM generate_series(1, $1) n`, [SCALE]);
    await db.pool.query(`INSERT INTO orders (is_legacy, ordered_at, total_cost_cents)
      SELECT true, now() - make_interval(days => n % 700), 1000 + n FROM generate_series(1, $1) n`, [SCALE]);
    await db.pool.query(`INSERT INTO order_items (order_id, position, product_id, quantity, estimated_delivery_at)
      SELECT o.id, p.position, (SELECT id FROM products ORDER BY id LIMIT 1 OFFSET (p.position * 7) % $1), 1 + p.position, o.ordered_at + interval '5 days'
        FROM orders o CROSS JOIN (VALUES (0), (1)) AS p(position)`, [products]);
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri("reconcile_scale"));
  }, 600_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
    await db?.drop();
  }, 120_000);

  test("plan, apply and verify: time and memory", async () => {
    const measure = async <T>(label: string, work: () => Promise<T>) => {
      global.gc?.();
      const before = process.memoryUsage();
      let peak = before.rss;
      const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 50);
      const started = performance.now();
      const result = await work();
      clearInterval(sampler);
      const ms = Math.round(performance.now() - started);
      console.log(`${label}: ${ms} ms, peak RSS ${Math.round(peak / 2 ** 20)} MB (start ${Math.round(before.rss / 2 ** 20)} MB)`);
      return result;
    };
    const mongoDb = mongoose.connection.db!;
    const plan = await measure("plan", () => planReconciliation(db.pool, mongoDb));
    expect(plan.inserts.users).toHaveLength(SCALE);
    expect(plan.inserts.orders).toHaveLength(SCALE);
    const report = await measure("apply", () => applyReconciliation(db.pool, mongoDb));
    expect(report.outcome).toBe("completed");
    expect(report.written).toMatchObject({ users: SCALE, orders: SCALE });
    const readiness = await measure("verify", () => verifyRollbackTarget(db.pool, mongoDb));
    expect(readiness).toMatchObject({ ready: true, reasons: [] });
  }, 3_600_000);
});
