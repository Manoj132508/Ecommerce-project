# Migration Plan: MongoDB/Vite → PostgreSQL/Next.js (TypeScript)

Status: **Phases 0–4 (local) are pushed on `migration/postgres`. Branch `phase5/nextjs-foundation` is pushed through `aad3125` (5A–5D). Phase 5E—customer cart, checkout and order history—is implemented and tested in local-only commits. Cookie sessions stay disabled by default and refused in production. The Vite app is unchanged and remains the live storefront; MongoDB is still the production default. Nothing was deployed and no production setting or production data was touched.**

> **Production blocker (updated 2026-10-21):** the backend is hosted on **Render** (owner). The production **MongoDB provider and location are still unknown** and must be verified before any production data operation (backup, profile, import). Render's current build/start settings aren't visible from the repository; the required changes are documented in §6 "Render deployment preparation" and have **not** been applied.
Inspected: 2026-10-21 against `main` @ `4e622f5` plus the uncommitted working tree (now committed on `backup/wip-ts-postgres-2026-10-21` @ `74522fa`).

Target stack:

| Layer | Target |
| --- | --- |
| Web | Next.js App Router + TypeScript, Tailwind CSS v4, shadcn/ui |
| Server state | TanStack Query v5 |
| Client/UI state | Redux Toolkit |
| API | Express + TypeScript |
| Database | PostgreSQL 17 (Docker Compose), `pg` with parameterised SQL only |

---

## 1. Current state (verified, not assumed)

### 1.1 Git state — the most important finding

`main` @ `4e622f5` is the last deployed version (Vite + JSX + Mongo). The working
tree contains **a large uncommitted migration already in progress**:

| Area | Uncommitted change |
| --- | --- |
| Frontend | All 27 `.jsx`/`.js` source files deleted and replaced with `.tsx`/`.ts`; React Context replaced by TanStack Query hooks (`src/queries/*`) + Redux Toolkit (`src/store`, `src/slices/homeSlice.ts`); new `src/types/*`; new `OneProductPage.tsx`, `AdminProducts*.tsx`; `tsconfig.json`, `vite.config.ts` |
| Backend | `pg` dependency, `config/postgres.js`, `compose.yaml`, `.env.postgres.example`, `scripts/*` (Postgres env/check + two Mongo backfill scripts), `utils/productInformation.js`; Product model gained `howItWorks`, `highlights`, `careInstructions` |
| Deleted | `ecommerce-backend/test/auth.test.js` — **the only backend test suite** (still valid against current code) |

Verified on 2026-10-21: frontend `tsc --noEmit` ✅, `eslint .` ✅, `vite build` ✅.
Postgres container `ecommerce-postgres-postgres-1` is running and healthy on `127.0.0.1:5432`.

~~None of this is in git.~~ **Resolved in Phase 0:** committed as `74522fa` on `backup/wip-ts-postgres-2026-10-21` and pushed to `origin`.

Untracked, intentionally ignored: `.env`, `.env.postgres`, `_recovery_backup_pre_restore_20260914_1645/` (117 KB), `.codex-run/*.log`.

### 1.2 Folder structure

```
Ecommerce-project/
├── ecommerce-backend/         Express 4, ESM JavaScript, Mongoose 9, pg 8 (unused at runtime)
│   ├── server.js              CORS allowlist, mounts routes, requires JWT_SECRET, connects Mongo
│   ├── config/db.js           Mongoose connect (MONGODB_URI)
│   ├── config/postgres.js     pg Pool (DATABASE_URL from .env.postgres) — only used by scripts
│   ├── middleware/authMiddleware.js   protect (Bearer JWT HS256, 24-hex id), adminOnly
│   ├── models/                User, Product, CartItem, DeliveryOption, Order
│   ├── controllers/           auth, product, cart, order
│   ├── routes/                auth, product, cart, order
│   ├── scripts/               postgres:env, postgres:check, migrate:product-*
│   ├── utils/productInformation.js
│   └── compose.yaml           postgres:17-alpine, named volume postgres_data
└── ecommerce-project/         Vite 6 + React 19 + TS (uncommitted), react-router 7, Tailwind v4
    └── src/{pages,components,queries,services,store,slices,types,utils}
```

### 1.3 Environment variables

| Variable | Where | Used by |
| --- | --- | --- |
| `MONGODB_URI` | backend `.env` | `config/db.js` (local value points at `127.0.0.1:27017/ecommerce_store`) |
| `PORT` | backend `.env` | `server.js` (default 3000) |
| `JWT_SECRET` | backend `.env` | token sign/verify; server refuses to start without it |
| `CLIENT_URL` | backend `.env` (not set locally) | extra CORS origins, comma-separated |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | backend `.env.postgres` | Docker Compose |
| `DATABASE_URL` | backend `.env.postgres` | `config/postgres.js` |
| `VITE_API_URL` | frontend `.env.local` / Vercel | Axios `baseURL` (default `/api`, proxied by Vite to :3000) |

Hard-coded: CORS origin `https://ecommerce-project-three-peach.vercel.app` in `server.js`.

### 1.4 Live data profile (local MongoDB, read-only scan)

| Collection | Docs | `_id` type | Notes |
| --- | --- | --- | --- |
| `users` | 1 | ObjectId | 1 admin; unique index on `email` |
| `products` | 35 | UUID string | all valid UUIDs; **no document has `stock`** (Mongoose reports default 0); `rating.stars` ∈ {3.5, 4, 4.5, 5} |
| `deliveryOptions` | 3 | string `"1"`,`"2"`,`"3"` | (7 d, 0¢), (3 d, 499¢), (1 d, 999¢) |
| `cartItems` | 4 | ObjectId | **no user field — one global cart**; unique index on `productId` |
| `orders` | 8 | UUID string | **6/8 have no `userId` and no `customer`**; **0/8 have product snapshots**; 5/8 order product ids no longer exist in `products` |
| `delivery Options` | 0 | — | stray empty collection (space in name); ignore |

