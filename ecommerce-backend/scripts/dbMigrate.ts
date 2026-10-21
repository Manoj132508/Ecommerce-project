// CLI for db/migrator.ts against DATABASE_URL (loaded from .env.postgres by
// config/postgres.ts).
//
//   npm run db:migrate                  apply pending migrations (repeatable)
//   npm run db:status                   list applied / pending migrations
//   npm run db:rollback -- --confirm    revert the latest migration (destructive)
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { migrate, migrationStatus, rollbackLatest } from "../db/migrator.js";
import { errorMessage } from "../utils/errors.js";

const MIGRATIONS_DIRECTORY = fileURLToPath(new URL("../db/migrations", import.meta.url));
const [command = "up", ...flags] = process.argv.slice(2);

let pool: Pool | undefined;
try {
  const postgres = await import("../config/postgres.js");
  pool = postgres.default;
  const { database_name: database } = await postgres.checkPostgresConnection();

  if (command === "up") {
    const result = await migrate(pool, MIGRATIONS_DIRECTORY, (message) => console.log(message));
    console.log(
      result.applied.length > 0
        ? `Database "${database}": applied ${result.applied.length} migration(s).`
        : `Database "${database}": already up to date (${result.alreadyApplied.length} applied).`,
    );
  } else if (command === "status") {
    console.log(`Database "${database}":`);
    for (const migration of await migrationStatus(pool, MIGRATIONS_DIRECTORY)) {
      const appliedAt = migration.appliedAt ? ` ${migration.appliedAt.toISOString()}` : "";
      console.log(`  ${migration.version}_${migration.name.padEnd(30)} ${migration.state}${appliedAt}`);
    }
  } else if (command === "rollback") {
    if (!flags.includes("--confirm")) {
      throw new Error(
        `Rollback deletes data in "${database}". Take a pg_dump backup first (db/README.md), then re-run with --confirm.`,
      );
    }
    const version = await rollbackLatest(pool, MIGRATIONS_DIRECTORY);
    console.log(version ? `Database "${database}": rolled back ${version}.` : `Database "${database}": nothing to roll back.`);
  } else {
    throw new Error(`Unknown command "${command}". Use up, status or rollback.`);
  }
} catch (error) {
  console.error(`Migration command failed: ${String(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
