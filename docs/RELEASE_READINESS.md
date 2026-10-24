# Release readiness (Phase 7A, 2026-10-23 – 2026-10-24)

**Verdict: NO-GO for production.** Nothing has been deployed, no production database or setting was touched, and no
cutover is approved. This report lists what was verified, what was measured, what is still open and the checklist
for any future cutover. Evidence for each line is in MIGRATION_PLAN.md §6 Phase 7A unless stated. Run links:
`https://github.com/Manoj132508/Ecommerce-project/actions/runs/<run id>` (branch `ci/phase7a-verification`).

## 0. Release-readiness summary

Statuses: PASS (verified), FAIL (verified not met), BLOCKED (cannot proceed until something else happens), PENDING
MANUAL (needs a person), NOT RUN (not attempted in 7A).

| Requirement | Evidence | Status | Risk | Next action |
| --- | --- | --- | --- | --- |
| CI: tests, typecheck, lint, builds, e2e on every PR | CI run 40090794609 (`753f00b`): 11/11 jobs success | PASS | Low | Keep required on PRs |
| Dependency audit, 0 advisories (3 packages) | CI 40084134395 failed on a new advisory (body-parser); fixed `c5056fd`; green since (40086240138, 40088693261, 40090794609) | PASS | Low — new advisories can appear any day | Fix or accept within days when the audit job fails |
| No server-only variable in client bundles | `build` job check, every CI run | PASS | Low | — |
| Chromium (desktop, tablet, mobile) | 14/14 jobs success in 7 browser runs, 0 flaky; final 91 passed, 8 skipped per job | PASS | Low | — |
| WebKit (desktop, iPhone) | Failed in every run before `753f00b` (hydration bug, fixed `73ddf7c`; sign-out race in a test, fixed `753f00b`); Browser 40090794620: 47 passed, 0 failed, 0 flaky, 19 skipped at 1 and 2 workers | PASS on **one** run | Medium until repeated | 2 more consecutive clean runs (§7) |
| Firefox (desktop) | Passed in 5 of 7 runs; failed in 39998439611 (1 worker, cause not recorded: annotations did not exist yet) and in 40088693317 (both jobs, the sign-out race, made worse by `96128da`, reverted); 40090794620: 26 passed, 0 failed, **0 flaky**, 7 skipped at 1 and 2 workers | PASS on **one** run | Medium until repeated | 2 more consecutive clean runs (§7) |
| Browser install bounded and cached | Install 696–2,692 s before `fce094d`; 0–51 s in the 4 runs after (§5) | PASS | Low | — |
| Security review (code + probes) | §2 | PASS (review done) | — | — |
| High-severity findings fixed | body-parser `c5056fd` | PASS | — | Production API still runs the vulnerable version until a deploy |
| Medium findings fixed or accepted | §2 "Open": 5 Medium items | FAIL | Medium | Owner decision; fixes before or during 7B |
| Checkout idempotency under concurrency | 10 × 3 simultaneous checkouts → exactly 10 orders; key reuse → 422 (§2) | PASS | Low | — |
| Automated accessibility (axe, keyboard, zoom, reflow, forced colours) | Browser runs (§3) | PASS | Low | — |
| Manual screen-reader pass | `docs/SCREEN_READER_TEST_GUIDE.md`; not performed | PENDING MANUAL | High for a release | Owner/tester runs NVDA + Firefox, VoiceOver + Safari |
| Performance budget | Local measurements only (§4) | PASS (local) | Medium — no field data | Measure on staging (7B) |
| Production config: data-source switches need `POSTGRES_PRODUCTION_ENABLED=true` | `config` code + tests | PASS | Low | — |
| Production config: cookie sessions refused with `NODE_ENV=production` | `auth/config.ts:72` + tests; guard kept | PASS (guard present) | — | Lifting it needs an approved change (§6) |
| Next.js storefront can sign in against production API | Impossible while the guard is on | BLOCKED | High | Approved, tested staging allowance first (7B plan) |
| `NODE_ENV=production` set on Render | Not visible from the repository | NOT RUN | Medium (stack traces in error pages otherwise) | Owner checks the Render dashboard |
| Production MongoDB provider and restore-tested backup | Unknown | BLOCKED | Blocker for any data step | Owner identifies the provider |
| R31 rollback after writes resume | Write-freeze mode and reconciliation CLI not implemented (§6) | BLOCKED | High | Implement and rehearse in 7B |
| Staging rehearsal | `docs/PHASE7B_STAGING_PLAN.md` (proposal) | NOT RUN | — | Needs approval |
| Deployment, production DB change | None made | NOT RUN (by design) | — | — |

