-- 0002 order history protection and import audit (Phase 3B).
--
-- 1. set_updated_at keeps an explicitly supplied updated_at, so a re-run of
--    the MongoDB import preserves source timestamps exactly; otherwise it
--    still stamps now().
-- 2. Orders get an operational status with explicitly allowed transitions.
--    Their financial history (owner, customer, time, total) can never be
--    edited, and orders and their lines can never be deleted row by row.
-- 3. data_import_runs keeps an audit trail of every import and rollback.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------- order status
-- Legacy orders imported from MongoDB have no recorded status (NULL); one is
-- never invented for them. Orders created by the application start "placed".
ALTER TABLE orders
  ADD COLUMN status text
    CONSTRAINT orders_status_known
    CHECK (status IN ('placed', 'processing', 'shipped', 'delivered', 'cancelled')),
  ADD COLUMN status_updated_at timestamptz,
  ADD CONSTRAINT orders_status_timestamp_together
    CHECK ((status IS NULL) = (status_updated_at IS NULL)),
  ADD CONSTRAINT orders_new_order_has_status
    CHECK (is_legacy OR status IS NOT NULL);

-- The only permitted status changes.
CREATE TABLE order_status_transitions (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  CONSTRAINT order_status_transitions_pkey PRIMARY KEY (from_status, to_status),
  CONSTRAINT order_status_transitions_distinct CHECK (from_status <> to_status)
);

INSERT INTO order_status_transitions (from_status, to_status) VALUES
  ('placed', 'processing'),
  ('placed', 'cancelled'),
  ('processing', 'shipped'),
  ('processing', 'cancelled'),
  ('shipped', 'delivered');

-- Financial history is immutable; only status may change, and only along an
-- allowed transition. status_updated_at is maintained here, not by callers.
CREATE FUNCTION orders_protect_history() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id, NEW.is_legacy, NEW.user_id,
      NEW.customer_full_name, NEW.customer_email, NEW.customer_phone,
      NEW.customer_address, NEW.customer_city, NEW.customer_postal_code,
      NEW.customer_country, NEW.ordered_at, NEW.total_cost_cents, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.is_legacy, OLD.user_id,
      OLD.customer_full_name, OLD.customer_email, OLD.customer_phone,
      OLD.customer_address, OLD.customer_city, OLD.customer_postal_code,
      OLD.customer_country, OLD.ordered_at, OLD.total_cost_cents, OLD.created_at) THEN
    RAISE EXCEPTION 'order financial history is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM order_status_transitions
       WHERE from_status = OLD.status AND to_status = NEW.status
    ) THEN
      RAISE EXCEPTION 'order status transition % -> % is not allowed',
        coalesce(OLD.status, 'none'), coalesce(NEW.status, 'none')
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.status_updated_at := now();
  ELSE
    NEW.status_updated_at := OLD.status_updated_at;
  END IF;

  RETURN NEW;
END;
$$;

-- Fires before orders_set_updated_at (triggers run in name order).
CREATE TRIGGER orders_protect_history BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_protect_history();

-- Order history is append-only. Removing imported data on purpose is only
-- possible with TRUNCATE (statement level), which `data:rollback --confirm`
-- uses after its own safety checks.
CREATE FUNCTION reject_order_history_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION reject_order_history_delete();

CREATE TRIGGER order_items_no_delete BEFORE DELETE ON order_items
  FOR EACH ROW EXECUTE FUNCTION reject_order_history_delete();

-- ------------------------------------------------------- import audit
CREATE TABLE data_import_runs (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation          text NOT NULL
                     CONSTRAINT data_import_runs_operation_known CHECK (operation IN ('import', 'rollback')),
  outcome            text NOT NULL
                     CONSTRAINT data_import_runs_outcome_known CHECK (outcome IN ('succeeded', 'failed')),
  started_at         timestamptz NOT NULL,
  finished_at        timestamptz NOT NULL,
  -- SHA-256 of the canonical MongoDB extraction the run was based on.
  source_fingerprint text
                     CONSTRAINT data_import_runs_fingerprint_format CHECK (source_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Counts and record ids only; never personal data or password hashes.
  summary            jsonb NOT NULL,
  CONSTRAINT data_import_runs_finished_after_start CHECK (finished_at >= started_at)
);
