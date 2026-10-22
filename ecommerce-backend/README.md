# Ecommerce backend

Express API written in TypeScript (strict mode), using MongoDB through
Mongoose. Install dependencies with `npm install`, configure `.env` using
`.env.example`, then start the API with `npm run dev`. Keep `JWT_SECRET`
private and stable so existing tokens remain valid. The server requires
`MONGODB_URI` and `JWT_SECRET`. Set `CLIENT_URL` to the deployed frontend
origin. Multiple allowed origins can be supplied as a comma-separated list.
All environment variables are documented in `types/environment.d.ts`.

## Development, build and production

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs `server.ts` with `tsx watch` (no build step; restarts on change) |
| `npm run typecheck` | Type-checks all TypeScript, including scripts (`tsconfig.json`) |
| `npm run build` | Deletes `dist/`, then compiles the server into it (`tsconfig.build.json`) |
| `npm start` | Runs the compiled server: `node dist/server.js`. **Run `npm run build` first** |
| `npm test` | Runs the Vitest suites (see Tests) |
| `npm run test:db` | Runs the PostgreSQL migration tests in a throwaway Docker container |
| `npm run db:migrate` / `db:status` / `db:rollback -- --confirm` | Manages the PostgreSQL schema (see [`db/README.md`](db/README.md)) |
| `npm run data:dry-run` / `data:import` / `data:verify` / `data:rollback -- --confirm` | Copies MongoDB data to PostgreSQL and verifies it (see [`db/README.md`](db/README.md)) |

PostgreSQL schema, migrations and the MongoDB → PostgreSQL copy tooling live in
`db/` (Phases 3A–3B of `MIGRATION_PLAN.md`). They run only when invoked
explicitly, never at server start-up. The application still reads and writes
**MongoDB only**.

The build needs the dev dependencies (`typescript`), so a deployment must
install them, run `npm run build`, then `npm start`. `dist/` is git-ignored.
Scripts in `scripts/` run from source through `tsx` and are not part of the
build.

Imports use `.js` extensions (for example `./models/User.js`) even though the
files are `.ts`. Node's ESM resolution requires this, and TypeScript, `tsx` and
Vitest all map them to the `.ts` sources.

## Data sources (MongoDB by default)

Every domain is served by **MongoDB unless explicitly switched**. Each domain
can be moved to PostgreSQL independently with an environment variable
(Phase 3C of `MIGRATION_PLAN.md`):

| Variable | Domain | Values |
| --- | --- | --- |
| `DATA_SOURCE_DELIVERY_OPTIONS` | delivery options | `mongo` (default) / `postgres` |
| `DATA_SOURCE_PRODUCTS` | products | `mongo` (default) / `postgres` |
| `DATA_SOURCE_USERS` | users and authentication | `mongo` (default) / `postgres` |
| `DATA_SOURCE_CARTS` | carts | `mongo` (default) / `postgres` |
| `DATA_SOURCE_ORDERS` | orders | `mongo` (default) / `postgres` |

The server refuses to start on an invalid value or an inconsistent
combination:

- Carts and orders must use the same source.
- PostgreSQL carts and orders also need PostgreSQL users, products and delivery options.
- PostgreSQL needs `DATABASE_URL` (from `.env.postgres` locally) and fully applied migrations (`npm run db:migrate`).
- With `NODE_ENV=production`, any PostgreSQL selection also needs `POSTGRES_PRODUCTION_ENABLED=true`.

All of these are deliberate deployment decisions; none is set today.

When carts are served by PostgreSQL, every cart route requires a bearer token
and each user has their own cart, with integer quantities from 1 to 10. When
orders are served by PostgreSQL, orders carry a `status`, and admins can change
it with `PATCH /api/orders/:orderId/status` (`{ "status", "reason" }`; audited;
only allowed transitions). With MongoDB orders that endpoint answers 501. All
intentional differences are listed in `MIGRATION_PLAN.md`.

