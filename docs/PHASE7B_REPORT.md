# Phase 7B report — Docker containerisation and AWS foundation (2026-11-17)

**Scope:** local Docker images and Compose stack, container verification and security, and an AWS design with cost
and CI/CD plans. **Nothing was pushed, merged or deployed; no AWS resource was created; Render, Vercel and every
production database are untouched.** Production remains **NO-GO**.

## Branch and commits

Branch `phase7b/docker-aws-foundation` (local only), created from `737e4f9` — whose application code is identical to
the verified Phase 7A commit `eae9b09` (`737e4f9` adds only the 7A result documents). The two hotfix-documentation
commits on `phase5/nextjs-foundation` (`cda38f7`, `b5130e3`) and the hotfix branches are not included.

| Commit | Content |
| --- | --- |
| `7b3a194` | Production images: `apps/web/Dockerfile`, `ecommerce-backend/Dockerfile`, `.dockerignore` files, conditional standalone output in `next.config.ts` |
| `fbf7f35` | `docker/compose.yaml`, `create-env.mjs`, `env.example`, `seed/dev-data.sql` |
| `d76474d` | `docker/test/container-integration.mjs` (59 checks) |
| `8914887` | `.github/workflows/container.yml` (build, scan, SBOM, Compose test; no AWS) |
| (docs) | This report, `DOCKER_SETUP.md`, `AWS_ARCHITECTURE.md`, `AWS_COST_ESTIMATE.md`, `AWS_CICD_PLAN.md`, updates to `MIGRATION_PLAN.md`, `RELEASE_READINESS.md`, `CI.md`, `PHASE7B_STAGING_PLAN.md` |

## Facts established from the repository

| Topic | Finding |
| --- | --- |
| Storefront | Next.js 16.4.2, `next build`; per-request rendering with a CSP nonce (`src/proxy.ts`); `/api/*` forwarded by a route handler to `BACKEND_ORIGIN` (runtime); public build-time values `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_SITE_URL` |
| API | Express + TypeScript, `npm run build` → `dist/` incl. `dist/db/migrations`; `/healthz`, `/readyz`; SIGTERM drain (`lifecycle.ts`); data sources per domain via `DATA_SOURCE_*`; PostgreSQL via `DATABASE_URL` only |
| Constraint 1 | The storefront refuses a plain-HTTP `BACKEND_ORIGIN` unless loopback → storefront and API share a network namespace (Compose) / one ECS task (AWS) |
| Constraint 2 | With `NODE_ENV=production` the API refuses cookie sessions except under the staging allowance, which requires Render's `RENDER_SERVICE_NAME` → local Compose runs the API with `NODE_ENV=development`; AWS staging needs a reviewed change (7C) |
| Constraint 3 | Client addresses: the proxy trusts a header the platform overwrites; an AWS ALB appends to `X-Forwarded-For` → 7C code change for per-IP rate limits |
| Constraint 4 | RDS requires TLS by default; the API image has no RDS CA bundle → 7C change |

## Results

| Check | Result |
| --- | --- |
| Image builds | Both succeed (web 2 m 33 s, API 48 s from a cold cache for the final versions); no secret or backend address at build time |
| Image sizes | storefront 296 MB, API 238 MB (first bookworm-slim versions: 412 / 354 MB) |
| Compose | `up --wait` healthy; migrations 0001–0006 applied once by the one-off service, "already up to date" afterwards; seed idempotent |
| Container integration test | Final two runs: **59 passed, 0 failed** each (bookworm image, then distroless image), with `--restart` |
| Shutdown / restart | `stop api` → exit 0 (clean drain); data intact after API and PostgreSQL restarts |
| Backend suites (source) | MongoDB 235 passed + 9 todo; PostgreSQL 309 passed + 2 skipped (unchanged from 7A) |
| Web | unit 240 passed; typecheck; lint |
| Plain `next build` (non-Docker path) | Compiled, type-checked and generated all 16 routes, no standalone output; then **stopped by Next.js's "agent upgrade nudge"**, which halts builds when it detects an AI agent environment and reports the Next.js advisory below. Not bypassed. The Docker build (no agent variables) completes. CI will build it normally. |
| Not run in 7B | Playwright browser suite, proxy e2e and pages e2e (unchanged `next start` path; they run in CI on push); GitHub Actions on this branch (not pushed) |

Test-script errors found on the way and fixed (the application was right each time): an assumption that a reused
`Idempotency-Key` with the same details returns 422 (it replays the original order; 422 is for different details);
a port check that read PostgreSQL's unpublished `5432/tcp` as published; a restart sequence that left the storefront
in the API's old network namespace (fixed by `docker compose restart api`, which restarts both).

## Security findings

