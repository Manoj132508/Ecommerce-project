# Release readiness (Phase 7A, 2026-10-23 – 2026-10-26)

**Verdict: NO-GO for production.** Nothing has been deployed, no production database or setting was touched, and no
cutover is approved. This report lists what was verified, what was measured, what is still open and the checklist
for any future cutover. Evidence for each line is in MIGRATION_PLAN.md §6 Phase 7A unless stated. Run links:
`https://github.com/Manoj132508/Ecommerce-project/actions/runs/<run id>` (branch `ci/phase7a-verification`).

## 0. Release-readiness summary

Statuses: PASS (verified), FAIL (verified not met), BLOCKED (cannot proceed until something else happens), PENDING
MANUAL (needs a person), NOT RUN (not attempted in 7A).

| Requirement | Evidence | Status | Risk | Next action |
| --- | --- | --- | --- | --- |
| CI: tests, typecheck, lint, builds, e2e on every PR | CI runs 40090794609 (`753f00b`) and 40094305039 (`c1caee0`, docs only): 11/11 jobs success each | PASS (on `c1caee0`) | Low | Keep required on PRs |
| CI on the release candidate | Pushed `c1caee0..9ed46cd` (approved). CI **40341123629: FAIL**, 9/11 jobs: PostgreSQL job — the Linux-only SIGTERM test exposed a real shutdown defect (keep-alive connections held until the timeout; fixed `ff8ca8b`) and one rate-limit test with a timing assumption (corrected `798ff88`); Vite job — `cartAuth.test.tsx` 1-s `findByRole` timeout in untouched code (passed locally and in every earlier CI run) | FAIL on `9ed46cd`; fixes local | Medium | Approve pushing `ff8ca8b`, `798ff88`, `7b2002a` and docs; then CI + 3 Browser runs on that SHA (§8) |
| All suites on the release candidate, locally | Backend MongoDB 234 + 9 todo, PostgreSQL 306 + 1 skipped (Linux-only SIGTERM test, verified by hand on Linux), Next.js 240, Vite 47, proxy e2e 52, pages e2e 92, typecheck, lint, builds, `npm audit` 0 ×3 | PASS (local) | Low | Same in CI after the push |
| Dependency audit, 0 advisories (3 packages) | CI 40084134395 failed on a new advisory (body-parser); fixed `c5056fd`; green since (40086240138, 40088693261, 40090794609) | PASS | Low — new advisories can appear any day | Fix or accept within days when the audit job fails |
| No server-only variable in client bundles | `build` job check, every CI run | PASS | Low | — |
| Chromium (desktop, tablet, mobile) | CI: 16/16 jobs success in 8 browser runs, 0 flaky (91 passed, 8 skipped per job on `753f00b`/`c1caee0`). Release candidate, locally: 3 consecutive local rounds on `0e40af7` (each engine alone, 1 worker): 103 passed, 0 failed, 0 flaky, 8 skipped each | PASS | Low | — |
| WebKit (desktop, iPhone) | Failed in every run before `753f00b` (hydration bug, fixed `73ddf7c`; sign-out race in a test, fixed `753f00b`); Browsers 40090794620 and 40094305058: 47 passed, 0 failed, 0 flaky, 19 skipped at 1 and 2 workers (two consecutive clean runs on the `753f00b` code). Release candidate, locally: on `d5510cb` 9–10 failures per round (pre-hydration form bug, fixed `fbee7e1`; Playwright screenshot style, harness fix `0e40af7`); then 3 consecutive local rounds on `0e40af7` (each engine alone, 1 worker): 55 passed, 0 failed, 0 flaky, 19 skipped each | PASS (CI ×2 on `753f00b`; local ×3 on the release candidate) | Medium until repeated in CI | 3 consecutive clean CI runs on the release candidate (§7) |
| Firefox (desktop) | Passed in 5 of 7 runs; failed in 39998439611 (1 worker, cause not recorded: annotations did not exist yet) and in 40088693317 (both jobs, the sign-out race, made worse by `96128da`, reverted); 40090794620 and 40094305058: 26 passed, 0 failed, **0 flaky**, 7 skipped at 1 and 2 workers (two consecutive clean runs). Release candidate, locally: 3 consecutive local rounds on `0e40af7` (each engine alone, 1 worker): 30 passed, 0 failed, **0 flaky** (no retry used), 7 skipped each | PASS (CI ×2 on `753f00b`; local ×3 on the release candidate) | Medium until repeated in CI | 3 consecutive clean CI runs on the release candidate (§7) |
| Browser run on `9ed46cd` | **40341123856: FAIL**, 6/7 jobs success: Chromium 103/0/0 ×2, Firefox 30/0/0 ×2, WebKit (2 workers) 55/0/0; WebKit (1 worker) — **infrastructure**: `Install webkit OS dependencies` (apt) timed out at the 15-min bound, suite skipped | FAIL (infra) | Medium: apt mirror slowness recurs (4 of 10 Browser runs; 2 since the split, both in the last 2 runs) | Count as a failed round; no timeout or retry change without approval (§8) |
| Browser install bounded and cached | Install 696–2,692 s before `fce094d`; 0–51 s in the 4 runs after (§5) | PASS | Low | — |
| Security review (code + probes) | §2 | PASS (review done) | — | — |
| High-severity findings fixed | body-parser `c5056fd` | PASS | — | Production API still runs the vulnerable version until a deploy |
| Medium findings fixed or accepted | All 5 fixed with regression tests (§2): `99db7ab`, `b63bdd7`, `2952952`, `d8d99c0`, `4549772` | PASS (local; CI pending) | Low | Review; CI on the push |
| Pre-hydration form input (found by the release-candidate runs) | Fixed `fbee7e1`, browser regression test | PASS (local) | Low | — |
| Checkout idempotency under concurrency | 10 × 3 simultaneous checkouts → exactly 10 orders; key reuse → 422 (§2) | PASS | Low | — |
| Automated accessibility (axe, keyboard, zoom, reflow, forced colours) | Browser runs (§3) | PASS | Low | — |
| Manual screen-reader pass | `docs/SCREEN_READER_TEST_GUIDE.md`; not performed | PENDING MANUAL | High for a release | Owner/tester runs NVDA + Firefox, VoiceOver + Safari |
| Performance budget | Local measurements only (§4) | PASS (local) | Medium — no field data | Measure on staging (7B) |
| Production config: data-source switches need `POSTGRES_PRODUCTION_ENABLED=true` | `config` code + tests | PASS | Low | — |
| Production config: cookie sessions refused with `NODE_ENV=production` | `auth/config.ts:72` + tests; guard kept | PASS (guard present) | — | Lifting it needs an approved change (§6) |
| Staging-only cookie-session allowance; production still refuses | `ae38316`: every condition tested; `server.ts` start-up with production-shaped settings exits 1 before listening (also with the staging switches copied in); staging starts with secure cookies | PASS (local) | Low | Use in 7B only |
| Next.js storefront can sign in against production API | Impossible while the guard is on (by design) | BLOCKED | High | A separate, approved production change after staging |
| `NODE_ENV=production` set on Render | Not visible from the repository | NOT RUN | Low since `2952952` (no stack traces in any environment); guards still depend on it | Owner checks the Render dashboard |
| Production MongoDB provider and restore-tested backup | Unknown: no tracked metadata; the local `.env` points at a local MongoDB (§6) | BLOCKED | Blocker for any data step | Owner reads the `MONGODB_URI` host in the Render dashboard |
| R31 rollback after writes resume | Write freeze `94e08b9`, CLI `d5510cb`, batched writes and a pre-flight size guard `7b2002a` (apply at 20,000 users/orders: 27 s → 6 s; guard 25,000 per table, ~0.6 GB measured at 20,000); runbook `docs/CUTOVER_RUNBOOK.md`; all on disposable databases | BLOCKED (for production) | High | Rehearsal on restored copies in 7B; streaming for > 25,000 records if real volumes need it |
| Live `main` dependencies | `main` has runtime advisories: backend proxy-addr critical, body-parser/express/path-to-regexp high, qs moderate; Vite app form-data critical, axios/react-router/turbo-stream high. Hotfix A (backend) prepared on local branch `hotfix/backend-express-4.22.3` (`bd8cb6a`): runtime audit 0, `node --test` 24/24, 35 requests identical before/after | BLOCKED (approval) | **High in production today** | Approve review → push → merge → deploy separately (`docs/HOTFIX_MAIN_DEPENDENCIES.md`); Hotfix B (Vite) to prepare |
| Staging rehearsal | `docs/PHASE7B_STAGING_PLAN.md` (proposal) | NOT RUN | — | Needs approval |
| Deployment, production DB change | None made | NOT RUN (by design) | — | — |

