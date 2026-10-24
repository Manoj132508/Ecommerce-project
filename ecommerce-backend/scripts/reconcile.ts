// Rollback reconciliation CLI, PostgreSQL -> MongoDB (MIGRATION_PLAN.md R31),
// around db/reconciliation/reverse.ts. Explicit, operator-run; nothing here runs
// at API start-up.
//
//   reconcile:plan                              read both; report what would be copied. Writes nothing.
//   reconcile:apply --confirm --writes-frozen   copy PostgreSQL-only records into MongoDB.
//   reconcile:verify                            the rollback gate: exit 0 ready, 2 not ready. Writes nothing.
//
// Safety:
//   - Local databases only unless --allow-remote-postgres / --allow-remote-mongodb
//     is passed; a remote (staging or production) run needs an approved plan.
//   - apply needs --confirm and --writes-frozen: the API must be running with
//     WRITE_FREEZE=true (middleware/writeFreeze.ts). The run also fails by itself
//     if PostgreSQL changed while it ran.
//   - PostgreSQL is only read. MongoDB writes are idempotent and insert-only,
//     except archived product replacements; existing orders are never changed.
//   - Reports hold counts, ids and issue codes, never names, emails or addresses.
//
// Options: --report <file>. Sources: MONGODB_URI (.env), DATABASE_URL
// (.env.postgres); real environment variables take precedence.
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { describeConnection, isLocalConnection } from "../db/dataMigration/source.js";
import {
  applyReconciliation, planReconciliation, ReconciliationError, verifyRollbackTarget,
  type ReconciliationIssue, type ReconciliationPlan,
} from "../db/reconciliation/reverse.js";

const packageRoot = ["..", "../.."]
  .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
  .find((candidate) => existsSync(path.join(candidate, "package.json"))) ?? process.cwd();
const envFile = path.join(packageRoot, ".env");
if (existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });

const args = process.argv.slice(2);
const command = args[0] ?? "";
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

type Operation = "plan" | "apply" | "verify";
const OPERATIONS: Record<string, Operation> = { plan: "plan", apply: "apply", verify: "verify" };

interface Report {
  tool: "ecommerce-backend reconciliation";
  reportVersion: 1;
  operation: Operation;
  outcome: "succeeded" | "blocked" | "not-ready" | "refused" | "failed";
  startedAt: string;
  finishedAt: string;
  postgres?: string;
  mongodb?: string;
  postgresFingerprint?: string;
  counts?: Record<string, number>;
  written?: Record<string, number>;
  runId?: string;
  reasons?: string[];
  issues?: ReconciliationIssue[];
  error?: string;
}

class Refusal extends Error {}

function requireLocal(uri: string, kind: "PostgreSQL" | "MongoDB", allowFlag: string) {
  if (!isLocalConnection(uri) && !flag(allowFlag)) {
    throw new Refusal(
      `The ${kind} database (${describeConnection(uri)}) is not on this machine. Refusing to connect. `
      + `A staging or production reconciliation needs an approved plan; pass ${allowFlag} only when one exists.`,
    );
  }
}

const counts = (plan: ReconciliationPlan) => ({
  deliveryOptions: plan.inserts.deliveryOptions.length,
  products: plan.inserts.products.length,
  productUpdates: plan.productUpdates.length,
  users: plan.inserts.users.length,
  orders: plan.inserts.orders.length,
  orderStatus: plan.orderStatus.length,
  carts: plan.carts.length,
});

async function run(operation: Operation, report: Report): Promise<Report> {
  const mongoUri = process.env.MONGODB_URI?.trim() ?? "";
  const postgresUri = process.env.DATABASE_URL?.trim() ?? "";
  if (!mongoUri) throw new Refusal("MONGODB_URI is missing (.env).");
  if (!postgresUri) throw new Refusal("DATABASE_URL is missing (.env.postgres).");
  requireLocal(postgresUri, "PostgreSQL", "--allow-remote-postgres");
  requireLocal(mongoUri, "MongoDB", "--allow-remote-mongodb");
  if (operation === "apply" && !(flag("--confirm") && flag("--writes-frozen"))) {
    throw new Refusal("apply copies records into MongoDB. Freeze writes first (WRITE_FREEZE=true on the API), then pass --confirm --writes-frozen.");
  }
  report.postgres = describeConnection(postgresUri);
  report.mongodb = describeConnection(mongoUri);

  const { default: pool } = await import("../config/postgres.js");
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5_000 });
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("MongoDB connection has no database");
    if (operation === "plan") {
      const plan = await planReconciliation(pool, db);
      const blocked = plan.issues.some((issue) => issue.severity === "error");
      return { ...report, outcome: blocked ? "blocked" : "succeeded", postgresFingerprint: plan.postgresFingerprint, counts: counts(plan), issues: plan.issues };
    }
    if (operation === "verify") {
      const readiness = await verifyRollbackTarget(pool, db);
      return { ...report, outcome: readiness.ready ? "succeeded" : "not-ready", postgresFingerprint: readiness.postgresFingerprint, reasons: readiness.reasons };
    }
    const result = await applyReconciliation(pool, db);
    return { ...report, outcome: "succeeded", runId: result.runId, postgresFingerprint: result.postgresFingerprint, written: result.written, issues: result.issues };
  } finally {
    await mongoose.disconnect();
    await pool.end();
  }
}

const operation = OPERATIONS[command];
if (!operation) {
  console.error("Usage: reconcile <plan | apply --confirm --writes-frozen | verify> [--report <file>] [--allow-remote-postgres] [--allow-remote-mongodb]");
  process.exitCode = 1;
} else {
  const startedAt = new Date().toISOString();
  let report: Report = { tool: "ecommerce-backend reconciliation", reportVersion: 1, operation, outcome: "failed", startedAt, finishedAt: startedAt };
  try {
    report = await run(operation, report);
  } catch (error) {
    report = {
      ...report,
      outcome: error instanceof Refusal ? "refused" : "failed",
      error: error instanceof Error ? error.message : String(error),
      ...(error instanceof ReconciliationError ? { issues: error.issues } : {}),
    };
  }
  report.finishedAt = new Date().toISOString();
  const file = path.resolve(option("--report") ?? path.join(packageRoot, "migration-reports", `reconcile-${operation}-${startedAt.replace(/[:.]/g, "-")}.json`));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`reconcile ${operation}: ${report.outcome}${report.error ? ` — ${report.error}` : ""}`);
  for (const reason of report.reasons ?? []) console.log(`  not ready: ${reason}`);
  if (report.counts) console.log(`  would copy: ${JSON.stringify(report.counts)}`);
  if (report.written) console.log(`  written: ${JSON.stringify(report.written)}`);
  console.log(`report: ${file}`);
  process.exitCode = report.outcome === "succeeded" ? 0 : report.outcome === "not-ready" ? 2 : 1;
}
