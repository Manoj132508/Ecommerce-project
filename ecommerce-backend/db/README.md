# PostgreSQL schema, migrations and data copy

Status: **Phase 3B.** The schema exists, and the MongoDB → PostgreSQL
copy-and-verify tooling is built and tested. **MongoDB is still the
application's only database**: no API route reads or writes PostgreSQL, and
nothing here runs when the server starts. See `../../MIGRATION_PLAN.md`.

Commands below are for **Windows PowerShell** (`npm.cmd` avoids the PowerShell
script-execution policy on `npm.ps1`). Run them from `ecommerce-backend`.

## Layout

| Path | Purpose |
| --- | --- |
| `db/migrations/NNNN_name.up.sql` | Forward schema migration, applied once in a transaction |
| `db/migrations/NNNN_name.down.sql` | Reverse migration, used only by `db:rollback` |
| `db/migrator.ts` | Schema migration runner: history table, checksums, advisory lock |
| `db/dataMigration/source.ts` | Read-only MongoDB extraction, fingerprint, connection guard |
| `db/dataMigration/plan.ts` | Validation and mapping to PostgreSQL rows (no I/O) |
| `db/dataMigration/importer.ts` | Transactional import and guarded rollback |
| `db/dataMigration/verify.ts` | Independent field-by-field comparison with the source |
| `db/dataMigration/report.ts` | Structured JSON report (ids and counts only) |
| `scripts/dbMigrate.ts`, `scripts/dataMigrate.ts` | CLIs (also compiled to `dist/scripts/`) |
| `test/db/` | Tests against throwaway PostgreSQL and in-memory MongoDB |

## Commands

| Command | Effect |
| --- | --- |
| `npm.cmd run db:status` | Lists schema migrations as `applied`, `pending`, `changed` or `missing-file` |
| `npm.cmd run db:migrate` | Applies pending schema migrations. Repeatable (a no-op when current) |
| `npm.cmd run db:rollback -- --confirm` | Reverts the latest schema migration. Destructive; back up first |
| `npm.cmd run data:dry-run` | Reads MongoDB and reports what an import would do. **Writes nothing anywhere** |
| `npm.cmd run data:import` | Imports into PostgreSQL in one transaction, then verifies |
| `npm.cmd run data:import -- --skip-invalid` | Same, importing only valid records and listing every skipped one |
| `npm.cmd run data:verify` | Compares PostgreSQL with MongoDB field by field. Read-only on both |
| `npm.cmd run data:rollback -- --confirm` | Removes imported data (guarded; see Rollback) |
| `npm.cmd run test:db` | Schema and data-migration tests (Docker required; never the compose database) |

Compiled equivalents for a deployed build: `node dist\scripts\dbMigrate.js up`
and `node dist\scripts\dataMigrate.js <dry-run|import|verify|rollback>`.

Data commands read `MONGODB_URI` from `.env` and `DATABASE_URL` from
`.env.postgres`; real environment variables take precedence. Options:

- `--report <file>`: where to write the report. The default is `migration-reports\<operation>-<time>.json`, which git ignores.
- `--allow-remote-source` and `--allow-remote-target`: see Safety.

## Copying data from MongoDB (Phase 3B)

```powershell
# 0. Start PostgreSQL and bring the schema up to date
docker compose up -d
npm.cmd run db:migrate

# 1. Back up both databases (see Backups), then:
npm.cmd run data:dry-run      # read-only; exit code 0 = an import would proceed
npm.cmd run data:import       # one transaction, then automatic verification
npm.cmd run data:verify       # may be repeated at any time
```

What the import does:

- **Order.** Imports delivery options, then products, then users, then orders with their lines. Within each collection it works in `_id` order (deterministic).
- **IDs.** Every source id is kept as it is: ObjectId users become TEXT ids, products and orders keep their UUIDs, delivery options keep their digit strings. Prices (cents), timestamps (to the millisecond) and order lines (position, quantity, delivery estimate, snapshot) are copied unchanged.
- **Nothing invented.** A missing timestamp, partial customer details, a fractional amount, an id in the wrong format or a non-normalised email is a **validation error**, never coerced. The only defaults are the Mongoose model defaults the API already shows today (for example `stock` → 0, a missing snapshot `description` → `""`). Each one is counted under `defaultsApplied`.
- **Legacy orders.** Every imported order is marked `is_legacy` with no operational `status`. An order whose owner no longer exists is imported with `user_id` NULL and listed under `orphanedOrders` with its original user id. Lines without a snapshot keep NULL snapshot columns.
- **Shared cart.** The `cartItems` collection is **excluded** (D1). Only its counts are reported; it stays in MongoDB and in the backups.
- **Strict by default.** Any validation error **blocks** the import before anything is written. `--skip-invalid` imports the valid records instead; an order whose owner is invalid is skipped with it.
- **Atomic.** The whole import is one transaction under an advisory lock, so a failure part-way leaves PostgreSQL exactly as it was.
- **Re-runnable.** Reference data is updated only where a value differs, keeping the source `updatedAt`. Existing orders are compared, **never updated**: a difference is a conflict that rolls the run back. Every run is recorded in `data_import_runs`.
- **Verification.** It reads the raw MongoDB documents with its own field mapping, independent of the importer. It reports matched, mismatched (field names only), missing and unexpected rows, and flags a source that changed since the last import.