The production database location is **unknown from the repo** (backend host isn't documented). It must be identified and profiled the same way before data migration.

---

## 2. API contract (must be preserved byte-for-byte unless noted)

| # | Method & path | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| A1 | `POST /api/auth/register` | — | `{name,email,password}` (pw 8 chars–72 bytes) | 201 `{_id,name,email,isAdmin,token}`; 400; 409 |
| A2 | `POST /api/auth/login` | — | `{email,password}` | 200 same shape; 400; 401 |
| A3 | `GET /api/auth/profile` | Bearer | — | 200 `{_id,name,email,isAdmin}`, `Cache-Control: no-store`; 401 |
| P1 | `GET /api/products` | — | — | `Product[]` sorted by `createdAt` asc |
| P2 | `POST /api/products` | admin | `{name,price(dollars),description,howItWorks,highlights(string\|string[]),careInstructions,image,category,stock}` | 201 `Product`; 400 |
| P3 | `PUT /api/products/:productId` | admin | same as P2 | 200 `Product`; 400 (incl. **"Invalid product id"**, R18); 404 |
| P4 | `DELETE /api/products/:productId` | admin | — | 200 `{id}`; 400 **"Invalid product id"** (R18); 404 |
| D1 | `GET /api/delivery-options[?expand=estimatedDeliveryTime]` | — | — | `{id,deliveryDays,priceCents,createdAt,updatedAt[,estimatedDeliveryTimeMs]}[]` |
| C1 | `GET /api/cart-items[?expand=product]` | **none** | — | `{id,productId,quantity,deliveryOptionId,createdAt,updatedAt[,product,unavailable]}[]` |
| C2 | `POST /api/cart-items` | **none** | `{productId (UUID string),quantity 1–10}` | 201 cart item (quantity is *added*); 400 (incl. **"Invalid product id"**, R18); 404 |
| C3 | `PUT /api/cart-items/:productId` | **none** | `{quantity?,deliveryOptionId? (digit string)}` | 200 cart item; 400 (incl. **"Invalid product id"** / "Invalid delivery option", R18); 404 |
| C4 | `DELETE /api/cart-items/:productId` | **none** | — | 204; 400 **"Invalid product id"** (R18); 404 |
| C5 | `GET /api/payment-summary` | **none** | — | `{totalItems,productCostCents,shippingCostCents,totalCostBeforeTaxCents,taxCents,totalCostCents,unavailableProductIds}` |
| O1 | `GET /api/orders[?expand=products]` | Bearer | — | `Order[]` by `orderTimeMs` desc; admin sees all |
| O2 | `GET /api/orders/:orderId[?expand=products]` | Bearer | — | `Order`; 400 **"Invalid order id"** (R18); 404 if not owner (unless admin) |
| O3 | `POST /api/orders` | Bearer | `{customer:{fullName,email,phone,address,city,postalCode,country}}` | 201 `Order`; 400; 409 `{message,unavailableProductIds}` |
| O4 | `PATCH /api/orders/:orderId/status` (**new, Phase 3C**) | admin | `{status, reason}` | 200 `Order` (with `status`); 400 invalid id/status/missing reason; 404; 409 transition not allowed; **501 while orders are served by MongoDB** |

`Product` = `{id,image,name,description,howItWorks,highlights[],careInstructions,category,stock,rating:{stars,count},priceCents,keywords[],createdAt,updatedAt}`
`Order` = `{id,userId?,customer?,orderTimeMs,totalCostCents,products:[{productId,product?,quantity,estimatedDeliveryTimeMs}],createdAt,updatedAt}`

Frontend TypeScript mirrors of these shapes already exist in `ecommerce-project/src/types/*.ts` — they become the contract source of truth.

Error envelope everywhere: `{ message: string }`. Note: cart/order/delivery 500s currently leak `error.message` — keep the envelope, stop leaking internals.

**Identifier contract (R18 fix, 2026-10-21).** Every identifier taken from a request must be a **string** in its entity's format, or the request gets a 400 before any database query (`utils/identifiers.ts`). Formats were verified against every identifier in the dev DB:

| Identifier | Format | Where it is checked | 400 message |
| --- | --- | --- | --- |
| product id (body `productId`, path `:productId`) | UUID, canonical 8-4-4-4-12 hex, any version/case | C2, C3, C4, P3, P4 | `Invalid product id` |
| order id (path `:orderId`) | UUID | O2 | `Invalid order id` |
| delivery option id (body `deliveryOptionId`) | digit string, 1–10 digits (`"1"`, `"2"`, `"3"`) | C3 | `Invalid delivery option` (existing message) |
| user id (JWT `id` claim) | 24-hex ObjectId | `protect` (unchanged; now uses the shared guard) | 401 `Not authorized` (unchanged) |

Contract changes, all on malformed input only:
- A missing or non-string `productId` on C2 was 404 "Product not found" and is now 400 "Invalid product id".
- Malformed path IDs on C3, C4, P3, P4 and O2 were 404 (or a leaking 500) and are now 400.
- A numeric `deliveryOptionId` (`3` instead of `"3"`) was accepted and is now 400.

Authentication and authorisation still run first (401/403 before 400). Well-formed but unknown IDs still get 404. The frontend only ever sends IDs taken from API responses, so none of its requests change.

### Working features (to be regression-tested at every phase)

Browse/search products (client-side filter via Redux `searchTerm`), product detail page, register/login/logout/profile restore, add to cart, change quantity, change delivery option, remove item, unavailable-product handling in checkout, payment summary, place order with customer details, orders list, buy again, tracking page, admin product CRUD, admin order list, mobile layout.

---

## 3. MongoDB → PostgreSQL mapping

### 3.1 Schema

**Implemented in Phase 3A** as `ecommerce-backend/db/migrations/0001_initial_schema.up.sql`. That file is the single source of truth; the design summary, backup and rollback procedures are in `ecommerce-backend/db/README.md`. The draft SQL that used to be here was superseded by the approved decisions. The main differences from that draft:

- **`carts` table (D1).** One cart per user (`UNIQUE user_id`, deleted with the user). `cart_items` belongs to a cart, not directly to a user. The shared MongoDB cart is not migrated or assigned.
- **IDs (D2).** `users.id` is `text` holding the original ObjectId hex (`CHECK ~ '^[0-9a-f]{24}$'`); there's no `legacy_mongo_id`. Product and order ids are `uuid`, keeping the existing values. Delivery option ids are digit-string `text`.
- **Cart quantity (FD1).** `cart_items.quantity` is an `integer` with `CHECK BETWEEN 1 AND 10`. `order_items.quantity` is only `>= 1`, because history may exceed the cart limit.
- **Legacy flag (D4).** `is_legacy` is on **`orders`** (imported from MongoDB), not on lines. Application orders must have a user and complete customer details. A trigger requires a product snapshot on every line of a non-legacy order; legacy lines may have none. Snapshots are all-or-nothing and `order_items` rejects every UPDATE (trigger).
- **Product references.** Neither `cart_items.product_id` (D3) nor `order_items.product_id` (D4) has a foreign key. The original id is always kept, and the current product is resolved with a LEFT JOIN that may return nothing. `product_id` itself stays `NOT NULL`, because `/tracking` and the API contract identify a line by it.
- **Foreign keys.** `orders.user_id` uses `ON DELETE RESTRICT` (history is never deleted with a user); `cart_items.delivery_option_id` also uses RESTRICT.
- **Integrity checks.** Normalised unique emails, bcrypt hash format, half-step ratings 0–5, no NULL array elements, all-or-nothing non-blank customer details, and `updated_at` triggers.
- **Stock.** `products.stock` is stored (`>= 0`) and **not enforced** anywhere.

Every constraint was checked against a read-only profile of the live MongoDB data (2026-10-21):
- whole-cent prices and totals;
- half-step ratings;
- customer details all-or-nothing (2 orders with all, 6 with none);
- order-line quantities 1–6;
- normalised emails;
- `$2b$12$` hashes;
- no dangling order user ids.

Field-level conversions:

| Mongo | Postgres | API serialisation |
| --- | --- | --- |
| `_id` (String UUID) | `uuid` | `id` (string) |
| User `_id` (ObjectId) | `text` holding the same 24-hex string (D2) | `_id` (unchanged key and value) |
| `rating: {stars,count}` | `rating_stars`, `rating_count` | rebuild nested `rating` object; cast `numeric` → `Number` |
| `[String]` | `text[]` | array |
| embedded `customer` | `customer_*` columns | rebuild object; omit when all null |
| `products[]` subdocs | `order_items` rows ordered by `position` | array |
| `orderTimeMs`, `estimatedDeliveryTimeMs` (Number ms) | `timestamptz` | `date.getTime()` |
| `timestamps: true` | `created_at`, `updated_at` | `createdAt`, `updatedAt` ISO strings |
| `select: false` password | `password_hash` never in any `SELECT` list used for responses | — |
| E11000 duplicate key | SQLSTATE `23505` | 409 |
| Mongoose `ValidationError` | SQLSTATE `23514`/`22P02` + explicit validation in TS | 400 |

`pg` returns `numeric` as string and `bigint` as string — use `integer` for cents (max ≈ $21.4M per value) and convert `numeric` explicitly.

### 3.2 Query-by-query mapping

> **Updated for the implemented schema (Phase 3A).** The cart rows below were drafted when `cart_items` had a `user_id` column. With the `carts` table:
> - Read `… WHERE ci.user_id = $1` as `… FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = $1`.
> - Read `ON CONFLICT (user_id, product_id)` as `ON CONFLICT (cart_id, product_id)`.
> - The cart row is created on first add: `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`.
>
> Under FD1, an add that would push a merged quantity above 10 violates `cart_items_quantity_range` (SQLSTATE 23514), which the repository maps to a 400. Checkout's `FOR UPDATE` lock and `DELETE` likewise target the user's own cart (D1).

| Location | Mongoose | Parameterised SQL |
| --- | --- | --- |
| `authMiddleware.protect` | `User.findById(id).select("-password")` | `SELECT id,name,email,is_admin FROM users WHERE id = $1` |
| `registerUser` | `User.findOne({email})` + `User.create` (pre-save bcrypt) | hash in TS, then `INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id,name,email,is_admin`; catch 23505 → 409 (drop the racy pre-check or keep it as a fast path) |
| `loginUser` | `User.findOne({email}).select("+password")` | `SELECT id,name,email,is_admin,password_hash FROM users WHERE email = $1` |
| `getProducts` | `Product.find().sort({createdAt:1})` | `SELECT … FROM products ORDER BY created_at, id` (add `id` tiebreak — ETL inserts share timestamps) |
| `createProduct` | `Product.create({...,rating:{0,0}})` | `INSERT INTO products (…) VALUES ($1…$n) RETURNING …` |
| `updateProduct` | `findByIdAndUpdate(id, d, {new:true})` | `UPDATE products SET …, updated_at = now() WHERE id = $1 RETURNING …` (0 rows ⇒ 404) |
| `deleteProduct` | `findByIdAndDelete(id)` | `DELETE FROM products WHERE id = $1 RETURNING id` |
| `getDeliveryOptions` | `DeliveryOption.find().sort({createdAt:1})` | `SELECT … FROM delivery_options ORDER BY created_at, id` |
| `getCartItems` | `CartItem.find().sort({createdAt:1})` + N×`Product.findById` | one query: `SELECT ci.*, p.* FROM cart_items ci LEFT JOIN products p ON p.id = ci.product_id WHERE ci.user_id = $1 ORDER BY ci.created_at` |
| `addCartItem` | `Product.findById` + `CartItem.findOne` + save/create | `INSERT … ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity, updated_at = now() RETURNING *` (atomic; removes read-modify-write race) |
| `updateCartItem` | `findOne` + `DeliveryOption.findById` + save | `UPDATE cart_items SET quantity = COALESCE($3, quantity), delivery_option_id = COALESCE($4, delivery_option_id) … WHERE user_id = $1 AND product_id = $2 RETURNING *`; FK violation `23503` ⇒ 400 "Invalid delivery option" |
| `deleteCartItem` | `findOne` + `deleteOne` | `DELETE FROM cart_items WHERE user_id = $1 AND product_id = $2` (rowCount 0 ⇒ 404) |
| `getPaymentSummary` | loop of N×2 `findById` | one `SELECT` joining `cart_items`, `products` (LEFT), `delivery_options`; keep the arithmetic in TS so rounding is identical |
| `getOrders` | `Order.find(filter).sort({orderTimeMs:-1})` + legacy `Product.findById` per line | `SELECT` orders (`WHERE user_id = $1` unless admin) `ORDER BY ordered_at DESC`, then one `SELECT` of `order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ANY($1)` |
| `getOrder` | `Order.findById` + owner check | same, `WHERE id = $1`, owner check in SQL or TS |
| `createOrder` | `CartItem.find` → N lookups → `Order.create` → `CartItem.deleteMany()` (**not atomic, deletes every user's cart**) | single transaction: `BEGIN; SELECT … FROM cart_items … WHERE user_id=$1 FOR UPDATE; INSERT orders; INSERT order_items (multi-row); DELETE FROM cart_items WHERE user_id=$1; COMMIT` |
| `scripts/populate*` | `Product.find` + `updateOne($set)` | one-off Mongo backfills; run **before** ETL so data arrives complete, then retire |

---

## 4. Risks

| # | Risk | Severity | Mitigation |
| --- | --- | --- | --- |
| R1 | Uncommitted WIP lost | ~~Critical~~ **Resolved** | Phase 0: `74522fa` on `backup/wip-ts-postgres-2026-10-21`, pushed |
| R2 | **Cart is global**: any visitor sees/edits the same cart; placing an order empties it for everyone | **High (existing bug)** | Decision D1; fix as an explicit, separately-tested behaviour change |
| R3 | User IDs change type → existing 30-day JWTs and `orders.userId` break | ~~High~~ **Mitigated by D2** | IDs kept verbatim as `text`; `protect` keeps HS256-only verification, expiry and the 24-hex check unchanged |
| R4 | Legacy orders lack `userId`, `customer`, snapshots; 5/8 referenced products deleted | Medium | Nullable columns, no FK on `order_items.product_id`, LEFT JOIN fallback — reproduces current "Product unavailable" output |
| R5 | Payment summary total (`before + round(before*0.1)`) and order total (`round(before*1.1)`) could differ by 1¢ | ~~Medium~~ **Low** | Exhaustively checked for every pre-tax total 1¢–$1,000: no difference. Pinned by `orders.test.js`. Still unify into one function in Phase 4.4 |
| R6 | Production DB location unknown; local profile may not match prod | High | Identify host, run the same read-only profile on prod, `mongodump` prod before cutover |
| R7 | `products.stock` absent on all docs → migrates as 0. Harmless today (stock isn't enforced) but becomes "everything out of stock" if enforcement is added | Low | Record; decide stock values before adding enforcement |
| R8 | Next.js routing differences: `<base href="/">` + relative `images/ratings/...` in `Product.tsx` breaks on nested routes; `ProductUnavailablePage` relies on router `location.state`; `*` route renders Home; `useSearchParams` needs a Suspense boundary | Medium | Covered in Phase 5 checklist |
| R9 | localStorage token is invisible to Server Components | Medium | Keep all authenticated fetching client-side in Phase 5; cookie auth is an optional later phase |
| R10 | Deployment config (Vercel root dir, backend build/start commands, CORS origin) breaks when folders move or build steps change | Medium | Don't move deployed folders until cutover; new Next app gets its own Vercel project first |
| R11 | Auth test suite deleted in WIP → no regression net for auth | ~~Medium~~ **Resolved** | All 24 original cases ported to Vitest in Phase 1 |
| R12 | `docker compose down -v` deletes Postgres data | Medium | Never use `-v`; `pg_dump` before each ETL rerun |
| R13 | Dual-write / split-brain if some domains read Mongo and others Postgres while sharing IDs | Medium | Migrate domains in dependency order; cut over all writes for a domain at once; no dual-write |
| R14 | Cart quantity validation gaps (found in Phase 1): POST accepts fractional quantities (`1.5`); re-adding can exceed 10; PUT has no upper bound | Medium | Pinned in `cart.test.js`. `integer` + `CHECK (quantity BETWEEN 1 AND …)` would reject current data/requests: **decided: FD1** (integer 1–10); 0 fractional quantities in live data |
| R15 | Non-JSON errors (found in Phase 1): unknown routes (404), malformed JSON (400) and CORS rejections (500) return Express's HTML error page, with stack traces unless `NODE_ENV=production`; cart/order/payment 500s leak `error.message` | Medium | Pinned in `app.test.js`/`cart.test.js`. Confirm production sets `NODE_ENV=production`; **decided: FD2** (safe JSON errors), as a deliberate contract change |
| R16 | Product `PUT` replaces `keywords` with `[category]`, discarding seeded keywords used by client-side search | Low | Pinned in `products.test.js`; **decided: FD3** (keep keywords unless explicitly updated) |
| R17 | Mongoose deprecation: `findByIdAndUpdate(..., { new: true })` (productController) warns under Mongoose 9 | Low | Code is replaced in Phase 4.2; no change now |
| R18 | **NoSQL operator injection (found in Phase 2 by the type checker).** `POST /api/cart-items` passed `productId` from the body to `findById`/`findOne` unvalidated: `{"productId":{"$ne":null}}` incremented an arbitrary existing cart line, or returned a 500 leaking the cast error. `PUT /api/cart-items/:id` with an operator-object `deliveryOptionId` passed the lookup, then failed as a leaking 500 | ~~High~~ **Fixed** (R18 commit) | Strict per-entity identifier guards (`utils/identifiers.ts`, see §2 "Identifier contract") reject objects, arrays, non-strings and malformed IDs with 400 before any query. All request inputs reaching Mongoose were inventoried; the others were already validated. `test/injection.test.js` (68 tests): `$ne`/`$gt`/`$regex`/`$where`/`$in`/`$exists`, nested objects, arrays, numbers, booleans, null, malformed and URL-encoded strings. Each asserts the exact 400, unchanged data and **no Mongoose call**. Against the vulnerable code it fails 57/68 (the 11 passes are positive controls). **Pre-deploy check:** run the read-only ID-format profile on production data (blocked by 0.6); any non-UUID product/order IDs there would now get 400s. Postgres parameterised SQL removes the class entirely in Phase 4 |
| R19 | `config/postgres.ts` found `.env.postgres` relative to its own file, so it missed the file from `dist/config/` | ~~Low~~ **Fixed (Phase 3B)** | It now checks the package root from both `config/` and `dist/config/`; real environment variables still take precedence (Render) |
| R20 | `npm audit`: 5 advisories (1 critical, 2 high, 2 moderate), all in **Express 4.21.2's own dependency tree** (proxy-addr, path-to-regexp, qs, body-parser). Pre-existing on `main`, not introduced by Phase 2 | ~~High~~ **Fixed** (R20 commit) | Express `^4.21.2` → **`^4.22.3`** (the `latest-4` tag; no major upgrade, Express 5 not adopted). Transitive: body-parser 1.20.8, qs 6.16.1, path-to-regexp 0.1.13, proxy-addr 2.0.8, raw-body 2.5.3. `npm audit`: **0 vulnerabilities** (all deps and `--omit=dev`). Compatibility: 173 tests green, plus 48/48 identical responses between Express 4.21.2 and 4.22.3 on the dev DB with `NODE_ENV=production`. That covers real data, query-string edge cases (objects, arrays, duplicates, 30-element arrays), malformed JSON, R18 rejections, CORS allow/deny/preflight and the default 404/500 pages. Note: `main` and `pre-pg-migration` still have Express 4.21.2 |
| R21 | **Phase 2 changes how the backend starts.** `server.js` no longer exists; production must run `npm ci` (with dev dependencies) → `npm run build` → `npm start` (`node dist/server.js`). A host still running `node server.js`, or installing with `--omit=dev`, fails to start | **High (deploy blocker)** | Nothing deployed. Before deploying `migration/postgres`, update the backend host's build command to `npm ci && npm run build` and the start command to `npm start`. Rollback: redeploy `main` or `pre-pg-migration`, which still use `node server.js` |
| R22 | **Windows PowerShell corrupts binary output redirected with `>`** (found in Phase 3B: a `pg_dump > file` gained a UTF-8 BOM and was unrestorable) | ~~High~~ **Mitigated** | `db/README.md` documents only in-container `pg_dump -f` + `docker compose cp` (and `-f` for hosted databases). Every documented command was executed and the dump restored. The corrupt file was deleted |
| R23 | Extraction reads collection by collection, not as one snapshot; writes to a live production MongoDB during an import could produce an inconsistent copy | Medium | Production import only inside an agreed write freeze. Verification compares field by field and flags a changed source fingerprint (Phase 3B decision 4) |
| R24 | Mixed data sources must stay consistent (for example, PostgreSQL carts with MongoDB users would break foreign keys) | ~~Medium~~ **Mitigated** | `config/dataSources.ts` refuses inconsistent combinations at start-up: carts and orders together; PostgreSQL carts/orders need PostgreSQL users, products and delivery options. 17 unit tests |
| R25 | Selecting PostgreSQL in production by accident | ~~High~~ **Mitigated** | With `NODE_ENV=production`, any PostgreSQL selection also needs `POSTGRES_PRODUCTION_ENABLED=true` (and `DATABASE_URL`); the server also refuses to start if schema migrations are pending |
| R26 | Switching carts to PostgreSQL makes cart routes require login (D1); the frontend had to handle 401 | ~~Medium~~ **Resolved (Phase 4 frontend)** | Session watcher: a 401 from cart/checkout/order data opens the login flow with a validated return path; add-to-cart while signed out opens it too; cache keys include the user id. The legacy MongoDB cart never returns 401, so it is unaffected. 44 frontend tests in both cart modes |
| R27 | JSON key order of products whose MongoDB document lacked `stock` differs between stores (MongoDB puts `stock` first) | Low | Key order has no meaning in JSON; content verified equal on real data (23/23). The MongoDB path itself is byte-identical to before (48/48) |
| R28 | The transaction-local flag that authorises `change_order_status()` can be set by any session with the application's database role | Low | It guards against accidental direct updates, not a compromised application. Every change is still audited in `order_status_events` (append-only) |
| R29 | Frontend `npm audit`: 16 advisories (1 critical via `axios` → `form-data`; high in `axios`, `react-router`/`turbo-stream`, and lint/build tooling) | ~~High~~ **Resolved (2026-10-22, `69a47e0`)** | `axios` 1.8.4 → 1.20.0 (`form-data` 4.0.6, `follow-redirects` 1.16.1), `react-router` 7.1.5 → 7.18.4 (same major; the app uses only the declarative API), `eslint` 9.39.5, plus a non-force `npm audit fix` for transitive dev tooling. No major upgrades. **`npm audit`: 0** (production-only: 0). Frontend tests 47/47 (3 new open-redirect cases), typecheck, lint and build pass |
| R30 | The bearer token is kept in `localStorage` (unchanged in the Vite app), so an XSS bug could read it | Medium | **Foundation implemented (Phase 5B, off by default):** PostgreSQL sessions, an HttpOnly `__Host-` cookie on the Next.js origin, CSRF and Origin checks, revocation, rotation, and the exchange endpoint for existing tokens. The Vite app still uses `localStorage` until it is replaced. Production activation needs the conditions in §6 Phase 5 ("Conditions before the legacy bearer tokens can be removed") |
| R31 | **Rollback limit.** Records written after a domain switches to PostgreSQL (new users, orders, carts, status changes, catalogue edits) do not exist in MongoDB; rolling that domain back hides them (verified: a PostgreSQL-only user gets 401 after rollback) | **High (production)** | **Strategy and proof of concept done (2026-10-22), see "Production cutover and recovery design (R31)" in §6 Phase 4.** Rollback after writes resume is allowed only through reverse reconciliation plus the readiness gate, which refuses any MongoDB that lacks a PostgreSQL record. 10/10 tests on disposable databases. **Phase 7A (2026-10-24):** write-freeze mode (`WRITE_FREEZE=true`, `94e08b9`) and the guarded CLI `reconcile:plan / apply / verify` (`d5510cb`) built and tested on disposable databases. Still needed: batching for production volumes, a rehearsal on restored copies (staging, 7B) and approval; until then the no-rollback rule applies once writes resume |
| R32 | After a switch, `data:verify` reports MISMATCH by design (PostgreSQL gains new rows) | Low | Verified locally: all 47 copied records still match field for field; only additions appear as "unexpected". Use verify **before** each switch; afterwards, PostgreSQL is authoritative |
| R33 | A Phase 4 smoke-test log printed the first 44 characters of a JWT issued by the **local** development server to the synthetic local test account `phase4-alice@example.com` | Low | **Investigated (2026-10-22): not a credential exposure.** The 44 characters were the fixed HS256 header (`{"alg":"HS256","typ":"JWT"}`, identical for every token) plus `.eyJpZCI` (`{"id"`). No user id, expiry or signature was printed, and the token cannot be rebuilt without `JWT_SECRET`. Neither `JWT_SECRET` nor the PostgreSQL password appears in any log, report, scratch file or git history (scanned). The account exists only in local PostgreSQL. No rotation needed. Prevention: the repository's tests and scripts print no tokens (checked); ad-hoc scripts must drop `token` before printing a response |
| R34 | A reconciliation process that dies mid-run leaves its run lock in `reconciliation_runs` | Low | Intended: an overlapping run could race on product updates. The readiness gate reports "a reconciliation run is in progress". Remove the lock by hand once no run is active, then re-run (runs are idempotent) |
| R35 | `eslint-config-next` pulls `fast-glob` → `micromatch` → `braces` ≤3.0.3: unpatched stack-exhaustion DoS (GHSA-vfj7-8cjw-p6xm) | ~~Low~~ **Resolved (5C)** | `eslint-config-next` installed with its `fast-glob` replaced by a local `fs.globSync` shim through npm `overrides` (the plugin only globs the optional `settings.next.rootDir`); `micromatch`/`braces` not installed; 22 Next.js rules active; `npm audit` 0 |
| R36 | A request from an Origin outside the CORS allow-list got **500** (Express default error page, stack trace outside production) | ~~Low–Medium~~ **Resolved (5C)** | JSON `403 {"message":"Origin not allowed"}` before CORS, body parsing or any route; nothing written or counted (tested) |
| R37 | No rate limiting on login | ~~Medium~~ **Resolved (5C)** | Shared, durable counters (PostgreSQL 0005 or MongoDB `authRateLimits`), per address and per account, same 429 for known and unknown accounts, fail closed, trusted-proxy handling. See §6 Phase 5 "5C" |
| R38 | Locally, cookies are not port-scoped (RFC 6265): the dev session cookie on `localhost:3001` is also sent to Express on `localhost:3000` | Low (local only) | Writes still need Origin and the CSRF token (tested). In production the API runs on a different host, so the `__Host-` cookie never reaches it directly (tested in the HTTPS-equivalent run) |
| R39 | Registration reveals whether an email is registered (409 "User already exists", legacy contract kept by `/api/auth/accounts` too) | Low | Mitigated by the per-address registration limit. Full protection needs email verification ("if the address is new, we sent a link"), a product decision for later |
| R40 | The per-account failure limit lets someone lock a known email out of sign-in for one window (default 15 min) | Low | Deliberate trade-off against password guessing; the window and limit are configurable. Revisit with email-based unlock or CAPTCHA if abused |
| R41 | No real-browser verification in this environment (no browser automation available) | Medium (until done) | Component tests cover roles, labels, focus order and keyboard activation; e2e covers HTTP behaviour. A manual desktop/mobile/keyboard pass is required before any preview is shown to users |
| R42 | Catalogue pages are cached for 60 s; product images live in the repository (12 MB) | Low | Admin edits appear within 60 s (an on-demand `revalidateTag("catalog")` hook can come with the admin migration). Move images to object storage/CDN under the conditions in §6 Phase 5 "5D" |

### Approved decisions (2026-10-21)

- **D1 — User-specific carts.** Every cart route requires a valid bearer token, and each user can read and change only their own cart lines (`UNIQUE (user_id, product_id)`). Checkout orders and clears **only the authenticated user's cart**, in the same transaction as the order insert. Another user's line returns 404, not 403. The existing behaviour is **not** changed silently: the shared-cart flaw is pinned as current behaviour in `test/cart.shared-cart.current-flaw.test.js`, and the target contract is listed there as 9 `it.todo` tests. Implemented as its own commit in Phase 4.4, which deletes the flaw tests and turns the todos into real tests. Frontend: gate cart queries in `CheckoutPage`, `Product`, `OneProductPage` and the `OrdersPage` "buy again" button. The 4 existing global cart rows aren't migrated (cart contents are transient; the Phase 0 dump keeps them).
- **D2 — Keep MongoDB ObjectId user IDs as PostgreSQL `TEXT`.** `users.id`, `orders.user_id` and `cart_items.user_id` are `text` holding the existing 24-hex strings verbatim. Existing valid JWTs keep working because the `id` claim still matches a row. Authentication isn't weakened: `protect` still verifies HS256 only, with the same secret, expiry/`nbf` checks and strict 24-hex format check. New users get an app-generated 24-hex id. Pinned by the 24 tests in `auth.test.js`.
- **D3 — Keep cart lines for deleted products.** No FK from `cart_items.product_id` to `products`. Lines stay visible as `product: null, unavailable: true`, are excluded from totals and listed in `unavailableProductIds`, and checkout returns 409 until the shopper deletes them. Nothing deletes them automatically. Pinned in `cart.test.js` and `orders.test.js`.
- **D4 — Preserve historical orders; no invented snapshots.** Legacy lines migrate with `is_legacy = true`, null snapshot columns and no FK on `product_id`, and keep the current LEFT JOIN lookup (current product or `null`). New lines require a `snapshot_name` and `snapshot_price_cents` (CHECK constraint) plus `quantity`, and `order_items` rejects UPDATE (trigger). Pinned in `orders.test.js`, including snapshot immutability after product edit and delete.

---

### Recorded future implementation decisions (owner, 2026-10-21)

Recorded during Phase 2 and **not implemented in Phase 2**, because Phase 2 must not change behaviour. Each will be its own commit, turning the matching "current behaviour" tests into target-contract tests.

- **FD1 — Cart quantity is an integer from 1 to 10.** Applies to POST (add), re-adding the same product (the merged total must stay ≤ 10) and PUT (update). Replaces today's gaps (fractional `1.5`, merges past 10, no PUT upper bound; R14). Postgres: `quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 10)`. Live data verified: 0 fractional quantities. Suggested timing: with D1 in Phase 4.4.
- **FD2 — API errors are safe JSON.** Every error response is `{ "message": string }` with a fixed, non-internal message: no raw `error.message` (today cart/order/delivery 500s leak it, and so does R18), no HTML pages, no stack traces. This includes a JSON 404 for unknown routes, a JSON 400 for malformed bodies and a JSON 403 for disallowed CORS origins (R15). Details are logged server-side only. Supersedes the old step 2.5. Suggested timing: a dedicated commit before Phase 4, so every Postgres-backed domain inherits it.
- **FD3 — Product edits keep search keywords unless explicitly updated.** `PUT /api/products/:id` stops replacing `keywords` with `[category]`. Keywords change only when the request includes them. Create keeps today's default (`[category]`) when none are sent (R16). Suggested timing: Phase 4.2 (products cut-over).

### Auth hardening plan (R30): HttpOnly session cookie (foundation implemented in Phase 5B; see §6 Phase 5 for what was built and how it differs)

**Today:** `POST /api/auth/login|register` returns a 30-day HS256 JWT in the body. The SPA keeps it in `localStorage` and sends `Authorization: Bearer`. CORS is an exact allow-list without credentials. The SPA (`*.vercel.app`) and the API (Render) are **different sites**: both suffixes are on the Public Suffix List.

**Why not a cross-site cookie:** it would need `SameSite=None`. Safari and Firefox block such third-party cookies by default, and Chrome is restricting them, so sessions would fail for part of the audience. Rejected.

**Design:**
1. **Same-origin API.** The frontend host proxies `/api/*` to Render: a Vercel rewrite now (`vercel.json`), Next.js `rewrites` in Phase 5. That matches the Vite dev proxy already in use. The browser then sees one origin, so cookies are first-party and CORS is no longer involved for the app. Alternative: a custom domain (`app.` and `api.` on one registrable domain, `SameSite=Lax`, CORS with `credentials: true` for that exact origin only).
2. **Server-side sessions** in PostgreSQL. A new `sessions` table stores a SHA-256 of a 256-bit random id, plus `user_id`, `created_at`, `last_seen_at`, `expires_at` and `revoked_at`. They are revocable, unlike the current JWTs, which stay valid until expiry even after logout. Sessions are not migrated by R31 reconciliation, so a rollback signs everyone out (acceptable).
3. **Cookie:** `__Host-sid=<id>; HttpOnly; Secure; SameSite=Lax; Path=/`, with no `Domain`. Idle timeout 7 days, absolute lifetime 30 days. The `__Host-` prefix requires `Secure`; locally the name is `sid` over `http://localhost`.
4. **CSRF:** `SameSite=Lax` blocks cross-site POST, PUT, PATCH and DELETE with the cookie. Defence in depth: every unsafe method, including login, must carry an `Origin` header on the allow-list (403 otherwise), and bodies must be `application/json` (form posts are rejected). No GET changes state, which is already true.
5. **Login and logout:** login and register create a session and set the cookie, rotating any previous session (no session fixation). They stop returning the token in the body once the migration window closes. `POST /api/auth/logout` revokes the row and clears the cookie. Add "sign out everywhere", and revoke all of a user's sessions when the password changes.
6. **Renewal:** sliding expiry. Extend `expires_at` at most once per hour of activity, never past the absolute lifetime. There are no refresh tokens and nothing for the SPA to store.
7. **Frontend:** remove the `token` key, the bearer interceptor and the `storage`-event logic. Instead, use `withCredentials` only if the custom-domain alternative is chosen, sign-in state from `GET /api/auth/profile` (already a TanStack query), and `BroadcastChannel` for cross-tab sign-out. The 401 → login flow and `safeReturnPath` stay as they are.
8. **Existing users:** a window of at most 30 days, the current JWT lifetime. The API accepts the session cookie first and a Bearer JWT as a fallback. On first load, a SPA holding a `localStorage` token calls `POST /api/auth/session` (Origin-checked) to exchange it for a cookie, then deletes the token. After the window: remove Bearer support and **rotate `JWT_SECRET`**, which invalidates any token still outstanding.
9. **Tests before rollout:** cookie attributes; Origin and content-type rejection; logout revokes server-side; idle and absolute expiry; rotation on login; cross-user isolation; the exchange endpoint; the Bearer fallback window. Tests and logs must never print cookie or token values.


## 5. Repository layout recommendation

**Do not restructure now.** Moving `ecommerce-project/` and `ecommerce-backend/` breaks the live Vercel and backend deploy configuration and adds diff noise to every later review, with no safety gain while both apps still run on their current stacks.

Recommended end state, reached without moving any deployed folder until cutover:

```
Ecommerce-project/
├── apps/
│   ├── web/          NEW Next.js app, created here from day one (Phase 5)
│   └── api/          ← git mv ecommerce-backend   (Phase 7, pure rename commit)
├── ecommerce-project/  Vite app: stays deployed until Next.js cutover, then removed (Phase 7)
├── package.json      npm workspaces ["apps/*"] (Phase 7)
└── MIGRATION_PLAN.md
```

This makes migration safer because the new frontend is built beside the old one (strangler pattern): the Vite app keeps serving production until `apps/web` passes the same acceptance checks, and rollback is a Vercel project/domain switch. Shared contract types live in `apps/web/src/types` (copied from the current `src/types`) and are enforced on the API side by contract tests; a separate `packages/contracts` workspace is optional later.

---

## 6. Incremental migration order

Each step is one reviewable commit (or a small PR), leaves `main` deployable, and has a verification gate. **Never start a step while the previous gate is red.**

### Phase 0 — Backup and freeze (no code changes)

- [x] 0.1 Backup branch `backup/wip-ts-postgres-2026-10-21` @ `74522fa`, pushed (staged files checked: no secrets, dumps, `node_modules` or build output)
- [x] 0.2 Annotated tag `pre-pg-migration` → `4e622f5` (verified as `origin/main` tip and Mongo/Vite/JSX baseline), pushed
- [x] 0.3 `mongodump` of the **local** DB — single gzip archive, restore-verified (§7). Production DB: still to do once identified
- [ ] 0.4 ~~JSON export~~ Optional: superseded by the restore-verified archive with matching `dbHash`
- [ ] 0.5 Owner: copy `.env` and `.env.postgres` to a password manager / secure location (they're git-ignored)
- [ ] 0.6 Owner: identify the production backend host, its build/start commands and its `MONGODB_URI` host; record here

**Acceptance:** backup branch visible on `origin`; tag exists; dump directories contain all 5 non-empty collections with doc counts matching §1.4; restoring the dump into a throwaway Mongo container reproduces the counts.

### Phase 1 — Commit the WIP and add a safety net (still Mongo)

- [x] 1.1 Working branch `migration/postgres` created from `backup/wip-ts-postgres-2026-10-21` (backup branch unchanged). All 24 cases of the deleted `test/auth.test.js` recreated in Vitest
- [x] 1.2 / 1.3 Frontend conversion and backend Postgres scaffolding: committed together in the Phase 0 backup commit `74522fa` instead of separately
- [x] 1.4 Backfills: **not needed locally**. Read-only check on 2026-10-21 found 0/35 products missing `description`, `howItWorks`, `highlights`, `careInstructions` or `category`. Re-check production once identified; don't run against production without approval
- [x] 1.5 Characterisation tests: Vitest 5 + Supertest 7 against an in-memory MongoDB (`mongodb-memory-server`), one private instance per file. `app.js` split from `server.js` so tests don't open a port or read `.env`. Covers all 16 endpoints, shapes, status codes, error cases, sort orders, totals, D1–D4 behaviour and CORS. Result: **7 files, 101 passed, 9 todo, 0 failed** (stable over repeated runs; dev DB `dbHash` unchanged before and after)
- [ ] 1.6 Update `ecommerce-project/README.md` (still describes the deleted Context files). Not done: outside the approved Phase 1 task list
- [ ] 1.7 Owner-gated: manual smoke test of all "working features" in §2, then deploy to production and confirm parity. Not done: deployment needs explicit approval

Test files (`ecommerce-backend/test/`):

| File | Tests | Covers |
| --- | --- | --- |
| `auth.test.js` | 24 | A1–A3, `protect` middleware, User model hashing (ported original suite) |
| `products.test.js` | 17 | P1–P4, product-detail derivation, `stock` default, cents rounding |
| `deliveryOptions.test.js` | 4 | D1 endpoint and `expand=estimatedDeliveryTime` |
| `cart.test.js` | 22 | C1–C5 mechanics, validation gaps, totals, D3 unavailable lines |
| `cart.shared-cart.current-flaw.test.js` | 5 + 9 todo | Current shared-cart flaw (not the target contract) + D1 target contract as todos |
| `orders.test.js` | 19 | O1–O3, checkout, D3 blocking, D4 snapshots/legacy orders, ownership |
| `app.test.js` | 10 | Health routes, CORS allowlist, Express default HTML errors |

**Acceptance (met locally):** `npm test` green in backend; frontend typecheck/lint/build green; `server.js` boots unchanged against the dev DB and serves `/api/products`.

**Acceptance:** `npm test` green in backend; frontend typecheck/lint/build green; production smoke test passes on the TS frontend.
**Rollback:** redeploy `pre-pg-migration` tag.

### Phase 2 — Backend TypeScript toolchain (behaviour unchanged)

**Status: complete locally on `migration/postgres` (2026-10-21), awaiting review. MongoDB remains the only runtime database.**

- [x] 2.1 Toolchain: `typescript ~6.0.3` (same as the frontend), `tsx`, `@types/node@24`, `@types/express@4` (Express is v4), `@types/cors`, `@types/jsonwebtoken`, `@types/pg`. bcryptjs, mongoose and dotenv ship their own types. `nodemon` removed (unused)
- [x] 2.2 `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noImplicitOverride`, `useUnknownInCatchVariables`, `verbatimModuleSyntax`, `module`/`moduleResolution: NodeNext`, `target`/`lib: ES2024` (Node 24), `noEmit`. `tsconfig.build.json` compiles only the runtime files to `dist/` with source maps
- [x] 2.3 Scripts: `dev` (`tsx watch server.ts`), `typecheck`, `build` (clean + `tsc -p tsconfig.build.json`), `start` (`node dist/server.js`). Ops scripts now run through `tsx`
- [x] 2.4 Files converted **in place** (no move to `src/`; this avoided churn in every test import and keeps history as `git mv` renames). Order: utils/config → models → middleware → controllers → routes → app/server → scripts → vitest config. `npm test` ran after each step
- [x] 2.5 `types/api.ts`: wire contracts mirroring the frontend `src/types`. `types/environment.d.ts`: every env var. `types/express.d.ts`: `req.user`. `AuthTokenPayload` + type guard in the auth middleware
- [x] 2.6 ~~Stop returning raw `error.message`~~ Moved to **FD2**: it's a behaviour change, so it isn't part of Phase 2. `utils/errors.ts` reproduces the existing reads exactly
- [ ] 2.7 Owner-gated: update the production host's build/start commands (R21), then deploy. Blocked on 0.6

File-by-file record (24 JavaScript source files converted; the 9 test-suite files stay JavaScript on purpose so the regression baseline is unchanged while it verifies the conversion):

| Area | Files | Typing notes |
| --- | --- | --- |
| Utils | `utils/productInformation.ts`; new `utils/errors.ts` | `ProductLabels`/`ProductInformation` interfaces; structural `errorMessage`/`errorName`/`errorCode` readers for `unknown` catch values |
| Config | `config/db.ts`, `config/postgres.ts` | `PostgresConnectionInfo` row type (R19 noted) |
| Models | `CartItem`, `DeliveryOption`, `Order`, `Product`, `User` | Types inferred from the schemas (Mongoose 9). `toJSON` transforms typed as `Record<string, unknown>`. `matchPassword` moved into the schema `methods` option. 72-byte check now throws `this.invalidate(...)`, the same `ValidationError(this)` as before. `UserDocument`/`OrderDocument` exported |
| Middleware | `authMiddleware.ts` | `RequestHandler`; `AuthTokenPayload` guard; same check order (header → secret → HS256/exp/nbf → 24-hex id → user); new `requireUser(req)` |
| Controllers | `auth`, `product`, `cart`, `order` | Bodies typed as `unknown` fields and validated exactly as before. Cart: `where().equals()` / `new Model().save()` / `doc.set()` carry the unvalidated value without casts (R18 preserved) |
| Routes | 4 route files | No edits needed |
| Entry | `app.ts`, `server.ts` | `createApp(): Express` |
| Scripts | 4 ops scripts | Typed error handling; run via `tsx` |
| Tests | `vitest.config.ts`; 9 suite files stay `.js` | Vitest resolves `../x.js` → `x.ts` |

Results (2026-10-21):

- `npm run typecheck`: **0 errors** in 28 TypeScript files. **0** `any`, **0** `@ts-ignore`/`@ts-expect-error`, **0** `as` assertions, **0** non-null assertions
- `npm test`: **104 passed, 9 todo, 0 failed** (101 Phase 1 tests + 3 new R18 "current flaw" tests, each verified against the original JavaScript before conversion)
- `npm run build`: 21 files in `dist/`, no tests or scripts
- Real-data parity: the original JS server (`ced0ff8`) and compiled `dist/` server, side by side on the dev DB, gave **32/32 byte-identical responses** (every GET endpoint, all 8 orders plain and expanded, the 401/404 paths, headers included). Read-only
- `npm run dev` and `npm start` both serve the API; `npm run postgres:check` works through `tsx`

Behaviour changes: **none in API responses.** Internal-only differences:
1. The 72-byte password `ValidatorError` now has `kind: "user defined"` (was `undefined`); the API still answers 400 "Invalid user data".
2. A thrown non-object would now produce `{}` instead of crashing the handler (unreachable with Mongoose).
3. Handlers reached without `protect` throw a descriptive error instead of a `TypeError` (unreachable: every such route uses `protect`).

**Acceptance:** suite green with unchanged assertions ✔; typecheck green ✔; build green ✔; real-data parity ✔; production deploy pending (R21, 0.6).
**Rollback:** `git revert` the Phase 2 commit; production keeps running `main`, which uses `node server.js`.

### Phase 3 — Postgres schema, data access layer and ETL (Mongo still live)

**Phase 3A (schema and migrations): complete locally, awaiting approval before any data transfer.** MongoDB remains the only application database; no application query changed and no data was copied.

- [x] 3A.1 Read-only profile of the live MongoDB values each constraint covers (§3.1)
- [x] 3A.2 `db/migrations/0001_initial_schema.up.sql` / `.down.sql`: users, products, delivery_options, carts, cart_items, orders, order_items (plus `schema_migrations`, created by the runner)
- [x] 3A.3 `db/migrator.ts` + `scripts/dbMigrate.ts`. Scripts: `db:migrate`, `db:status`, `db:rollback -- --confirm`. History table with SHA-256 checksums (CRLF/LF-normalised), advisory lock, one transaction per migration, refuses edited, missing or out-of-order migrations
- [x] 3A.4 `npm run test:db`: **73 tests** (16 runner + 57 schema) against a throwaway `postgres:17-alpine` container (random port on 127.0.0.1, random credentials, a fresh database per test, removed afterwards; never the compose database). Mutation check: weakening the quantity range, the immutability trigger, D3 (adding a product FK) and the new-order rule made exactly the 4 matching tests fail
- [x] 3A.5 Local dev Postgres (empty): backed up, then `db:migrate` applied 0001 (72 ms). A second run was a no-op and `db:status` shows it applied. Rollback without `--confirm` refuses. The documented backup and restore commands were executed and verified
- [x] 3A.6 `db/README.md`: schema design, commands, safety rules, backup, restore and rollback
- [x] 3A.7 Owner decisions before 3B: answered 2026-10-21 (see "Phase 3B decisions" below)

**Phase 3B (copy-and-verify tooling): complete locally, awaiting review.** MongoDB remains the only application database; nothing runs at API start-up; no production database was touched.

- [x] 3B.1 **Migration 0002** (`order_history_protection`):
  - `set_updated_at` keeps an explicitly supplied `updated_at`, so imports preserve source timestamps.
  - `orders.status` / `status_updated_at`, with an `order_status_transitions` table (placed → processing | cancelled; processing → shipped | cancelled; shipped → delivered).
  - Financial columns immutable (UPDATE rejected); row DELETEs on `orders` and `order_items` rejected.
  - `data_import_runs` audit table.
- [x] 3B.2 Read-only extraction (`db/dataMigration/source.ts`): only `listCollections`/`find`, `_id` order, SHA-256 fingerprint of the canonical Extended JSON. Connection guard refuses non-local hosts unless `--allow-remote-source`/`--allow-remote-target` is passed.
- [x] 3B.3 Validation and mapping (`db/dataMigration/plan.ts`, no I/O). It reports invalid ids, missing references, duplicate keys, missing ownership, orphaned orders, missing snapshots, deleted-product references, unknown fields and collections, and schema incompatibilities. Defaults are limited to Mongoose model defaults and each use is counted. Nothing is coerced or invented.
- [x] 3B.4 Import (`db/dataMigration/importer.ts`):
  - One transaction under an advisory lock; parameterised SQL in batches.
  - Dependency order: delivery options → products → users → orders + lines.
  - Change-detecting upserts for reference data; insert-or-compare for orders (history never updated; a difference is a conflict).
  - Strict by default (any error blocks before writing); `--skip-invalid` is opt-in.
  - Shared cart excluded and counted.
  - Requires all schema migrations to be applied.
- [x] 3B.5 Verification (`db/dataMigration/verify.ts`): an independent field-by-field mapping from the raw MongoDB documents. It reports matched, mismatched (field names only), missing and unexpected rows, cart exclusion, and source changes since the last import.
- [x] 3B.6 Guarded rollback (`data:rollback --confirm`): TRUNCATE in one transaction. It refuses if any cart, non-legacy order, or row not created by a recorded import exists.
- [x] 3B.7 Reports: JSON with ids and counts only (no personal data or credentials), written to git-ignored `migration-reports/`; console summary; non-zero exit unless succeeded.
- [x] 3B.8 Build: the runner and data CLI compile to `dist/scripts/`; `npm run build` copies the SQL to `dist/db/migrations`. The server imports neither.
- [x] 3B.9 Tests (`npm run test:db`, isolated PostgreSQL container plus in-memory MongoDB): **120 tests** (16 runner + 75 schema + 29 data migration). They cover dry-run, exact import, re-run, source change, deleted products, deleted users, malformed ids, duplicates, `--skip-invalid`, partial failure, order conflict, unmigrated schema, concurrent imports, verification drift, guarded rollback, MongoDB `dbHash` unchanged, and the connection guard. Mutation check: writing `created_at` into `ordered_at` makes 8 tests fail through the independent verifier.
- [x] 3B.10 Local development run, all **local** databases (2026-10-21):
  - Dev PostgreSQL backed up first, then `db:migrate` applied 0002.
  - `data:dry-run`: 0 errors.
  - `node dist/scripts/dataMigrate.js import`: inserted **3 delivery options, 35 products, 1 user, 8 orders (19 lines)**; excluded **4 shared-cart items** (quantity 5, 4 products) and the empty `delivery Options` collection.
  - Verification **MATCH (47/47 records)**. A re-run had 0 inserted, 0 updated and 47 unchanged.
  - MongoDB `dbHash` unchanged (`53733060…`).
  - Findings: 6 orders without an owner, 0 orphaned, 19 lines without a snapshot (kept NULL), 16 lines referencing deleted products, and `products.stock` model default applied ×35.
- [x] 3B.11 `db/README.md`: exact Windows PowerShell commands, data-copy procedure, report format, safety rules, backup/restore and rollback. **All commands were executed as documented.**

#### Phase 3B decisions (owner, 2026-10-21)

- Keep MongoDB ObjectId user ids as TEXT; keep product/order UUIDs and delivery-option digit strings.
- Orders of deleted users: import with NULL ownership and list them in the audit report (`orphanedOrders`, with the original user id).
- The 4 shared-cart items are not assigned to anyone: excluded from PostgreSQL, counted in every report, preserved in MongoDB and the backups.
- Preserve historical order information without inventing snapshots.
- Completed-order financial history is protected against editing; only controlled status transitions are allowed (migration 0002).
- Data migration is a separate, explicit command, never run at API start-up.
- Production PostgreSQL: preferably managed **Render Postgres in the backend's region**. Compile the runner into the build; don't run it automatically.


**Phase 3C (PostgreSQL API repositories): complete locally, awaiting approval before any domain is switched.** MongoDB remains the default for every domain.

- [x] 3C.1 **Repository layer** (`repositories/`): interfaces for delivery options, products, users, carts and orders (`types.ts`):
  - **MongoDB implementations** (`mongo.ts`): the previous Mongoose queries, unchanged. Products and orders are returned as documents, so MongoDB-mode JSON stays byte-identical.
  - **PostgreSQL implementations** (`postgres.ts`): parameterised `pg` SQL only.
  - **Shared controllers.** Controllers, routes and the `protect` middleware now depend on repositories, not Mongoose. Cart and order code reaches products and delivery options through those domains' repositories.
- [x] 3C.2 **Per-domain selection** (`config/dataSources.ts`):
  - Variables `DATA_SOURCE_DELIVERY_OPTIONS`, `DATA_SOURCE_PRODUCTS`, `DATA_SOURCE_USERS`, `DATA_SOURCE_CARTS` and `DATA_SOURCE_ORDERS`, each `mongo` (default) or `postgres`; anything else refuses to start.
  - Consistency rules (R24).
  - Production guard `POSTGRES_PRODUCTION_ENABLED=true` (R25).
  - With all defaults, `server.ts` behaves exactly as before. With a PostgreSQL selection it loads `.env.postgres`, refuses to start if migrations are pending, and logs the selection.
- [x] 3C.3 **Migration 0003** (`inventory_and_status_audit`):
  - `products.inventory_tracked` (default false).
  - Append-only `order_status_events` audit table.
  - `change_order_status()` is the only way to change a status; a direct UPDATE is rejected.
  - Legacy orders (no status) may be closed by an admin as `delivered` or `cancelled`.
  - The data rollback (Phase 3B) also refuses when any status event exists.
- [x] 3C.4 **Users (D2).** Existing ObjectId strings are kept; new users get application-generated ObjectId hex ids; bcrypt cost 12; MongoDB-era tokens keep working.
- [x] 3C.5 **Per-user carts (D1, FD1, D3).**
  - With `DATA_SOURCE_CARTS=postgres`, every cart route requires login and only touches the caller's cart.
  - Quantities must be integers 1–10, including after merging, enforced by the CHECK constraint and an atomic upsert.
  - Deleted products stay as unavailable lines.
- [x] 3C.6 **Transactional checkout.** One transaction that:
  - locks the buyer's cart row (concurrent checkouts produce one order);
  - snapshots name, image, price, description and category;
  - records a "placed" audit event;
  - clears **only** the buyer's cart.

  Stock is decremented and enforced **only** for `inventory_tracked` products (none today), with conditional updates in product-id order; it never goes negative. Any failure rolls everything back.
- [x] 3C.7 **Order history.** Legacy orders keep their shape: no invented owner, customer, snapshot or status. Snapshots are immutable. Cancellation is a status only: totals never change, and refunds are not modelled.
- [x] 3C.8 **Admin status endpoint** `PATCH /api/orders/:orderId/status` (contract O4): audited, allowed transitions only, 501 while orders are served by MongoDB.
- [x] 3C.9 **Tests.**
  - `npm test`: **190 passed** (173 existing, unchanged, plus 17 data-source tests).
  - `npm run test:db`: **190 passed** (121 schema/runner/data copy, 28 PostgreSQL API, 41 compatibility).
  - Mutation checks: 3 repository bugs (cart owner leak, clearing every cart, missing stock guard) and 1 response-shape drift were each caught.
- [x] 3C.10 **Compatibility verified.**
  - MongoDB mode byte-identical to before Phase 3C on real data (**48/48**).
  - Fixture comparison MongoDB vs PostgreSQL (**41 tests**: reads, invalid input, writes, checkout totals and snapshots).
  - Real-data comparison of the compiled app on dev MongoDB vs dev PostgreSQL (**23/23 equal**, 19/23 also equal in key order; R27).

#### Intentional API differences when a domain is served by PostgreSQL

| # | Difference | Why |
| --- | --- | --- |
| 1 | Cart routes require a bearer token (401 without), and each user has their own cart | D1 (security fix for R2) |
| 2 | Cart quantity must be an integer 1–10 on add, merge and update (MongoDB accepted `1.5`, merges above 10 and any PUT quantity ≥ 1); the PUT error message is "Quantity must be between 1 and 10" | FD1 |
| 3 | Cart line `id` is a UUID (MongoDB: ObjectId) | New table; nothing relies on the format |
| 4 | Orders include `status` (`null` for legacy orders); admins can change it via O4 (MongoDB: 501) | Phase 3B decision: controlled status transitions |
| 5 | An order whose owner was deleted has no `userId` (MongoDB shows the dangling id) | Phase 3B decision: NULL ownership, audited |
| 6 | Checkout can return 409 `insufficientStockProductIds` for inventory-tracked products | Stock protection; no product is tracked today |
| 7 | JSON key order may differ for products MongoDB stored without `stock` | R27; content identical |

All other responses (status codes, bodies and error messages) are identical, as verified above.

#### Phase 3C decisions taken (please confirm)

- Legacy orders may be closed **only** as `delivered` or `cancelled`, by an admin, with a reason; nothing else.
- `inventory_tracked` stays false for every product until real inventory data and rules exist. No API sets it yet.
- A cancelled order does not restock tracked inventory automatically (left for the inventory/refund design).
- A status change needs a reason (1–500 characters), stored in the audit trail.


Remaining Phase 3 work (not started; Phase 3C / Phase 4 preparation):

- [x] 3.1 ~~`db/pool.ts`~~ Done in Phase 3C (`withTransaction`, `verifySchemaCurrent`)
- [x] 3.2 ~~`db/migrations/001_init.sql` + runner~~ Done in Phase 3A
- [x] 3.3 ~~Repository interfaces~~ Done in Phase 3C (`repositories/`)
- [x] 3.4 ~~Per-domain switch~~ Done in Phase 3C (`config/dataSources.ts`; defaults all `mongo`)
- [x] 3.5 ~~ETL script~~ Done in Phase 3B (`data:import`, `db/dataMigration/`)
- [x] 3.6 ~~verify script~~ Done in Phase 3B (`data:verify`)
- [x] 3.7 ~~Characterisation suite against PostgreSQL~~ Done in Phase 3C (`test/db/api.postgres.test.ts`, `test/db/api.compatibility.test.ts`)

**Acceptance:** `db:migrate` creates the schema on an empty DB and is a no-op on rerun (**met in 3A**); ETL + verify exit 0 twice in a row; characterisation suite passes with every `DATA_SOURCE_*=postgres`.
**Rollback:** nothing user-facing changed; `npm run db:rollback -- --confirm` or restore the pre-migration `pg_dump` (`db/README.md`).

#### Outstanding decisions (after Phase 3B)

1. **Production MongoDB provider and location.** Still unknown; must be verified before any production backup, profile or import. Use a read-only MongoDB user for the import.
2. **Render Postgres instance.** Plan, region (same as the backend), PostgreSQL **17** (the tested version), backup retention. Not created yet.
3. **Production data profile.** Run `data:dry-run` against production only after decisions 1–2, from an approved environment, with `--allow-remote-source`. Any validation error needs a data decision **before** import; the tool won't coerce.
4. **Write freeze for the production import.** Extraction isn't a single snapshot; agree a maintenance window, then compare the import's fingerprint with a fresh `data:verify`.
5. **Legacy order statuses.** Legacy orders have no status and can't be given one. Should the admin ever be able to mark a legacy order (for example "delivered")? That would need an explicit rule, never an automatic backfill.
6. **Cancellation and refunds.** `cancelled` exists as an operational status only. Refunds and money movements are out of scope and must never edit the immutable financial columns.
7. **Mapping notes for the repositories (no decision needed).** `pg` returns `numeric` as a string (convert `rating_stars`). Constraint names map to API errors (unique email → 409, quantity range → 400, missing delivery option → 400). New orders insert `status = 'placed'`.


#### Render deployment preparation (documented only, not applied)

Nothing below has been changed on Render. Apply it only with approval, in the stated order.

| Setting | Value | Why |
| --- | --- | --- |
| Root directory | `ecommerce-backend` | Monorepo layout unchanged until Phase 7 |
| Node version | 24 (`NODE_VERSION=24` or `engines`) | Matches local development and `@types/node` |
| Build command | `npm ci --include=dev && npm run build` | TypeScript is a dev dependency. With `NODE_ENV=production`, a plain `npm ci` would omit it and the build would fail (R21) |
| Start command | `npm start` (`node dist/server.js`) | `server.js` no longer exists at the package root (R21) |
| Pre-deploy command | **Leave empty for now.** From Phase 4: `node dist/scripts/dbMigrate.js up` | Schema migrations are explicit and repeatable; they never run inside the server process |
| Health check path | `/` | Returns "Ecommerce API is running" |
| Environment (unchanged) | `MONGODB_URI`, `JWT_SECRET`, `CLIENT_URL`, `NODE_ENV=production` | MongoDB stays the application database |
| `DATABASE_URL` | **Do not add until Phase 4.** Then: the Render Postgres *internal* connection string | Nothing reads PostgreSQL in production yet |

One-off production data copy (Phase 4 only, after decisions 1–4), run from a Render Shell or one-off job of the deployed build:

1. Back up production MongoDB (§7) and confirm the Render Postgres backup.
2. `node dist/scripts/dbMigrate.js up`
3. `node dist/scripts/dataMigrate.js dry-run --allow-remote-source`. Review the report; it must show 0 errors.
4. Start the write freeze. Then `node dist/scripts/dataMigrate.js import --allow-remote-source --allow-remote-target`.
5. `node dist/scripts/dataMigrate.js verify --allow-remote-source --allow-remote-target`. It must report MATCH.

Rollback for any step: no API reads PostgreSQL until Phase 4 switches a domain, so the safe default is to do nothing. Production keeps serving from MongoDB. To discard imported data: `node dist/scripts/dataMigrate.js rollback --confirm --allow-remote-target`, or restore the Render Postgres backup.

### Phase 4 — Cut over domain by domain (lowest risk first)

**Local cutover: COMPLETE (2026-10-22), on the local development environment only.** Production cutover has **not** started; it needs the outstanding production decisions (§6 Phase 3 list, R29–R31) and explicit approval.

Writes for a domain move all at once; **no dual-write**. MongoDB stays untouched and remains the rollback target.

#### Prerequisites verified (Part C, 2026-10-22)

- Fresh backups of both local databases, **restore-verified**:
  - `mongo-ecommerce_store-before-phase4-20261022-020258.archive.gz`: restored 51/51 documents, per-collection `dbHash` identical to live.
  - `pg-ecommerce-before-phase4-20261022-020258.dump`: restored into a scratch database with identical counts and migrations.
- `db:status`: 0001, 0002 and 0003 applied.
- `data:verify`: **MATCH 47/47**. Source fingerprint unchanged since the 3B import (`207443604b2e…`), so no refresh was needed.
- Data-source rules: 17 unit tests; the server refuses invalid values, mixed carts/orders, PostgreSQL orders without PostgreSQL users/products/delivery options, and production use without `POSTGRES_PRODUCTION_ENABLED=true`.

#### Local switch results

Each step compared the compiled server (candidate, :3000) against an all-MongoDB baseline (:3101) on real local data, and checked the frontend path through the Vite dev server's `/api` proxy.

| Step | Domains on PostgreSQL | Responses equal to MongoDB | Integration tests | Counts | Frontend path |
| --- | --- | --- | --- | --- | --- |
| [x] 4.1 | delivery options | **29/29** (29/29 identical key order) | 4 + 2 passed | 3 = 3 | shell 200, proxied API equal |
| [x] 4.2 | + products | **29/29** (24/29 key order; R27) | 4 + 22 passed | 35 = 35 | ok |
| [x] 4.3 | + users | **29/29** (24/29 key order; R27); auth error responses identical | 5 passed | 1 = 1 (+ local test users) | ok |
| [x] 4.4 + 4.5 | + carts + orders (all five) | **26/26** incl. all 8 legacy orders (only `status` excluded); MongoDB no longer connected | full suites | 8 legacy orders, 19 lines | ok |

Carts and orders on PostgreSQL: **30/30 behaviour checks** on the running local server:
- every cart/order endpoint needs a login;
- Bob can't see, change or delete Alice's lines (404);
- add/merge/update reject 0, 11, 1.5, "2", -1 and 2+9 (FD1);
- a deleted product stays as unavailable and blocks checkout (409) until removed;
- **0 products have inventory tracking**, and stock is unchanged after checkout;
- **3 simultaneous checkouts produce exactly 1 order**, and only the buyer's cart is cleared;
- snapshots as sold;
- status changes are admin-only (403/401), need a reason (400), refuse disallowed transitions (409), and are audited with actor, previous status, new status, time and reason;
- **cancellation keeps the total and lines, with no restock and no refund**;
- legacy history intact (8 orders, 19 lines, no invented status).

End-to-end smoke through the Vite proxy (all PostgreSQL): **20/20**. It covered register, login (case-insensitive email), browse, add, update quantity and delivery, payment summary, checkout (total equals summary), cart emptied, order history and tracking, then switching to another user (empty cart, no foreign orders, 404 on the other user's order) and 401 when signed out.

Rollback (E7): **11/11**.
- Restarting without `DATA_SOURCE_*` serves MongoDB again: 35 products, the legacy shared cart, 8 orders, and 501 for status changes.
- PostgreSQL kept every row.
- Switching forward again restored the Phase 4 orders and statuses.
- **MongoDB `dbHash` identical before and after Phase 4.** As expected (R31), users created on PostgreSQL can't log in after rolling back.

Data comparison after the local switch: all 47 copied records still match field for field; PostgreSQL additionally holds the local test data (4 users, 3 orders, carts and status events), reported as "unexpected" by design (R32).

#### Local activation and rollback commands (Windows PowerShell, from `ecommerce-backend`)

```powershell
# 0. Safety first: back up both databases (db/README.md "Backups"), then confirm:
npm.cmd run -s db:status          # 0001-0003 applied
npm.cmd run -s data:verify        # MATCH; "source changed since import" must be False
# If the source changed: back up, then  npm.cmd run data:import  and verify again.

# 1-4. Switch for this PowerShell session only (no file changes), one step at a time:
$env:DATA_SOURCE_DELIVERY_OPTIONS = "postgres"            # 4.1
$env:DATA_SOURCE_PRODUCTS = "postgres"                    # 4.2
$env:DATA_SOURCE_USERS = "postgres"                       # 4.3
$env:DATA_SOURCE_CARTS = "postgres"; $env:DATA_SOURCE_ORDERS = "postgres"   # 4.4 + 4.5 (together)
npm.cmd run dev                   # or: npm.cmd run build; npm.cmd start
# The log line "Data sources: ..." shows the selection.

# Rollback (any step): stop the server, clear the variables, start again.
Remove-Item Env:DATA_SOURCE_DELIVERY_OPTIONS, Env:DATA_SOURCE_PRODUCTS, Env:DATA_SOURCE_USERS, Env:DATA_SOURCE_CARTS, Env:DATA_SOURCE_ORDERS -ErrorAction SilentlyContinue
npm.cmd run dev                   # all domains on MongoDB again; PostgreSQL data is kept

# To discard the local Phase 4 test data from PostgreSQL, restore the pre-Phase-4 dump
# (db/README.md "Rollback"): ..\..\ecommerce-backups\pg-ecommerce-before-phase4-20261022-020258.dump
```

The frontend needs no setting. With the legacy MongoDB cart it behaves as before. With PostgreSQL carts, a 401 opens the login flow and returns the user afterwards.

#### Remaining before any production cutover

- [ ] Decisions: production MongoDB provider; Render Postgres instance (region, version 17, backups); write-freeze window and mechanism
- [x] R29: frontend dependency update (`69a47e0`, `npm audit` 0)
- [x] R31: recovery design and reconciliation proof of concept (below)
- [ ] R31 production readiness: ~~write-freeze switch~~ (done, `94e08b9`), ~~a guarded reconciliation CLI~~ (done, `d5510cb`), batching for production volumes, a rehearsal on restored copies of production dumps, owner approval
- [ ] R30: decide the auth cookie plan (§4); implement before or with Phase 5
- [ ] Render settings from "Render deployment preparation" (§6 Phase 3) applied, then deploy `migration/postgres` with **all domains on MongoDB** first; verify; then switch production domains one at a time with `POSTGRES_PRODUCTION_ENABLED=true`, each right after a production `data:import` + `data:verify`
- [ ] 4.6 Remove Mongoose only after two weeks of stable production on PostgreSQL and a final `mongodump`

**Acceptance per domain (production):** suites green; `data:verify` MATCH immediately before the switch; smoke test of that domain's features; no 5xx increase for 48 h.
**Rollback per domain:** while writes are still frozen, unset `DATA_SOURCE_<DOMAIN>` and restart. After writes resume, only through the reconciliation procedure below (R31).

#### Production cutover and recovery design (R31)

**The problem.** Once PostgreSQL accepts writes, it holds records MongoDB has never seen: new users with password hashes, orders and order lines, status changes and their audit trail, per-user carts, and catalogue edits. Pointing the app back at MongoDB would serve an **older snapshot**. New customers could no longer sign in, their orders would disappear from their history and from the admin list, and paid orders would be invisible to fulfilment. Verified locally in Phase 4 E7 and again in the proof of concept.

**Principle.** No rollback may silently discard an accepted write. MongoDB may become active again only after it is shown to contain every PostgreSQL record. If that cannot be shown, recovery is **forward-fix only**.

##### Cutover runbook (per production switch; nothing here has been executed)

1. **Prepare.** Owner approval; Render Postgres provisioned; migrations applied with `db:migrate` (not at startup); restore-verified `mongodump` and `pg_dump`; reconciliation CLI rehearsed against restored copies.
2. **Freeze writes.** Set `WRITE_FREEZE=true` on the API and restart (`middleware/writeFreeze.ts`, Phase 7A): every request that would write shop data gets 503 with `Retry-After`; reads, sign-in and sign-out keep working. Fallback: block writes at the edge. Confirm the freeze: the start-up log says `WRITE FREEZE: ON`, and the MongoDB fingerprint (`data:dry-run`) stays unchanged over several minutes.
3. **Back up** both databases (§7) and verify each by restoring into a throwaway container.
4. **Consistency checks.** `data:dry-run`: 0 errors; the documented warnings only (orphaned orders, excluded shared cart). Record the source fingerprint.
5. **Migrate.** `data:import` (one transaction; refuses a source that changed since the dry run).
6. **Verify.** `data:verify` MATCH, and the fingerprint is unchanged since step 4.
7. **Activate, under control.** Set `DATA_SOURCE_*` for the approved domains and `POSTGRES_PRODUCTION_ENABLED=true`, then restart. Run read-only smoke checks **while still frozen**. Rollback at this point is the plain one, with no loss (PostgreSQL has received no writes).
8. **Resume writes.** Lift the freeze and record the time: **from now on, rollback requires reconciliation.**

##### Rollback after writes resumed (reverse reconciliation)

1. Freeze writes again (step 2), then back up **both** databases.
2. Dry run: `npm run reconcile:plan` (`planReconciliation`, read-only on both sides) lists what would be copied and any blocking issue.
3. Apply: `npm run reconcile:apply -- --confirm --writes-frozen` (`applyReconciliation`; refused without both flags, and remote databases need `--allow-remote-postgres` / `--allow-remote-mongodb` under an approved plan). It reads PostgreSQL in one `REPEATABLE READ` snapshot, writes MongoDB **insert-only and keyed by id**, then re-reads PostgreSQL. A changed fingerprint means writes were not frozen, and the run fails.
4. Gate: `npm run reconcile:verify` (`verifyRollbackTarget`, exit 0 only when ready, 2 when not) must return `ready: true`. It requires every PostgreSQL user, order, product and delivery option to exist and match in MongoDB, the side collections to mirror PostgreSQL, no run in progress, and a completed run against PostgreSQL as it is now. **It never reports an older MongoDB as ready.** Switching `DATA_SOURCE_*` back is a manual step taken only after this check; nothing switches automatically.
5. Before lifting the freeze, act on the warnings, for example by deleting by hand any product that was deleted on PostgreSQL.

| What | How it is reconciled |
| --- | --- |
| New users | Inserted with the same ObjectId and the **same bcrypt hash**, written raw because the Mongoose save hook would hash it twice. Users keep their passwords. A different MongoDB user with the same email is a blocking conflict |
| New orders and lines | Inserted with the same UUID, totals, customer details and **immutable product snapshots**, in the shape the MongoDB app writes. The MongoDB API then returns them identical to PostgreSQL apart from `status` |
| Existing orders | **Compared, never modified.** Any difference in owner, customer, time, total or lines is a blocking conflict. Orders whose owner was deleted are compared without the owner, as imported (Phase 3B) |
| Status and audit trail | Copied to `reconciliation_order_status`. MongoDB has no status model (status changes return 501 there), so history is preserved but not served |
| Per-user carts | Copied to `reconciliation_carts`; **never merged into the shared cart** (D1). Customers lose cart contents on rollback; orders are not affected |
| Catalogue edits | A newer PostgreSQL product replaces the MongoDB one only after the old version is archived in `reconciliation_previous_products`. New products are inserted |
| Products deleted on PostgreSQL | Reported (warning), **not** deleted from MongoDB. Manual decision |
| Inventory tracking | Not representable in MongoDB (warning; 0 products today) |
| Records only in MongoDB | Blocking: they mean MongoDB was written after the cutover. Manual resolution |

**Proof of concept** (`ecommerce-backend/db/reconciliation/reverse.ts`, `test/db/reconciliation.test.ts`). It runs only against disposable databases: an in-memory MongoDB and a fresh database in the throwaway PostgreSQL container. Until Phase 7A there was deliberately **no npm script**; the guarded CLI (`scripts/reconcile.ts`, 4 more tests in `test/db/reconcileCli.test.ts`) now wraps it. Not yet done: batched reads and writes for production volumes (the plan holds every record in memory). Post-cutover traffic goes through the real PostgreSQL-backed API: 2 registrations, cart lines, a checkout, admin status changes on a new order and a legacy order, and a product edit, create and delete. Results are checked through the real MongoDB-backed API. **10/10 tests:**
- Without reconciliation, the new user gets 401 and the readiness gate refuses the older MongoDB.
- Planning writes nothing on either side.
- After reconciliation, new users log in with their passwords, the new order matches PostgreSQL apart from `status`, existing orders are byte-identical, status history and carts are archived, the shared cart is unchanged, catalogue edits are applied with the old version archived, and the deleted product is reported.
- Re-running is a no-op: same `dbHash`, no duplicates.
- An interrupted run (failure before orders) is not ready; resuming completes it without duplicates.
- A changed MongoDB order blocks everything, writes nothing and is never modified.
- A duplicate email blocks.
- A write to PostgreSQL during the run is detected ("not frozen"), and the gate stays closed until a clean re-run.
- A completed run goes stale after any new PostgreSQL write.
- Overlapping runs: the second is refused (lock); nothing is duplicated.

Mutation checks:
- Removing the freeze re-check, the gate's missing-record rule, the order total comparison or the lock each fails at least one test.
- Replacing the idempotent insert with a plain insert still passes. Duplicates are prevented structurally, because MongoDB `_id` is unique and every run re-plans from the current state; the upsert only keeps overlapping runs from failing, which the lock now prevents anyway.

**Not covered by the proof of concept:**
- Production-scale reads: whole tables are loaded into memory, which is fine for today's data and needs batching later.
- Product-image files.
- A re-cutover after a rollback, which needs its own plan. The PostgreSQL database is kept, never dropped, so that plan has the full history to work from.

##### No-rollback condition and forward-fix plan

After writes resume, **rolling back to MongoDB is not allowed** whenever any of these is true:
- the reconciliation CLI is not built, rehearsed and approved;
- reconciliation reports blocking conflicts;
- the readiness gate is not `ready`;
- Mongoose has been removed (4.6).

In those cases recovery is forward-fix on PostgreSQL:
- Redeploy the previous commit with the **same** `DATA_SOURCE_*` settings for code regressions.
- Ship a targeted fix behind the existing tests.
- For data damage: `pg_restore` from the latest dump into a new database, or Render point-in-time recovery if the plan includes it, then switch `DATABASE_URL`.
- Keep the write freeze on while recovering if integrity is in doubt.
- MongoDB stays untouched as the archive of everything before the cutover.


### Phase 5 — Next.js frontend in `apps/web` (Vite stays live)

**5A and the 5B authentication foundation: DONE locally (2026-10-22) on branch `phase5/nextjs-foundation` (not pushed, not merged).** Nothing was deployed. The Vite app and the legacy JWT login are unchanged. Cookie sessions are off unless `AUTH_COOKIE_SESSIONS=true`, and the API refuses to start with them under `NODE_ENV=production`. Full page migration has **not** started and awaits approval.

#### 5A — What exists in `apps/web`

| Package | Version | Note |
| --- | --- | --- |
| `next` | 16.4.2 | App Router, Turbopack build; was 16.4.0, upgraded in 5F for critical advisories (see 5F); `npm audit` 0 |
| `react`, `react-dom` | 19.3.0 | |
| `@tanstack/react-query` | 5.104.1 | server state |
| `@reduxjs/toolkit`, `react-redux` | 2.13.0, 9.3.0 | UI state only |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | |
| `typescript` | 6.0.3 | strict, `noUncheckedIndexedAccess` (same major as the backend) |
| `eslint` + `eslint-config-next` | 9.39.5, 16.4.2 | official Next.js rules (core web vitals + TypeScript); its `fast-glob` is replaced by `tools/fast-glob-shim` (R35, resolved in 5C) |
| `vitest`, `tough-cookie`, `server-only` | 5.0.5, 6.0.2, 0.0.1 | tests; browser-like cookie jar for the end-to-end check; build-time guard for server-only modules |
| `@playwright/test`, `playwright-core`, `@axe-core/playwright` | 1.64.0, 1.64.0, 4.13.0 | real-browser suite (5F); `playwright-core` pinned so axe uses the same copy |

```
apps/web/
  next.config.ts              security headers, no X-Powered-By
  scripts/auth-proxy-e2e.mjs  end-to-end proxy + cookie test (throwaway PostgreSQL)
  src/app/                    layout, page (placeholder home), login/, loading, error, global-error, not-found
  src/app/api/[...path]/      the same-origin API proxy (route handler)
  src/components/             SiteHeader, SessionStatus
  src/features/auth/          session API (validated), hooks (TanStack), LoginForm
  src/features/catalog/       product preview (proves the /api path)
  src/hooks/                  useReturnPath
  src/lib/                    api client, env (typed + validated), proxy, query keys, safeReturnPath
  src/providers/              AppProviders: Redux store + QueryClient, one instance per tree
  src/store/                  makeStore, uiSlice (notices only), typed hooks
```

State rule (unchanged from the Vite app): products, cart, orders and the signed-in user live **only** in the TanStack Query cache. Redux holds UI state; today that is one notice. The CSRF token sits in the session query and never in Redux or browser storage. User-scoped query keys are cleared whenever the identity changes.

#### Vite → Next.js incompatibilities found

1. **Router.** `BrowserRouter`, `Routes`, `Link`, `Navigate`, `useNavigate`, `useLocation`, `useParams` and `useSearchParams` come from `react-router`; they become `next/link` and `next/navigation`. `useSearchParams` needs a `<Suspense>` boundary.
2. **`location.state` has no Next.js equivalent.** It is used in 5 places: the login and register return path, `/product-unavailable` (`productName`), `AuthSessionWatcher` and `useRequireLogin`. Use query parameters instead (`?from=` is already done in `apps/web`). The values stay validated (`safeReturnPath`).
3. **Module-level singletons.** `store` and the `QueryClient` are created at module load. On a Next.js server that would share state between requests, so they must be created per tree (done in `AppProviders`).
4. **Bearer token in `localStorage`, the axios interceptor and the `storage`-event watcher** are replaced by the HttpOnly cookie session, same-origin `fetch`, and (later) `BroadcastChannel` for cross-tab sign-out.
5. **`import.meta.env.VITE_API_URL`** becomes the server-only `BACKEND_ORIGIN`; the browser only ever calls `/api` on its own origin.
6. **Browser-only APIs during render.** `window.confirm`, `window.scrollTo` and `document.getElementById` must live in Client Components and event handlers or effects.
7. **The `*` route renders the home page** today. Next.js `not-found.tsx` answers 404 instead; the foundation does this, pending approval (see the mapping).
8. **15 MB of images in `ecommerce-project/public/images`.** They are needed by Next.js (`/images/...`); copy them or serve from shared storage when pages move (decision).
9. **Tests.** `MemoryRouter`-based page tests and `msw` handlers need `next/navigation` test doubles when pages move.
10. **Registration** still returns a JWT (legacy). Cookie-session registration needs a decision: a new `POST /api/auth/session/register`, or register followed by sign-in.

#### Route-by-route mapping (plan; current status in "5D" below)

| Vite route | Vite component | Next.js route | Rendering plan | Access | Notes |
| --- | --- | --- | --- | --- | --- |
| `/` | `HomePage` (grid, search) | `app/page.tsx` (placeholder now) | Server shell + client grid (TanStack); server prefetch later | public | search term: URL `?q=` or Redux `home` slice (UI state) |
| `/products/:productId` | `OneProductPage` | `app/products/[productId]/page.tsx` | dynamic, `generateMetadata` | public | validate the UUID; `notFound()` |
| `/login` | `LoginPage` | `app/login/page.tsx` (**done, cookie session**) | client form | public | `?from=` replaces `location.state` |
| `/register` | `RegisterPage` | `app/register/page.tsx` | client form | public | needs the registration decision (item 10 above) |
| `/admin` | `AdminDashboard` | `app/admin/**` (**done in 5G**) | server pages + client forms | admin | server role check per page; the API keeps enforcing `adminOnly` |
| `/checkout` | `CheckoutPage` | `app/checkout/page.tsx` | client | signed in (per-user carts) | 401 → `/login?from=/checkout` |
| `/order-confirmation` | `OrderConfirmationPage` | `app/order-confirmation/page.tsx` | client | signed in | |
| `/product-unavailable` | `ProductUnavailablePage` | `app/product-unavailable/page.tsx` | static + client | public | `?productName=` instead of `location.state` (render as text only) |
| `/orders` | `OrdersPage` | `app/orders/page.tsx` | client | signed in | |
| `/tracking` | `TrackingPage` | `app/tracking/page.tsx` | client inside `<Suspense>` | signed in | `?orderId&productId` |
| `*` | `HomePage` | `app/not-found.tsx` (**done**) | static | public | **behaviour change**: 404 instead of home; approve or revert |

#### Same-origin API proxy

The browser calls `/api/*` on the Next.js host. The route handler `src/app/api/[...path]/route.ts` forwards to `BACKEND_ORIGIN`, using the rules in `src/lib/proxy/backendProxy.ts`. A handler was chosen over `next.config` rewrites because rewrites forward almost every header unfiltered and give no control over `Set-Cookie`.

- **Fixed target.** Only `/api/*` paths, appended to the one validated `BACKEND_ORIGIN` (exact origin, no credentials or path; https unless loopback). It refuses traversal (`..`), empty segments, backslashes, encoded `.`, `/`, `\` and NUL, and control characters, without contacting the API. It cannot reach any other host.
- **Methods:** GET, HEAD, POST, PUT, PATCH and DELETE; others get 405. Bodies are limited to 1 MiB (413); upstream timeout 15 s (502); an unreachable API returns a generic 502 with no details.
- **Request headers (allow-list):** `Accept`, `Accept-Language`, `Authorization` (for the legacy token exchange), `Content-Type`, `If-None-Match`, `If-Modified-Since`, `Origin` (Express checks it), `User-Agent` and `X-CSRF-Token`. It never forwards `Host`, hop-by-hop headers, `X-Forwarded-*`, `Forwarded`, `X-Real-IP`, `Referer` or `Proxy-*`. Of the cookies, only `__Host-ecom_session` and `ecom_dev_session` are forwarded.
- **Response headers (allow-list):** content and caching headers only. `Set-Cookie` passes only for the session cookies, and **any `Set-Cookie` with a `Domain` attribute is dropped**, as is a `__Host-` cookie without `Secure` or `Path=/`. Every cookie is therefore host-only on the browser-facing origin. Redirects from the API are not followed or passed on (502). `X-Powered-By`, `Server`, `Location`, CORS headers and `Content-Encoding` are not passed on.
- **Forwarded headers.** Express does not trust `X-Forwarded-*` (`trust proxy` stays off). The cookie's `Secure` flag comes from configuration, never from the request. The proxy does not send forwarded headers at all.

**Local vs HTTPS behaviour**

| | Local development | HTTPS (production design, HTTPS-equivalent test) |
| --- | --- | --- |
| Browser origin | `http://localhost:3001` (or `http://127.0.0.1:3001`) | `https://<next-host>` |
| Express setting | `AUTH_COOKIE_SECURE=false`, `AUTH_ALLOWED_ORIGINS=http://localhost:3001` | `AUTH_COOKIE_SECURE=true` (default), `AUTH_ALLOWED_ORIGINS=https://<next-host>` |
| Cookie | `ecom_dev_session`: HttpOnly, SameSite=Lax, Path=/, no Secure | `__Host-ecom_session`: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain |
| Scope | host-only, but cookies are **not port-scoped**: it also reaches Express on the same host, where writes still need Origin and the CSRF token (tested) | host-only on the Next.js host; never sent to the API host directly |
| Why two names | Safari, and any device or LAN testing over `http://<ip>`, will not store a `Secure` cookie without HTTPS (Chrome and Firefox treat `http://localhost` as secure) | — |

**How to test the proxy**
- Unit tests: `npm test` in `apps/web` (75 tests), against a real local HTTP upstream.
- End to end: build both apps, then run `npm run test:e2e` in `apps/web`. It uses Docker and openssl and starts a throwaway PostgreSQL container that is removed afterwards. It runs the real `next start` and the compiled Express, and checks both the local HTTP scenario and an HTTPS-equivalent one: a local TLS terminator in front of Next.js, as the hosting edge terminates TLS. Result: **52/52**.

#### 5B — Cookie-session architecture (implemented, disabled by default)

- **Storage:** migration `0004_auth_sessions`.
  - Columns: `id`, `token_hash` (SHA-256, 32 bytes, unique), `user_id` (FK to `users`, cascade), `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at`, `revoked_at`, `revoked_reason` and `user_agent` (512 characters at most).
  - A trigger keeps the id, token hash, user, creation time and absolute expiry immutable, and makes revocation one-way.
  - Indexes support active sessions per user and cleanup.
  - The data-migration rollback now refuses while sessions exist and truncates them with the users.
- **Tokens:** 32 random bytes (`crypto.randomBytes`), base64url. Only the hash is stored, and the raw token is never in a response body, the logs or the frontend state (tested). The CSRF token is `HMAC-SHA256(key = session token, "ecommerce csrf v1")`: it needs no storage and is not derivable from the database.
- **Endpoints** (mounted only when enabled; otherwise 404):

| Endpoint | Purpose | Protection |
| --- | --- | --- |
| `POST /api/auth/session` | sign in (email, password) through the same `users.authenticate` (bcrypt) as the legacy login; **rotates** any session the browser presented | Origin allow-list, JSON only (login CSRF) |
| `GET /api/auth/session` | `{ user, csrfToken }`; `Cache-Control: no-store` | session cookie |
| `DELETE /api/auth/session` | sign out this browser: revoke, clear the cookie | cookie + Origin + CSRF |
| `DELETE /api/auth/sessions` | sign out everywhere (this user's sessions) | cookie + Origin + CSRF |
| `POST /api/auth/session/exchange` | migration: a valid legacy bearer token becomes a cookie session | Origin allow-list + bearer token |

- **Application routes:**
  - The existing `protect` middleware accepts a session cookie when **no** `Authorization: Bearer` header is present. A bearer token always takes the unchanged legacy path, so the Vite app behaves exactly as before.
  - Cookie-authenticated POST, PUT, PATCH and DELETE need an allowed `Origin` **and** the matching `X-CSRF-Token`. Both are checked before any database access, so a refused request changes nothing (tested on cart, order-status and logout).
  - Ownership and `adminOnly` checks are untouched (tested).
- **Expiry and renewal:**
  - Idle timeout 7 days, extended on use at most every 15 minutes, never past the absolute lifetime of 30 days. All comparisons use the database clock.
  - Expired, revoked or unknown tokens get 401 and the cookie is cleared.
  - Cleanup is deliberate, never automatic: `npm run sessions:cleanup` counts; `-- --confirm` deletes sessions that finished more than 7 days ago (`--retention-days N`).
- **Configuration** (`auth/config.ts`; any invalid value stops start-up):
  - `AUTH_COOKIE_SESSIONS` (`true` enables) needs `DATA_SOURCE_USERS=postgres` and is refused with `NODE_ENV=production`.
  - `AUTH_COOKIE_SECURE` defaults to `true`; with it, every entry in `AUTH_ALLOWED_ORIGINS` must be https.
  - `AUTH_ALLOWED_ORIGINS`: exact origins, also added to the CORS allow-list.
  - `AUTH_SESSION_IDLE_HOURS`, `AUTH_SESSION_ABSOLUTE_HOURS`.
- **Dependency:** sessions reference users in PostgreSQL, so production activation can only follow the production users cutover. An R31 rollback does not reconcile sessions; everyone is signed out, which is acceptable.
- **Tests:** `test/db/authSessions.test.ts` has 38 tests, plus migrator updates. Mutation checks: removing the CSRF check, the Origin check, rotation, the revocation filter, `Secure`, the login Origin check, the idle-expiry filter, or token hashing each fails at least one test.

#### Local development commands (Windows PowerShell)

```powershell
# Express with cookie sessions (LOCAL ONLY). Migrations 0004 and 0005 are new: back up the
# local PostgreSQL first (db/README.md "Backups"), then apply it.
cd ecommerce-backend
npm.cmd run db:migrate
$env:DATA_SOURCE_DELIVERY_OPTIONS = "postgres"; $env:DATA_SOURCE_PRODUCTS = "postgres"; $env:DATA_SOURCE_USERS = "postgres"
$env:DATA_SOURCE_CARTS = "postgres"; $env:DATA_SOURCE_ORDERS = "postgres"
$env:AUTH_COOKIE_SESSIONS = "true"; $env:AUTH_COOKIE_SECURE = "false"; $env:AUTH_ALLOWED_ORIGINS = "http://localhost:3001"
npm.cmd run dev                 # http://localhost:3000; log shows "Cookie sessions: enabled (local HTTP development cookie)"

# Next.js (second terminal)
cd apps/web
Copy-Item .env.example .env.local   # BACKEND_ORIGIN=http://127.0.0.1:3000
npm.cmd run dev                 # open http://localhost:3001 (the origin must match AUTH_ALLOWED_ORIGINS exactly)

# Checks
npm.cmd test; npm.cmd run typecheck; npm.cmd run lint; npm.cmd run build
npm.cmd run test:e2e            # after building ecommerce-backend and apps/web; needs Docker
npm.cmd run test:pages          # migrated pages end to end (production and dev servers); same prerequisites

# The Vite app is unchanged: cd ecommerce-project; npm.cmd run dev  (http://localhost:5173, bearer tokens)
# Turn cookie sessions off again: Remove-Item Env:AUTH_COOKIE_SESSIONS
```

The local development database does **not** have 0004 or 0005 applied yet. With any PostgreSQL domain selected, the API refuses to start until `db:migrate` runs, as it does for every migration.

#### Conditions before the legacy bearer tokens can be removed

1. The Next.js storefront has replaced the Vite app in production (Phase 7), and no client sends bearer tokens. Measure this: log the count of bearer-authenticated requests, not the tokens.
2. Cookie sessions are enabled in production. That needs: an owner decision; production users on PostgreSQL (cutover); `AUTH_COOKIE_SECURE=true` with the production Next.js origin; a login rate limit (R37); the CORS rejection handled as 403 (R36); and session cleanup scheduled.
3. A migration window of at least the JWT lifetime (30 days) after step 1, with the exchange endpoint available, so signed-in users move without a forced sign-in. The window is set when step 1 happens; no deadline is enforced now.
4. Then: remove the bearer path from `protect`, the exchange endpoint and `token` from the legacy responses, and **rotate `JWT_SECRET`** to invalidate any token still outstanding.

#### 5C — Authentication security hardening (2026-10-22, commit `1be8a1c`, local)

- **R36 fixed: rejected origins get a JSON 403.** A request whose `Origin` is not on the CORS allow-list now gets `403 {"message":"Origin not allowed"}`. Previously it was Express's HTML 500, with a stack trace outside production. The check runs before CORS headers, body parsing and every route, so nothing is written or counted (tested). Requests without an `Origin` continue as before (server-to-server calls, same-origin GETs).
- **R37 fixed: rate limits on authentication, in a shared database.**
  - *Storage:* PostgreSQL migration `0005_auth_rate_limits`, or the MongoDB collection `authRateLimits` with a TTL index. The store follows `DATA_SOURCE_USERS`. Each hit is one atomic statement on the database clock, so every Render instance enforces the same counters (25 simultaneous attempts are counted as 25, tested). Keys are `SHA-256(rule, subject)`: no email or IP address is stored.
  - *Limits:* per address: login (legacy and cookie share one budget, default 20 per 15 min), registration (legacy and `/api/auth/accounts`, 10), token exchange (20). Per account: failed logins (10). The account check runs **before** the password check, so a correct password is also refused while locked. Unknown emails are counted exactly like real ones. Every limit answers the same `429 {"message":"Too many attempts. Please wait a few minutes and try again."}` with `Retry-After`.
  - *Account existence:* unknown emails now do the same bcrypt work as wrong passwords, so timing does not reveal whether an account exists.
  - *Failure handling:* if the counter store fails, sign-in is refused with 503 (fail closed).
  - *Settings:* `AUTH_RATE_LIMIT` (`false` only outside production), `AUTH_RATE_LIMIT_WINDOW_MINUTES`, `…_LOGIN_PER_IP`, `…_LOGIN_FAILURES_PER_ACCOUNT`, `…_REGISTER_PER_IP`, `…_EXCHANGE_PER_IP`. In-process test apps run without limits unless a test provides them; `server.ts` always builds the limiter.
- **Client addresses without spoofing.**
  - `TRUST_PROXY_HOPS` (default 0) sets Express `trust proxy`. At 0, `X-Forwarded-For` is ignored. At `n`, only the address `n` hops from the right counts, so a forged leftmost entry has no effect. Render: set 1, after confirming Render appends exactly one hop.
  - The Next.js proxy may forward the browser address as `X-Client-IP` with `X-Proxy-Secret`, but only when both sides set `PROXY_CLIENT_IP_SECRET` (32+ characters) and Next.js sets `TRUSTED_CLIENT_IP_HEADER` to a header the platform overwrites (Vercel: `x-real-ip`). Client-supplied `X-Client-IP` or `X-Proxy-Secret` headers are never forwarded, and Express ignores them without the secret (tested).
  - IPv6 clients are counted per /64.
- **Operational data excluded from migration.** The 3B extraction skips the `authRateLimits` collection (`OPERATIONAL_COLLECTIONS`), so login attempts during a write freeze do not change the source fingerprint (tested). Deploying this backend creates that collection in production MongoDB on the first login attempt; no existing data is touched.
- **R35 resolved: official Next.js lint rules without the vulnerable chain.** `eslint-config-next` 16.4.0 is installed with 22 `@next/next/*` rules active. Its only `fast-glob` use, expanding the optional `settings.next.rootDir` monorepo glob, is served by `apps/web/tools/fast-glob-shim`, a 30-line wrapper around Node's `fs.globSync` wired in through `package.json` `overrides` (`$fast-glob`). `micromatch` and `braces` are not installed; `npm audit` is 0.
- **Tests:**
  - MongoDB suite: +21, covering configuration, brute force, lockout and recovery, unknown-account parity, timing parity, per-address limits, registration limits, hashed keys and TTL, atomic counting, fail-closed, proxy hops, the proxy secret, IPv6 subjects and legacy compatibility.
  - PostgreSQL suite: +13, covering the store, cookie-login limits, shared budgets, rejected origins, token exchange and account creation.
  - Mutation checks, each removal caught: the 403 middleware, the account lock, failure counting, the trusted-hop count, the secret check, fail-closed, the timing equaliser and IPv6 grouping.

#### 5D — First pages migrated (local, awaiting approval to push)

| Route | Status | Rendering | Notes |
| --- | --- | --- | --- |
| `/` | **migrated** | Server Component, catalogue cached 60 s | All products; `?q=` search and `?category=` filter, as on `/products` |
| `/products` | **new** | Server Component | Listing with search and category chips; search pages are `noindex` |
| `/products/[productId]` | **migrated** | Server Component + `generateMetadata` | Title, description, canonical, Open Graph image, schema.org `Product` JSON-LD (escaped). Malformed or unknown ids answer a **real 404** |
| `/login` | **migrated** (5B) | Client form | Notices from Redux; `?from=` validated by `safeReturnPath`; link to registration keeps the return path |
| `/register` | **migrated** | Client form | `POST /api/auth/accounts`, then the normal sign-in (below) |
| `/account` | **new** | Server layout guard + Server Component | Session checked server-side per request (redirect 307 to `/login?from=%2Faccount`); profile; sign out; sign out on all devices |
| unknown URLs | **404** | `not-found.tsx` | Approved behaviour change |
| `/checkout`, `/orders` | **migrated in 5E** | Server guard + Client Component | Cookie session, CSRF and per-user query keys |
| `/tracking`, `/order-confirmation`, `/product-unavailable`, `/admin` | next stage | — | Still served by the Vite app |

- **Architecture:**
  - Public catalogue pages are Server Components (SEO, no client fetch for first paint). Product data is read server-to-server from Express (`lib/server/catalog.ts`, React `cache` + `fetch` revalidate 60 s) and validated (`features/catalog/product.ts`).
  - Interactive controls are Client Components: the quantity select and Add to Cart (`features/cart/AddToCartControls`), the session area in the header, and the forms. TanStack Query holds the session (user + CSRF token) and mutations. Redux holds sign-in notices only, which replaces `location.state`. Return paths always go through `?from=` and `safeReturnPath`.
  - The header search is a GET `next/form` to `/products?q=`: it works without JavaScript and navigates client-side when it can.
- **Status codes and loading states.** A `loading.tsx` above a page makes Next.js stream a 200 before `notFound()` or `redirect()` can run; the first pages e2e run caught exactly this. The listing skeletons therefore live in route groups (`app/(catalog)/loading.tsx`, `app/products/(list)/loading.tsx`) that wrap only the listings. The product page and account area have no loading boundary, so their 404 and 307 are real. Error boundaries: `app/error.tsx`, `app/products/error.tsx` (catalogue unavailable), `global-error.tsx`.
- **Registration (Part E).** `POST /api/auth/accounts` (backend, cookie mode only) reuses `registerAccount()`, the same validation and creation code as the legacy endpoint (shared function). It returns `201 {user}` with **no token, no cookie and no session**, and requires an allowed Origin and JSON. After success the browser sets a Redux notice and goes to `/login?from=…`, where the normal cookie sign-in applies. Duplicate email (409), invalid data (400), rate limits (429) and server failures (500, or non-JSON) show safe messages. Tests confirm that no password, session token or JWT reaches `localStorage`, `sessionStorage`, `document.cookie`, Redux or the query cache. The CSRF token is held in memory in the session query by design: it is not a credential.
- **Add to cart (limited integration).** On product cards and pages: sends `POST /api/cart-items` with the CSRF token. Signed out → notice + `/login?from=<this page>`. A 401 ends the local session and asks to sign in again. There is no cart page yet (next stage).

**Product images (Part D)**
- *Inventory:* the local catalogue references 35 product images. All exist and are 720×720 JPEGs.
- *Copied:* those 35, plus all 11 rating images (192×38 PNG), into `apps/web/public/images/{products,ratings}`. Each was verified as a decodable image (sharp) and byte-identical to its source (SHA-256).
- *Not copied:* 7 files that no product or order snapshot references (`2-slot-toaster-white`, `adults-plain-cotton-tshirt-2-pack-teal`, `athletic-cotton-socks-6-pairs`, `elegant-white-dinner-plate-set`, `intermediate-composite-basketball`, `men-chino-pants-beige`, `men-cozy-fleece-hoodie-light-teal`). They stay in the Vite app; the first three only appear in backend test fixtures. Icons, logos and guide images are not used by the migrated pages and were not copied. Total: 12 MB.
- *URLs:* stored paths (`images/products/x.jpg`) are mapped explicitly to `/images/products/x.jpg` (`productImageSource`). Anything else is not rendered, except https URLs (admin-entered), which are shown unoptimised.
- *Rendering:* `next/image` with `fill` in fixed square boxes, `sizes` hints (cards ≤ 180 px, product page ≤ 500 px), alt text = product name, the first four cards and the product photo `preload`ed, the rest lazy. Rating images have their value as alt text.
- *Optimiser:* limited to `/images/**` with no query strings and no remote hosts. Device sizes are capped at 1080 because the sources are 720 px.
- *Verified* in production (`next start`) and development (`next dev`): files are served byte-identical, `/_next/image` returns WebP (7.5 kB vs the original), and the optimiser refuses query variants, remote URLs and paths outside `/images`.

**When to move images to object storage or a CDN.** Move them once any of these holds:
- admins upload images instead of typing paths;
- the catalogue grows beyond a few hundred images, or git and deploy size becomes a burden (images are in the repository now);
- images must change without a frontend deploy;
- the Vite and Next.js apps (or other clients) must share one copy;
- Vercel image-optimisation usage or cost becomes significant.

Then use a bucket such as S3 or R2 behind a CDN, store absolute URLs, and allow exactly that host in `images.remotePatterns`.

**Behaviour differences from the Vite app (intentional unless noted)**
1. **Search:**
   - Search is submitted, through the URL (`?q=`): shareable, server-rendered, works without JavaScript. Vite filtered live as you typed, from Redux.
   - Category filters are new.
2. **Unknown URLs and missing products** answer 404. Vite showed the home page for unknown URLs and answered 200 "Product not found" for missing products.
3. **Registration does not sign you in**; you sign in next. Vite stored a JWT and signed in immediately.
4. **Authentication is the cookie session.** It needs `AUTH_COOKIE_SESSIONS=true` and users on PostgreSQL. The Vite app keeps its bearer token.
5. **Header:** no cart, orders or admin links yet (next stage). The account page is new.
6. **Add to Cart** needs a cookie session and therefore PostgreSQL carts, and only confirms ("Added N to your cart"); there is no cart page yet.
7. **Catalogue freshness:** public pages may show data up to 60 s old after an admin edit. Vite fetched live.
8. **Product page:** empty description sections are hidden; the image is optimised (WebP, responsive).

**Tests and verification for 5D:**
- *Next.js unit and component tests: 143 in total.* Catalogue rules: 26. Pages: 14, covering home, search, filters, the product page, JSON-LD escaping, metadata and 404s. Auth, account and cart controls: 24, covering sign-in, safe return paths, registration with every error class, header state, sign-out, session expiry, account guard, sign-out everywhere, add to cart, quantities, keyboard reachability and storage checks. The proxy, environment and client tests cover the rest.
- *Pages end to end:* `npm run test:pages`, **35/35**. It runs real `next start` and `next dev`, the compiled Express API, and throwaway PostgreSQL with real images. It covers SSR content, preload and lazy loading, search and filters, `noindex`, canonical, Open Graph and JSON-LD, real 404s, static and optimised images in both modes, optimiser refusals, unused images absent, register → 307 guard → sign in → account → sign out → 307, no live session left, per-client rate limiting through the proxy (and no bypass with spoofed headers), and a rejected origin answered with 403.
- *Proxy end to end:* `npm run test:e2e`, 52/52, now on the shared helpers in `scripts/e2e-support.mjs`.
- **Browser automation is not available in this environment.** Visual, responsive and real-browser checks, including keyboard use in a browser, are **pending a manual pass**. The component tests cover labels, roles, focus order and Enter activation; the e2e runs cover HTTP behaviour.

#### 5E — Customer cart, checkout and order history (local, not pushed)

| Route/surface | Rendering and ownership | Behaviour |
| --- | --- | --- |
| Header + cart drawer | Client Components backed by the cookie session and user-scoped TanStack Query keys | Responsive account/cart/order navigation; backend-derived item count and totals; signed-out users never receive another user's cached data |
| `/cart` | Server session guard + Client Component | Quantity 1–10, remove item, choose delivery option, authoritative totals, and unavailable products remain visible and block checkout until removed |
| `/checkout` | Server session guard + Client Component; Redux stores only the details/review presentation step | Validated customer details, review step, authoritative cart summary, double-submit protection, and an explicit statement that no payment provider is integrated and no charge is made |
| `/orders` | Server guard + Client Component | Signed-in customer's orders only, newest first, with status and totals |
| `/orders/[id]` | Server Component ownership check + hydrated Client Component | Malformed, unknown and another user's ids return a real 404; stored product snapshots and prices are used, never current catalogue prices for new orders |

**Architecture and security**
- Cart and order data stays in TanStack Query, keyed by user id. Redux contains only ephemeral UI state (drawer/menu, notice and checkout step). Sign-in, sign-out and a client-side 401 clear user-scoped data before a safe login redirect.
- Every cart and order response is private and non-cacheable (`Cache-Control: private, no-store, max-age=0`, `Pragma: no-cache`, `Vary: Cookie, Authorization`). The Next proxy forwards that cache policy.
- Checkout still requires the cookie session and CSRF token. It additionally sends a UUID `Idempotency-Key`. Migration `0006_checkout_idempotency` adds a nullable, immutable per-user checkout key; PostgreSQL checks it before and after locking the user's cart, so simultaneous requests and later retries return one order. Existing orders are unchanged. MongoDB compatibility is preserved and ignores the optional key.
- Controller errors log their internal cause on the server and return a generic 500 to the browser. Backend authorization remains authoritative; client route guards are navigation assistance, not access control.

**Compatibility and changed-file inventory**

| Area | Kept / changed / rejected |
| --- | --- |
| Legacy Vite app | **Kept unchanged.** Its bearer-token requests and API bodies remain compatible. No route, dependency or asset was changed. |
| Express API | Cart/order cache middleware, safe errors, optional checkout idempotency header, repository support and migration 0006. Existing response fields remain; order JSON now exposes the already-stored `status`. |
| Next.js app | New cart, checkout and order route/features; navigation, session-expiry handling, per-user query keys, proxy/header support, component tests and real-server e2e coverage. |
| `apps/web/AGENTS.md` | **Kept and tracked.** Next.js generated it to route repository work to the installed, version-matched framework documentation; it contains no secret or machine-specific path. |
| Generated output and local logs | **Rejected.** `.next`, `dist`, `.codex-run`, database dumps and environment files remain ignored/outside git. |

**Database execution and recovery (local only, 2026-10-22)**
- The pre-existing MongoDB archive was restored into an isolated container: 51/51 documents and the live per-collection `dbHash` matched.
- Before migrations 0004–0005: `pg-ecommerce-before-auth-migrations-20261022-154407.dump`, SHA-256 `B9AA55F5E4174CADEF4E8CE4004F1575858DA1DC1B91BFB51256526541BCBEF2`; restored with `--no-owner` into a scratch database and row counts matched.
- Before migration 0006: `pg-ecommerce-before-0006-20261022-155754.dump`, SHA-256 `3F4262A22DE452A5FEC1B3036DF9B59E2ACD6AB103EF1DD9165E0511AFC5FB3E`; scratch restore counts matched. All six migrations are applied locally and a repeat migration run is a no-op. No production database was contacted.

**Tests and verification for 5E**
- PostgreSQL suite: **255/255**, including malformed keys, three simultaneous same-key requests, later retry, per-user key scope, private-cache headers and migrations 0001–0006.
- Next.js unit/component suite: **148/148**, including deleted products, quantity limits, CSRF, checkout review/idempotency/no-payment wording, snapshot prices, session expiry, keyboard focus and proxy header forwarding.
- Pages e2e: **46/46** against real compiled Express + `next start` + throwaway PostgreSQL: two-user isolation, direct guarded routes, cart checkout, three simultaneous retries producing one order, ownership 404s, stored snapshots and private-cache headers.
- Proxy e2e remains **52/52**; legacy Vite remains **47/47** plus typecheck, lint and build. Backend MongoDB unit suite remains **211 passed, 9 todo**. Typechecks, lints, builds and package audits are clean.
- A real-browser visual pass is still pending. Windows browser control stopped before inspection because it could not establish the current Edge URL with enough confidence. Component keyboard tests and real-server HTTP e2e passed, but they are not a substitute for desktop/mobile visual and screen-reader checks.

#### 5F — Parity verification, checkout idempotency and real-browser testing (2026-10-22, local, not pushed)

5E (`e816bd7`, `b7a32a4`, `902dea7`) was reviewed, secret-scanned (no credentials, customer data, dumps, logs or generated output), verified with the full baseline and **pushed without force** (`aad3125..902dea7`). `main`, `migration/postgres` and `backup/wip-ts-postgres-2026-10-21` were not touched.

**Feature-parity matrix (Vite → Next.js)**

| Area | Vite | Next.js | Status |
| --- | --- | --- | --- |
| Home / catalogue grid | `/`, client fetch, all products | `/` and `/products`, server-rendered, 60 s cache | Complete |
| Search | live filter from Redux, name/description/category/keywords | `?q=` (same matching), shareable, no-JS, box shows the current query (fixed in 5F), back/forward restore it | Intentionally changed (URL-based) |
| Category filter | — | `?category=` chips | New |
| Product details | `/products/:id`, 200 "Product not found" | `/products/[id]`, metadata, JSON-LD, real 404 | Complete (404 intentionally changed) |
| Images | `public/images` | 35 product + 11 rating images, `next/image`; all decode in Chromium, Firefox, WebKit (browser suite) | Complete |
| Login / registration | bearer JWT, `location.state` return path | cookie session, `?from=` validated; register then sign in | Intentionally changed |
| Return path after sign-in | path + search | path + search (header links and session expiry now keep the query; fixed in 5F); foreign/sign-in paths ignored | Complete |
| Header | name, cart count, orders, admin, logout; mobile menu | account, cart count, preview drawer, checkout, orders, sign out; mobile menu closes on Escape/navigation (5F) | Complete (admin link added in 5G) |
| Cart / checkout review | `/checkout` (quantities, delivery, summary) | `/cart` + drawer | Complete |
| Customer details + place order | `/order-confirmation` | `/checkout` two-step review, idempotent; `/order-confirmation` → 307 `/checkout` | Intentionally changed |
| Unavailable (deleted) products | blocks confirmation; `/product-unavailable` after Buy again | stays visible, blocks checkout; Buy again explains inline; `/product-unavailable` → 307 `/orders` | Intentionally changed |
| Orders list | all lines, Buy again, Track package | same, plus View order; Buy again and Track package **added in 5F** | Complete |
| Order details | — | `/orders/[id]`, owner only, snapshots, status | New |
| Tracking | `/tracking?orderId&productId`, time-based stages | same URL, owner-checked server page, real 404, Vite stage rules + recorded status (cancelled/shipped/delivered) — **added in 5F** | Complete |
| Historical orders | product or "no longer available" | stored snapshot name/price; legacy lines "Product information unavailable" (browser-tested) | Complete |
| Session expiry / 401 | notice + login with return path | same, from client 401s and server guards | Complete |
| Cross-tab sign-in/out | `storage` event | `BroadcastChannel` (one channel per tab, no user data in the message) — **added in 5F** | Complete |
| Unknown URL | renders home | 404 page | Intentionally changed (approved) |
| Admin (products CRUD, all orders) | `/admin` | `/admin`, `/admin/products`, `/admin/orders` — **migrated in 5G** | Complete (see 5G) |
| Admin viewing `/orders` | admin tab | "Your orders" shows only the admin's own orders (`?scope=own`, 5G); every order is in `/admin/orders` | Complete |
| Desktop width | grid fills up to 8 columns | content capped at 1024 px (`max-w-5xl`), 5 columns | Partial — visual, left to Phase 6 (spec §2.3) |
| Dates | browser time zone | fixed store zone `Europe/London` on server and client (hydration-safe) | Intentionally changed |

**Parity and quality fixes in 5F (Next.js)**
- Header search shows the active query; sign-in/register links and the session-expiry redirect keep the full path and query.
- Orders: Buy again (deleted product → inline message), Track package; `/tracking` page; legacy route redirects (307 while Vite is live).
- Cross-tab identity changes clear user data, re-check the session and re-run server guards.
- Cart drawer: focus moves in, Tab is trapped, Escape closes, page scroll locked, focus returns to the opener (Safari included: the opener focuses itself on click). Backdrop is no longer a second unlabeled tab stop.
- **Bugs found by the real browsers:** (1) WebKit hydration errors — data detectors rewrote numbers/dates (`formatDetection` meta added) and the header's Suspense boundary could hydrate after the session had loaded (`useHydrated`); (2) a cart/order action clicked before the session check finished was treated as an expired session (`requireCsrfToken` now waits for the check); (3) a cart change during the first payment-summary load left the old summary in place, blocking checkout (`refetchAfterWrite` cancels in-flight reads before invalidating); (4) mobile order/cart images stretched to full width (thumbnails capped).
- `robots.txt` (private pages and `/api/` disallowed) and `sitemap.xml` (catalogue; absolute URLs only when `NEXT_PUBLIC_SITE_URL` is set at build time).
- **Security update:** `next` and `eslint-config-next` 16.4.0 → **16.4.2** (critical GHSA-2464-fhr4-w9xw image-optimiser RCE with SVG; GHSA-p3m5-59mp-jv5r Server Actions DoS; Next 16.4.0 refused to build). 16.4.2 is 7 days old — an exception to the 14-day rule for a critical fix. The app serves no SVG through the optimiser (`localPatterns` `/images/**`, no remote hosts).

**Checkout idempotency (Part C)**
- Scope: `orders.checkout_key` is unique per `(user_id, key)` and used only by `POST /api/orders` (operation scope). Another user's identical key is independent.
- Same key + same details (after the server's normalisation: trim, lower-case email) → the original order (201), including simultaneous requests (serialised by the cart row lock, re-checked after the lock) and late retries after the cart was refilled (the new cart is left alone).
- **Same key + different details → `422`**, nothing written (new in 5F; no migration: the stored customer columns are the request body).
- Interrupted before commit: everything (order, lines, status event, cart clear, key) is one transaction; a failure stores nothing, the cart is intact and the same key succeeds on retry (tested with an injected failure).
- Errors (`empty`, `unavailable`, `invalid-delivery`, `insufficient-stock`, 500) never store a key, so they are never replayed as successes.
- Client: one key per reviewed set of details; retries reuse it, edited details get a new one (safe because a completed attempt already emptied the cart); after a failed attempt and an emptied cart the page points to Orders. Each new checkout visit starts a new key.
- Retention: keys live as long as their order (immutable column, no expiry, no cleanup job). Storage cost is one UUID per order; a time-limited window can be added later by a `checkout_key_expires_at` policy if needed. MongoDB orders ignore the header (legacy path).

**Real-browser testing (Part D)** — `npm run test:browser` (Playwright 1.64.0, `@axe-core/playwright` 4.13.0)
- Isolated browsers launched by Playwright against a throwaway stack (`browser/stack.mjs`: PostgreSQL container, compiled Express, `next start`); no existing browser window or development database is touched. Browsers set to `America/Los_Angeles` on purpose to catch date-hydration mismatches.
- Projects: Chromium 1366×900, Chromium tablet 820×1180 (touch), Pixel 7, Firefox 1366×900, WebKit 1366×900, iPhone 14.
- Covered: images decode, no console/hydration errors, search/filters/back, product + 404s, legacy redirects, registration validation and labels, safe return paths, sign-out and guards, keyboard order and focus rings, cart drawer focus handling, full checkout with native validation, order confirmation, Buy again, tracking, deleted products blocking checkout, idle-expired session, cross-account privacy in one browser, cross-tab sign-out, historical/legacy orders, no horizontal scroll, axe (WCAG 2.0/2.1 A/AA), CLS (Chromium).
- Result: **92 passed, 0 failed, 0 flaky, 10 skipped** (skips are deliberate: axe on one engine per layout family, Layout Instability API Chromium-only, WebKit does not Tab to links by default, cross-tab on desktop only).
- axe: **0 violations of any impact** on 12 pages × 4 engine/layouts. Measured home-page CLS ≤ 0.0007; 172.7 KiB encoded script (local `next start`, no throttling — not a field benchmark).
- Screenshots (12 per project) in `apps/web/test-results/screenshots/<project>/` (ignored by git).
- Firefox: during development, Playwright's Firefox intermittently stopped issuing requests after an action and once failed closing a context (Juggler protocol error); not seen in Chromium/WebKit and not reproduced by a timer-throttling experiment. The project has `retries: 1` so any recurrence is reported as *flaky*; the final run had none. Root cause not established — include Firefox in the manual pass.
- Automated checks do **not** replace a screen-reader test. Manual checklist (still to do): NVDA + Firefox and VoiceOver + iOS Safari on sign-in, add to cart, cart drawer, checkout errors, order confirmation and tracking; 200 % zoom; Windows high contrast.

**Performance and security review (Part E)**
- Server/client boundaries: catalogue, product, tracking and guards are Server Components; 17 client components are interactive islands (forms, header session area, cart, checkout, orders). Duplicate fetching: none found beyond the deliberate server guard + client query on private pages (the guard only checks the session).
- Caching: authenticated HTML answers `private, no-cache, no-store` (Next dynamic rendering; checked for `/account`, `/cart`, `/checkout`, `/orders`, `/orders/[id]`, `/tracking`), and private API responses `private, no-store` with `Vary: Cookie, Authorization` (pages e2e).
- Cookies, CSRF, Origin checks, redirect validation and the proxy allow-lists are unchanged from 5B–5E and still covered by the 52-check proxy e2e. No session token or private data in URLs, storage, Redux, logs or the BroadcastChannel message.
- Query cache: cleared on sign-in, sign-out, 401 and cross-tab identity changes.
- Remaining items: field validation errors are not yet linked per field (`aria-describedby`) on sign-in/registration; header shows the full nav only from 1280 px; copy uses internal terms ("Stored total", "Authoritative total") — all scheduled in the Phase 6 spec.

**Tests and verification for 5F (final run, 2026-10-22)**
- Backend MongoDB suite **211 passed, 9 todo**; PostgreSQL suite **260/260** (+5: key reuse 422, normalised replay, late retry with refilled cart, fresh key, interrupted transaction); mutation check: removing the payload comparison fails the 422 test.
- Next.js unit/component **168/168** (+20); mutation checks for the hydration guard and the in-flight refetch fix. Proxy e2e **52/52**; pages e2e **60/60** (+14: tracking ownership, private-page caching, legacy redirects, robots, sitemap, key reuse 422); browser suite as above.
- Vite **47/47**, typecheck, lint, build. Typecheck, lint, builds and `npm audit` (0) clean in all three packages.

**Phase 6 proposal:** [`docs/PHASE6_REDESIGN_SPEC.md`](docs/PHASE6_REDESIGN_SPEC.md) — tokens, type scale, components, duplication to remove, page-by-page tasks, accessibility and responsive acceptance criteria. Not implemented.

#### 5G — Admin dashboard and accessibility fixes (2026-10-22, local, not pushed)

5F (`ff4564e`…`11ba8ce`) was re-verified (baseline suites, secret scan) and **pushed without force** (`902dea7..11ba8ce`). Other branches untouched.

**Admin area (`apps/web/src/app/admin`, `src/features/admin`, `src/lib/server/admin.ts`)**

| Route | What it does |
| --- | --- |
| `/admin` | Live dashboard: products and categories, orders by status (links to filtered lists), recorded order value without cancelled orders, last 30 days, five most recent orders. Values are recorded totals — no payment provider, stated on the page. |
| `/admin/products` | List with filter (name, description, category, keywords), image, price, stock and keywords; Edit; Delete with an in-page confirmation (`alertdialog`, focus managed; replaces Vite's `window.confirm`). |
| `/admin/products/new`, `/admin/products/[id]` | One form for all fields: name, category, price, stock, image path (with preview), description, how it works, care, highlights and **search keywords**; per-field validation matching Express, errors linked to fields. |
| `/admin/orders` | Every order (admin view), filter by status (including legacy orders without a status). |
| `/admin/orders/[id]` | Fixed financial record (total, items, prices when ordered, customer), status change form offering only allowed transitions with a **required reason**, and the **audit history** (who, when, why). |

- **Authorisation:** each admin page checks the session and role on the server for every request (the layout and every page — a layout is not re-run on client navigation). Signed out → 307 to sign-in with the return path; signed in without the role → 404 (the area is not advertised). Express enforces `protect` + `adminOnly` on every admin API call (403), and PostgreSQL enforces the transitions, the reason and the append-only history. The UI copies of these rules only decide what is offered.
- **No admin data in shared caches or the browser cache:** admin pages render per request with the session cookie (`no-store`); admin API responses (`/orders`, `/orders/:id/status-events`, product writes) send `private, no-store`. Admin data is never put in the TanStack Query cache: Server Components load it, client components only send writes and refresh the page.
- **Catalogue freshness:** a successful product write through the proxy calls `revalidateTag("catalog", { expire: 0 })`, so the storefront shows new, changed and deleted products at once (was up to 60 s).
- **No new dependencies.**

**Express changes (backwards compatible with the Vite app)**
1. **Bug fixed — search keywords were lost on every edit.** Create/update always set `keywords` to `[category]`, wiping curated keywords (Vite admin too). Now `keywords` is an optional field (array or comma-separated; trimmed, lower-case, unique, at most 20 of 40 characters). An update without it keeps the stored keywords; a create without it uses the category, as before. *Intentional API difference:* client-supplied keywords are no longer ignored.
2. `GET /api/orders?scope=own` and `GET /api/orders/:id?scope=own` limit an admin to their own orders (the customer pages use it, so "Your orders" is personal). Without `scope` nothing changes (the Vite admin still lists every order); a customer cannot widen the scope.
3. New `GET /api/orders/:orderId/status-events` (admin only, private): the append-only audit trail, oldest first, with the changing user's name. MongoDB orders answer 501 (no status model).
4. Product write responses are `private, no-store`.

**Accessibility (Task 3)**
- Sign-in and registration: one error per field, linked with `aria-describedby`, `aria-invalid` set, focus moved to the first problem; rejected credentials are linked to both fields; "already registered" (409) is reported on Email. Admin forms follow the same pattern.
- Customer wording: "Authoritative total" → "Order summary", "Stored total" → "Order total", "Saved unit price" → "Price paid … each", "Historical …" → "Image not available" / "Price paid not recorded" / "Product details not recorded", legacy status → "not recorded (older order)".
- Found and fixed by the new browser checks: `/account` overflowed by 10 px at 320 px (sub-navigation did not wrap); in Windows high-contrast (forced colours) mode, filled buttons and the header search field lost their boundary (global forced-colours border rule).
- Verified automatically: keyboard and focus (existing suite), cart drawer focus handling unchanged and still tested, 200 % zoom (683 px) and 320 px reflow on six customer pages, forced-colours borders on four pages, axe on admin dashboard, product form and order pages (0 serious/critical).
- **Not performed:** screen-reader testing. Checklist: [`docs/ACCESSIBILITY_MANUAL_CHECKLIST.md`](docs/ACCESSIBILITY_MANUAL_CHECKLIST.md) (NVDA + Firefox/Chrome, VoiceOver + iOS Safari, zoom, contrast themes, text spacing).

**Tests and verification for 5G (final run, 2026-10-22)**
- Backend MongoDB **212 passed, 9 todo** (+1; two baseline tests updated for the keyword fix); PostgreSQL **264/264** (+4: keywords kept/replaced/validated, private product writes, `scope=own` for lists and single orders, audit-trail access and append-only).
- Next.js unit/component **186/186** (+18: admin rules, server guard on every admin page, product form create/edit/validation, confirmed delete, status form, linked form errors, late session expiry on the sign-in page).
- Pages e2e **81/81** (+21: admin pages 200/no-store/noindex, customer 403/404, catalogue refreshed after create/edit/delete, keywords kept on edit, 400/409/200 status changes with audit, `scope=own`).
- Proxy e2e **52/52**. Vite **47/47**; typecheck, lint, builds and `npm audit` 0 in all three packages. Checkout and session code unchanged in 5G (checkout: wording only); idempotency and session tests pass in the PostgreSQL and proxy suites.
- Browser suite (6 projects; new: admin lifecycle, status change and history, role guard, reflow, forced colours), two full runs on the final build:
  - run 1: 112 passed, **1 failed** (WebKit mobile, catalogue search — rendering stall, see below), 1 flaky (Firefox), 18 skipped;
  - run 2: **113 passed, 0 failed, 1 flaky** (Firefox), 18 skipped.
- **Bug found and fixed (cross-tab sign-out):** signing out in one tab could send the other tab to `/login?from=%2F` instead of `/login?from=%2Forders`. The server guard had already redirected that tab to sign in; a late 401 from its cart query then fired the session-expired handler, which read `/login` as the current page and reset the return path to `/`. `SessionExpiryWatcher` now leaves a tab that is already on a sign-in page where it is (it still ends the local session and shows the notice); unit test added. Stress after the fix: 44/45 across all projects and 28/30 in Firefox — none of the failures was this bug (all were the Firefox stall below).
- **Open — browser stalls under load (not fixed, root cause not found):** in roughly one in five to fifteen runs of a test, Firefox stops making progress: an `/api/auth/session` response reaches the network layer (200) but its body never reaches the page and no further requests follow, or a `page.evaluate`/locator lookup never returns. Seen in different tests (admin lifecycle, cross-tab sign-out, axe page scan); never in Chromium (0 in 15 repeats per project). WebKit mobile stalled once (a link found but never "stable" — no animation frames) and passed 20/20 in isolation. Firefox admin lifecycle passed 25/25 in isolation with retries off. No timeout was raised; the Firefox retry from 5F stays. Treat Firefox and WebKit as needing the manual pass.

**Remaining gaps after 5G**
- Parity: none functional. Visual: desktop content width (Phase 6, P8). The admin order list is not paginated (every order loads; fine at current volume — add server pagination before order counts grow). Inventory tracking (`inventory_tracked`) is not exposed in the API or the admin UI.
- Accessibility: screen-reader pass not done; checkout uses the browser's native validation messages (announced, not styled per field); admin pages were checked on mobile screenshots but are not in the 320 px automated reflow test.
- Browser tests: intermittent Firefox (and once WebKit) stalls under full-suite load, described above; one retry stays configured for Firefox only.

#### Remaining Phase 5 work (awaiting approval)

- [x] Review and push the 5E commits (done in 5F, without force).
- [x] Review and push the 5F commits (done in 5G, without force).
- [x] Review and push the 5G commits (pushed 2026-10-22 22:08, `11ba8ce..24e498e`, per the local reflog).
- [ ] Manual pass: `docs/ACCESSIBILITY_MANUAL_CHECKLIST.md` (screen readers, zoom, contrast themes).
- [x] Admin migration (5G). Retire the Vite-only redirects when the Vite app is switched off (Phase 7).
- [ ] Before any deployment: the Render settings `TRUST_PROXY_HOPS` and `PROXY_CLIENT_IP_SECRET`, and on Vercel `BACKEND_ORIGIN`, `TRUSTED_CLIENT_IP_HEADER`, `PROXY_CLIENT_IP_SECRET` and `NEXT_PUBLIC_SITE_URL` (documented, not applied); then a preview deployment as a **new** Vercel project.

**Acceptance (5C/5D/5E):** met locally except for the explicitly manual visual/browser pass.
- Backend: MongoDB suite 211 + 9 todo, PostgreSQL suite 255.
- Next.js: 148 unit and component tests, 46 pages e2e and 52 proxy e2e checks.
- Vite: 47 tests, plus the read-only smoke run.
- Typecheck, lint, builds, and `npm audit` 0 in every package.

**Rollback:**
- Revert the Phase 5 commits. The Vite app was not modified.
- Migration 0005 has a down file.
- Turning rate limits off (`AUTH_RATE_LIMIT=false`) is possible only outside production.

### Phase 6 — shadcn/ui (after parity, component by component)

Owner decisions P1–P8 approved 2026-10-22 (spec §0).

- [x] **6A — design system and shared UI (2026-10-23, local, not pushed):** tokens (`--primary` `#16794a`), Inter, `cn()`, shadcn-style `ui/` components, 1280 px `Container`, restyled header and mobile menu, new footer, product card/grid, `Price`, `QuantitySelector`, skip link. What was built, deviations and results: spec §8. Final checks: unit 186/186, proxy e2e 52/52, pages e2e 81/81, browser run 2 121 passed / 0 failed / 0 flaky / 23 skipped (run 1 had 2 failures from the known Firefox/WebKit stalls; re-run in isolation passed).
- [x] **6B — home, catalogue with sorting, product details (2026-10-23, local, not pushed):** 6A pushed first without force (`24e498e..1506b1a`). Pages, components reused, sorting rules and deviations: spec §9. Only `apps/web` changed (no backend, API contract, Vite or dependency changes), so the backend (MongoDB 212 + 9 todo, PostgreSQL 264) and Vite (47) suites were not re-run; their last results are 5G.
  - Checks on the final build: typecheck, lint, build, `npm audit` 0; unit/component **205/205** (+19); proxy e2e **52/52**; pages e2e **92/92** (+11).
  - Bugs found by the new checks and fixed before commit: the legacy `/?q=` redirect answered **200** (the home route streams behind its loading skeleton, so a page-level `redirect()` arrived too late) → moved to `next.config.ts` redirects (307); the home metadata fetched the catalogue at build time (build failed without a backend) → reads the request first, as `/products` does.
  - Test fixes, not app changes: the sort browser test never focused the select (Playwright's `selectOption` does not move focus) — with focus first, focus stays on the control after each sort in all six projects; a focus-restoring workaround written for a suspected remount was removed again after a real-browser check showed no remount. WebKit on iPhone skipped lazy images when the test jumped to the page end (5 images at 1,375–2,015 px on the 3,484 px home page, confirmed by a diagnostic) → the test now scrolls through the page.
  - Browser suite runs (6 projects): run 1 **invalid** (the PC slept for about 8 hours mid-run; stopped, its throwaway container removed; it showed the sort-test focus failure in Chromium, fixed above); run 2: 128 passed, **2 failed** (Firefox public/private axe test over the 90 s limit; WebKit-mobile lazy images, fixed above), 26 skipped; run 3 (final): **132 passed, 1 failed, 1 flaky, 28 skipped** — Firefox account flow failed twice (no navigation after "Create account"; then `page.goto("/account")` never returned) and Firefox public-pages axe flaky (`page.goto` never returned).
  - **Firefox stall investigation:** the trace of the hung `goto("/account")` shows the server answered at once (307, then `/login?from=%2Faccount` 200 in 4 ms, and every prefetch 200) but Firefox never reported the load event — the stall is in the browser/automation layer, not the app or server. Each axe call costs ~2 s in Firefox even for a single trivial rule (per-rule timing), so the 13-page axe test was close to the limit by construction; it is now two tests (public, signed in) with per-page timings recorded as annotations. **Firefox alone (whole project, retries off) passed 22/22 with 1 worker and 22/22 with 3 workers**; every Firefox stall seen in 5G–6B happened while Chromium and WebKit ran at the same time. Recommendation: run the Firefox project as its own step (CI or locally) before release; timeouts were not raised and the single Firefox retry is unchanged. Still a **pre-release risk** until confirmed on another machine/CI.
- [x] **6C — cart drawer, cart, checkout, orders and tracking (2026-10-23, local, not pushed):** the six 6B commits were pushed first without force (`1506b1a..bd87ee9`); the final 6B browser result stays as recorded above (132 passed, 1 failed, 1 flaky, 28 skipped — both Firefox navigation stalls). What was built, components, duplication removed and decisions: spec §10. Only `apps/web` changed; no API contract, backend, Redux shape or query key changed.
  - Checks on the final build: typecheck, lint, build; `npm audit` 0 in web, backend and Vite; unit/component **220/220** (+15); proxy e2e **52/52**; pages e2e **92/92**; backend MongoDB **212 passed, 9 todo**, PostgreSQL **264/264** (auth, transactional checkout, idempotency — re-run although nothing there changed); Vite **47/47** with typecheck, lint and build.
  - Browser suite, **Firefox run separately from Chromium and WebKit** (Part G). Final: Chromium + WebKit **120 passed, 0 failed, 0 flaky, 25 skipped**; Firefox alone **23 passed, 0 failed, 0 flaky, 6 skipped**. Earlier 6C runs: run A (Chromium + WebKit) 117 passed, **3 failed**, 25 skipped; run A2 120 passed, 0 failed; run B (Firefox) 22 passed, **1 flaky**, 6 skipped. Traces and logs of every run were copied aside before the next one (local scratch folder, not committed).
  - Failures and what they were: (1) Chromium desktop `net::ERR_NETWORK_IO_SUSPENDED` and (2) Chromium tablet "Failed to fetch" — **the PC went to sleep at 12:36:07 during run A** (Windows System log: Kernel-Power 42, resumed 107 a second later); environmental. Later runs held a temporary keep-awake request (process-scoped `SetThreadExecutionState`, no power setting changed) and logged no sleep. (3) Chromium mobile, forced colours: a native radio reported no author border — native radios are drawn by the system in forced colours (screenshot checked); the check now exempts radios/checkboxes but requires them to be displayed. **Application bug found:** run B's Firefox flake was an 11 px horizontal overflow on order details caused by a long email (fixed; spec §10).
  - **Stall investigation, new evidence (not a resolution):** with three parallel Chromium workers, `GET /api/auth/session` took 2–12 s and the next `GET /api/cart-items` never answered in 3 of 5 repeats of one test; **serially 5/5 passed**. Reproduced at API level against the same throwaway stack with 1, 3 and 6 concurrent customers (register, sign in, add, order, add, session, cart, summary; then also with 30 cold image-optimiser requests each): **no stall** — session/cart/summary stayed at 13–104 ms. Register and sign-in scale with concurrency: **bcryptjs (pure JavaScript, cost 12) costs 335 ms of event-loop time per hash** on this machine and delayed a 10 ms timer by up to 394 ms while four hashes ran. This slows every request while accounts are created in parallel, but does not explain a 12 s answer after all hashing has finished. The remaining stalls are therefore still unexplained and are seen in the browser/automation layer under parallel load — now in Chromium as well as Firefox. Timeouts and retries are unchanged.
  - **Reproducing on an isolated machine or CI runner:** (a) a runner that cannot sleep, with nothing else running; (b) `npx playwright test --project=firefox-desktop` and, separately, the Chromium + WebKit projects, each `--repeat-each=3` with `--retries=0`, then the same with `--workers=1`; (c) on any failure keep `test-results/browser/**/trace.zip` (network and action timings) and the stack's Express/Next logs; (d) note whether account creation was running at the same moment (bcrypt load) — `browser/stack.mjs` could later use a lower test-only cost or native `bcrypt` to rule it out (backend change, not made in 6C).
- [x] **6D — sign-in, registration, account and admin (2026-10-23, local, not pushed):** the six 6C commits were pushed first without force (`bd87ee9..6c50155`); other branches untouched. Pages, components and decisions: spec §11. Only `apps/web` changed; no authentication backend, session, CSRF, rate-limit or role logic changed.
  - Checks on the final build: typecheck, lint, build; `npm audit` 0 in web, backend and Vite; unit/component **232/232** (+12); proxy e2e **52/52**; pages e2e **92/92**; backend MongoDB **212 passed, 9 todo**, PostgreSQL **264/264** (sessions, CSRF, role checks, transactional checkout and idempotency); Vite **47/47** with typecheck, lint and build. Cart isolation, session expiry and cross-tab sign-out are covered by the browser session-privacy spec, which passed in every final run.
  - Browser suite, Firefox as its own step: **final** Chromium + WebKit **133 passed, 0 failed, 0 flaky, 27 skipped**; Firefox **24 passed, 0 failed, 1 flaky, 7 skipped**. First 6D pair: Chromium + WebKit 128 passed, **5 failed**, 27 skipped; Firefox 24 passed, 1 flaky, 7 skipped.
  - Failures and flakes, classified: **test bug** — a new test built an email from a label with a space (3 Chromium failures); **application bug** (fixed) — in WebKit the dialog could not return focus to its opener because Safari does not focus a clicked button (2 failures); **suspected client/automation timing** — Firefox logged the catalogue error boundary after two aborted RSC prefetches while the test navigated away (every server response in the trace was 200/404 within 200 ms; passed on retry); **load** — the Firefox public-pages axe scan finished its last step at 90.2 s, just over the 90 s limit (no request or call was hanging; passed on retry). Timeouts and retries unchanged.
  - **Stall investigation, Part H:** machine: Intel i5-4590, **4 logical CPUs**, 15.9 GB RAM with 25.2 of 29.8 GB committed before the suite (other desktop apps and the Docker VM running). A 5-second sampler during the runs measured **mean CPU 91 % (Chromium + WebKit) and 80–89 % (Firefox alone); 57–83 % of samples at ≥ 95 %; free memory down to 1.6 GB**, against 10–17 % CPU and 4.5–4.8 GB free outside the runs; up to 43 browser processes. **No sleep events** during any 6D run (keep-awake request held; Windows System log checked). Together with 6C (serial 5/5 vs parallel 2/5 for the same test; no stall at API level with 6 concurrent customers), CPU saturation from parallel browsers on 4 cores is the strongest measured contributor — still not a proven root cause, and one clean pair of runs does not retire the risk.
  - Recommended next checks (not done): the same suite on an 8-core CI runner with nothing else running; the Chromium + WebKit step with `--workers=2` and `--workers=1` for comparison; keep the trace, the load CSV and the stack logs for any failure.
- [x] 6.1 shadcn/ui set up by hand in `apps/web` (not `npx shadcn init`; reason in spec §8); brand colours mapped to CSS variables
- [ ] 6.2 Replace `utils/tailwindClasses.ts` usages with `Button`, `Select`, `Input`, `Label`, `Card`, `Dialog` (admin delete confirm replaces `window.confirm`), `Tabs` (admin), `Sheet` (mobile menu), `Sonner` toasts (added-to-cart)
- [ ] 6.3 One page per commit; visual check at 375 px and 1280 px after each

**Acceptance:** no visual regressions in the §2 checklist; accessibility of forms equal or better.

### Phase 7 — Cutover and cleanup

- [x] **7A — CI, security review and release readiness (2026-10-23 – 2026-10-24; commits local and on the CI branch only):** the five 6D commits were pushed first without force (`6c50155..80c8ff4`). With the owner's approval, the 7A commits were pushed **only** to the new branch `ci/phase7a-verification` (never merged; `origin/phase5/nextjs-foundation` stays at `80c8ff4`; `main`, `migration/postgres` and the backup branches untouched). Nothing deployed; no production database, setting or secret touched; cookie sessions stay refused in production. Reports: `docs/RELEASE_READINESS.md` (verdict **NO-GO**, release-readiness table §0), `docs/CI.md`, `docs/PHASE7B_STAGING_PLAN.md` (proposal), `docs/SCREEN_READER_TEST_GUIDE.md`.
  - **Commits** (`80c8ff4..753f00b`): `0fde38c` per-test timings, launch probe, run summary, 1024/1280 reflow; `b174e4a` GitHub Actions (`ci.yml`, `browser.yml`); `1ced369` failure annotations, artifact actions on Node 24; `fa70e25` pinned test for the sign-in rate-limit race; `c917823`, `aa57bc9`, `96128da` (reverted in `753f00b`), `753f00b` account-flow sign-out race; `6d1f2f4` date-format browser test; `fce094d` cached, split and bounded browser install; `c5056fd` **body-parser 1.20.9** (GHSA-27r3-jxmh-p828, high; lockfile only); `73ddf7c` **hydration fix** for order pages in Linux WebKit. Pushes to the CI branch (all without force): new branch at `b174e4a`, then `..fa70e25`, `..c917823`, `..fce094d`, `..aa57bc9`, `..96128da`, `..753f00b`.
  - **Workflows** (`docs/CI.md`): `CI` — backend MongoDB, backend PostgreSQL (throwaway container), Next.js unit, Vite, typecheck + lint ×2, production builds with a client-bundle secret-name check, `npm audit --audit-level=low` ×3, proxy + page e2e (11 jobs). `Browser` — one build job, then Chromium, WebKit and Firefox each on its own runner at 1 and 2 workers (6 jobs). Actions pinned to SHAs, `contents: read`, no secrets, empty `MONGODB_URI`/`DATABASE_URL`, job timeouts.
  - **CI results** (run ids on `https://github.com/Manoj132508/Ecommerce-project/actions/runs/<id>`): CI 39998439379, 40004086017, 40008746458 success; **40084134395 failure** (backend audit: the new body-parser advisory, published that day) → `c5056fd`; 40086240138, 40088693261, **40090794609** success (11/11). Browser: 39998439611 cancelled (WebKit install hit the 45-min limit), 40004086124, 40008746470, 40084134454, 40086240119, 40088693317 failure, **40090794620 success: 7/7 jobs; Chromium 91 passed / 0 failed / 0 flaky / 8 skipped, Firefox 26/0/0/7, WebKit 47/0/0/19 — identical at 1 and 2 workers; 0 cancelled**. Per-run failures and classification: `RELEASE_READINESS.md` §5.
  - **Suite counts on `753f00b`** (local, and the CI jobs green): Next.js unit/component **235** (+3 date-format tests); backend MongoDB **212 passed, 9 todo**; PostgreSQL **265** (+1 pinned race test); Vite **47**; proxy e2e **52**; pages e2e **92**; `npm audit` 0 in all three packages.
  - **Browser findings:** (1) WebKit/Firefox CI durations of 11–45 min were the `--with-deps` install (696–2,692 s), not tests → split, bounded and cached (`fce094d`); 0–51 s per step since. (2) **Application bug, root cause confirmed before the fix:** Linux WebKit's ICU formats `Saturday 24 October 2026` where Node writes `Saturday, 24 October 2026` → React #418 on order pages; my first hypothesis (a console allow-list wording) was wrong and was not committed; the new date test named the exact strings (run 40084134454); `lib/format.ts` now builds the text from numeric Intl parts (same output as before, unit-tested 2025–2027 incl. clock changes); WebKit date and historical-order tests pass in all 6 jobs since. (3) **Test-design race:** after the header's sign-out the app runs `router.refresh()`; the following `page.goto("/account")` raced it in WebKit and Firefox. Waiting for the refresh response (`c917823`, `aa57bc9`) or `networkidle` (`96128da`, worse in Firefox) did not synchronise it; the guard check now uses a new page of the same context (`753f00b`) with the same assertion. No timeout, retry or assertion relaxed. **One clean run (40090794620) does not establish stability**; the go/no-go criterion is 3 consecutive clean runs. (4) CI runners (4 vCPU, ~13 GB free) never showed the local Firefox stalls; that is evidence of local contention, not proof.
  - **Security review** (`RELEASE_READINESS.md` §2): fixed — body-parser (High; the deployed API is very likely affected until it is redeployed), WebKit hydration (Medium). Open, each needing approval because it changes pinned API or auth behaviour: sign-in limit exceeded by simultaneous attempts (Medium; pinned by `authRateLimit.concurrent-flaw.test.ts`), raw database errors in two 500 responses (Medium), Express default HTML error pages with stack traces unless `NODE_ENV=production` (Medium), no CSP (Medium), PostgreSQL pool without timeouts / no graceful shutdown / no DB health check (Medium, reliability), `X-Powered-By` (Low), unstructured logs (Low), raw "Failed to fetch" on cart/orders (Low). Concurrency probe: 10 customers × 3 simultaneous checkouts → exactly 10 orders; key reuse with other details → 422.
  - **Production configuration audit:** `DATA_SOURCE_DELIVERY_OPTIONS|PRODUCTS|USERS|CARTS|ORDERS` are refused in production without `POSTGRES_PRODUCTION_ENABLED=true`; `AUTH_COOKIE_SESSIONS=true` is refused with `NODE_ENV=production` (`auth/config.ts:72`) — both controls kept. Consequence: the Next.js storefront cannot sign in against the production API until an approved change allows cookie sessions there. Whether Render sets `NODE_ENV=production` is not verifiable from the repository.
  - **R31 review:** rollback after writes resume is still blocked — no write-freeze maintenance mode, the reverse reconciliation is a tested proof of concept without a CLI or batching, no re-cutover plan. Production MongoDB provider unknown (no restore-tested dump).
  - **Acceptance:** CI infrastructure, security review, automated accessibility and the WebKit hydration fix **accepted**. **Not accepted yet:** browser stability (1 of 3 consecutive clean runs), the manual screen-reader pass (PENDING MANUAL), the Medium findings (owner decision). Phase 7B is **not started**.
- [ ] **7A, second pass — security fixes and staging prerequisites (2026-10-24; local commits, NOT pushed — awaiting approval):** the docs commits `62258b3`, `c1caee0` were pushed to `ci/phase7a-verification` only (`753f00b..c1caee0`, no force); its runs: CI **40094305039** 11/11 success, Browser **40094305058** 7/7 success (Chromium 91/0/0/8, Firefox 26/0/0/7, WebKit 47/0/0/19 per job, 0 flaky) — the second consecutive clean browser run on the `753f00b` application code. Nothing merged or deployed; no production database, service or setting touched; the production cookie-session guard unchanged.
  - **Commits** (`c1caee0..d5510cb`, each separately reviewable, regression tests that fail on the previous code): `99db7ab` sign-in attempts counted before the password check; `b63bdd7` fixed 500 messages for products and delivery options; `2952952` JSON 404/error handler, no stack traces in any environment, no `X-Powered-By`; `d8d99c0` PostgreSQL timeouts, `/healthz` + `/readyz`, graceful shutdown; `4549772` nonce-based CSP; `ae38316` staging-only cookie-session allowance; `94e08b9` write-freeze mode; `d5510cb` `reconcile:plan / apply / verify` CLI; `fbee7e1` sign-in/registration keep text typed before hydration (found by the browser rounds below); `0e40af7` browser harness: WebKit's refusal of Playwright's own screenshot style ignored only during `snapshot()`. Details and evidence: `docs/RELEASE_READINESS.md` §2 and §6.
  - **Suites on the release candidate** (local; backend at `d5510cb`, unchanged since; web re-run on `0e40af7`): backend MongoDB **234 passed, 9 todo** (+22); PostgreSQL **306 passed, 1 skipped** (+41; the skip is the SIGTERM end-to-end test, Linux only — verified by hand on Linux in throwaway containers: request in flight finished 200, pool closed, exit 0); Next.js unit **240** (+5); Vite **47**; proxy e2e **52**; pages e2e **92**; typecheck, lint, builds, client-bundle check; `npm audit` 0 ×3. The compiled API checked with `NODE_ENV=production`: JSON errors, no stack, no `X-Powered-By`.
  - **Browser, release candidate `d5510cb`** (local, each engine on its own as in CI, 1 worker, retries unchanged): on `d5510cb` 3 rounds: Chromium 100/0/0 each; **WebKit 9–10 failures per round** (traces kept): an application bug, text typed into sign-in/registration before hydration was lost from state (fixed `fbee7e1`, regression test fails without it), and a harness artifact, Playwright's WebKit screenshot `<style>` refused by the CSP (`0e40af7`). On **`0e40af7`: 3 consecutive clean rounds, 9/9 runs** — Chromium 103 passed / 0 failed / 0 flaky / 8 skipped, Firefox 30/0/0/7 (no retry used), WebKit 55/0/0/19 in every round; 0 sleep events. Local evidence only; CI has not run this commit.
  - **Not run on CI:** the release candidate is not pushed (no approval for application/security commits), so CI and Browser runs on `d5510cb` do not exist yet.
  - **Production MongoDB provider:** still unknown (no tracked metadata; the local `.env` points at a local MongoDB). Owner action: read the host of `MONGODB_URI` in the Render dashboard.
  - **R31:** write freeze and CLI built and tested on disposable databases; batching for production volumes, the staging rehearsal and approval remain.
- [ ] 7.1 Point the production domain at the `apps/web` Vercel project
- [ ] 7.2 After 2 weeks stable: `git rm -r ecommerce-project` (Vite) — it remains in git history and the backup branch
- [ ] 7.3 `git mv ecommerce-backend apps/api` in a rename-only commit; update backend host root dir; add root `package.json` workspaces
- [ ] 7.4 Remove hard-coded Vercel origin from CORS; move to `CLIENT_URL` only

**Rollback:** re-point the domain to the old Vercel project (kept, not deleted, for 30 days).

---

## 7. Backups — exact commands

Run from the repo root in Git Bash. Nothing here deletes data.

```bash
# 0.1 — backup branch containing the uncommitted WIP (ignored files .env/.env.postgres are NOT included)
git switch -c backup/wip-ts-postgres-2026-10-21
git add -A
git status            # review: no .env, no .env.postgres, no _recovery_backup_*
git commit -m "WIP backup: TS frontend, TanStack/Redux, Postgres scaffolding"
git push -u origin backup/wip-ts-postgres-2026-10-21

# 0.2 — tag last deployed commit
git tag -a pre-pg-migration 4e622f5 -m "Last Mongo/Vite production commit"
git push origin pre-pg-migration

# Working branch for Phase 1+
git switch -c migration/postgres
```

**Completed 2026-10-21 (local DB).** The backup is a **single gzip archive file**, not a dump directory:

| Item | Value |
| --- | --- |
| File | `C:\Users\manoj\Desktop\ecommerce-backups\mongo-ecommerce_store-2026-10-21.archive.gz` (9,450 bytes) |
| SHA-256 | `77bf72fd6ecd17015dcc689980cb8f8bb47eded2b7b6b42429fb36c17301ce26` (also in `…archive.gz.sha256`) |
| Tooling | `mongodump` 100.19.1 in `mongo:8`, source MongoDB 8.3.8 |
| Verified | `gzip -t` OK; restored into an isolated throwaway container: 51/51 documents, index counts and per-collection `dbHash` identical to live |
| Counts | products 35, orders 8, cartItems 4, deliveryOptions 3, users 1, `delivery Options` 0 |

```bash
# 0.3 — mongodump without installing tools. The URI is passed as an env var, never as an argument.
# host.docker.internal reaches the Windows host (worked even though mongod binds 127.0.0.1).
export MONGO_URI="mongodb://host.docker.internal:27017/ecommerce_store"
docker run --rm -e MONGO_URI -v "$(cd ../ecommerce-backups && pwd -W):/backup" mongo:8 \
  sh -c 'mongodump --uri "$MONGO_URI" --gzip --archive=/backup/mongo-ecommerce_store-YYYY-MM-DD.archive.gz'

# Verify: restore into a throwaway container with no published ports (never into the real DB)
docker run -d --name restore-verify mongo:8
docker run --rm --network container:restore-verify -v "$(cd ../ecommerce-backups && pwd -W):/backup:ro" mongo:8 \
  mongorestore --uri mongodb://127.0.0.1:27017 --gzip --archive=/backup/mongo-ecommerce_store-YYYY-MM-DD.archive.gz
docker exec restore-verify mongosh --quiet ecommerce_store --eval 'db.runCommand({dbHash:1}).collections'
docker rm -f restore-verify
```

```bash
# Before every ETL run and before Phase 4.6
docker compose -f ecommerce-backend/compose.yaml exec -T postgres \
  pg_dump -U ecommerce_app -d ecommerce -Fc > ../ecommerce-backups/pg-$(date +%Y%m%d-%H%M).dump
```

Backups go **outside** the repo (`../ecommerce-backups/`) so they can never be committed.

---

## 8. Global rollback summary

| Situation | Action |
| --- | --- |
| Lost or broken WIP | `git switch backup/wip-ts-postgres-2026-10-21` |
| Broken production after any deploy | Redeploy previous commit; worst case redeploy tag `pre-pg-migration` |
| A Postgres-backed domain misbehaves, writes still frozen | `DATA_SOURCE_<DOMAIN>=mongo`, restart API |
| A Postgres-backed domain misbehaves after writes resumed | Freeze writes → back up both → reverse reconciliation → `verifyRollbackTarget` ready → then switch. Not ready → forward-fix only (§6 Phase 4, R31) |
| Postgres data corrupted | `pg_restore` latest dump, or drop schema → `db:migrate` → ETL |
| MongoDB data corrupted | `mongorestore` from §7 dump (into a fresh DB first, then swap `MONGODB_URI`) |
| Next.js frontend regressions | Re-point domain to Vite Vercel project |

Never run `docker compose down -v`, `git clean -fdx`, `git reset --hard`, or `dropDatabase` during this migration.

---

## 9. Immediate next step

`origin/phase5/nextjs-foundation` is at `80c8ff4`. `origin/ci/phase7a-verification` is at `c1caee0` (7A first pass + docs). The 7A second pass (security fixes, staging prerequisites, the pre-hydration form fix: `c1caee0..HEAD`) is **local only**, awaiting approval to push to the CI branch. Nothing is merged or deployed. Verdict: **NO-GO** (`docs/RELEASE_READINESS.md`).

1. Owner: review the second-pass commits; approve (or not) pushing them to `ci/phase7a-verification` only.
2. After that push: the CI workflow green and **three consecutive clean Browser runs on that same commit** (the push gives one; re-run or dispatch for the others). Any failure is classified before anything changes; earlier failures stay in the record.
3. Manual screen-reader pass (R41): `docs/SCREEN_READER_TEST_GUIDE.md` with `docs/ACCESSIBILITY_MANUAL_CHECKLIST.md` — still not performed.
4. Owner checks (no code): the production MongoDB provider (host of `MONGODB_URI` in the Render dashboard), `NODE_ENV=production` on Render, the Render health check path (`/readyz` once deployed). The deployed API still has the vulnerable body-parser until a separate, approved deploy.
5. Before a production-volume rollback could be rehearsed: batching in the reconciliation (R31).
6. Phase 7B (staging rehearsal, `docs/PHASE7B_STAGING_PLAN.md`) only with explicit approval; its code prerequisites now exist (staging cookie-session allowance with the production guard kept, write freeze, reconciliation CLI).
