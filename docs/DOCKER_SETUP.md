# Docker setup (Phase 7B)

Two production images and a local, production-style Compose stack. **Local only:** nothing here deploys, pushes an
image or touches a real database. AWS is designed in `docs/AWS_ARCHITECTURE.md` and not created.

## Files

| File | Purpose |
| --- | --- |
| `apps/web/Dockerfile`, `apps/web/.dockerignore` | Next.js storefront image (standalone server) |
| `ecommerce-backend/Dockerfile`, `ecommerce-backend/.dockerignore` | Express API image (compiled TypeScript, SQL migrations, operator commands) |
| `apps/web/next.config.ts` | `output: "standalone"` only when `NEXT_STANDALONE=true` (set by the Dockerfile); `next start`, CI and Vercel unchanged |
| `docker/compose.yaml` | PostgreSQL + one-off migrations + API + storefront, hardened, storefront published on 127.0.0.1 only |
| `docker/create-env.mjs`, `docker/env.example` | Generates `docker/.env` (git-ignored) with random local secrets; the example shows the keys only |
| `docker/seed/dev-data.sql` | Idempotent, invented test catalogue (6 products, 3 delivery options; one product stock-tracked with 2 in stock) |
| `docker/test/container-integration.mjs` | 59 checks against the running containers (below) |
| `.github/workflows/container.yml` | CI: build, scan, SBOM, Compose stack and the integration test — no registry, no AWS, no secrets |

## Images

| | Storefront `ecommerce-web` | API `ecommerce-api` |
| --- | --- | --- |
| Build stage | `node:24-trixie-slim` (digest-pinned), `npm ci --ignore-scripts` from `apps/web/package-lock.json`, `next build` with `NEXT_STANDALONE=true` | same base, `npm ci --ignore-scripts`, `npm run build` (tsc + `db/migrations` copied to `dist/db/migrations`); separate `npm ci --omit=dev` stage |
| Runtime base | `gcr.io/distroless/nodejs24-debian13:nonroot` (digest-pinned): Node 24.22.3, no shell, no package manager | same |
| Contents | `.next/standalone` (server + 19 traced packages), `.next/static`, `public/` | `dist/`, production `node_modules`, `package.json` |
| User | uid 65532 (`nonroot`), files root-owned and read-only | same |
| Writable at run time | `/app/.next/cache` (image optimiser) only | nothing |
| Port / health | 3000; `HEALTHCHECK` GET `/robots.txt` | `PORT` (3000 default); `HEALTHCHECK` GET `/healthz`; readiness `/readyz` |
| Command | `server.js` (entrypoint `/nodejs/bin/node`) | `dist/server.js`; migrations: `dist/scripts/dbMigrate.js up` |
| Size (local) | 296 MB | 238 MB |
| Build-time values | `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SITE_URL` (public by design: inlined into the browser bundle) | none |

**Base image choice, on scan evidence (Trivy 0.76.2, 2026-11-17):** `node:24-bookworm-slim` 1 critical / 43 high;
`node:24-trixie-slim` 0 / 53; `distroless/nodejs24-debian12` 1 / 6 but Node 24.14.0 (eight releases behind);
`distroless/nodejs24-debian13` **0 / 0** with Node 24.22.3 (43 medium, 12 low, none fixable). A first version on
bookworm-slim with npm, npx, corepack and yarn removed was replaced by the distroless one.

