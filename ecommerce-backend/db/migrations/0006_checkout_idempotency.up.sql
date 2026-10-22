-- 0006 idempotent PostgreSQL checkout requests.
--
-- A browser sends one random UUID for a checkout attempt. Replaying that key
-- for the same user returns the already-created order instead of creating a
-- duplicate. The key is operational metadata and is never returned by the API.

ALTER TABLE orders ADD COLUMN checkout_key uuid;

CREATE UNIQUE INDEX orders_user_checkout_key_unique
  ON orders (user_id, checkout_key)
  WHERE checkout_key IS NOT NULL;

CREATE FUNCTION orders_checkout_key_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.checkout_key IS DISTINCT FROM OLD.checkout_key THEN
    RAISE EXCEPTION 'order checkout key is immutable'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER orders_checkout_key_immutable BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_checkout_key_immutable();
