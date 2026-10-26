# Production security hotfix plan — dependencies on `main` (separate from the migration)

**Status: backend hotfix prepared and verified locally on branch `hotfix/backend-express-4.22.3` (`bd8cb6a`, from
`main` `4e622f5`). Not pushed, not merged, not deployed.** Each step in "Procedure" needs separate, explicit
approval. Independent of the PostgreSQL / Next.js migration: no migration code is involved.

## Why

`main` (the branch the live services were built from) was never part of the migration's dependency updates. A
lockfile-only audit of `main` on 2026-10-26:

| Package | Runtime advisories (`npm audit --omit=dev`) | Dev-only |
| --- | --- | --- |
| `ecommerce-backend` (Render API) | **proxy-addr** 2.0.7 critical; **body-parser** 1.20.3 high (GHSA-27r3-jxmh-p828 DoS via trailing bytes after a compressed body; GHSA-v422-hmwv-36x6 invalid limit disables size enforcement); **express** 4.21.2 high; **path-to-regexp** 0.1.12 high (ReDoS); **qs** 6.13.0 moderate | brace-expansion, minimatch, picomatch (via nodemon) |
| `ecommerce-project` (live Vite storefront) | form-data critical; axios high; react-router high; turbo-stream high; follow-redirects moderate | 17 more (build tooling) |

Express 4.21.2 **pins** `body-parser` 1.20.3, `qs` 6.13.0 and `path-to-regexp` 0.1.12 exactly, so body-parser cannot
be patched on its own. Express 4.22.3 (same major) accepts the fixed versions — the same versions the migration
branch already runs and audits clean (`c5056fd`).

## Hotfix A — backend (prepared)

Change: `ecommerce-backend/package.json` `express` `^4.21.2` → `^4.22.3`, and the lockfile: express 4.22.3,
body-parser 1.20.9, qs 6.16.1, path-to-regexp 0.1.13, proxy-addr 2.0.8 (183 lockfile lines). No application code
changes.

Evidence (local, 2026-10-26):
- `npm audit --omit=dev`: **0** (was 1 critical, 3 high, 1 moderate). Dev-only highs via nodemon remain (not shipped;
  out of scope for a minimal hotfix).
- `main`'s own tests (`node --test`): **24/24**.
- Behaviour unchanged: the real `server.js` with `main`'s original dependencies and with the hotfix, each against a
  throwaway in-memory MongoDB, the same 35 requests — health, products, delivery options, register/login/profile,
  admin product create/update/delete, cart add/update/remove, payment summary, a complete checkout, order history
  and lookup, malformed JSON, an oversized body, unknown and encoded paths, a query-shaped id. **Identical responses**
  (status, content type, body with ids, tokens and dates masked).

## Hotfix B — live Vite storefront (not prepared)

The runtime advisories in `ecommerce-project` on `main` (axios, react-router, form-data, turbo-stream,
follow-redirects) reach the browser bundle. The audit reports fixes within the current major versions. This needs
its own change, the Vite test suite (47 tests on the migration branch) and a manual check of sign-in, cart and
checkout, so it is listed here and not bundled into Hotfix A. The migration branch's Vite app already audits clean.

## Procedure (each step: separate approval)

1. **Review** `bd8cb6a` (two files). Optionally re-run the evidence above.
2. **Push the branch** `hotfix/backend-express-4.22.3` (new branch, no force). Open a pull request into `main`; the
   CI workflow is not on `main`, so the checks are the local ones above unless the owner wants them added there.
3. **Merge** into `main` — only after approval for that specific merge.
4. **Deploy** on Render from `main` (manual deploy of the merged commit), then: `GET /` 200; sign-in; product list;
   add to cart; one test checkout on a test account; error logs quiet for 30 minutes.
5. **Rollback**: redeploy the previous commit (`4e622f5`) from the Render dashboard. No data change is involved, so
   rollback is immediate and lossless.

Nothing in this plan changes production environment variables, databases or the cookie-session guard.
