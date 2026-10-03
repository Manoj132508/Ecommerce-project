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

## Tests

Run `npm test`. The authentication tests use real HTTP requests and model
password hashing with in-memory database stubs, so they do not require MongoDB
or create accounts in your configured database.
