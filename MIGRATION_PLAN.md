# Migration Plan: MongoDB/Vite → PostgreSQL/Next.js (TypeScript)

Status: **Planning — no application code changed by this document.**
Inspected: 2026-10-21 against `main` @ `4e622f5` plus the uncommitted working tree.

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

**None of this is in git. A disk failure or a careless `git checkout .` loses it.** Backing it up is step 0.

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
| P3 | `PUT /api/products/:productId` | admin | same as P2 | 200 `Product`; 400; 404 |
| P4 | `DELETE /api/products/:productId` | admin | — | 200 `{id}`; 404 |
| D1 | `GET /api/delivery-options[?expand=estimatedDeliveryTime]` | — | — | `{id,deliveryDays,priceCents,createdAt,updatedAt[,estimatedDeliveryTimeMs]}[]` |
| C1 | `GET /api/cart-items[?expand=product]` | **none** | — | `{id,productId,quantity,deliveryOptionId,createdAt,updatedAt[,product,unavailable]}[]` |
| C2 | `POST /api/cart-items` | **none** | `{productId,quantity 1–10}` | 201 cart item (quantity is *added*); 400; 404 |
| C3 | `PUT /api/cart-items/:productId` | **none** | `{quantity?,deliveryOptionId?}` | 200 cart item; 400; 404 |
| C4 | `DELETE /api/cart-items/:productId` | **none** | — | 204; 404 |
| C5 | `GET /api/payment-summary` | **none** | — | `{totalItems,productCostCents,shippingCostCents,totalCostBeforeTaxCents,taxCents,totalCostCents,unavailableProductIds}` |
| O1 | `GET /api/orders[?expand=products]` | Bearer | — | `Order[]` by `orderTimeMs` desc; admin sees all |
| O2 | `GET /api/orders/:orderId[?expand=products]` | Bearer | — | `Order`; 404 if not owner (unless admin) |
| O3 | `POST /api/orders` | Bearer | `{customer:{fullName,email,phone,address,city,postalCode,country}}` | 201 `Order`; 400; 409 `{message,unavailableProductIds}` |

`Product` = `{id,image,name,description,howItWorks,highlights[],careInstructions,category,stock,rating:{stars,count},priceCents,keywords[],createdAt,updatedAt}`
`Order` = `{id,userId?,customer?,orderTimeMs,totalCostCents,products:[{productId,product?,quantity,estimatedDeliveryTimeMs}],createdAt,updatedAt}`

Frontend TypeScript mirrors of these shapes already exist in `ecommerce-project/src/types/*.ts` — they become the contract source of truth.

Error envelope everywhere: `{ message: string }`. Note: cart/order/delivery 500s currently leak `error.message` — keep the envelope, stop leaking internals.

### Working features (to be regression-tested at every phase)

Browse/search products (client-side filter via Redux `searchTerm`), product detail page, register/login/logout/profile restore, add to cart, change quantity, change delivery option, remove item, unavailable-product handling in checkout, payment summary, place order with customer details, orders list, buy again, tracking page, admin product CRUD, admin order list, mobile layout.

---

## 3. MongoDB → PostgreSQL mapping

### 3.1 Schema

