# Phase 7B — staging rehearsal plan (proposal, not started)

**Status: not approved, nothing created.** Each step below needs the owner's explicit approval before it is run. No
production service, database, domain or setting is touched at any point; staging uses separate services and
disposable or sanitised data only.

## Goal

Run the complete Next.js + Express + PostgreSQL stack on hosted infrastructure that matches production (Render API,
Render Postgres, Vercel frontend), rehearse the MongoDB → PostgreSQL migration and its rollback on **non-production
data**, and collect the evidence the go/no-go checklist (`docs/RELEASE_READINESS.md` §7) asks for.

## Preconditions (must be true before step 1)

1. Owner approval for Phase 7B, recorded with date and scope.
2. Phase 7A commits reviewed; the CI workflow green on the commit to be staged, and the Browser workflow green on at
   least 3 consecutive runs with no failed attempt (one so far: run 40090794620).
3. A decision on the code changes staging needs (see "Code changes required"), each as its own reviewed commit.
4. A **sanitised** dataset: the test catalogue from `scripts/e2e-support.mjs` (`SEED_PRODUCTS`) or a copy of the
   development MongoDB with every email, name, address, phone and password hash replaced. Never a production dump.

## Code changes required before staging can exercise the real target

| Change | Why | Notes |
| --- | --- | --- |
| A staging-only allowance for cookie sessions (staging runs with `NODE_ENV=production` so it behaves like production) | `auth/config.ts` refuses `AUTH_COOKIE_SESSIONS=true` with `NODE_ENV=production`; the Next.js storefront cannot sign in without cookie sessions | The production guard stays as it is. The allowance must be explicit, named for staging, logged at start-up, and covered by a test proving that the production configuration (without it) still refuses. Enabling cookie sessions in production remains a separate approval. |
| Write-freeze maintenance mode (503 for non-GET `/api`) | Cutover runbook step 2 (MIGRATION_PLAN.md R31); not implemented | Needed to rehearse import and rollback honestly |
| Reverse-reconciliation CLI around `db/reconciliation/reverse.ts` | The proof of concept is tested, but no command exists; rollback after writes is not allowed without it | Batch reads before production volumes |
| Fixes for the Medium findings in `RELEASE_READINESS.md` §2 (rate-limit race, error leaks, error handler, pool timeouts, graceful shutdown, health check) | So staging rehearses the release candidate, not today's gaps | Each changes behaviour the characterisation tests pin; update those tests deliberately |

## Steps

1. **Provision (approval A).** A new Render web service `ecommerce-api-staging` from the staged commit, region R;
   a Render Postgres 17 instance in the same region R (internal URL, TLS enforced by Render, daily backups); a new
   Vercel project for `apps/web` (Preview environment only). Nothing shares a database, secret or domain with
   production.
2. **Configure (approval A).** API: build `npm ci && npm run build`, start `node dist/server.js`, `NODE_ENV` as
   decided above, fresh `JWT_SECRET` and `PROXY_CLIENT_IP_SECRET` (generated for staging only), `DATABASE_URL` =
   staging internal URL, `CLIENT_URL`/`AUTH_ALLOWED_ORIGINS` = the Vercel preview origin, `TRUST_PROXY_HOPS` per
   Render's proxy, `DATA_SOURCE_*` and `POSTGRES_PRODUCTION_ENABLED` as the rehearsal step requires. Vercel:
   root `apps/web`, `BACKEND_ORIGIN` = staging API URL (server-only), `NEXT_PUBLIC_APP_NAME`,
   `NEXT_PUBLIC_SITE_URL`, `TRUSTED_CLIENT_IP_HEADER=x-real-ip`, `PROXY_CLIENT_IP_SECRET` (same value as the API).
3. **Schema.** `npm run db:migrate` from a one-off job against staging; `db:status` shows 0001–0006 applied with
   matching checksums; `pg_dump` taken and restored into a throwaway container to prove the backup.
4. **Data rehearsal (approval B).** Load the sanitised MongoDB copy into a **staging** MongoDB (never production);
   `data:dry-run` (0 errors), freeze writes, `data:import`, `data:verify` (MATCH, unchanged fingerprint).
5. **Switch domains one at a time.** Delivery options → products → users → carts → orders, each with
   `DATA_SOURCE_<DOMAIN>=postgres`, a restart and the smoke checks below; record each switch time.
6. **Functional pass.** Run the CI browser suite against the staging URLs (read-only checks first), then by hand:
   register, sign in, cart on two accounts (isolation), checkout with a network drop and a retry (one order),
   orders, tracking, admin product create/edit/delete with storefront refresh, status change with history, session
   expiry, sign out everywhere, the screen-reader checklist on staging.
7. **Rollback rehearsal (approval C).** After writes on staging PostgreSQL, freeze, back up both sides, run the
   reconciliation dry run and apply, require `verifyRollbackTarget` = ready, switch staging back to MongoDB and
   confirm new users sign in and new orders are listed; then switch forward again.
8. **Failure drills.** Stop the staging database briefly (requests should fail fast with a generic error, then
   recover); restart the API during a checkout (no duplicate order; the retry reuses its key); deploy a previous
   commit (forward-fix path).
9. **Report.** Evidence for every item of the go/no-go checklist, with timings and any failure, then delete or keep
   the staging services as the owner decides.

## Exit criteria

All go/no-go items that staging can evidence are PASS, every failure has an explanation, and the owner has the
data needed to approve or reject a production cutover plan. Staging success is **not** production approval.