## 1. Risks that exist in production today (not introduced by this migration)

| # | Risk | Severity | Ends when |
| --- | --- | --- | --- |
| R2 | The deployed MongoDB path has **one global cart**: any visitor can read and change it, and an order empties it for everyone (pinned in `test/cart.shared-cart.current-flaw.test.js`). | High | Carts move to PostgreSQL (per-user carts, D1) at cutover |
| R30 | The live Vite app keeps a **30-day JWT in `localStorage`**. | Medium | Cookie sessions replace bearer tokens (plan §4 "Conditions before the legacy bearer tokens can be removed") |
| — | Production MongoDB **provider and location unknown**; no verified backup. | Blocker for any data operation | The owner identifies the provider and a restore-tested dump exists |

## 2. Security review — findings (verified in code or by a probe; no guesses)

**Fixed in Phase 7A, first pass (on the CI branch, awaiting review):**

| Severity | Finding | Evidence | Fix |
| --- | --- | --- | --- |
| High | `body-parser` < 1.20.9: DoS via trailing bytes after a compressed request body (GHSA-27r3-jxmh-p828). Reachable: `express.json()` inflates compressed bodies on unauthenticated routes. **The deployed API is very likely affected too** (same Express 4 line). | New advisory, caught by the CI audit job on 2026-10-24 (run 40084134395). | `c5056fd`: lockfile-only update to 1.20.9 (Express 4.22.3 accepts `~1.20.5`). 1.20.9 was 2 days old — a documented exception to the 14-day rule for a high-severity DoS. Backend suites, typecheck, build and audit pass. |
| Medium (functional/accessibility) | **Hydration mismatch on order pages in Linux WebKit** (React error #418): Linux WebKit's ICU writes "Saturday 24 October 2026", Node "Saturday, 24 October 2026". | `browser/formatting.spec.ts` on CI run 40084134454 named the exact strings. | `73ddf7c`: `lib/format.ts` builds the text from numeric date parts; unit tests prove the output equals the previous Node text. Confirmed on CI run 40086240119 (WebKit historical-orders and date tests pass). |

**Fixed in Phase 7A, second pass (2026-10-24; local commits, not pushed — awaiting approval):** each one a separate
commit with regression tests that fail against the previous code.

| Severity | Finding | Fix and evidence |
| --- | --- | --- |
| Medium | **Per-account sign-in limit exceeded by simultaneous attempts** (peek → bcrypt → count; 12 at once had 4–8 passwords checked against a limit of 3). | `99db7ab`: the attempt is counted with the existing atomic upsert (PostgreSQL `ON CONFLICT` row lock; MongoDB `findOneAndUpdate` pipeline) **before** the check; only attempts within the limit are checked; a right password still clears the count; a failed check stays counted. `test/db/authRateLimit.concurrent.test.ts`: exactly 3 checked from one address **and from 12 addresses**; with one attempt left, 5 simultaneous right passwords → exactly 1 sign-in; check and store failures start no session. MongoDB suite: 10 simultaneous → exactly 3 checked. 5 of the 6 new tests fail on the old code. |
| Medium | **Raw database errors** in `GET /api/products` and `GET /api/delivery-options` 500 responses. | `b63bdd7`: "Unable to load products" / "Unable to load delivery options"; the detail is logged server-side, like every other 500. Tests with a stubbed unreachable database (MongoDB suite) and renamed tables (PostgreSQL); both fail on the old code. |
| Medium | **Stack traces in error pages**: Express's default HTML pages (malformed JSON with stack and file paths unless `NODE_ENV=production`, HTML 404). | `2952952`: JSON 404 and error handler: 400 Malformed JSON body, 413 Request body too large, 415 unsupported encoding/charset, 500 Server error, in **every** environment. Server log: stack outside production (diagnostics kept), message and code only in production. Tests for `NODE_ENV=production`, development and unset; the compiled `dist` checked with `NODE_ENV=production`: JSON bodies, no stack, no `X-Powered-By`. |
| Medium | **No Content-Security-Policy.** | `4549772`: nonce-based policy per request (`src/proxy.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, `connect-src 'self'`; no `'unsafe-inline'` for scripts or style elements, no eval. Documented allowances: `img-src https: data: blob:` (admin-set off-site photos, `next/image`), `style-src-attr 'unsafe-inline'` (style attributes from `next/image`; CSS only). `next dev` adds `'unsafe-eval'`, inline styles and `ws:` as Next.js requires (checked by hand: hydrates, no violation). All pages now render per request (`/login`, `/register`, 404 were prerendered and would have lacked the nonce). Browser spec in Chromium, Firefox and WebKit: policy present and new per request, no violation on customer and admin pages, injected event-handler markup does not run. |
| Medium (reliability) | **No pool timeouts, no graceful shutdown, no database health check.** | `d8d99c0`: API pool 5 s connect, 10 s `statement_timeout`, 10 s `idle_in_transaction_session_timeout`, keepAlive (`PG_*` overrides); an `error` listener (a lost idle connection used to crash the process); `GET /healthz` (no database) and `GET /readyz` (each store used answers within 2 s; 503 while shutting down; no details); SIGTERM/SIGINT drain for `SHUTDOWN_TIMEOUT_MS` (10 s), then close the pool and MongoDB; MongoDB server selection 5 s instead of 30 s. Tested on throwaway PostgreSQL: lock-blocked query cancelled at the limit with the fixed 500; idle-in-transaction session ended and its lock released; terminated connections logged and reconnected; unreachable and silent servers fail fast; full pool fails fast. **SIGTERM on Linux** (compiled API in a throwaway container): the request in flight finished 200, pool closed, exit 0. |
| Low | `X-Powered-By: Express` on the API. | `2952952`: disabled. |
| Medium (functional; found by the release-candidate browser runs) | **Text typed into sign-in or registration before the page hydrated was lost from state**: the fields looked filled, but submitting said "Enter your email address." and sent nothing. Older than the CSP, but rendering `/login` and `/register` per request (needed for the nonce) made WebKit hit it in every run (9–10 WebKit failures per round on `d5510cb`). Credentials were never exposed: the inputs have no `name`, so a pre-hydration native submit carries no values. | `fbee7e1`: the forms adopt what the browser already holds when they mount. Browser regression test holds the scripts back while typing; fails without the fix (Chromium, WebKit), passes in all 5 projects with it. |
| — (test harness) | In WebKit, Playwright's screenshot code inserts an inline `<style>` that the CSP refuses (one console error per visual-review screenshot); the app raised no violation (compared with `bypassCSP`, and `securitypolicyviolation` events). | `0e40af7`: that exact message is ignored only while `snapshot()` is taking a screenshot; any other violation still fails. |

**Open:**

| Severity | Finding | Evidence | Proposed fix |
| --- | --- | --- | --- |
| Low | Logs are unstructured `console` strings; no request id. | Code. | JSON logs with a request id; never log bodies or cookies. |
| Low | Cart and orders pages show the browser's raw network error ("Failed to fetch"); checkout already explains it. | Browser probe with the API aborted. | Same mapping as checkout. |
| Low | `'strict-dynamic'` lets an already-trusted script add further scripts (by design); `style-src-attr 'unsafe-inline'` allows injected style attributes. | CSP design. | Accept; revisit if a third-party script is ever added. |
| Info | A failing `docker run` in the test helpers prints the throwaway container password. | CI/test logs only; random, single use, loopback-only container. | Optional: pass it via an env file. |
| Info | Whether Render sets `NODE_ENV=production` is not verifiable from the repository. Since `2952952` no environment exposes stack traces, so this no longer leaks anything, but rate-limit and data-source guards depend on it. | — | Owner checks the Render dashboard. |

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
| 40094305058 | `c1caee0` (docs only; same app code) | 91/0/0/8 · 91/0/0/8 | 26/0/0/7 · 26/0/0/7 | 47/0/0/19 · 47/0/0/19 | **None.** 7/7 jobs success, 0 flaky — second consecutive clean run |

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
- **Release candidate, locally (2026-10-24).** CI could not run it (not pushed). Each engine on its own, 1 worker,
  configured retries, keep-awake held (0 sleep events in the System log). On `d5510cb`: Chromium 100/0/0 in all 3 rounds;
  WebKit 9–10 failures in every round — two real causes, both found from traces: (1) **application bug**, text typed
  into sign-in/registration before hydration lost from state (fixed `fbee7e1`); (2) **test harness**, Playwright's
  WebKit screenshot style refused by the CSP (`0e40af7`). (A script error ran every project in the "Firefox" runs of
  those rounds; Firefox itself passed in them.) On `0e40af7`: **9/9 runs clean** — Chromium 103 passed, Firefox 30,
  WebKit 55, 0 failed, 0 flaky in every round. Reports and traces kept in the session scratch folder.
- **One clean run is not stability.** The account-flow race appeared in 4 of the 5 earlier runs that have annotations and the fix has
  run once. The local Firefox stalls (no navigation after an action under heavy parallel load) did **not** reproduce
  on CI. Both stay documented risks until the go/no-go criterion in §7 (3 consecutive clean runs) is met.

## 6. Production plan (documentation only — nothing below has been done)

**Hosting (confirmed from the repository and the owner):** API on Render; live Vite storefront on Vercel
(`ecommerce-project-three-peach.vercel.app`, hard-coded in the API's CORS list). The Next.js app (`apps/web`) has
**no** deployment yet; it gets a **new** Vercel project (plan §5, R10).

**MongoDB (production):** provider **still unknown**. Checked 2026-10-24 without reading any secret value: no tracked
file or commit names a provider or a hosted MongoDB domain, and the local `.env` / `.env.example` point at a local
MongoDB (host class only was inspected), which says nothing about production. Next step for the owner: read the host
of `MONGODB_URI` in the Render dashboard (e.g. `*.mongodb.net` = MongoDB Atlas). Then take a `mongodump` with the URI
passed as an environment variable (never on a command line or in a file in the repo), restore it into a throwaway
container and verify counts before any data operation (plan §7).

**PostgreSQL (production):** managed Render Postgres in the API's region, PostgreSQL 17 (the tested version), daily
backups with point-in-time recovery if the plan allows, `pg_dump` before every migration; migrations applied with
`npm run db:migrate` (never at start-up); an application role without DDL rights for runtime.

**R31 rollback limits:** after writes resume on PostgreSQL, rolling back to MongoDB needs the reverse
reconciliation (plan §6 Phase 4 "Rollback after writes resumed"); orders placed on PostgreSQL carry snapshots and
idempotency keys MongoDB cannot represent fully; the documented no-rollback condition and forward-fix plan apply.
Built in 7A and tested on disposable databases only: the write freeze (`WRITE_FREEZE=true`: 503 for writes to shop
data, reads and sign-in/out keep working) and the CLI `reconcile:plan` / `reconcile:apply --confirm --writes-frozen`
/ `reconcile:verify` (local databases only unless `--allow-remote-postgres` / `--allow-remote-mongodb`; reports
without personal data). **Not done:** batching for production volumes, a rehearsal on restored copies, approval.

**Render (API):** build `npm ci && npm run build` (TypeScript → `dist`, migrations copied); start `node dist/server.js`;
`NODE_ENV=production`, `JWT_SECRET`, `MONGODB_URI`, `CLIENT_URL`, `TRUST_PROXY_HOPS`, `PROXY_CLIENT_IP_SECRET`; for
PostgreSQL domains `DATABASE_URL` (internal URL) and the per-domain switches `DATA_SOURCE_DELIVERY_OPTIONS`,
`DATA_SOURCE_PRODUCTS`, `DATA_SOURCE_USERS`, `DATA_SOURCE_CARTS`, `DATA_SOURCE_ORDERS`, which the API only accepts in
production together with `POSTGRES_PRODUCTION_ENABLED=true` (set only at the approved step). New in 7A, all with
safe defaults: `PG_POOL_MAX`, `PG_CONNECT_TIMEOUT_MS`, `PG_STATEMENT_TIMEOUT_MS`,
`PG_IDLE_IN_TRANSACTION_TIMEOUT_MS`, `SHUTDOWN_TIMEOUT_MS`, `WRITE_FREEZE`. Health check path: `/readyz` for
readiness (database reachable), `/healthz` for liveness; `GET /` still answers as before.
**Cookie sessions cannot be switched on in production today:** `auth/config.ts` refuses
`AUTH_COOKIE_SESSIONS=true` with `NODE_ENV=production` ("a development feature … yet"); the guard is unchanged.
**Staging only** (`ae38316`): allowed with `NODE_ENV=production` when *all* of `DEPLOYMENT_ENVIRONMENT=staging`,
`AUTH_COOKIE_SESSIONS_STAGING=true`, a host-set `RENDER_SERVICE_NAME` ending in `-staging`, the Secure `__Host-`
cookie and no production storefront origin in `AUTH_ALLOWED_ORIGINS` hold. Verified at the real start-up path
(`server.ts` on a throwaway database): production-shaped settings with `AUTH_COOKIE_SESSIONS=true` exit 1 before
listening, also with the staging switches copied in; a staging service starts with secure cookie sessions.
Activating them in production still needs an approved code change, then `AUTH_COOKIE_SESSIONS=true`,
`AUTH_ALLOWED_ORIGINS=<storefront origin>`, `AUTH_COOKIE_SECURE=true` (the default), with sessions stored in
PostgreSQL. Until then the Next.js storefront cannot sign anyone in against the production API — it depends on
cookie sessions.

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
- [x] Medium findings in §2 fixed (rate-limit race, error leaks, stack traces, CSP, pool timeouts, graceful
      shutdown, health check) — local commits; reviewed, pushed and green in CI still pending.
- [ ] Manual screen-reader pass completed with no ✗ in checkout, sign-in, dialogs or error rows.
- [ ] Staging pass (§6) completed on sanitised data.
- [ ] The production guard on cookie sessions (`auth/config.ts`) lifted by an approved, tested change; the legacy
      bearer-token conditions (plan §4) met.
- [ ] `NODE_ENV=production` and every variable in §6 set and verified on Render and Vercel; no secret in the repo.
- [ ] Write-freeze window, reconciliation CLI (built in 7A; batching still to do) rehearsed against restored copies,
      rollback owner on call.
- [ ] Monitoring: health check (`/readyz` exists since 7A; the host must be pointed at it), error logs and alerting in
      place before traffic moves.

## 8. Phase 7A third pass (2026-10-26)

**Push.** The eleven approved commits went to `ci/phase7a-verification` only, without force (`c1caee0..9ed46cd`);
`main`, `migration/postgres`, `phase5/nextjs-foundation` and the backup branches unchanged.

**CI on `9ed46cd` (run 40341123629): FAIL, 9/11 jobs success.** Every failure was investigated before anything
changed:

| Job | Failure | Cause | Action |
| --- | --- | --- | --- |
| Backend tests (PostgreSQL) | `serverShutdown.test.ts` exit 1 instead of 0 | **Real defect.** First Linux run of the SIGTERM test. Reproduced exactly in a Linux container ("requests still open after 4000 ms"): `server.close()` closes only connections idle at that moment, so a keep-alive connection whose request finished during the drain stayed open until the force timeout. Every shutdown behind a keep-alive client (the Next.js proxy) would have been forced, exit 1. An earlier check with `wget` (closes its connection) could not show it | `ff8ca8b`: idle connections closed every 100 ms while draining, `Connection: close` on late responses. New keep-alive unit test fails on the old code; exact Linux test passes twice (clean drain in 3.4–3.6 s, exit 0) |
| Backend tests (PostgreSQL) | `authRateLimit.concurrent` "5 simultaneous right passwords: exactly one signs in" got 4 | **Wrong test assumption.** A successful sign-in clears the account's count (unchanged design), so right passwords that arrive after it start a fresh budget — they are the owner's. The guarantee concerns wrong guesses | `798ff88`: asserts that 5 simultaneous wrong passwords with one attempt left get exactly one more check; right passwords: every 200 has a session. The 12-attempt burst tests are unchanged and still fail on the old limiter |
| Legacy Vite app | `cartAuth.test.tsx` "Unable to find link Socks" | **Timing flake in untouched code** (no Vite file changed since `c1caee0`): `findByRole`'s 1 s default on a loaded runner. Passed locally (18/18) and in all 9 earlier CI runs | Recorded; the Vite app is not altered (standing restriction). Watch for recurrence |

**Browser on `9ed46cd` (run 40341123856): FAIL, 6/7 jobs success** — every job that ran its suite passed with
0 failed, 0 flaky: Chromium 103 passed, 8 skipped (1 and 2 workers); Firefox 30 passed, 7 skipped (1 and 2 workers);
WebKit 55 passed, 19 skipped (2 workers). WebKit (1 worker): `Install webkit OS dependencies` (apt packages) timed
out at its 15-minute bound after 912 s, so the suite was skipped — infrastructure, the same apt slowness as run
39998439611, now bounded instead of a 45-minute hang. Counted as a failed round, not hidden.

**Security verification** (CI 40341123629 jobs that passed, plus the local suites on the final commit):

| Area | Evidence |
| --- | --- |
| Concurrent sign-in limit | `authRateLimit.concurrent.test.ts` (7 tests): exactly the limit checked from 1 and 12 addresses; one attempt left → exactly one more check; failures of the check and of the store start no session; MongoDB suite: 10 simultaneous → exactly 3 |
| Safe database errors | `errorResponses.test.js` (unreachable database), `api.postgres.test.ts` (renamed tables): fixed messages, detail only in the log |
| JSON errors, no stack | `app.test.js` for production, development and unset `NODE_ENV`; compiled `dist` probed with `NODE_ENV=production` |
| CSP | unit (`csp.test.ts`), browser (`csp.spec.ts`) in all 6 projects in CI run 40341123856 where the suite ran |
| PostgreSQL timeouts, readiness, shutdown | `reliability.test.ts` against real PostgreSQL; `reliability.test.js` (incl. keep-alive); SIGTERM end to end on Linux |
| CSRF, session expiry and revocation | `authSessions.test.ts` (PostgreSQL suite; all passed except the two tests above) and the proxy e2e (52/52 in CI) |
| Admin role and customer ownership | PostgreSQL path: `api.postgres.test.ts` (401/403 for non-admins, 404 for another user's order or cart line), `authSessions.test.ts`, browser admin spec ("'Your orders' stays personal") and session-privacy spec. The MongoDB path keeps its known shared cart (R2, §1) |
| Checkout idempotency and rollback | `api.postgres.test.ts` (interrupted checkout stores nothing; key reuse 422; stock never negative under concurrency) |
| No production cookie sessions | `auth/config.ts` guard unchanged; `stagingGuard.test.ts` at `server.ts` start-up (exit 1 before listening) |
| No sensitive data in bundles, logs, reports | CI build job client-bundle check; proxy e2e "no session token in the Express or Next.js logs"; reconcile reports without personal data or credentials (tested); browser artifacts hold counts, timings and runner load, failure artifacts only throwaway data |
| `npm audit` | 0 in all three packages on the CI branch (CI audit jobs, 40341123629) |

**R31 at production scale** (`7b2002a`, disposable databases only): measured 20,000 users + 20,000 orders + 40,000
lines — plan 1.2 s, apply 27.2 s → **6.0 s** with ordered bulk writes of 500, verify 1.7 s, peak RSS ~0.57 GB
(memory grows with size: one consistent snapshot is compared in memory). An interruption between batches leaves
whole batches and a re-run completes without duplicates (tested). The CLI counts rows on both sides before loading
and refuses above `--max-records` (default 25,000). Not done: streaming the snapshot for larger volumes — needed
only if real volumes exceed the guard; real volumes are unknown until the MongoDB provider is known. Procedures:
`docs/CUTOVER_RUNBOOK.md`.

**Local suites on the fixed code (`7b2002a`):** PostgreSQL 309 passed, 2 skipped (the Linux-only SIGTERM test,
verified in a Linux container; the opt-in scale test); MongoDB 235 passed, 9 todo; typecheck, build, `npm audit` 0.
One local MongoDB run before that failed three test files at setup (`auth`, `authSecurity`, `deliveryOptions`; the
in-memory server start; the error text was not captured) and did not reproduce: the file alone 24/24, the full suite
again 235/235; CI ran the suite green on `9ed46cd`. Recorded as a local start-up flake.

**Final CI on the fixed commit `6c03fa5`** (pushed with approval, `9ed46cd..6c03fa5`, no force):

- **CI 40370706527: SUCCESS, 11/11 jobs** — backend MongoDB, backend PostgreSQL (incl. the Linux SIGTERM test and the
  concurrency tests), Next.js unit, Vite (tests, typecheck, lint, build), typecheck and lint ×2, production builds
  with the client-bundle check, `npm audit` ×3, proxy and page e2e.
- **Browser round 1, run 40370706705: FAIL (infrastructure), 6/7 jobs success.** Every suite that ran: 0 failed,
  0 flaky — Chromium 103 passed / 8 skipped (1 and 2 workers), Firefox 30 / 7 (2 workers), WebKit 55 / 19 (1 and 2
  workers). Firefox (1 worker): `Install firefox OS dependencies` timed out at 912 s, suite skipped. Chromium
  (1 worker) needed 417 s for the same step.
- **Rounds 2 and 3: not run.** A re-run repeats the same `apt` installation, which has now hung in 4 of 10 Browser
  runs (2 of the last 2). Three consecutive clean rounds on one SHA cannot be shown reliably until that dependency is
  removed — see "Proposed CI change" below. The application tests themselves have not failed on `6c03fa5`.

**Proposed CI change (not made; needs approval, and would change the SHA under test):** run the browser jobs in
Playwright's official container image pinned to the same version (`mcr.microsoft.com/playwright:v1.64.0-noble`,
OS packages and browsers preinstalled), removing both install steps. No timeout, retry or test change. Alternative:
keep the runner and cache the `.deb` packages — less robust. Then CI plus three Browser rounds on the new SHA.
