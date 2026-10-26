# Cutover, rollback and fix-forward runbook (R31)

**Status: procedure only. Nothing here has been executed against staging or production.** It is rehearsed first in
Phase 7B on staging with sanitised data, and each production step needs the owner's explicit approval, recorded
with date and scope. It consolidates MIGRATION_PLAN.md §6 Phase 4 ("Production cutover and recovery design") and §7
("Backups") with the tools built in Phase 7A.

Conventions: connection strings are only ever passed as environment variables set in the shell for one command or
in the host's secret settings, never as command-line arguments, never in a file in the repository, never in a
report. Commands run from `ecommerce-backend/`. Remote databases need the explicit `--allow-remote-*` flags, which
exist for an approved run only.

## 0. Before the window

| Gate | Evidence required |
| --- | --- |
| Approval | Owner approval for this step (date, domains, window) |
| Release | The commit to deploy is green in CI and has 3 consecutive clean Browser runs (RELEASE_READINESS.md §7) |
| Target | Render Postgres 17 provisioned; `npm run db:migrate` then `npm run db:status`: 0001–0006 applied, checksums match |
| Sizes | `reconcile:plan` pre-flight counts (or `SELECT count(*)`) under 25,000 per table, or a machine sized for more (measured: ~0.6 GB RSS at 20,000 users + 20,000 orders) |
| People | Operator and rollback owner named and available for the whole window |

## 1. Back up (both sides) and prove the backups

1. MongoDB: `mongodump` through the `mongo:8` image with the URI in an environment variable (§7 0.3), gzip archive
   to the backup folder; restore it into a throwaway container with no published ports and compare `dbHash` and
   document counts.
2. PostgreSQL: `pg_dump -Fc` (Render: a manual backup plus point-in-time recovery if the plan has it); restore into a
   throwaway database and compare row counts.
3. Record file names, sizes, times and the verification results. No step below starts without both.

## 2. Freeze writes

1. Set `WRITE_FREEZE=true` on the API and restart. Expect the start-up line `WRITE FREEZE: ON …`.
2. Verify: `GET /readyz` 200; a write such as `POST /api/cart-items` answers **503** with `Retry-After` and the
   maintenance message; `GET /api/products` 200; sign-in still works.
3. Verify nothing changes: two `data:dry-run` fingerprints a few minutes apart are identical (and, after a cutover,
   two `reconcile:plan` PostgreSQL fingerprints).

## 3. Forward cutover (MongoDB → PostgreSQL), per approved domain set

1. `npm run data:dry-run`: 0 errors; only the documented warnings. Record the source fingerprint.
2. `npm run data:import` (one transaction; refuses a source that changed since the dry run).
3. `npm run data:verify`: MATCH, fingerprint unchanged since step 1.
4. Set `DATA_SOURCE_<DOMAIN>=postgres` for the approved domains and `POSTGRES_PRODUCTION_ENABLED=true`; restart.
   Point the host's health check at `/readyz`.
5. Read-only smoke checks **while still frozen**: catalogue, product page, order history, admin lists. A failure here
   is a plain rollback with no loss: unset the switches and restart (PostgreSQL has received no writes).
6. Lift the freeze (`WRITE_FREEZE` unset or `false`, restart) and record the time. **From now on rollback needs
   reconciliation (section 4) or is forward-fix only (section 5).**

## 4. Rollback after writes resumed (PostgreSQL → MongoDB)

Allowed only when the reconciliation has been rehearsed on restored copies and approved.

1. Freeze writes (section 2) and back up both sides (section 1).
2. `npm run reconcile:plan` — read-only. Exit 0 with no blocking issue, or stop: blocking issues mean forward-fix.
3. `npm run reconcile:apply -- --confirm --writes-frozen` — ordered, idempotent batches of 500; fails by itself if
   PostgreSQL changed during the run. Safe to re-run after an interruption.
4. `npm run reconcile:verify` must exit **0** (`ready`). Exit 2 lists the reasons; do not switch.
5. Act on the warnings (for example a product deleted on PostgreSQL), unset the `DATA_SOURCE_*` switches, restart,
   smoke-test while frozen, lift the freeze.
6. Known losses, accepted in the design: per-user carts and order status history are archived in side collections
   MongoDB does not serve; everyone is signed out (sessions are not reconciled).

## 5. Fix-forward (when rollback is not allowed)

Rollback to MongoDB is **not** allowed when the reconciliation is not rehearsed and approved, reports blocking
conflicts, the gate is not ready, or Mongoose has been removed. Then:

| Problem | Action |
| --- | --- |
| Code regression | Redeploy the previous commit with the **same** `DATA_SOURCE_*` settings |
| Bug with a known fix | Ship the targeted fix through CI (and, for anything user-facing, the browser workflow) |
| Data damage | Freeze writes; `pg_restore` the latest verified dump into a **new** database (or Render point-in-time recovery); verify; switch `DATABASE_URL`; restart |
| Database unreachable | The API fails fast (5 s connect, 10 s statements) and `/readyz` answers 503; restore the database, no code change |
| Integrity in doubt | Keep the write freeze on until verified |

MongoDB stays untouched throughout as the archive of everything before the cutover.

## 6. Shutdown behaviour relied on above

Every restart in this runbook sends SIGTERM: readiness turns 503, requests in flight finish for up to
`SHUTDOWN_TIMEOUT_MS` (10 s; the host must wait at least that long), keep-alive connections are closed as their
requests finish, then the pool and MongoDB connections close and the process exits 0 (verified on Linux, Phase 7A).