```sql
-- Extensions: none required (gen_random_uuid() is built in since PG 13)

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_mongo_id char(24) UNIQUE,                 -- ObjectId hex, for ETL + token transition
  name            text NOT NULL CHECK (btrim(name) <> ''),
  email           text NOT NULL CHECK (email = lower(btrim(email))),
  password_hash   text NOT NULL,                   -- bcrypt, cost 12 (copied verbatim)
  is_admin        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- all 35 existing ids are valid UUIDs
  image             text NOT NULL,
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  how_it_works      text NOT NULL DEFAULT '',
  highlights        text[] NOT NULL DEFAULT '{}',
  care_instructions text NOT NULL DEFAULT '',
  category          text NOT NULL DEFAULT '',
  stock             integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  rating_stars      numeric(2,1) NOT NULL DEFAULT 0 CHECK (rating_stars BETWEEN 0 AND 5),
  rating_count      integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  price_cents       integer NOT NULL CHECK (price_cents >= 0),
  keywords          text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_created_at_idx ON products (created_at);

CREATE TABLE delivery_options (
  id            text PRIMARY KEY,                  -- '1','2','3' are part of the API contract
  delivery_days integer NOT NULL CHECK (delivery_days >= 0),
  price_cents   integer NOT NULL CHECK (price_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cart_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- see decision D1
  product_id         uuid NOT NULL,   -- no FK (decision D3): deleted products stay in the cart as "unavailable"
  quantity           integer NOT NULL CHECK (quantity >= 1),
  delivery_option_id text NOT NULL REFERENCES delivery_options(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_id)
);

CREATE TABLE orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,  -- nullable: 6 legacy orders have none
  customer_full_name  text,      -- customer_* nullable: 6 legacy orders have no customer
  customer_email      text,
  customer_phone      text,
  customer_address    text,
  customer_city       text,
  customer_postal_code text,
  customer_country    text,
  ordered_at          timestamptz NOT NULL,         -- serialised as orderTimeMs
  total_cost_cents    integer NOT NULL CHECK (total_cost_cents >= 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_ordered_idx ON orders (user_id, ordered_at DESC);

CREATE TABLE order_items (
  order_id               uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  position               integer NOT NULL,           -- preserves array order
  product_id             uuid NOT NULL,              -- deliberately NO FK: 5/8 referenced products are already deleted,
                                                     -- and /tracking looks items up by productId
  quantity               integer NOT NULL CHECK (quantity >= 1),
  estimated_delivery_at  timestamptz NOT NULL,       -- serialised as estimatedDeliveryTimeMs
  snapshot_name          text,                       -- snapshot_* NULL ⇒ legacy order, LEFT JOIN products
  snapshot_image         text,
  snapshot_price_cents   integer,
  snapshot_description   text,
  snapshot_category      text,
  PRIMARY KEY (order_id, position)
);

CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
```

Field-level conversions:

