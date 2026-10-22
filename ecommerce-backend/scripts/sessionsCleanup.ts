// Deliberate cleanup of expired and revoked cookie sessions (migration 0004),
// against DATABASE_URL (loaded from .env.postgres by config/postgres.ts).
// Nothing deletes sessions automatically; run this on a schedule you choose.
//
//   npm run sessions:cleanup                          count what would be deleted
//   npm run sessions:cleanup -- --confirm             delete it
//   npm run sessions:cleanup -- --retention-days 30   keep finished sessions longer (default 7)
import type { Pool } from "pg";
import { PostgresSessionRepository } from "../auth/sessionRepository.js";
import { errorMessage } from "../utils/errors.js";

const flags = process.argv.slice(2);
const confirm = flags.includes("--confirm");
const retentionIndex = flags.indexOf("--retention-days");
const retentionDays = retentionIndex >= 0 ? Number(flags[retentionIndex + 1]) : 7;

let pool: Pool | undefined;
try {
  if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 3650) {
    throw new Error("--retention-days must be a whole number of days (0-3650)");
  }
  const retentionSeconds = retentionDays * 86_400;
  const postgres = await import("../config/postgres.js");
  pool = postgres.default;
  const { database_name: database } = await postgres.checkPostgresConnection();

  if (confirm) {
    // Lifetimes are not used by deleteExpired.
    const sessions = new PostgresSessionRepository(pool, { idleSeconds: 1, absoluteSeconds: 1, renewAfterSeconds: 1 });
    console.log(`Database "${database}": deleted ${await sessions.deleteExpired(retentionSeconds)} session(s) finished more than ${retentionDays} day(s) ago.`);
  } else {
    const { rows: [row] } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM auth_sessions
        WHERE absolute_expires_at < now() - make_interval(secs => $1)
           OR idle_expires_at < now() - make_interval(secs => $1)
           OR revoked_at < now() - make_interval(secs => $1)`,
      [retentionSeconds],
    );
    console.log(`Database "${database}": ${row?.count ?? 0} session(s) finished more than ${retentionDays} day(s) ago. Re-run with --confirm to delete them.`);
  }
} catch (error) {
  console.error(`Session cleanup failed: ${String(errorMessage(error))}`);
  process.exitCode = 1;
} finally {
  await pool?.end();
}
