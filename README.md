# Ecommerce Platform

A full-stack commerce platform that demonstrates an incremental production migration: a legacy React/Vite storefront is being replaced by a Next.js App Router application while the Express API moves from MongoDB to PostgreSQL domain by domain.

The migration is deliberately reversible. MongoDB remains the default data source until each PostgreSQL repository, schema migration, and compatibility contract has passed its tests.

## Engineering highlights

- Next.js App Router, React, strict TypeScript, TanStack Query, and Redux Toolkit.
- Express API with typed controllers and repository interfaces.
- MongoDB and PostgreSQL implementations selected independently by domain.
- Versioned PostgreSQL migrations plus dry-run, import, verification, rollback, and reconciliation tooling.
- Cookie-based sessions, CSRF protection, authorization boundaries, rate limiting, input validation, and private-cache controls.
- Unit, component, API-contract, accessibility, browser, and database integration tests.
- Reproducible Docker images and GitHub Actions checks for the web app, API, PostgreSQL migration path, and containers.

## Architecture

```text
Browser
   |
   v
Next.js web (apps/web, port 3001)
   |  same-origin /api proxy
   v
Express API (ecommerce-backend, port 3000)
   |
   +-- repository interfaces
          |-- MongoDB (current default)
          `-- PostgreSQL 17 (opt-in per domain)
```

TanStack Query owns server state. Redux is limited to client-controlled UI state. API controllers depend on repository interfaces instead of database-specific models, allowing delivery options, products, users, carts, and orders to move independently.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Current Next.js storefront and account/admin experience |
| `ecommerce-backend` | Express API, tests, repositories, and database migration tooling |
| `ecommerce-project` | Legacy Vite client retained during route-parity migration |
| `docs` | Accessibility checks and the redesign specification |
| `MIGRATION_PLAN.md` | Decision log, risks, phases, and verification evidence |

## Run locally

Requirements: Node.js 22.12+, npm, MongoDB, and Docker Desktop if you want the PostgreSQL path.

```powershell
# API
cd ecommerce-backend
Copy-Item .env.example .env
# Set MONGODB_URI and a private JWT_SECRET in .env
npm.cmd ci
npm.cmd run dev

# Web app (a second terminal)
cd apps/web
Copy-Item .env.example .env.local
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:3001`. The web application proxies `/api/*` to the API origin configured by `BACKEND_ORIGIN`.

## PostgreSQL migration path

PostgreSQL runs alongside MongoDB; setting it up does not switch or delete the current data source.

```powershell
cd ecommerce-backend
npm.cmd run postgres:env
docker compose up -d --wait
npm.cmd run postgres:check
npm.cmd run db:migrate
npm.cmd run data:dry-run
```

After a verified import, domains can be selected individually with `DATA_SOURCE_*` environment variables. See [`ecommerce-backend/db/README.md`](ecommerce-backend/db/README.md) for the exact migration, verification, rollback, and production-safety procedures.

## Quality checks

```powershell
# Next.js
cd apps/web
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

# Express and MongoDB contracts
cd ../../ecommerce-backend
npm.cmd run typecheck
npm.cmd test
npm.cmd run build

# PostgreSQL schema and repository integration tests (requires Docker)
npm.cmd run test:db
```

The GitHub Actions workflow runs these checks on pushes and pull requests. It also builds both Docker images without publishing them.

## Containers

Build the services independently so database credentials and deployment configuration remain runtime concerns:

```powershell
docker build -t ecommerce-api ./ecommerce-backend
docker build -t ecommerce-web ./apps/web
```

The API container expects its MongoDB/PostgreSQL URLs and authentication secrets at runtime. The web container expects `BACKEND_ORIGIN` at runtime and accepts public branding/site URL values as build arguments.

## Migration status

The modern Next.js application and PostgreSQL implementation are intentionally kept on a review branch until their verification gates are complete. The legacy Vite client and MongoDB repositories remain available as rollback paths. No migration command runs automatically at server startup.
