-- Reverts 0001_initial_schema. DESTROYS every row in these tables.
-- Only `npm run db:rollback -- --confirm` runs this, after a pg_dump backup
-- (see db/README.md).

DROP TABLE order_items;
DROP FUNCTION order_items_reject_update();
DROP FUNCTION order_items_require_snapshot();
DROP TABLE orders;
DROP TABLE cart_items;
DROP TABLE carts;
DROP TABLE delivery_options;
DROP TABLE products;
DROP TABLE users;
DROP FUNCTION set_updated_at();