Local development run (2026-10-21): 3 delivery options, 35 products, 1 user
and 8 orders (19 lines) imported. The 4 shared-cart items were excluded.
Verification: 47/47 records matched. A re-run changed nothing. The MongoDB
`dbHash` was identical before and after.

### Reports

Each command writes a JSON report and prints a summary. Reports contain
**record ids, counts and field names only**: no names, emails, addresses,
password hashes or credentials (connections are shown as `host/database`).
The sections are:

- `tables`: source, valid, invalid, inserted, updated and unchanged counts per collection.
- `skipped`: invalid ids per collection.
- `issues`: each error, warning and info item with its code, collection, id and field.
- `orphanedOrders`, `ordersWithoutOwnership`, `missingSnapshots`, `deletedProductReferences`, `defaultsApplied`.
- `excluded`: the shared cart and unknown collections.
- `verification`: present after an import or verify.

Exit code 0 means `succeeded`. `blocked`, `failed` and `mismatch` exit with 1.

### Safety

- **MongoDB is only read.** The source module calls only `listCollections` and `find`. Tests assert the source `dbHash` is byte-identical after dry-run, import, re-import, verify and rollback. For production, also use a MongoDB user with only the built-in `read` role.
- **Local only by default.** The CLI refuses any MongoDB or PostgreSQL host that isn't this machine (`localhost`, `127.0.0.1`, `::1`; SRV/Atlas URIs always count as remote). `--allow-remote-source` and `--allow-remote-target` exist for an approved production run only.
- **Consistent source.** Extraction reads collection by collection, not as one snapshot. On a live production database, freeze writes (or use a maintenance window) during an import, then compare the `fingerprint` recorded by the import with a fresh `data:verify`.

## How the schema runner keeps migrations safe

- **History.** `schema_migrations(version, name, checksum, applied_at, execution_ms)` is created automatically.
- **Atomic.** Each migration and its history row commit together. A failure rolls back everything that migration did, and nothing is recorded.
- **One runner at a time.** An advisory lock serialises concurrent runs.
- **No drift.** The SHA-256 checksum of each applied file is verified on every run, so editing or deleting an applied migration stops the runner. CRLF and LF line endings hash the same.
- **Ordered.** A pending migration numbered below the latest applied one is rejected.

Writing a migration: add the next `NNNN_short_name.up.sql` (and a `.down.sql`
if it can be reversed). Never edit a migration that has been applied anywhere.
The build copies `db/migrations` to `dist/db/migrations`.

## Schema

```
users 1───0..1 carts 1───* cart_items *───1 delivery_options
  │                          ╎ product_id (no FK, D3)
  │ 0..1                     ╎
  └──────* orders 1───* order_items
           │ status ─ order_status_transitions
           ╎         ╎ product_id (no FK, D4)
products (referenced by id only)          data_import_runs (audit)
```

### 0001_initial_schema

| Table | Key | Notes |
| --- | --- | --- |
| `users` | `id text` = MongoDB ObjectId hex (D2) | email unique, lowercase and trimmed; bcrypt hash format; `is_admin` |
| `products` | `id uuid` (existing UUIDs kept) | price in cents; `rating_stars numeric(2,1)` in half steps 0–5; `highlights`/`keywords text[]` without nulls; `stock` stored but **not enforced** |
| `delivery_options` | `id text` digit string (`"1"`, `"2"`, `"3"`) | days and price non-negative |
| `carts` | `id uuid` | **one cart per user** (`UNIQUE user_id`); deleted with the user (D1) |
| `cart_items` | `id uuid`, `UNIQUE (cart_id, product_id)` | quantity **integer 1–10** (FD1); `product_id` has **no FK**, so lines for deleted products remain (D3) |
| `orders` | `id uuid` (existing UUIDs kept) | `is_legacy` marks imported orders, which may lack `user_id` and customer details. Application orders need both. Customer details are all-or-nothing and non-blank. `user_id` FK `RESTRICT` |
| `order_items` | `(order_id, position)` | `product_id` has **no FK** (history). Quantity ≥ 1. Snapshot columns are all-or-nothing and **required** on non-legacy orders. Rows are immutable |

### 0002_order_history_protection

