-- Reverts 0002_order_history_protection. Drops the import audit trail and
-- order statuses. Take a pg_dump backup first (db/README.md).

DROP TABLE data_import_runs;

DROP TRIGGER order_items_no_delete ON order_items;
DROP TRIGGER orders_no_delete ON orders;
DROP FUNCTION reject_order_history_delete();

DROP TRIGGER orders_protect_history ON orders;
DROP FUNCTION orders_protect_history();
DROP TABLE order_status_transitions;

ALTER TABLE orders
  DROP CONSTRAINT orders_new_order_has_status,
  DROP CONSTRAINT orders_status_timestamp_together,
  DROP COLUMN status_updated_at,
  DROP COLUMN status;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