Code layout:
- `repositories/types.ts`: the data-access interfaces.
- `repositories/mongo.ts` and `repositories/postgres.ts`: the two implementations.
- `config/dataSources.ts`: the selection rules.
- Controllers use only the repositories.

## Authentication

### Register: `POST /api/auth/register`

Send JSON with `name`, `email`, and `password`:

```json
{
  "name": "Alex",
  "email": "alex@example.com",
  "password": "example-password"
}
```

Passwords must contain at least 8 characters and be no more than 72 UTF-8 bytes.
The API trims names and normalizes emails to lowercase. Passwords are hashed
before storage. Public registration always creates a non-admin user.

### Login: `POST /api/auth/login`

Send JSON with `email` and `password` using the same credentials.

Both endpoints return `_id`, `name`, `email`, `isAdmin`, and a `token` valid for
30 days. Passwords and password hashes are excluded from responses.

| Status | Meaning |
| --- | --- |
| 201 | Registration succeeded |
| 200 | Login succeeded |
| 400 | Missing or invalid input |
| 401 | Invalid email or password |
| 409 | Email already registered |
| 500 | Server error |

### Profile: `GET /api/auth/profile`

Send the token from registration or login in the `Authorization` header:

```http
Authorization: Bearer <token>
```

Returns the current user's `_id`, `name`, `email`, and `isAdmin`. It does not
return a password or issue a new token. Missing, invalid, or expired tokens,
and tokens belonging to deleted users, return 401. Server failures return 500.

Product and delivery-option reads and all cart routes are public; order routes
require a token, and product writes require an admin. The cart is currently
shared by everyone. User-specific carts (approved decision D1 in
`MIGRATION_PLAN.md`) are planned work.

## Local PostgreSQL 17 with Docker Compose

PostgreSQL is added alongside MongoDB for a gradual migration. The API still
uses MongoDB until individual features are deliberately migrated and tested.
Nothing in this setup deletes or modifies MongoDB data.

1. Install and start Docker Desktop, then verify `docker --version` and
   `docker compose version` in a new PowerShell window.
   On Windows, Docker Desktop may require the Virtual Machine Platform feature.
   After enabling that feature, restart Windows before continuing.
2. Run `npm.cmd run postgres:env`. This creates `.env.postgres` with a strong,
   URL-safe random password and refuses to overwrite the file if it exists.
3. Validate the resolved setup with `docker compose config`.
4. Start the database with `docker compose up -d`.
5. Wait for `docker compose ps` to show the `postgres` service as healthy.
6. Confirm PostgreSQL itself with:

   ```powershell
   docker compose exec postgres psql -U ecommerce_app -d ecommerce -c "SELECT version(), current_database(), current_user;"
   ```

7. Confirm the Express-side `pg` connection with
   `npm.cmd run postgres:check`.

The named Docker volume `postgres_data` persists PostgreSQL data across normal
container restarts and recreation. `docker compose down` keeps the volume;
do not run `docker compose down -v` unless you intentionally want to delete the
PostgreSQL data. The MongoDB database is separate and is never mounted or
changed by this Compose file.

Useful commands:

```powershell
docker compose logs -f postgres
docker compose stop
docker compose start
```

## Tests

Run `npm test` (Vitest + Supertest). Each test file starts its own throwaway
in-memory MongoDB via `mongodb-memory-server`, so tests never read `.env` or
touch your configured database; `test/setup.js` refuses to run if Mongoose is
connected anywhere else. The first run downloads a MongoDB binary.

The suites are the regression baseline for the PostgreSQL migration
(`MIGRATION_PLAN.md`): they pin current status codes, response shapes, sort
orders and totals for all 16 API endpoints. `test/cart.shared-cart.current-flaw.test.js`
documents the shared-cart security flaw as current behaviour only; the approved
user-specific cart contract is listed there as `todo` tests.

`test/injection.test.js` guards against MongoDB operator injection: every
identifier taken from a request (product, order and delivery-option IDs) must
be a string in its entity's format (`utils/identifiers.ts`), or the API answers
400 before any database query.