- **Explicit `updated_at`.** `set_updated_at` keeps a value supplied in the same UPDATE, which is how imports preserve source timestamps. Otherwise it stamps `now()`.
- **Order status.** `orders.status` is `placed | processing | shipped | delivered | cancelled`, with `status_updated_at` maintained by a trigger. Application orders must have a status; legacy orders have **none** (it is never invented) and cannot be given one.
- **Allowed transitions.** `order_status_transitions` holds placed → processing | cancelled, processing → shipped | cancelled, and shipped → delivered. Any other change is rejected.
- **Financial history is immutable.** An UPDATE changing the owner, customer, order time, total, legacy flag or creation time is rejected.
- **Append-only history.** Row DELETEs on `orders` and `order_items` are rejected. Removing imported data is possible only with `TRUNCATE`, which only `data:rollback --confirm` runs.
- **Audit trail.** `data_import_runs` records every import and rollback: operation, outcome, times, source fingerprint, counts and ids.

Conventions:
- **Money:** `integer` cents.
- **Time:** `timestamptz` with millisecond precision.
- **Constraint names:** explicit, so errors can be mapped to API responses.
- **Not enforced:** stock levels, and order totals versus line sums (legacy data is stored as it is).

## Backups

Back up **before** `db:migrate` on a database with data, before every
`data:import`, and always before any rollback. Keep backups outside the
repository, for example `..\..\ecommerce-backups\`.

> **Windows PowerShell: never redirect `pg_dump` output with `>`.** PowerShell
> 5.1 re-encodes native output as text (it adds a UTF-8 BOM), which corrupts a
> binary dump. This was observed on 2026-10-21. Write the dump inside the
> container and copy it out:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
docker compose exec -T postgres sh -c "pg_dump -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -Fc -f /tmp/backup.dump"
docker compose cp postgres:/tmp/backup.dump "..\..\ecommerce-backups\pg-ecommerce-$stamp.dump"
docker compose exec -T postgres rm /tmp/backup.dump

# Check it: a valid dump starts with the bytes PGDMP and is listable
docker compose cp "..\..\ecommerce-backups\pg-ecommerce-$stamp.dump" postgres:/tmp/check.dump
docker compose exec -T postgres pg_restore --list /tmp/check.dump
docker compose exec -T postgres rm /tmp/check.dump
```

MongoDB (read-only `mongodump` in a container; see MIGRATION_PLAN.md §7):

```powershell
$env:MONGO_URI = "mongodb://host.docker.internal:27017/ecommerce_store"
docker run --rm -e MONGO_URI -v "${PWD}\..\..\ecommerce-backups:/backup" mongo:8 `
  sh -c 'mongodump --uri "$MONGO_URI" --gzip --archive=/backup/mongo-ecommerce_store-$(date +%Y%m%d-%H%M%S).archive.gz'
```

For a hosted PostgreSQL (Render), use the provider's backups and, from a
machine with PostgreSQL 17 client tools, `pg_dump "$env:DATABASE_URL" -Fc -f backup.dump`.
`-f` writes the file directly, so no redirection is involved.

## Rollback

| Situation | Action |
| --- | --- |
| A schema migration fails | Nothing to do: it rolled back automatically and was not recorded |
| A data import fails or reports a conflict | Nothing to do: the whole import rolled back. Read the report, fix the cause, run again |
| Imported data must be removed (PostgreSQL holds only imported data) | `npm.cmd run data:rollback -- --confirm` |
| A schema migration must be undone | `npm.cmd run db:rollback -- --confirm` (latest only; repeat for earlier ones) |
| Anything else, or data must be preserved | Restore the backup taken before the change (below) |
| A problem after PostgreSQL goes live (Phase 4) | Switch the affected data source back to MongoDB (MIGRATION_PLAN.md §8). MongoDB stays authoritative until cut-over |

`data:rollback --confirm` refuses, and removes nothing, when:

- PostgreSQL holds application data (any cart or non-legacy order);
- any row was not created by a recorded successful import.

Otherwise it TRUNCATEs the imported tables in one transaction and records the
rollback in `data_import_runs`, which is never cleared.

Restore a dump into a scratch database, check it, then switch over:

```powershell
docker compose cp "..\..\ecommerce-backups\pg-ecommerce-YYYYMMDD-HHMMSS.dump" postgres:/tmp/restore.dump
docker compose exec -T postgres sh -c "dropdb -U `"`$POSTGRES_USER`" --if-exists ecommerce_restore && createdb -U `"`$POSTGRES_USER`" ecommerce_restore"
docker compose exec -T postgres sh -c "pg_restore -U `"`$POSTGRES_USER`" -d ecommerce_restore --no-owner /tmp/restore.dump"
docker compose exec -T postgres rm /tmp/restore.dump
# Check ecommerce_restore, then point DATABASE_URL at it, or rename the databases.
```

Never run `docker compose down -v`: it deletes the `postgres_data` volume.