| Finding | Severity | Status |
| --- | --- | --- |
| **mongoose 9.9.5**: GHSA-gg4r-jv3p-qx3c, GHSA-8332-j7wj-wjw4 (high), GHSA-wr5m-5jph-8m96, GHSA-6972-9mcm-vhwj (moderate); fixed in 9.11.4. **Also in the live `main` API and in the prepared backend hotfix (`d1b9144`)** | High | Open — the update was not approved in this session; Trivy and `npm audit` both report it; the container scan gate fails on it by design |
| next 16.4.2: GHSA-mfr8-8qww-v76h (`'use cache'` via `unstable_cache()`; this app uses neither); fixed in 16.4.5 | Moderate | Open — update not approved; **Trivy 0.76.2 did not report it, `npm audit` did**: both scanners are needed |
| ecommerce-project (Vite, migration branch): follow-redirects 1.16.1 GHSA-mrwp-f3q8-3g9p; fixed in 1.16.2 (the storefront hotfix branch already resolves 1.16.2) | High | Open — update not approved |
| `npm audit` was 0 for all three packages on 2026-10-26; these advisories were published since. **CI's audit job will now fail on `eae9b09` and on this branch** | — | Recorded |
| Base images | — | Distroless Debian 13: 0 critical / 0 high (43 medium, 12 low, none fixable) |
| Secrets in images | — | None (Trivy secret scan; local secrets absent from saved archives; history sets only `NODE_ENV`) |
| Runtime hardening | — | uid 65532, read-only root FS, all capabilities dropped, no-new-privileges, limits, health checks; only 127.0.0.1:8080 published |
| Local limitation | Low | The shared API/storefront namespace has outbound internet locally; on AWS controlled by security groups/routing |

## AWS recommendation (details in `AWS_ARCHITECTURE.md`, `AWS_COST_ESTIMATE.md`, `AWS_CICD_PLAN.md`)

London (eu-west-2); ALB + ACM; ECS Fargate service with one task holding the storefront and API containers; RDS for
PostgreSQL 17 in isolated subnets; ECR (immutable tags), Secrets Manager, CloudWatch, S3. Monthly, from AWS price
lists of 2026-11: **Option A staging $76.47** (Ireland $71.67), **Option B production $304.74** (Ireland $286.22), of
which two NAT gateways are $73.00. CI/CD: build once, scan, SBOM, push by digest with GitHub OIDC, staging first,
manual approval, production deploys the same digests, circuit-breaker rollback — **no AWS job enabled**.

## Database migration protection (R31, unchanged by 7B)

- Production MongoDB provider: **unverified** (owner check in the Render dashboard).
- Real production record counts: **unknown**; the reconciliation CLI refuses more than 25,000 records per table.
- Write freeze and reconciliation: tested on disposable databases only, **not rehearsed** on restored copies.
- Real backups and a tested restore of production MongoDB: **still required** before any data step.
- The production cookie-session guard: **active and unchanged**.
- No production data was read or moved; no live database was touched.

## Phase 7B assessment

| Acceptance criterion | Status |
| --- | --- |
| Both production images build | **Met** |
| Compose starts the isolated application | **Met** |
| Existing customer and administrator workflows pass | **Met** in containers (59 checks); browser suite not run against containers |
| PostgreSQL migrations and shutdown verified | **Met** |
| Container security reviewed | **Met** (findings above) |
| Required local tests and CI checks pass | **Not met:** local suites pass, but CI has not run (branch not pushed) and the dependency audit now fails on three advisories published after Phase 7A |
| AWS architecture and cost plans documented | **Met** |
| AWS CI/CD design ready for review | **Met** |
| Outstanding blockers recorded | **Met** |

**Phase 7B is complete locally but not complete:** two items need your approval — the dependency security updates
(mongoose 9.11.4, next/eslint-config-next 16.4.5, follow-redirects 1.16.2) and pushing this branch so CI, Browser
and Container workflows run on one SHA.

## Recommended Phase 7C (each step with approval)

1. Approve and apply the dependency updates on this branch; re-run all suites, push to a `ci/**` branch, require CI
   11/11, Browser 3 consecutive rounds and Container green on one SHA. Separately update the backend production
   hotfix for mongoose (the live API is affected).
2. Code changes with tests: right-most `X-Forwarded-For` for the ALB; an ECS-aware staging allowance (production
   refusal unchanged); RDS TLS (CA bundle, `sslmode=verify-full`); HSTS; Next.js `deploymentId`.
3. Owner checks: production MongoDB provider and record counts; manual screen-reader pass.
4. AWS account set-up (MFA, budget alarm), then IaC for Option A staging, reviewed before apply; GitHub OIDC staging
   role; enable the staging deploy job only.
5. Staging rehearsal on AWS with sanitised data (`PHASE7B_STAGING_PLAN.md` steps): deploy, smoke and browser tests,
   restore-tested backups, write freeze, forward migration and the R31 rollback on restored copies.
6. Decide production specifics (cache consistency, NAT vs endpoints, WAF rules), then a separate production plan.