| Mongo | Postgres | API serialisation |
| --- | --- | --- |
| `_id` (String UUID) | `uuid` | `id` (string) |
| User `_id` (ObjectId) | `uuid` + `legacy_mongo_id` | `_id` (keep the key name; value becomes the uuid) |
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
| R1 | Uncommitted WIP lost | **Critical** | Phase 0 backup branch, pushed to origin |
| R2 | **Cart is global**: any visitor sees/edits the same cart; placing an order empties it for everyone | **High (existing bug)** | Decision D1; fix as an explicit, separately-tested behaviour change |
| R3 | User IDs change ObjectId → uuid: existing 30-day JWTs fail the 24-hex check; `orders.userId` strings must be remapped | High | ETL maps via `legacy_mongo_id`; decision D2 on token handling |
| R4 | Legacy orders lack `userId`, `customer`, snapshots; 5/8 referenced products deleted | Medium | Nullable columns, no FK on `order_items.product_id`, LEFT JOIN fallback — reproduces current "Product unavailable" output |
| R5 | Payment summary total (`before + round(before*0.1)`) and order total (`round(before*1.1)`) can differ by 1¢ with float rounding | Medium (existing) | Pin current behaviour in characterisation tests; unify in one shared function in a separate commit |
| R6 | Production DB location unknown; local profile may not match prod | High | Identify host, run the same read-only profile on prod, `mongodump` prod before cutover |
| R7 | `products.stock` absent on all docs → migrates as 0. Harmless today (stock isn't enforced) but becomes "everything out of stock" if enforcement is added | Low | Record; decide stock values before adding enforcement |
| R8 | Next.js routing differences: `<base href="/">` + relative `images/ratings/...` in `Product.tsx` breaks on nested routes; `ProductUnavailablePage` relies on router `location.state`; `*` route renders Home; `useSearchParams` needs a Suspense boundary | Medium | Covered in Phase 5 checklist |
| R9 | localStorage token is invisible to Server Components | Medium | Keep all authenticated fetching client-side in Phase 5; cookie auth is an optional later phase |
| R10 | Deployment config (Vercel root dir, backend build/start commands, CORS origin) breaks when folders move or build steps change | Medium | Don't move deployed folders until cutover; new Next app gets its own Vercel project first |
| R11 | Auth test suite deleted in WIP → no regression net for auth | Medium | Restore before any backend refactor (Phase 1) |
| R12 | `docker compose down -v` deletes Postgres data | Medium | Never use `-v`; `pg_dump` before each ETL rerun |
| R13 | Dual-write / split-brain if some domains read Mongo and others Postgres while sharing IDs | Medium | Migrate domains in dependency order; cut over all writes for a domain at once; no dual-write |

### Decisions needed from the owner

- **D1 — Cart ownership.** Recommended: per-user cart (`user_id NOT NULL`, cart routes behind `protect`). The frontend already gates cart queries on login in `Header`/`OrderConfirmationPage`; `CheckoutPage` does not and must be gated. The 4 existing global cart rows are discarded (or assigned to the single local user). Alternative: keep the global cart in Postgres (`user_id` nullable) for strict parity and fix later.
- **D2 — Existing tokens.** Recommended: during a transition window, `protect` accepts either a uuid or a 24-hex id (lookup via `legacy_mongo_id`); remove after 30 days. Alternative: force everyone to log in again.
- **D3 — Deleting a product that is in carts.** Today the cart row survives and checkout shows "no longer available". `ON DELETE CASCADE` silently removes it instead. Recommended for parity: no FK on `cart_items.product_id`, keep the LEFT JOIN behaviour (this is what the schema above uses). Alternative: `REFERENCES products(id) ON DELETE CASCADE`.
- **D4 — Snapshot backfill for legacy orders.** Recommended: don't fabricate snapshots; keep the LEFT JOIN fallback.

---

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

- [ ] 0.1 Create backup branch with the WIP and push (commands in §7)
- [ ] 0.2 Tag the last deployed commit: `pre-pg-migration` → `4e622f5`
- [ ] 0.3 `mongodump` local DB (and production DB once identified) — §7
- [ ] 0.4 JSON export of every collection (second, tool-independent copy) — §7
- [ ] 0.5 Copy `.env` and `.env.postgres` to a password manager / secure location (they're git-ignored)
- [ ] 0.6 Identify the production backend host, its build/start commands and its `MONGODB_URI` host; record here

**Acceptance:** backup branch visible on `origin`; tag exists; dump directories contain all 5 non-empty collections with doc counts matching §1.4; restoring the dump into a throwaway Mongo container reproduces the counts.

### Phase 1 — Commit the WIP and add a safety net (still Mongo)

- [ ] 1.1 On a working branch `migration/postgres`, decide whether `test/auth.test.js` deletion was intentional; recommended: `git restore ecommerce-backend/test/auth.test.js`
- [ ] 1.2 Commit the frontend TS/TanStack/Redux conversion as its own commit (already green: typecheck, lint, build)
- [ ] 1.3 Commit the backend Postgres scaffolding (compose, config, scripts) as its own commit
- [ ] 1.4 Run `migrate:product-descriptions` and `migrate:product-categories` against Mongo (idempotent backfills) so data is complete before ETL
- [ ] 1.5 Add **characterisation tests** (`node:test` + real HTTP, like the existing auth test) for every endpoint in §2, against a seeded test database. These pin current status codes, shapes, sort orders and rounding, and become the acceptance suite for every later phase
- [ ] 1.6 Update `ecommerce-project/README.md` (still describes the deleted Context files)
- [ ] 1.7 Manual smoke test of all "working features" in §2; deploy to production; confirm parity

**Acceptance:** `npm test` green in backend; frontend typecheck/lint/build green; production smoke test passes on the TS frontend.
**Rollback:** redeploy `pre-pg-migration` tag.

### Phase 2 — Backend TypeScript toolchain (behaviour unchanged)

- [ ] 2.1 Add `typescript`, `tsx`, `@types/express`, `@types/pg`, `@types/jsonwebtoken`, `@types/bcryptjs`, `@types/cors`; `tsconfig.json` with `allowJs: true`, `strict: true`, `outDir: dist`
- [ ] 2.2 Scripts: `dev: tsx watch src/server.ts`, `build: tsc`, `start: node dist/server.js`, `typecheck: tsc --noEmit`
- [ ] 2.3 Move sources under `src/` and convert leaf files first: `utils/`, `config/`, `middleware/`, `routes/`, then `server.ts`. Controllers stay JS until their domain migrates
- [ ] 2.4 `src/types/api.ts` — response types copied from the frontend `src/types`
- [ ] 2.5 `src/lib/errors.ts` — stop returning raw `error.message` on 500s (keep `{message}` envelope)
- [ ] 2.6 Update production build/start commands on the backend host

**Acceptance:** characterisation suite green unchanged; `tsc --noEmit` green; production deploy healthy.
**Rollback:** revert the phase commits; restore old start command.

### Phase 3 — Postgres schema, data access layer and ETL (Mongo still live)

- [ ] 3.1 `src/db/pool.ts` (typed wrapper over `config/postgres.js`; `withTransaction(fn)` helper)
- [ ] 3.2 `db/migrations/001_init.sql` (schema in §3.1) + tiny runner using `schema_migrations`; `npm run db:migrate`
- [ ] 3.3 Repository interfaces per domain (`ProductRepo`, `DeliveryOptionRepo`, `UserRepo`, `CartRepo`, `OrderRepo`) with a Mongo implementation (wrapping current Mongoose code) and a Postgres implementation (parameterised SQL only — no string-built SQL, ever)
- [ ] 3.4 Per-domain switch `DATA_SOURCE_<DOMAIN>=mongo|postgres` (default `mongo`)
- [ ] 3.5 `scripts/etl/mongoToPostgres.ts`: reads Mongo read-only, upserts into Postgres in one transaction per collection (`ON CONFLICT (id) DO UPDATE`), maps user ObjectIds via `legacy_mongo_id`, converts ms → timestamptz, flattens rating/customer, explodes order products with `position`; idempotent and re-runnable
- [ ] 3.6 `scripts/etl/verify.ts`: row counts per table = doc counts; per-row checksum of key fields; every `orders.user_id` resolves; every product price/rating equal; prints a diff and exits non-zero on mismatch
- [ ] 3.7 Run the characterisation suite against each Postgres repo implementation

**Acceptance:** `db:migrate` creates the schema on an empty DB and is a no-op on rerun; ETL + verify exit 0 twice in a row; characterisation suite passes with every `DATA_SOURCE_*=postgres`.
**Rollback:** nothing user-facing changed; drop and recreate the Postgres schema.

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

```bash
# 0.3 — mongodump without installing tools (Docker Desktop; host.docker.internal reaches the Windows host)
mkdir -p ../ecommerce-backups/mongo-2026-10-21
docker run --rm -v "$(cd ../ecommerce-backups && pwd -W)/mongo-2026-10-21:/dump" mongo:8 \
  mongodump --uri "mongodb://host.docker.internal:27017/ecommerce_store" --out /dump
# Restore test into a throwaway container (never into the real DB):
#   docker run -d --name mongo-restore-test -p 27018:27017 mongo:8
#   docker run --rm -v ".../mongo-2026-10-21:/dump" mongo:8 mongorestore --uri mongodb://host.docker.internal:27018 /dump
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

**Phase 0.1–0.4:** create and push the backup branch and tag (§7), then take the Mongo dump and verify its counts against §1.4. After that, answer decisions D1–D4 and identify the production backend/database host (0.6), which unblocks Phase 1.
