# Migration Plan: MongoDB/Vite → PostgreSQL/Next.js (TypeScript)

Status: **Phases 0–2, R18, R20, 3A and 3B committed and pushed. Phase 3C (PostgreSQL API repositories, opt-in per domain) complete locally and awaiting review. MongoDB is still the default and only active database for every domain; no domain has been switched. No production setting, deployment or production data was touched.**

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
| R26 | Switching carts to PostgreSQL makes cart routes require login (D1). The current frontend calls the cart only when logged in on most pages, but `CheckoutPage` and add-to-cart buttons must be gated before that switch | Medium | Documented as a Phase 4.4 prerequisite; not switched. MongoDB keeps the shared cart until then |
| R27 | JSON key order of products whose MongoDB document lacked `stock` differs between stores (MongoDB puts `stock` first) | Low | Key order has no meaning in JSON; content verified equal on real data (23/23). The MongoDB path itself is byte-identical to before (48/48) |
| R28 | The transaction-local flag that authorises `change_order_status()` can be set by any session with the application's database role | Low | It guards against accidental direct updates, not a compromised application. Every change is still audited in `order_status_events` (append-only) |

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

For each domain: convert its controller to TS → switch its flag to `postgres` locally → characterisation suite → re-run ETL → deploy with flag on → smoke test → monitor. Writes for a domain move all at once; **no dual-write**.

- [ ] 4.1 **Delivery options** (read-only, 3 rows)
- [ ] 4.2 **Products** (public read + admin CRUD). Re-run ETL immediately before flipping so admin edits aren't lost
- [ ] 4.3 **Users/auth** (register, login, profile, `protect`). Apply decision D2. Bcrypt hashes copy verbatim — verify an existing user can log in with their old password
- [ ] 4.4 **Cart + payment summary.** Apply decision D1 (per-user cart = a contract change: add `protect` to cart routes; gate `useCartQuery` in `CheckoutPage`, `Product`, `OneProductPage`, `OrdersPage` "buy again"). Separate commit for the behaviour change with its own tests
- [ ] 4.5 **Orders** (transactional `createOrder`, legacy-order LEFT JOIN). Final ETL run of orders inside a short write freeze
- [ ] 4.6 Remove Mongoose: models, `config/db.js`, `MONGODB_URI`, Mongo repo implementations, flags — **only after 2 weeks of stable production** and a final `mongodump`

**Acceptance per domain:** characterisation suite green; verify script green after the final ETL; manual smoke of that domain's features in production; no 5xx increase in logs for 48 h.
**Rollback per domain:** set `DATA_SOURCE_<DOMAIN>=mongo` and restart (Mongo is untouched and still authoritative for anything written before the flip). Writes made to Postgres after the flip must be replayed or accepted as lost — this is why each flip happens right after an ETL run, at low traffic.

### Phase 5 — Next.js frontend in `apps/web` (Vite stays live)

- [ ] 5.1 `create-next-app` in `apps/web` (TypeScript, App Router, Tailwind v4, ESLint, `src/` dir)
- [ ] 5.2 Copy `public/images`, `src/types`, `src/services/api.ts`, `src/queries`, `src/store`, `src/slices`, `src/utils`; `VITE_API_URL` → `NEXT_PUBLIC_API_URL`; `import.meta.env` → `process.env`
- [ ] 5.3 `next.config.ts` rewrites `/api/:path*` → API origin (replaces Vite proxy; keeps same-origin, no CORS change)
- [ ] 5.4 `app/providers.tsx` (`'use client'`): Redux store created once per client via `useRef(makeStore())`, `QueryClient` via `useState`
- [ ] 5.5 Route map (pages start as client components wrapping the existing page code):

  | React Router | Next App Router |
  | --- | --- |
  | `index` | `app/page.tsx` |
  | `products/:productId` | `app/products/[productId]/page.tsx` |
  | `login`, `register` | `app/login/page.tsx`, `app/register/page.tsx` |
  | `admin` | `app/admin/page.tsx` |
  | `checkout` | `app/checkout/page.tsx` (own layout: checkout header, no main `Header`) |
  | `order-confirmation` | `app/order-confirmation/page.tsx` |
  | `product-unavailable` | `app/product-unavailable/page.tsx` — replace `location.state.productName` with `?productName=` |
  | `orders` | `app/orders/page.tsx` |
  | `tracking` | `app/tracking/page.tsx` — wrap `useSearchParams` user in `<Suspense>` |
  | `*` → Home | `app/not-found.tsx` (decide: render Home or a 404) |

- [ ] 5.6 Replace `react-router` APIs: `Link` → `next/link` (`to` → `href`), `useNavigate` → `useRouter().push/replace`, `<Navigate>` → `router.replace` in effect, `useParams`/`useSearchParams` from `next/navigation`
- [ ] 5.7 Fix relative asset paths (`images/ratings/...` → `/images/ratings/...`); drop `<base href="/">`; move Roboto to `next/font`; `<title>` → `metadata`/`generateMetadata`
- [ ] 5.8 Deploy `apps/web` as a **new** Vercel project (preview URL); add its origin to `CLIENT_URL`
- [ ] 5.9 Run the full feature checklist (§2) on the preview, desktop and mobile widths
- [ ] 5.10 Optional follow-ups after parity: Server Components for product list/detail (public data); httpOnly cookie auth (removes R9)

**Acceptance:** `next build` green with no type errors; every feature in §2 passes on the preview URL; Lighthouse/mobile layout no worse than Vite.
**Rollback:** the Vite deployment is untouched; nothing to roll back until the domain switch in Phase 7.

### Phase 6 — shadcn/ui (after parity, component by component)

- [ ] 6.1 `npx shadcn init` in `apps/web`; map current brand colours (`#198754` etc.) to CSS variables
- [ ] 6.2 Replace `utils/tailwindClasses.ts` usages with `Button`, `Select`, `Input`, `Label`, `Card`, `Dialog` (admin delete confirm replaces `window.confirm`), `Tabs` (admin), `Sheet` (mobile menu), `Sonner` toasts (added-to-cart)
- [ ] 6.3 One page per commit; visual check at 375 px and 1280 px after each

**Acceptance:** no visual regressions in the §2 checklist; accessibility of forms equal or better.

### Phase 7 — Cutover and cleanup

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
| A Postgres-backed domain misbehaves | `DATA_SOURCE_<DOMAIN>=mongo`, restart API |
| Postgres data corrupted | `pg_restore` latest dump, or drop schema → `db:migrate` → ETL |
| MongoDB data corrupted | `mongorestore` from §7 dump (into a fresh DB first, then swap `MONGODB_URI`) |
| Next.js frontend regressions | Re-point domain to Vite Vercel project |

Never run `docker compose down -v`, `git clean -fdx`, `git reset --hard`, or `dropDatabase` during this migration.

---

## 9. Immediate next step

Pushed to `origin/migration/postgres`: Phases 1, 2, R18, R20, 3A, 3B (latest `6a4a560`). Phase 3C is complete locally and awaiting review. **No domain has been switched to PostgreSQL.**

1. Owner: review Phase 3C (`repositories/`, `config/dataSources.ts`, migration 0003, the O4 endpoint, the intentional differences) and approve committing/pushing it.
2. Owner: confirm the "Phase 3C decisions taken" above.
3. Owner: still open from Phase 3B: the production MongoDB provider and the Render Postgres instance.
4. Then Phase 4, switching domains one at a time, each behind its `DATA_SOURCE_*` variable with a re-run of `data:import` + `data:verify` just before the switch:
   - delivery options → products → users;
   - then carts + orders together, after the frontend gates the cart behind login (R26).
