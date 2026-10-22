-- Reverts 0006_checkout_idempotency. Existing orders remain; only the replay
-- key is removed. Take a pg_dump backup first (db/README.md).

DROP TRIGGER orders_checkout_key_immutable ON orders;
DROP FUNCTION orders_checkout_key_immutable();
DROP INDEX orders_user_checkout_key_unique;
ALTER TABLE orders DROP COLUMN checkout_key;
