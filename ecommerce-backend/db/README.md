# PostgreSQL schema and migrations

Status: **schema only (Phase 3A).** MongoDB is still the application's only
database. No application query uses PostgreSQL yet, and no data has been
copied. See `../../MIGRATION_PLAN.md` for the overall plan and approved
decisions (D1–D4, FD1–FD3).

## Layout

| Path | Purpose |
| --- | --- |
| `db/migrations/NNNN_name.up.sql` | Forward migration, applied once in a transaction |
| `db/migrations/NNNN_name.down.sql` | Optional reverse migration, used only by `db:rollback` |
| `db/migrator.ts` | Runner: history table, checksums, advisory lock, rollback |
| `scripts/dbMigrate.ts` | CLI used by the npm scripts below |
| `test/db/` | Migration tests against a throwaway PostgreSQL container |

## Commands

All commands use `DATABASE_URL` from `.env.postgres` (real environment
variables take precedence). Start the local database first with
`docker compose up -d`.

| Command | Effect |
| --- | --- |
| `npm run db:status` | Lists each migration as `applied`, `pending`, `changed` or `missing-file` |
| `npm run db:migrate` | Applies pending migrations in order. Safe to run repeatedly: an up-to-date database is a no-op |
| `npm run db:rollback -- --confirm` | Reverts the **latest** migration with its down file. Destructive; take a backup first |
| `npm run test:db` | Runs the migration tests (requires Docker; never touches the compose database) |

## How the runner keeps migrations safe

- **History.** `schema_migrations(version, name, checksum, applied_at, execution_ms)`
  records every applied migration. It is created automatically.
- **Atomic.** Each migration and its history row commit in one transaction. A
  failure rolls back everything that migration did, and nothing is recorded.
- **One runner at a time.** A PostgreSQL advisory lock serialises concurrent
  `db:migrate` runs (for example, two deploys starting together).
- **No drift.** The SHA-256 checksum of each applied file is verified on every
  run. Editing or deleting an applied migration stops the runner; add a new
  migration instead. Checksums ignore CRLF/LF differences, so Windows and
  Linux checkouts agree.
- **Ordered.** A pending migration numbered below the latest applied one is
  rejected; renumber it.

Writing a migration: add the next `NNNN_short_name.up.sql` (and a
`.down.sql` if it can be reversed). Never edit a migration once it has been
applied anywhere.

## Schema (0001_initial_schema)

```
users 1───0..1 carts 1───* cart_items *───1 delivery_options
  │                          ╎ product_id (no FK, D3)
  │ 0..1                     ╎
  └──────* orders 1───* order_items
                             ╎ product_id (no FK, D4)
products (referenced by id only)
```

| Table | Key | Notes |
| --- | --- | --- |
| `users` | `id text` = MongoDB ObjectId hex (D2) | email unique, lowercase/trimmed; bcrypt hash format; `is_admin` |
| `products` | `id uuid` (existing UUIDs kept) | price in cents; `rating_stars numeric(2,1)` in half steps 0–5; `highlights`/`keywords text[]` without nulls; `stock` stored but **not enforced** |
| `delivery_options` | `id text`, digit string (`"1"`, `"2"`, `"3"`) | days and price non-negative |
| `carts` | `id uuid` | **one cart per user** (`UNIQUE user_id`); deleted with the user (D1) |
| `cart_items` | `id uuid`, `UNIQUE (cart_id, product_id)` | quantity **integer 1–10** (FD1); `product_id` has **no FK**, so lines for deleted products remain (D3); delivery option FK `RESTRICT` |
| `orders` | `id uuid` (existing UUIDs kept) | `is_legacy` marks orders imported from MongoDB. Legacy orders may lack `user_id` and customer details; application orders must have both. Customer details are all-or-nothing and non-blank. `user_id` FK `RESTRICT`, so order history can't be deleted with a user |
| `order_items` | `(order_id, position)` | `product_id` has **no FK** (5 of 8 existing orders reference deleted products; `/tracking` needs the id). Quantity ≥ 1, no upper bound (history). Snapshot columns are all-or-nothing; a trigger **requires** a snapshot for non-legacy orders, and another makes rows **immutable** (any UPDATE fails) |

Conventions:
- **Money:** `integer` minor units (cents). Fractional values are rejected, not rounded.
- **Time:** `timestamptz` with millisecond precision, so `orderTimeMs` round-trips exactly.
- **`updated_at`:** maintained by a trigger on every mutable table.
- **Constraint names:** explicit, so errors can be mapped to API responses.

Indexes: `products (created_at, id)` for the catalogue order;
`cart_items (cart_id, created_at)` for cart order; `orders (user_id, ordered_at DESC)`
for a user's history; `orders (ordered_at DESC)` for the admin list. Unique
constraints add indexes on `users.email`, `carts.user_id` and
`cart_items (cart_id, product_id)`.

Deliberately not enforced:
- **Stock levels:** no inventory data or business rules yet.
- **Order totals reconciling with line sums:** legacy data must be stored as it is.
- **Immutability of `orders` rows:** only `order_items` are immutable for now (outstanding decision).

## Backups

Take a backup **before** every `db:migrate` against a database that holds
data, and always before `db:rollback`. Keep backups outside the repository
(for example `../../ecommerce-backups/`).

```bash
# Local Docker database (custom format, compressed)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > ../../ecommerce-backups/pg-ecommerce-$(date +%Y%m%d-%H%M%S).dump

# Verify the backup can be read
docker compose exec -T postgres pg_restore --list < ../../ecommerce-backups/pg-ecommerce-YYYYMMDD-HHMMSS.dump
```

For a hosted database, run `pg_dump "$DATABASE_URL" -Fc -f backup.dump` from a
machine with PostgreSQL 17 client tools, and use the provider's own snapshot
feature as well.

## Rollback

| Situation | Action |
| --- | --- |
| A new migration fails | Nothing to do: it rolled back automatically and was not recorded. Fix it and run `db:migrate` again |
| A migration applied but must be undone, and the tables hold no data worth keeping | `npm run db:rollback -- --confirm` (latest migration only; repeat for earlier ones) |
| Data must be preserved | Restore the backup taken before the migration (below) |
| Application problem after PostgreSQL goes live (Phase 4) | Switch the affected data source back to MongoDB (MIGRATION_PLAN.md §8). MongoDB remains authoritative until cut-over |

Restoring a backup into the local database (replaces its contents):

```bash
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists ecommerce_restore && createdb -U "$POSTGRES_USER" ecommerce_restore'
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d ecommerce_restore --no-owner' < ../../ecommerce-backups/pg-ecommerce-YYYYMMDD-HHMMSS.dump
# Check ecommerce_restore, then point DATABASE_URL at it, or rename the databases.
```

Never run `docker compose down -v`: it deletes the `postgres_data` volume.