## 1. Risks that exist in production today (not introduced by this migration)

| # | Risk | Severity | Ends when |
| --- | --- | --- | --- |
| R2 | The deployed MongoDB path has **one global cart**: any visitor can read and change it, and an order empties it for everyone (pinned in `test/cart.shared-cart.current-flaw.test.js`). | High | Carts move to PostgreSQL (per-user carts, D1) at cutover |
| R30 | The live Vite app keeps a **30-day JWT in `localStorage`**. | Medium | Cookie sessions replace bearer tokens (plan §4 "Conditions before the legacy bearer tokens can be removed") |
| — | Production MongoDB **provider and location unknown**; no verified backup. | Blocker for any data operation | The owner identifies the provider and a restore-tested dump exists |

## 2. Security review — findings (verified in code or by a probe; no guesses)

**Fixed in Phase 7A (on the CI branch, awaiting review):**

| Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- |
| High | `body-parser` < 1.20.9: DoS via trailing bytes after a compressed request body (GHSA-27r3-jxmh-p828). Reachable: `express.json()` inflates compressed bodies on unauthenticated routes. **The deployed API is very likely affected too** (same Express 4 line). | New advisory, caught by the CI audit job on 2026-10-24 (run 40084134395). | `c5056fd`: lockfile-only update to 1.20.9 (Express 4.22.3 accepts `~1.20.5`). 1.20.9 was 2 days old — a documented exception to the 14-day rule for a high-severity DoS. Backend suites, typecheck, build and audit pass. |
| Medium (functional/accessibility) | **Hydration mismatch on order pages in Linux WebKit** (React error #418): Linux WebKit's ICU writes "Saturday 24 October 2026", Node "Saturday, 24 October 2026". | `browser/formatting.spec.ts` on CI run 40084134454 named the exact strings. | `73ddf7c`: `lib/format.ts` builds the text from numeric date parts; unit tests prove the output equals the previous Node text. Confirmed on CI run 40086240119 (WebKit historical-orders and date tests pass). |

**Open (not fixed — each changes pinned API behaviour or authentication and needs approval):**

| Severity | Finding | Evidence | Proposed fix (not applied: API-contract or auth change, needs approval) |
| --- | --- | --- | --- |
| Medium | **Per-account sign-in limit can be exceeded by simultaneous attempts.** `AuthRateLimiter.authenticate()` peeks, checks the password (bcrypt), then counts. | New test `test/db/authRateLimit.concurrent-flaw.test.ts`: 12 simultaneous wrong passwords → more than 3 checked (3/3 runs). The atomic per-address limit still caps the burst; the account is locked afterwards; no session is created. | Count first (atomic `hit` before the check; clear on success), keep the 429 shape. |
| Medium | **Raw database errors in two 500 responses**: `GET /api/products`, `GET /api/delivery-options` return `error.message` (e.g. `connect ECONNREFUSED 10.20.30.40:5432`, `relation "delivery_options" does not exist`). | In-process probe with a failing repository, `NODE_ENV` unset and `production`. | Generic message, log the detail server-side (as every other 500 already does). |
| Medium (Low if `NODE_ENV=production`) | **Express default error handler**: malformed JSON → HTML page **with a stack trace and server file paths** unless `NODE_ENV=production`; unknown routes → HTML 404. Pinned as current behaviour by `test/app.test.js`. | Probe. Whether Render sets `NODE_ENV=production` is **not verified**. | JSON error handler (400 malformed body, 413 too large, 404, generic 500); set and verify `NODE_ENV=production` on Render. |
| Medium | **No Content-Security-Policy** on the Next.js app (other headers present: nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy). | `next.config.ts`. | Nonce-based CSP in the proxy/middleware (App Router needs nonces for its inline scripts), report-only first. |
| Medium (reliability) | **PostgreSQL pool has no connection or statement timeout** (`pg` defaults: wait for a connection indefinitely, max 10). **No graceful shutdown** (no SIGTERM handler; pool never closed). **No health check that touches the database** (`GET /` returns text). | `config/postgres.ts`, `server.ts`. | `connectionTimeoutMillis`, `statement_timeout`, `idle_in_transaction_session_timeout`; SIGTERM → stop accepting, drain, `pool.end()`; `/healthz` with a `SELECT 1`. |
| Low | `X-Powered-By: Express` on the API (not forwarded by the Next.js proxy, visible on the Render origin). Express sets no security headers of its own. | Probe. | `app.disable("x-powered-by")`; minimal headers on the API. |
| Low | Logs are unstructured `console` strings; no request id. | Code. | JSON logs with a request id; never log bodies or cookies. |
| Low | Cart and orders pages show the browser's raw network error ("Failed to fetch"); checkout already explains it. | Browser probe with the API aborted. | Same mapping as checkout. |
| Info | A failing `docker run` in the test helpers prints the throwaway container password. | CI/test logs only; random, single use, loopback-only container. | Optional: pass it via an env file. |

**Verified as sound** (tests and code): `__Host-` session cookie, HttpOnly, Secure, SameSite=Lax, host-only; 32-byte
random token stored as SHA-256; idle 7 d (extended at most every 15 min) and absolute 30 d expiry; revocation on
logout, logout-all, rotation, password change; CSRF = HMAC of the session token, constant-time compare, plus strict
`Origin` checks on unsafe methods and a pre-route Origin refusal; atomic per-address rate limits that fail closed;
admin routes enforced in Express (`adminOnly`) and in every admin page; customer ownership (404 for another user's
order or cart line, `scope=own`); every SQL statement parameterised (interpolations are constant column lists or
generated `$n` placeholders) and request identifiers validated by exact format; checkout in one transaction with a
cart row lock; Idempotency-Key replay and **422 on key reuse with different details**; private responses
`private, no-store` with `Vary: Cookie, Authorization`; the Next.js proxy forwards only `/api/*` to one origin with
traversal/encoding checks, allow-listed methods/headers, session cookies only, `Domain` cookies dropped, 1 MiB
request limit, 15 s upstream timeout, no redirects followed; no server-only variable name in client bundles (CI
check); no credential or `.env` file in the 61 commits of git history.

**Measured (disposable stack):** 10 customers × 3 simultaneous identical checkouts with one key each → 30 × 201, the
same order id per customer, **exactly 10 orders**, all carts emptied; reusing each key with other details → 10 × 422,
no new order. `npm audit`: 0 vulnerabilities in all three packages.

## 3. Accessibility

Automated, passing in CI and locally: axe (WCAG 2.0/2.1 A/AA, no serious or critical) on customer and admin pages;
keyboard order and focus rings; cart drawer focus trap/return; modal dialogs (`:modal`, Escape, focus return
incl. WebKit); linked form errors with focus on the first; 200 % zoom (683 px) and reflow at 320, 375, 768, 1024,
1280 px; forced colours (Chromium); reduced motion (drawer animation off).

**Blocker: the manual screen-reader pass has not been performed** (NVDA + Firefox, VoiceOver + iOS Safari) — see
`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md` and how to run it in `docs/SCREEN_READER_TEST_GUIDE.md`. No item is ticked.

## 4. Performance and reliability (measured locally on `next start`, not field data)

Chromium desktop, warm navigation: TTFB 13–105 ms; LCP 92–128 ms on catalogue, product, order and admin pages,
**600–684 ms on cart and checkout** (client-rendered after the session and cart requests); CLS ≤ 0.011 except cart
0.035 and checkout 0.065 (skeleton → content; under 0.1); encoded script 184–189 KiB per page. Fast 3G + 4× CPU:
cart LCP 1.3 s, checkout 964 ms, other pages ≤ 576 ms (scripts were cached, so first visits are slower). Images:
`next/image` with fixed boxes, only the first row/hero preloaded. Admin edits invalidate the catalogue cache at once
(`revalidateTag("catalog")`, browser and pages e2e). Error states: API 500 and offline show a titled error with
**Try again**. Recommendation backed by these numbers: server-render the first cart/checkout payload.

## 5. Browser stability

Each engine runs on its own runner at 1 and at 2 workers. Every Browser run on `ci/phase7a-verification`
(counts per job: passed / failed / flaky / skipped; failed attempts from the job annotations):

| Run | Commit | Chromium 1w · 2w | Firefox 1w · 2w | WebKit 1w · 2w | Failures |
| --- | --- | --- | --- | --- | --- |
| 39998439611 | `b174e4a` | success · success | **failure** · success | **cancelled** (install hit 45 min) · **failure** | Not recorded (annotations added in `1ced369`; logs need sign-in) |
| 40004086124 | `fa70e25` | success · success | success · success | **failure** · **failure** | WebKit: historical orders, console errors (×2 projects, both jobs); account flow `goto /account` "interrupted by another navigation" (2w, both projects) |
| 40008746470 | `c917823` | success · success | success · success (13 min: install 696 s) | **cancelled** (install 2,692 s) · **failure** | WebKit 2w: historical orders, React #418 (both projects) |
| 40084134454 | `fce094d` | success · success | success · success | **failure** · **failure** | WebKit: historical orders #418 and the new date-format test (both projects, both jobs) naming `"Saturday, 24 October 2026"` (Node) vs `"Saturday 24 October 2026"` (WebKit); 1w also account flow "TypeError: Load failed" |
| 40086240119 | `aa57bc9` | success · success | success · success | **failure** · **failure** | WebKit: account flow "interrupted by another navigation" (1 project per job). Dates: **pass** |
| 40088693317 | `96128da` | success · success | **failure** · **failure** | **failure** · **failure** | Account flow only: Firefox "JSHandle@object" console error (1w) and `NS_BINDING_ABORTED` (2w), both attempts; WebKit "Load failed" (1w), "interrupted by another navigation" (2w) |
| **40090794620** | **`753f00b`** | 91/0/0/8 · 91/0/0/8 | 26/0/0/7 · 26/0/0/7 | 47/0/0/19 · 47/0/0/19 | **None.** 7/7 jobs success, 0 flaky, 0 cancelled |

What the evidence shows:

- **CI runners are not saturated** the way the local PC was: mean CPU 44–73 % for Chromium and Firefox jobs, 64–88 %
  for WebKit (up to 7 samples ≥ 95 % in WebKit at 2 workers), 12–13.7 GB memory free (the local 4-core PC: 80–91 %,
  1.6 GB free). Browser launch per worker 35–1,242 ms.
- **Chromium passed all 14 jobs** at 1 and 2 workers, with no flaky test.
- **The long WebKit/Firefox CI durations (11–45 min) were installation, not tests** (`playwright install
  --with-deps`: 696–2,692 s). Since `fce094d` the browser download and the OS packages are separate steps of at most
  15 minutes each, and the browser is cached: across the 4 runs since, the OS-package step took 11–51 s and the
  browser step 0–8 s. Inferred from step timings (the cache log itself needs sign-in): Chromium and Firefox took 4–8 s
  on the first run (cache miss) and 0–1 s afterwards (hit). WebKit's cache was only saved in 40090794620, because
  `actions/cache` saves on job success and every earlier WebKit job failed; its download took 3–5 s anyway. The
  original slowness was outside the repository (package mirrors/downloads); the bound turns a recurrence into a
  clear step failure instead of a 45-minute timeout.
- **One application defect, Linux WebKit only:** the date hydration mismatch (React #418 on order pages). Root
  cause confirmed by the date-format test before any app change; fixed in `73ddf7c` (text built from numeric date
  parts; `lib/format.test.ts` proves the output equals the previous Node text). Passing in WebKit in all 6 jobs of the
  3 runs since.
- **The other failures were one test's design**, all in the account flow, all after the header's sign-out:
  `page.goto("/account")` raced the app's own `router.refresh()` of the current page (WebKit "interrupted by another
  navigation", Firefox `NS_BINDING_ABORTED`, an aborted fetch logged as "Load failed" / "JSHandle@object"). Two
  attempts to wait for the refresh did not synchronise it — matching the refresh's RSC response excluded prefetches
  (`aa57bc9`) but the page is applied after that response, and `networkidle` (`96128da`) resolves at once and made
  Firefox fail more often, so it was reverted. Next.js exposes no "refresh applied" signal. The guard check now
  opens a new page in the same context (`753f00b`): the same cookies, the same assertion that `/account` sends a
  signed-out visitor to sign in. No timeout, retry or assertion was relaxed. A real visitor is not affected: a
  click during the refresh is an ordinary navigation that supersedes it.
- **One clean run is not stability.** The account-flow race appeared in 4 of the 5 earlier runs that have annotations and the fix has
  run once. The local Firefox stalls (no navigation after an action under heavy parallel load) did **not** reproduce
  on CI. Both stay documented risks until the go/no-go criterion in §7 (3 consecutive clean runs) is met.

## 6. Production plan (documentation only — nothing below has been done)

**Hosting (confirmed from the repository and the owner):** API on Render; live Vite storefront on Vercel
(`ecommerce-project-three-peach.vercel.app`, hard-coded in the API's CORS list). The Next.js app (`apps/web`) has
**no** deployment yet; it gets a **new** Vercel project (plan §5, R10).

**MongoDB (production):** provider unknown → identify it; take a `mongodump` with the URI passed as an environment
variable (never on a command line or in a file in the repo), restore it into a throwaway container and verify counts
before any data operation (plan §7).

**PostgreSQL (production):** managed Render Postgres in the API's region, PostgreSQL 17 (the tested version), daily
backups with point-in-time recovery if the plan allows, `pg_dump` before every migration; migrations applied with
`npm run db:migrate` (never at start-up); an application role without DDL rights for runtime.

**R31 rollback limits:** after writes resume on PostgreSQL, rolling back to MongoDB needs the reverse
reconciliation (plan §6 Phase 4 "Rollback after writes resumed"); orders placed on PostgreSQL carry snapshots and
idempotency keys MongoDB cannot represent fully; the documented no-rollback condition and forward-fix plan apply.

**Render (API):** build `npm ci && npm run build` (TypeScript → `dist`, migrations copied); start `node dist/server.js`;
`NODE_ENV=production`, `JWT_SECRET`, `MONGODB_URI`, `CLIENT_URL`, `TRUST_PROXY_HOPS`, `PROXY_CLIENT_IP_SECRET`; for
PostgreSQL domains `DATABASE_URL` (internal URL) and the per-domain switches `DATA_SOURCE_DELIVERY_OPTIONS`,
`DATA_SOURCE_PRODUCTS`, `DATA_SOURCE_USERS`, `DATA_SOURCE_CARTS`, `DATA_SOURCE_ORDERS`, which the API only accepts in
production together with `POSTGRES_PRODUCTION_ENABLED=true` (set only at the approved step).
**Cookie sessions cannot be switched on in production today:** `auth/config.ts` refuses
`AUTH_COOKIE_SESSIONS=true` with `NODE_ENV=production` ("a development feature … yet"). Activating them needs an
approved code change first, then `AUTH_COOKIE_SESSIONS=true`, `AUTH_ALLOWED_ORIGINS=<storefront origin>`,
`AUTH_COOKIE_SECURE=true` (the default), with sessions stored in PostgreSQL. Until then the Next.js storefront cannot
sign anyone in against the production API — it depends on cookie sessions.

**Vercel (Next.js):** root `apps/web`; `BACKEND_ORIGIN=https://<render API>` (server-only), `NEXT_PUBLIC_APP_NAME`,
`NEXT_PUBLIC_SITE_URL`, `TRUSTED_CLIENT_IP_HEADER=x-real-ip`, `PROXY_CLIENT_IP_SECRET` (same as Render). The browser
only ever calls the storefront origin; `/api/*` is proxied server-side, so the session cookie is first-party and
host-only (`__Host-`). No custom cookie domain is needed; a custom domain changes `AUTH_ALLOWED_ORIGINS`,
`NEXT_PUBLIC_SITE_URL` and `CLIENT_URL` together. Legacy JWT: the Vite app keeps working with bearer tokens until it
is retired; tokens are not migrated.

**Staging test plan (Phase 7B, not started):** a separate Render service + Render Postgres + Vercel preview project,
seeded with the test catalogue or a **sanitised** copy (no real emails, addresses, passwords or orders); run the CI
suites against it plus a manual pass: register, sign in, cart on two accounts, checkout with a network drop and
retry, orders, tracking, admin product create/edit/delete with storefront refresh, status change with history,
session expiry, sign out everywhere, the screen-reader checklist.

## 7. Go/no-go checklist for any future production cutover

- [ ] Owner approval for the specific step, recorded with date.
- [ ] Production MongoDB provider identified; restore-tested `mongodump` taken within 24 h.
- [ ] Render Postgres provisioned (region, v17, backups/PITR); restore of its backup rehearsed.
- [ ] All CI jobs green on the release commit, **and** the browser workflow green on at least 3 consecutive runs
      with no failed attempt outside Firefox's single retry; any stall explained.
- [ ] Medium findings in §2 fixed or explicitly accepted by the owner (rate-limit race, error leaks, CSP, pool
      timeouts, graceful shutdown, health check).
- [ ] Manual screen-reader pass completed with no ✗ in checkout, sign-in, dialogs or error rows.
- [ ] Staging pass (§6) completed on sanitised data.
- [ ] The production guard on cookie sessions (`auth/config.ts`) lifted by an approved, tested change; the legacy
      bearer-token conditions (plan §4) met.
- [ ] `NODE_ENV=production` and every variable in §6 set and verified on Render and Vercel; no secret in the repo.
- [ ] Write-freeze window, reconciliation CLI rehearsed against restored copies, rollback owner on call.
- [ ] Monitoring: health check, error logs and alerting in place before traffic moves.
