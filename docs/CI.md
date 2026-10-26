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
| Proxy and page e2e | `npm run test:e2e` (52 checks, incl. an HTTPS-equivalent scenario with a throwaway certificate) and `npm run test:pages` (92 checks) against compiled Express + `next start` | its own `postgres:17-alpine` container (`scripts/e2e-support.mjs`) |

## `.github/workflows/browser.yml` — real browsers, isolated

One job builds the backend and Next.js once and shares the output (`dist`, `.next` without its cache) as a 1-day
artifact. Then **each engine runs on its own runner**, at **1 and at 2 workers** (6 jobs):

| Engine | Projects (viewports) |
| --- | --- |
| Chromium | desktop 1366×900, tablet 820×1180 (touch), Pixel 7 — plus the reflow tests at 320, 375, 683 (200 % zoom), 768, 1024 and 1280 px, forced colours and layout-shift measurements |
| WebKit | desktop 1366×900, iPhone 14 |
| Firefox | desktop 1366×900 |

Browsers are installed with the official Playwright procedure in two bounded steps (at most 15 minutes each):
`npx playwright install <engine>` with the browser cached per engine and Playwright version (`actions/cache`,
`~/.cache/ms-playwright`), then `npx playwright install-deps <engine>` for the OS packages. They were one step
(`--with-deps`) until run 40008746470, where installation took 696–2,692 s (WebKit hit the 45-minute job limit) while
the tests themselves took 1–3 minutes; in the 4 runs since (40084134454 – 40090794620) the browser step took 0–8 s and
the OS-package step 11–51 s. `actions/cache` saves only when the job succeeds, so an engine whose jobs fail keeps
downloading (3–5 s for WebKit); the step timings show hits for Chromium and Firefox from the second run on. The
cache key includes the Playwright version, so an upgrade downloads fresh browsers. The OS-package step still hangs now
and then on the package mirrors (3 of 9 Browser runs: 2 before the install was split, 1 after — 40341123856, WebKit 1 worker, 912 s); the bound
makes that a clear step failure, counted as a failed round. No retry or longer bound has been added. The suite starts its own
throwaway stack (`browser/stack.mjs`). Timeouts and retries are those of `playwright.config.ts` (90 s per test, one
retry for Firefox only); the workflow only sets the worker count.

Each browser job records, and summarises in the job summary and as annotations (`scripts/browser-report-summary.mjs`):
counts per project (passed, failed, flaky, skipped), every failed attempt with its file and line, the slowest attempts
with their slowest API request and document response (`timings` fixture in `browser/support.ts`), /api requests left
unfinished at the end of a test, one browser launch time per worker, and runner load from `vmstat` every 5 s.

## Safety

- `permissions: contents: read` everywhere; checkouts use `persist-credentials: false`; no `secrets.*` is referenced.
- Third-party actions are the official `actions/*` ones, pinned to commit SHAs (with the version in a comment).
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
