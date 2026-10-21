# Ecommerce backend

Install dependencies with `npm install`, configure `.env` using `.env.example`,
then start the API with `npm run dev`. Keep `JWT_SECRET` private and stable so
existing tokens remain valid. The server requires `MONGODB_URI` and `JWT_SECRET`.
Set `CLIENT_URL` to the deployed frontend origin. Multiple allowed origins can
be supplied as a comma-separated list.

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

The existing product, cart, and order routes remain public; user-specific
carts are separate work.

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
