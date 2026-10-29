# Continuous integration (Phase 7A)

Two GitHub Actions workflows verify every pull request. **Neither deploys anything**, reads a repository secret or can
reach a real database. Both run on `pull_request`, on pushes to `ci/**` branches and on manual dispatch.

## `.github/workflows/ci.yml` — tests, builds, audit

| Job | What it runs | Database |
| --- | --- | --- |
| Backend tests (MongoDB, in-memory) | `ecommerce-backend`: `npm test` (Vitest + supertest) | `mongodb-memory-server` on the runner; `test/setup.js` deletes `MONGODB_URI`/`DATABASE_URL` and refuses to run if Mongoose was connected elsewhere |
| Backend tests (PostgreSQL) | `npm run test:db`: migrations 0001–0006 up/down, ETL, reconciliation, every API route on PostgreSQL, sessions, CSRF, rate limits, checkout idempotency | its own `postgres:17-alpine` container with a random password (`test/db/globalSetup.ts`), removed afterwards |
| Next.js unit and component tests | `apps/web`: `npm test` | none (fetch is faked) |
| Legacy Vite app | `ecommerce-project`: tests, typecheck, lint, build | none |
| Typecheck and lint | backend `tsc`; web `tsc` + ESLint | none |
| Production builds | backend `tsc` build, `next build`; then a check that no server-only variable name (`BACKEND_ORIGIN`, `PROXY_CLIENT_IP_SECRET`, `DATABASE_URL`, `MONGODB_URI`, `JWT_SECRET`) appears in `.next/static` | none |
| Dependency audit | `npm audit --audit-level=low` per package (fails on any advisory) | none |
| Proxy and page e2e | `npm run test:e2e` (52 checks, incl. an HTTPS-equivalent scenario with a throwaway certificate) and `npm run test:pages` (92 checks) against compiled Express + `next start` | its own `postgres:17-alpine` container (`scripts/e2e-support.mjs`, started on the runner) |

## `.github/workflows/browser.yml` — real browsers, isolated

One job builds the backend and Next.js once and shares the output (`dist`, `.next` without its cache) as a 1-day
artifact. Then **each engine runs on its own runner**, at **1 and at 2 workers** (6 jobs):

| Engine | Projects (viewports) |
| --- | --- |
| Chromium | desktop 1366×900, tablet 820×1180 (touch), Pixel 7 — plus the reflow tests at 320, 375, 683 (200 % zoom), 768, 1024 and 1280 px, forced colours and layout-shift measurements |
| WebKit | desktop 1366×900, iPhone 14 |
| Firefox | desktop 1366×900 |

**Browsers come from the official Playwright image (since `eae9b09`).** Each browser job runs in
`mcr.microsoft.com/playwright:v1.64.0-noble`, pinned by digest, which ships the exact browser builds of the locked
Playwright version (1.64.0: Chromium 1248, Firefox 1555, WebKit 2370) and their Ubuntu 24.04 libraries. Nothing is
downloaded or apt-installed per job; starting the container took 32–43 s. A step fails if the lockfile's Playwright
version no longer matches the image, so an upgrade must move the image tag and digest with it. The job runs as uid
1001 (the image's unprivileged `pwuser`, also the runner's uid); no Docker socket is mounted, nothing is privileged.

The suite starts its own throwaway stack (`browser/stack.mjs`): compiled Express, `next start`, and a fresh
database. In the job container that database is created on a `postgres:17-alpine` **service container** with no
published port (`E2E_POSTGRES_SERVER_URL`; `scripts/e2e-support.mjs` creates a randomly named database, migrates it
and drops it afterwards). Locally and in `ci.yml`, without that variable, the helper starts its own PostgreSQL
container as before. Timeouts and retries are those of `playwright.config.ts` (90 s per test, one retry for Firefox
only); the workflow only sets the worker count.

History of the install step (kept for the record). Until run 40008746470 browsers were installed with
`playwright install --with-deps`, which took 696–2,692 s (WebKit hit the 45-minute job limit) while the tests took
1–3 minutes. From `fce094d` the install was split into two bounded steps (at most 15 minutes each, browser cached
with `actions/cache`): in the next 4 runs the browser step took 0–8 s and the OS-package step 11–51 s, but the
OS-package (apt) step still hung on the package mirrors — 4 of 10 Browser runs, 2 before the split and 2 after
(40341123856 WebKit and 40370706705 Firefox, 1 worker, 912 s each; Chromium 1 worker 417 s in the latter). Each such
round counted as failed; no retry or longer bound was added. The image replaced both steps. On `eae9b09`, Browser
40914194558 then passed three consecutive complete rounds (attempts 1–3, 21/21 jobs).

Each browser job records, and summarises in the job summary and as annotations (`scripts/browser-report-summary.mjs`):
counts per project (passed, failed, flaky, skipped), every failed attempt with its file and line, the slowest attempts
with their slowest API request and document response (`timings` fixture in `browser/support.ts`), /api requests left
unfinished at the end of a test, one browser launch time per worker, and runner load from `vmstat` every 5 s.

## Safety

- `permissions: contents: read` everywhere; checkouts use `persist-credentials: false`; no `secrets.*` is referenced.
- Third-party actions are the official `actions/*` ones, pinned to commit SHAs (with the version in a comment). The
  browser jobs' container image is Microsoft's official Playwright image, pinned by digest.
- The browser jobs' database service uses a fixed placeholder password (`e2e`): it has no published port, is
  reachable only from that job's network, holds only throwaway test data and is removed with the job.
- `MONGODB_URI` and `DATABASE_URL` are set to empty strings at workflow level, and both test setups clear them again.
- `concurrency` cancels a superseded run on the same branch; every job has a `timeout-minutes`.
- npm caches (`actions/setup-node` with `cache: npm`) hold downloaded packages only, keyed on the lockfiles.
- **The repository is public, so artifacts and logs are visible to signed-in GitHub users.** Metrics artifacts hold
  counts, timings and load only. Failure artifacts (traces, screenshots, HTML report) hold only this run's throwaway
  accounts, passwords and orders from a disposable database; nothing from a real system can be in them. Note: if
  `docker run` itself fails, the error message prints the container's random, single-use PostgreSQL password.

## Running a job locally

```powershell
# Backend (Docker needed for test:db)
cd ecommerce-backend; npm ci; npm test; npm run test:db
# Next.js
cd apps/web; npm ci; npm test; npm run typecheck; npm run lint; npm run build
# e2e and browsers need both builds (backend: npm run build; web: npm run build) and Docker
npm run test:e2e; npm run test:pages
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = "test-results/report.json"
npx playwright test --project=firefox-desktop --workers=1 --reporter=list,json,html
node scripts/browser-report-summary.mjs test-results/report.json
```

## Not included (deliberately)

No deployment, preview environment, production smoke test or database migration job. No secrets are needed for any
job; adding one would need its own review.
