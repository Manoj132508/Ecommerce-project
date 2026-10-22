-- Reverts 0003_inventory_and_status_audit. Drops the status audit trail and
-- inventory flags. Take a pg_dump backup first (db/README.md).

DROP FUNCTION change_order_status(uuid, text, text, text);

-- Restore 0002's trigger body: status changes without the audited path.
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

DROP TABLE order_status_events;
DROP FUNCTION reject_audit_change();

DELETE FROM order_status_transitions WHERE from_status = 'none';

ALTER TABLE products DROP COLUMN inventory_tracked;