**Runtime environment.** Storefront: `BACKEND_ORIGIN` (required; `https://…`, or `http://` only for a loopback
address — the storefront refuses plain HTTP to any other host), optional `TRUSTED_CLIENT_IP_HEADER` +
`PROXY_CLIENT_IP_SECRET` (both or neither). API: `JWT_SECRET`, `DATABASE_URL`, `DATA_SOURCE_DELIVERY_OPTIONS`,
`DATA_SOURCE_PRODUCTS`, `DATA_SOURCE_USERS`, `DATA_SOURCE_CARTS`, `DATA_SOURCE_ORDERS`, `MONGODB_URI` (only when a
domain uses MongoDB), `AUTH_COOKIE_SESSIONS`, `AUTH_COOKIE_SECURE`, `AUTH_ALLOWED_ORIGINS`, `AUTH_RATE_LIMIT_*`,
`TRUST_PROXY_HOPS`, `PROXY_CLIENT_IP_SECRET`, `PG_POOL_MAX`, `PG_CONNECT_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`,
`PG_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `WRITE_FREEZE`; with `NODE_ENV=production` also
`POSTGRES_PRODUCTION_ENABLED` for PostgreSQL domains. Unchanged: **with `NODE_ENV=production` the API refuses cookie
sessions** unless every staging condition in `auth/config.ts` holds (one of them is Render's `RENDER_SERVICE_NAME`).

## How the containers communicate

```
browser ──http://localhost:8080──▶ [api container's network namespace]
                                     ├─ web  (Next.js, :3000, published as 127.0.0.1:8080)
                                     │     │  /api/* route handler → http://127.0.0.1:4000
                                     └─ api  (Express, :4000, not published)
                                           │  postgres://…@postgres:5432  (network "backend", internal)
                                         postgres (no port mapping, volume ecommerce-local-pgdata)
migrate (one-off, same API image) ──backend──▶ postgres      seed (one-off psql, profile "seed") ──▶ postgres
```

The storefront and the API **share one network namespace**, exactly like two containers of one ECS task
(`docs/AWS_ARCHITECTURE.md`): the storefront refuses a plain-HTTP backend that is not a loopback address, and this
keeps that rule without TLS between them. The browser only ever talks to the storefront's origin; `/api/*` is
forwarded by the route handler with its existing restrictions (methods, headers, session cookies only, no
redirects). Consequence: restarting the API container restarts the storefront (`depends_on … restart: true`); use
`docker compose restart api`, not `stop` + `start`.

## Running it (Windows with Docker Desktop, macOS, Linux)

```powershell
node docker/create-env.mjs                       # once; refuses to overwrite docker/.env
docker volume create ecommerce-local-pgdata      # once
docker build -t ecommerce-api:local ecommerce-backend
docker build -t ecommerce-web:local apps/web
docker compose -f docker/compose.yaml up -d --wait
docker compose -f docker/compose.yaml --profile seed run --rm seed
# http://localhost:8080
node docker/test/container-integration.mjs --restart
docker compose -f docker/compose.yaml down       # stops and removes containers; the data volume stays
```

- **Images are built explicitly, not by Compose.** Compose v5 always builds through Bake, which refuses build
  contexts outside the Compose file's folder without an entitlement flag Compose does not expose; and
  `pull_policy: never` guarantees a same-named image from a registry can never stand in for the local build.
- **Linux containers only** (Docker Desktop's default WSL 2 engine on Windows). The images are `linux/amd64` on an
  x86 machine; for Graviton (`linux/arm64`) build with `docker buildx build --platform linux/arm64` — the Next.js
  compiler and sharp have arm64 packages in the lockfile.
- Git Bash on Windows rewrites `/nodejs/bin/node` in `docker exec` arguments: set `MSYS_NO_PATHCONV=1`, or use
  PowerShell. Line endings: the Dockerfiles and SQL work with CRLF checkouts.
- **Data safety:** the volume is `external`, so no Compose command (including `down -v`) deletes it; only an explicit
  `docker volume rm ecommerce-local-pgdata` does. PostgreSQL gets 60 s to stop cleanly. Re-running the seed changes
  nothing. Regenerating `docker/.env` changes the database password — the existing volume keeps the old one, so do
  that only together with a new volume.
- **Rate limits** stay on; `docker/.env` sets a 1-minute window (production default 15) so repeated test runs reset
  quickly.

## Security settings (Compose)

All services: read-only root filesystem (tmpfs for `/tmp`, PostgreSQL's socket directory and the image cache),
`cap_drop: [ALL]` (PostgreSQL adds back only CHOWN, DAC_OVERRIDE, FOWNER, SETGID, SETUID for its entrypoint),
`no-new-privileges`, `init`, PID limit 256, memory and CPU limits (PostgreSQL 512 MB, API 384 MB, storefront
512 MB), health checks, stop grace periods longer than the API's 10 s drain. Only `127.0.0.1:8080` is published.
Verified in the running containers: uid 65532, writes to `/app` fail with `EROFS`, the cache tmpfs is writable.
**Local limitation:** the shared API/storefront namespace has outbound internet access (a published port needs a
non-internal network, and Docker has no egress filter); on AWS egress is controlled by security groups and routing.

## Verification (2026-11-17, on this branch)

| Check | Result |
| --- | --- |
| Image builds | Both succeed from clean; no `BACKEND_ORIGIN` or secret needed at build time |
| Compose start | `migrate` applied 0001–0006 once, then "already up to date" on every later `up`; API `/readyz` healthy; storefront healthy |
| Container integration test (`--restart`) | **59 passed, 0 failed** (third consecutive run; earlier runs found 2 errors in the test itself, see `docs/PHASE7B_REPORT.md`) |
| Graceful shutdown | `docker compose stop api` → exit code 0 (clean drain); data kept across API and PostgreSQL restarts |
| Secrets | Trivy secret scan 0 in both images; the local database password and JWT secret occur 0 times in the saved image archives; image history sets only `NODE_ENV=production`; logs contain no session token, password or secret |
| Vulnerabilities (Trivy 0.76.2) | Storefront: 0 critical, 0 high. API: 0 critical, **2 high in mongoose 9.9.5** (fixed in 9.11.4; update not yet approved) |
| SBOM | CycloneDX 1.7 for each image (API 140 components, storefront 34) |
| Existing suites | Backend MongoDB 235 passed + 9 todo; PostgreSQL 309 passed + 2 skipped; web unit 240; typecheck; lint |
