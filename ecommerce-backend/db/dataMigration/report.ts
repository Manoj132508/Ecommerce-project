// Structured migration report. It holds counts and record ids only, never
// names, emails, addresses, password hashes or connection credentials, so it
// can be stored and shared.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { IMPORTED_COLLECTIONS, type ImportedCollection, type Issue, type MigrationPlan } from "./plan.js";

export type Operation = "dry-run" | "import" | "verify" | "rollback";
export type Outcome = "succeeded" | "blocked" | "failed" | "mismatch";

export interface TableCounts {
  source: number;
  valid: number;
  invalid: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface TableVerification {
  expected: number;
  actual: number;
  matched: number;
  mismatched: number;
  missing: string[];
  unexpected: string[];
}

/** Which field differs. Values are deliberately omitted: they may be personal data. */
export interface FieldMismatch {
  table: ImportedCollection;
  id: string;
  field: string;
}

export interface VerificationResult {
  outcome: "match" | "mismatch";
  tables: Record<ImportedCollection, TableVerification>;
  mismatches: FieldMismatch[];
  excludedCart: { sourceCartItems: number; destinationCarts: number; destinationCartItems: number };
  lastImportFingerprint: string | null;
  sourceChangedSinceLastImport: boolean;
}

export interface MigrationReport {
  tool: "ecommerce-backend data migration";
  reportVersion: 1;
  operation: Operation;
  outcome: Outcome;
  startedAt: string;
  finishedAt: string;
  source?: { connection: string; database: string; fingerprint: string; collections: Record<string, number> };
  target?: { connection: string };
  tables?: Record<ImportedCollection, TableCounts>;
  excluded?: MigrationPlan["excluded"];
  orphanedOrders?: MigrationPlan["orphanedOrders"];
  ordersWithoutOwnership?: number;
  missingSnapshots?: { orders: number; lines: number; details: MigrationPlan["missingSnapshots"] };
  deletedProductReferences?: MigrationPlan["deletedProductReferences"];
  defaultsApplied?: { collection: string; field: string; value: string; count: number }[];
  skipped?: Record<ImportedCollection, string[]>;
  issues?: { errors: number; warnings: number; info: number; items: Issue[] };
  verification?: VerificationResult;
  rollback?: { removed: Record<string, number> };
  error?: string;
}

const emptyCounts = (): TableCounts => ({ source: 0, valid: 0, invalid: 0, inserted: 0, updated: 0, unchanged: 0 });

/** Report fields that describe the plan itself (shared by dry-run and import). */
export function planSummary(plan: MigrationPlan, sourceConnection: string): Partial<MigrationReport> {
  const plannedRows: Record<ImportedCollection, number> = {
    deliveryOptions: plan.deliveryOptions.length,
    products: plan.products.length,
    users: plan.users.length,
    orders: plan.orders.length,
  };
  const tables = Object.fromEntries(IMPORTED_COLLECTIONS.map((collection) => [collection, {
    ...emptyCounts(),
    source: plan.sourceCounts[collection] ?? 0,
    valid: plannedRows[collection],
    invalid: plan.invalid[collection].length,
  }]));

  return {
    source: {
      connection: sourceConnection,
      database: plan.sourceDatabase,
      fingerprint: plan.sourceFingerprint,
      collections: plan.sourceCounts,
    },
    tables: {
      deliveryOptions: tables.deliveryOptions ?? emptyCounts(),
      products: tables.products ?? emptyCounts(),
      users: tables.users ?? emptyCounts(),
      orders: tables.orders ?? emptyCounts(),
    },
    excluded: plan.excluded,
    orphanedOrders: plan.orphanedOrders,
    ordersWithoutOwnership: plan.ordersWithoutOwnership.length,
    missingSnapshots: {
      orders: plan.missingSnapshots.length,
      lines: plan.missingSnapshots.reduce((total, entry) => total + entry.positions.length, 0),
      details: plan.missingSnapshots,
    },
    deletedProductReferences: plan.deletedProductReferences,
    defaultsApplied: plan.defaultsApplied.map(({ collection, field, value, ids }) => ({ collection, field, value, count: ids.length })),
    skipped: plan.invalid,
    issues: {
      errors: plan.issues.filter((issue) => issue.severity === "error").length,
      warnings: plan.issues.filter((issue) => issue.severity === "warning").length,
      info: plan.issues.filter((issue) => issue.severity === "info").length,
      items: plan.issues,
    },
  };
}

export async function writeReport(report: MigrationReport, file: string): Promise<string> {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return absolute;
}

/** Human-readable console summary of a report. */
export function formatReport(report: MigrationReport): string {
  const lines = [`${report.operation}: ${report.outcome.toUpperCase()}`];
  if (report.source) {
    lines.push(`source  ${report.source.connection} (fingerprint ${report.source.fingerprint.slice(0, 12)}…)`);
  }
  if (report.target) lines.push(`target  ${report.target.connection}`);
  if (report.tables) {
    lines.push("", "table            source  valid  invalid  inserted  updated  unchanged");
    for (const [table, counts] of Object.entries(report.tables)) {
      lines.push(
        `${table.padEnd(16)} ${String(counts.source).padStart(6)} ${String(counts.valid).padStart(6)} ${String(counts.invalid).padStart(8)} `
        + `${String(counts.inserted).padStart(9)} ${String(counts.updated).padStart(8)} ${String(counts.unchanged).padStart(10)}`,
      );
    }
  }
  if (report.excluded) {
    lines.push("", `excluded: ${report.excluded.cartItems.count} shared-cart item(s) (total quantity ${report.excluded.cartItems.totalQuantity}, ${report.excluded.cartItems.distinctProducts} product(s))`);
    for (const other of report.excluded.otherCollections) lines.push(`excluded: collection "${other.name}" (${other.count} documents)`);
  }
  if (report.orphanedOrders) lines.push(`orphaned orders (owner deleted, imported with NULL owner): ${report.orphanedOrders.length}`);
  if (report.ordersWithoutOwnership !== undefined) lines.push(`orders without an owner in the source: ${report.ordersWithoutOwnership}`);
  if (report.missingSnapshots) lines.push(`order lines without a product snapshot (kept as NULL): ${report.missingSnapshots.lines} in ${report.missingSnapshots.orders} order(s)`);
  if (report.deletedProductReferences) lines.push(`order lines referencing deleted products: ${report.deletedProductReferences.length}`);
  if (report.defaultsApplied?.length) {
    lines.push(`model defaults applied: ${report.defaultsApplied.map((entry) => `${entry.collection}.${entry.field}=${entry.value} ×${entry.count}`).join(", ")}`);
  }
  if (report.issues) {
    lines.push(`issues: ${report.issues.errors} error(s), ${report.issues.warnings} warning(s), ${report.issues.info} info`);
    for (const issue of report.issues.items.filter((item) => item.severity !== "info").slice(0, 25)) {
      lines.push(`  [${issue.severity}] ${issue.collection} ${issue.id}${issue.field ? ` ${issue.field}` : ""}: ${issue.message}`);
    }
  }
  if (report.verification) {
    lines.push("", `verification: ${report.verification.outcome.toUpperCase()}`);
    for (const [table, result] of Object.entries(report.verification.tables)) {
      lines.push(`  ${table.padEnd(16)} expected ${result.expected}, actual ${result.actual}, matched ${result.matched}, mismatched ${result.mismatched}, missing ${result.missing.length}, unexpected ${result.unexpected.length}`);
    }
    for (const mismatch of report.verification.mismatches.slice(0, 25)) {
      lines.push(`  mismatch ${mismatch.table} ${mismatch.id} ${mismatch.field}`);
    }
    if (report.verification.sourceChangedSinceLastImport) lines.push("  WARNING: the source has changed since the last successful import");
  }
  if (report.rollback) {
    lines.push(`removed: ${Object.entries(report.rollback.removed).map(([table, count]) => `${table} ${count}`).join(", ")}`);
  }
  if (report.error) lines.push("", `error: ${report.error}`);
  return lines.join("\n");
}
