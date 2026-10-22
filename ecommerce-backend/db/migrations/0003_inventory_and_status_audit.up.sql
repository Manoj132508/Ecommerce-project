-- 0003 inventory tracking and audited order status changes (Phase 3C).
--
-- 1. Stock is enforced at checkout only for products whose inventory is
--    explicitly tracked. Imported products have no real stock data (every
--    MongoDB product lacked the field), so nothing is tracked by default.
-- 2. Every order status change is recorded in an append-only audit table,
--    and can only happen through change_order_status(), which writes the
--    audit row in the same statement.
-- 3. An admin may close a legacy order (no recorded status) as delivered or
--    cancelled. No status is ever assigned automatically.
-- Cancellation is an operational status only: order totals stay immutable,
-- and refunds are a separate concern this schema does not model.

ALTER TABLE products
  ADD COLUMN inventory_tracked boolean NOT NULL DEFAULT false;

INSERT INTO order_status_transitions (from_status, to_status) VALUES
  ('none', 'delivered'),
  ('none', 'cancelled');

CREATE TABLE order_status_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    uuid NOT NULL
              CONSTRAINT order_status_events_order_id_fkey REFERENCES orders (id) ON DELETE RESTRICT,
  -- NULL: the order had no status before (creation, or a legacy order).
  from_status text,
  to_status   text NOT NULL
              CONSTRAINT order_status_events_to_status_known
              CHECK (to_status IN ('placed', 'processing', 'shipped', 'delivered', 'cancelled')),
  changed_by  text NOT NULL
              CONSTRAINT order_status_events_changed_by_fkey REFERENCES users (id) ON DELETE RESTRICT,
  reason      text NOT NULL
              CONSTRAINT order_status_events_reason_not_blank CHECK (btrim(reason) <> ''),
  changed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_status_events_order_id_idx ON order_status_events (order_id, id);

-- The audit trail is append-only.
CREATE FUNCTION reject_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are append-only', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER order_status_events_append_only BEFORE UPDATE OR DELETE ON order_status_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_change();

-- Same financial-history protection as 0002; additionally, a status change
-- is accepted only inside change_order_status() (a transaction-local flag),
-- and an order without a status may follow the 'none' transitions.
CREATE OR REPLACE FUNCTION orders_protect_history() RETURNS trigger
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
    IF current_setting('app.audited_status_change', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'order status changes must go through change_order_status()'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM order_status_transitions
       WHERE from_status = coalesce(OLD.status, 'none') AND to_status = NEW.status
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

-- The only way to change an order's status. Locks the order, applies the
-- transition (validated by orders_protect_history) and records who, when,
-- from, to and why, all in one statement.
CREATE FUNCTION change_order_status(p_order_id uuid, p_to_status text, p_changed_by text, p_reason text)
RETURNS SETOF orders
LANGUAGE plpgsql AS $$
DECLARE
  v_from text;
BEGIN
  SELECT status INTO v_from FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % does not exist', p_order_id
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM set_config('app.audited_status_change', 'on', true);
  RETURN QUERY UPDATE orders SET status = p_to_status WHERE id = p_order_id RETURNING *;
  PERFORM set_config('app.audited_status_change', 'off', true);

  INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, reason)
  VALUES (p_order_id, v_from, p_to_status, p_changed_by, p_reason);
END;
$$;
