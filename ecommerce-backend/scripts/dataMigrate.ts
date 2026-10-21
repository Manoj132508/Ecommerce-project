// MongoDB -> PostgreSQL copy-and-verify CLI (Phase 3B). Explicit use only:
// nothing here runs at API start-up, and MongoDB stays the application's
// database.
//
//   data:dry-run                  validate the source and report; writes nothing
//   data:import [--skip-invalid]  import (one transaction), then verify
//   data:verify                   compare PostgreSQL with the source
//   data:rollback --confirm       remove imported data (guarded)
//
// Options: --report <file>  --allow-remote-source  --allow-remote-target
// Sources: MONGODB_URI from .env, DATABASE_URL from .env.postgres (real
// environment variables take precedence).
import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { DataMigrationError, importPlan, rollbackImportedData } from "../db/dataMigration/importer.js";
import { buildPlan, errorCount } from "../db/dataMigration/plan.js";
import { formatReport, planSummary, writeReport, type MigrationReport, type Operation } from "../db/dataMigration/report.js";
import { describeConnection, extractSource, isLocalConnection } from "../db/dataMigration/source.js";
import { verifyAgainstSource } from "../db/dataMigration/verify.js";

// The package root is one level up from scripts/ (source) or two from dist/scripts/ (compiled).
const packageRoot = ["..", "../.."]
  .map((relative) => fileURLToPath(new URL(relative, import.meta.url)))
  .find((candidate) => existsSync(path.join(candidate, "package.json"))) ?? process.cwd();
// db/migrations from source, dist/db/migrations when compiled (the build copies the SQL).
const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../db/migrations", import.meta.url));

const envFile = path.join(packageRoot, ".env");
if (existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });

const args = process.argv.slice(2);
const command = args[0] ?? "";
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const OPERATIONS: Record<string, Operation> = { "dry-run": "dry-run", import: "import", verify: "verify", rollback: "rollback" };

function reportPath(operation: Operation): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return option("--report") ?? path.join(packageRoot, "migration-reports", `${operation}-${stamp}.json`);
}

function requireLocal(uri: string, kind: "source" | "target", allowFlag: string) {
  if (!isLocalConnection(uri) && !flag(allowFlag)) {
    throw new Error(
      `The ${kind} database (${describeConnection(uri)}) is not on this machine. Refusing to connect. `
      + `Production data operations need an approved plan; pass ${allowFlag} only when one exists.`,
    );
  }
}

function sourceUri(): string {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error("MONGODB_URI is missing (.env).");
  requireLocal(uri, "source", "--allow-remote-source");
  return uri;
}

async function targetPool(): Promise<{ pool: Pool; connection: string }> {
  const postgres = await import("../config/postgres.js");
  const uri = process.env.DATABASE_URL ?? "";
  try {
    requireLocal(uri, "target", "--allow-remote-target");
  } catch (error) {
    await postgres.default.end();
    throw error;
  }
  return { pool: postgres.default, connection: describeConnection(uri) };
}

const baseReport = (operation: Operation, startedAt: Date): MigrationReport => ({
  tool: "ecommerce-backend data migration",
  reportVersion: 1,
  operation,
  outcome: "succeeded",
  startedAt: startedAt.toISOString(),
  finishedAt: startedAt.toISOString(),
});

async function run(operation: Operation): Promise<MigrationReport> {
  const startedAt = new Date();

  if (operation === "dry-run") {
    const uri = sourceUri();
    const plan = buildPlan(await extractSource(uri));
    return {
      ...baseReport(operation, startedAt),
      ...planSummary(plan, describeConnection(uri)),
      outcome: errorCount(plan) > 0 ? "blocked" : "succeeded",
      finishedAt: new Date().toISOString(),
    };
  }

  if (operation === "rollback") {
    const { pool, connection } = await targetPool();
    try {
      return await rollbackImportedData(pool, { confirm: flag("--confirm"), targetConnection: connection, migrationsDirectory: MIGRATIONS_DIRECTORY });
    } finally {
      await pool.end();
    }
  }

  const uri = sourceUri();
  const { pool, connection } = await targetPool();
  try {
    const source = await extractSource(uri);
    const plan = buildPlan(source);

    if (operation === "verify") {
      const verification = await verifyAgainstSource(pool, source, plan);
      return {
        ...baseReport(operation, startedAt),
        ...planSummary(plan, describeConnection(uri)),
        target: { connection },
        verification,
        outcome: verification.outcome === "match" ? "succeeded" : "mismatch",
        finishedAt: new Date().toISOString(),
      };
    }

    const report = await importPlan(pool, plan, {
      migrationsDirectory: MIGRATIONS_DIRECTORY,
      sourceConnection: describeConnection(uri),
      targetConnection: connection,
      skipInvalid: flag("--skip-invalid"),
    });
    if (report.outcome !== "succeeded") return report;

    // Verify straight after a successful import.
    const verification = await verifyAgainstSource(pool, source, plan);
    return {
      ...report,
      verification,
      outcome: verification.outcome === "match" ? "succeeded" : "mismatch",
      finishedAt: new Date().toISOString(),
    };
  } finally {
    await pool.end();
  }
}

const operation = OPERATIONS[command];
if (!operation) {
  console.error('Usage: dataMigrate <dry-run | import [--skip-invalid] | verify | rollback --confirm> [--report <file>]');
  process.exitCode = 1;
} else {
  let report: MigrationReport;
  try {
    report = await run(operation);
  } catch (error) {
    report = error instanceof DataMigrationError
      ? error.report
      : { ...baseReport(operation, new Date()), outcome: "failed", error: error instanceof Error ? error.message : String(error) };
  }
  const file = await writeReport(report, reportPath(operation));
  console.log(formatReport(report));
  console.log(`\nreport: ${file}`);
  if (report.outcome !== "succeeded") process.exitCode = 1;
}
