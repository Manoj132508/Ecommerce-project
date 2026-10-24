// scripts/reconcile.ts end to end on disposable databases: a throwaway
// PostgreSQL database and an in-memory MongoDB. The CLI is run as an operator
// would run it (a separate process), and its JSON reports are checked.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { createTestDatabase, MIGRATIONS_DIRECTORY, type TestDatabase } from "./helpers.js";

const BACKEND = fileURLToPath(new URL("../..", import.meta.url));
let mongo: MongoMemoryServer;
let db: TestDatabase;
let mongoUri: string;
let reports: string;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
}, 120_000);

afterAll(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
  // Records that exist only in PostgreSQL, as after a cutover with writes resumed.
  await db.pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0)");
  await db.pool.query("INSERT INTO users (id, name, email, password_hash) VALUES ('6ad8b3e08afe6f8ad3173cac', 'Alice', 'alice@example.com', $1)",
    [await bcrypt.hash("user-password-123", 4)]);
  mongoUri = mongo.getUri(`reconcile_${db.name}`);
  reports = await mkdtemp(path.join(tmpdir(), "reconcile-reports-"));
});

afterEach(async () => {
  await db.drop();
  await rm(reports, { recursive: true, force: true });
});

async function cli(args: string[], env: Record<string, string> = {}) {
  const report = path.join(reports, `${args[0]}-${Date.now()}.json`);
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/reconcile.ts", ...args, "--report", report], {
    cwd: BACKEND,
    // Explicit URLs: a local .env is loaded by the CLI, but never overrides a variable that is set.
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", MONGODB_URI: mongoUri, DATABASE_URL: db.url, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
  const json = JSON.parse(await readFile(report, "utf8")) as Record<string, unknown>;
  return { code, output, report: json };
}

const mongoCount = async (collection: string) => {
  const client = await mongoose.mongo.MongoClient.connect(mongoUri);
  try {
    return await client.db().collection(collection).countDocuments();
  } finally {
    await client.close();
  }
};

describe("reconcile CLI", () => {
  test("refuses remote databases without the explicit flag, before connecting", async () => {
    const remote = await cli(["plan"], { MONGODB_URI: "mongodb+srv://user:secret@cluster0.example.mongodb.net/shop" });
    expect(remote.code).toBe(1);
    expect(remote.report).toMatchObject({ outcome: "refused" });
    expect(String(remote.report.error)).toMatch(/MongoDB database \(.*\) is not on this machine/);
    // The report never contains the credentials.
    expect(JSON.stringify(remote.report)).not.toContain("secret");

    const remotePostgres = await cli(["verify"], { DATABASE_URL: "postgresql://app:secret@db.example.com:5432/shop" });
    expect(remotePostgres.report).toMatchObject({ outcome: "refused" });
    expect(JSON.stringify(remotePostgres.report)).not.toContain("secret");
  }, 60_000);

  test("plan reports what would be copied and writes nothing; the report has counts and ids only", async () => {
    const plan = await cli(["plan"]);
    expect(plan.code).toBe(0);
    expect(plan.report).toMatchObject({ outcome: "succeeded", counts: { deliveryOptions: 1, users: 1, orders: 0 } });
    expect(JSON.stringify(plan.report)).not.toMatch(/alice|Alice|password/);
    expect(await mongoCount("users")).toBe(0);
  }, 60_000);

  test("apply is refused without --confirm and --writes-frozen", async () => {
    for (const args of [["apply"], ["apply", "--confirm"], ["apply", "--writes-frozen"]]) {
      const refused = await cli(args);
      expect(refused.code).toBe(1);
      expect(refused.report).toMatchObject({ outcome: "refused" });
      expect(String(refused.report.error)).toMatch(/WRITE_FREEZE=true/);
    }
    expect(await mongoCount("users")).toBe(0);
  }, 90_000);

  test("verify is not ready before apply (exit 2), ready after it (exit 0), and not ready again after a new PostgreSQL write", async () => {
    const before = await cli(["verify"]);
    expect(before.code).toBe(2);
    expect(before.report).toMatchObject({ outcome: "not-ready" });
    expect(before.report.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/users exist only in PostgreSQL/)]));

    const applied = await cli(["apply", "--confirm", "--writes-frozen"]);
    expect(applied.code).toBe(0);
    expect(applied.report).toMatchObject({ outcome: "succeeded", written: { deliveryOptions: 1, users: 1 } });
    expect(await mongoCount("users")).toBe(1);

    // Re-running is idempotent.
    expect((await cli(["apply", "--confirm", "--writes-frozen"])).code).toBe(0);
    expect(await mongoCount("users")).toBe(1);

    expect((await cli(["verify"])).code).toBe(0);

    await db.pool.query("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('2', 3, 499)");
    const stale = await cli(["verify"]);
    expect(stale.code).toBe(2);
    expect(stale.report.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/deliveryOptions exist only in PostgreSQL|PostgreSQL changed/)]));
  }, 120_000);
});
