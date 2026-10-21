-- 0001 initial schema (Phase 3A). See MIGRATION_PLAN.md §3 and db/README.md.
--
-- Identifier formats are preserved from MongoDB (approved decision D2):
--   users.id             TEXT: the original 24-hex ObjectId string
--   products.id          UUID (all existing ids are UUIDs)
--   orders.id            UUID
--   delivery_options.id  TEXT digit string ("1", "2", "3")
-- Money is integer minor units (cents). Nothing here enforces stock.
-- The runner applies this file once, inside a transaction.

-- Keeps updated_at current on every UPDATE.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            text PRIMARY KEY
                CONSTRAINT users_id_object_id CHECK (id ~ '^[0-9a-f]{24}$'),
  name          text NOT NULL
                CONSTRAINT users_name_not_blank CHECK (btrim(name) <> ''),
  email         text NOT NULL
                CONSTRAINT users_email_normalised CHECK (email = lower(btrim(email)) AND email <> ''),
  password_hash text NOT NULL
                CONSTRAINT users_password_hash_bcrypt CHECK (password_hash ~ '^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------- products
CREATE TABLE products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image             text NOT NULL
                    CONSTRAINT products_image_not_blank CHECK (btrim(image) <> ''),
  name              text NOT NULL
                    CONSTRAINT products_name_not_blank CHECK (btrim(name) <> ''),
  description       text NOT NULL DEFAULT '',
  how_it_works      text NOT NULL DEFAULT '',
  highlights        text[] NOT NULL DEFAULT '{}'
                    CONSTRAINT products_highlights_no_nulls CHECK (array_position(highlights, NULL) IS NULL),
  care_instructions text NOT NULL DEFAULT '',
  category          text NOT NULL DEFAULT '',
  -- Stored and returned only. Not enforced or decremented until inventory rules exist.
  stock             integer NOT NULL DEFAULT 0
                    CONSTRAINT products_stock_non_negative CHECK (stock >= 0),
  rating_stars      numeric(2,1) NOT NULL DEFAULT 0
                    CONSTRAINT products_rating_stars_half_steps
                    CHECK (rating_stars BETWEEN 0 AND 5 AND rating_stars * 2 = trunc(rating_stars * 2)),
  rating_count      integer NOT NULL DEFAULT 0
                    CONSTRAINT products_rating_count_non_negative CHECK (rating_count >= 0),
  price_cents       integer NOT NULL
                    CONSTRAINT products_price_cents_non_negative CHECK (price_cents >= 0),
  keywords          text[] NOT NULL DEFAULT '{}'
                    CONSTRAINT products_keywords_no_nulls CHECK (array_position(keywords, NULL) IS NULL),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- GET /api/products orders by creation time; id breaks ties from bulk inserts.
CREATE INDEX products_created_at_id_idx ON products (created_at, id);

CREATE TRIGGER products_set_updated_at BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------- delivery_options
CREATE TABLE delivery_options (
  id            text PRIMARY KEY
                CONSTRAINT delivery_options_id_digits CHECK (id ~ '^[0-9]{1,10}$'),
  delivery_days integer NOT NULL
                CONSTRAINT delivery_options_days_non_negative CHECK (delivery_days >= 0),
  price_cents   integer NOT NULL
                CONSTRAINT delivery_options_price_cents_non_negative CHECK (price_cents >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER delivery_options_set_updated_at BEFORE UPDATE ON delivery_options
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------- carts
-- D1: one cart per user. The shared MongoDB cart is not migrated or assigned.
CREATE TABLE carts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    text NOT NULL
             CONSTRAINT carts_user_id_fkey REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_user_id_key UNIQUE (user_id)
);

CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON carts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------ cart_items
CREATE TABLE cart_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id            uuid NOT NULL
                     CONSTRAINT cart_items_cart_id_fkey REFERENCES carts (id) ON DELETE CASCADE,
  -- D3: deliberately no foreign key. A line whose product was deleted stays in
  -- the cart, shown as unavailable, and blocks checkout until the shopper removes it.
  product_id         uuid NOT NULL,
  -- FD1: integer from 1 to 10.
  quantity           integer NOT NULL
                     CONSTRAINT cart_items_quantity_range CHECK (quantity BETWEEN 1 AND 10),
  delivery_option_id text NOT NULL
                     CONSTRAINT cart_items_delivery_option_id_fkey REFERENCES delivery_options (id) ON DELETE RESTRICT,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_cart_id_product_id_key UNIQUE (cart_id, product_id)
);

-- Cart contents are listed in the order they were added.
CREATE INDEX cart_items_cart_id_created_at_idx ON cart_items (cart_id, created_at);

CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON cart_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------- orders
CREATE TABLE orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- D4: true for orders imported from MongoDB, which may lack a user, customer
  -- details and product snapshots. Orders created by the application are false.
  is_legacy            boolean NOT NULL DEFAULT false,
  -- RESTRICT: a user with order history cannot be deleted by accident.
  user_id              text
                       CONSTRAINT orders_user_id_fkey REFERENCES users (id) ON DELETE RESTRICT,
  customer_full_name   text,
  customer_email       text,
  customer_phone       text,
  customer_address     text,
  customer_city        text,
  customer_postal_code text,
  customer_country     text,
  ordered_at           timestamptz NOT NULL,
  total_cost_cents     integer NOT NULL
                       CONSTRAINT orders_total_cost_cents_non_negative CHECK (total_cost_cents >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Customer details are all present or all absent (true of every existing order).
  CONSTRAINT orders_customer_all_or_nothing CHECK (
    num_nonnulls(customer_full_name, customer_email, customer_phone, customer_address,
                 customer_city, customer_postal_code, customer_country) IN (0, 7)
  ),
  CONSTRAINT orders_customer_not_blank CHECK (
    customer_full_name IS NULL OR (
      btrim(customer_full_name) <> '' AND btrim(customer_email) <> '' AND
      btrim(customer_phone) <> '' AND btrim(customer_address) <> '' AND
      btrim(customer_city) <> '' AND btrim(customer_postal_code) <> '' AND
      btrim(customer_country) <> ''
    )
  ),
  -- Application-created orders always have an owner and customer details.
  CONSTRAINT orders_new_order_has_user_and_customer CHECK (
    is_legacy OR (user_id IS NOT NULL AND customer_full_name IS NOT NULL)
  )
);

-- A user's order history, newest first.
CREATE INDEX orders_user_id_ordered_at_idx ON orders (user_id, ordered_at DESC);
-- The admin list of all orders, newest first.
CREATE INDEX orders_ordered_at_idx ON orders (ordered_at DESC);

CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------- order_items
CREATE TABLE order_items (
  order_id              uuid NOT NULL
                        CONSTRAINT order_items_order_id_fkey REFERENCES orders (id) ON DELETE CASCADE,
  -- Preserves the line order of the original products array.
  position              integer NOT NULL
                        CONSTRAINT order_items_position_non_negative CHECK (position >= 0),
  -- D4: the original product id, kept even when the product no longer exists.
  -- Deliberately no foreign key: 5 of 8 existing orders reference deleted
  -- products, and /tracking finds a line by orderId + productId. The current
  -- product is looked up with a LEFT JOIN and may be absent.
  product_id            uuid NOT NULL,
  -- At least 1. No upper bound: history may include quantities above the
  -- cart limit, which the old API allowed when the same product was re-added.
  quantity              integer NOT NULL
                        CONSTRAINT order_items_quantity_positive CHECK (quantity >= 1),
  estimated_delivery_at timestamptz NOT NULL,
  -- Immutable snapshot of the product when the order was placed. All columns
  -- are present (new orders) or all absent (legacy lines). Never backfilled.
  snapshot_name         text,
  snapshot_image        text,
  snapshot_price_cents  integer
                        CONSTRAINT order_items_snapshot_price_non_negative CHECK (snapshot_price_cents >= 0),
  snapshot_description  text,
  snapshot_category     text,
  CONSTRAINT order_items_pkey PRIMARY KEY (order_id, position),
  CONSTRAINT order_items_snapshot_all_or_nothing CHECK (
    num_nonnulls(snapshot_name, snapshot_image, snapshot_price_cents,
                 snapshot_description, snapshot_category) IN (0, 5)
  ),
  CONSTRAINT order_items_snapshot_name_not_blank CHECK (
    snapshot_name IS NULL OR btrim(snapshot_name) <> ''
  )
);

-- D4: lines of application-created orders must carry a snapshot.
CREATE FUNCTION order_items_require_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.snapshot_name IS NULL
     AND NOT COALESCE((SELECT is_legacy FROM orders WHERE id = NEW.order_id), true) THEN
    RAISE EXCEPTION 'order_items of a non-legacy order require a product snapshot'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER order_items_require_snapshot BEFORE INSERT ON order_items
  FOR EACH ROW EXECUTE FUNCTION order_items_require_snapshot();

-- D4: order history is append-only; snapshots can never be edited.
CREATE FUNCTION order_items_reject_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_items are immutable'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER order_items_immutable BEFORE UPDATE ON order_items
  FOR EACH ROW EXECUTE FUNCTION order_items_reject_update();
