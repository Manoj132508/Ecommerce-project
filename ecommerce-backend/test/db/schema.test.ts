// Constraint behaviour of migration 0001. Valid rows mirror the real MongoDB
// data shapes profiled on 2026-10-21; invalid rows must fail with the exact
// SQLSTATE (and constraint name where one applies).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { migrate } from "../../db/migrator.js";
import { createTestDatabase, expectSqlState, MIGRATIONS_DIRECTORY, SQLSTATE, type TestDatabase } from "./helpers.js";

let db: TestDatabase;

const sql = (text: string, values: unknown[] = []) => db.pool.query(text, values);

const USER_ID = "6aa7f3b07e1b7e1411434c6b";
const OTHER_USER_ID = "6ad8b3e08afe6f8ad3173cac";
const PRODUCT_ID = "e43638ce-6aa0-4b85-b27f-e1d07eb678c6";
const OTHER_PRODUCT_ID = "15b6fc6f-327a-4ec4-896f-486349e85a3d";
const DELETED_PRODUCT_ID = "99999999-9999-4999-8999-999999999999";
const ORDER_ID = "813e5e9d-bba1-40a3-8fde-cf6673a7f1e7";
// Real bcrypt format: $2b$12$ + 53 characters.
const BCRYPT_HASH = `$2b$12$${"a".repeat(53)}`;
const CUSTOMER = ["Ada Lovelace", "ada@example.com", "0123 456", "1 Analytical Way", "London", "N1 1AA", "UK"];

const insertUser = (id = USER_ID, email = "user@example.com") => sql(
  "INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Test User', $2, $3)",
  [id, email, BCRYPT_HASH],
);

const insertProduct = (id = PRODUCT_ID, overrides: Record<string, unknown> = {}) => {
  const row: Record<string, unknown> = {
    id,
    image: "images/products/socks.jpg",
    name: "Black and Gray Athletic Cotton Socks - 6 Pairs",
    price_cents: 1090,
    rating_stars: 4.5,
    rating_count: 87,
    highlights: ["Cotton", "6 pairs"],
    keywords: ["socks", "sports"],
    ...overrides,
  };
  const columns = Object.keys(row);
  return sql(
    `INSERT INTO products (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`,
    Object.values(row),
  );
};

const insertDeliveryOptions = () => sql(
  "INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 7, 0), ('2', 3, 499), ('3', 1, 999)",
);

const insertCart = async (userId = USER_ID) => (
  await db.pool.query<{ id: string }>("INSERT INTO carts (user_id) VALUES ($1) RETURNING id", [userId])
).rows[0]?.id ?? "";

const insertCartItem = (cartId: string, productId = PRODUCT_ID, quantity: unknown = 1, deliveryOptionId = "1") => sql(
  "INSERT INTO cart_items (cart_id, product_id, quantity, delivery_option_id) VALUES ($1, $2, $3, $4)",
  [cartId, productId, quantity, deliveryOptionId],
);

interface OrderRow {
  id?: string;
  isLegacy?: boolean;
  userId?: string | null;
  customer?: (string | null)[];
  // unknown: tests also send invalid values such as -1 and 10.5.
  totalCostCents?: unknown;
  // Defaults to "placed" for application orders and none for legacy ones (0002).
  status?: string | null;
}

const insertOrder = ({
  id = ORDER_ID,
  isLegacy = false,
  userId = USER_ID,
  customer = CUSTOMER,
  totalCostCents = 5801,
  status = isLegacy ? null : "placed",
}: OrderRow = {}) => sql(
  `INSERT INTO orders (id, is_legacy, user_id, customer_full_name, customer_email, customer_phone,
     customer_address, customer_city, customer_postal_code, customer_country, ordered_at, total_cost_cents,
     status, status_updated_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CASE WHEN $13::text IS NULL THEN NULL ELSE now() END)`,
  [id, isLegacy, userId, ...customer, new Date(1_790_167_054_005), totalCostCents, status],
);

const SNAPSHOT = ["Socks", "images/products/socks.jpg", 1090, "Comfortable socks.", "Clothing"];
const NO_SNAPSHOT = [null, null, null, null, null];

interface OrderItemRow {
  orderId?: string;
  position?: number;
  productId?: string;
  quantity?: unknown;
  snapshot?: unknown[];
}

const insertOrderItem = ({
  orderId = ORDER_ID,
  position = 0,
  productId = PRODUCT_ID,
  quantity = 2,
  snapshot = SNAPSHOT,
}: OrderItemRow = {}) => sql(
  `INSERT INTO order_items (order_id, position, product_id, quantity, estimated_delivery_at,
     snapshot_name, snapshot_image, snapshot_price_cents, snapshot_description, snapshot_category)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [orderId, position, productId, quantity, new Date(1_790_771_854_005), ...snapshot],
);

beforeEach(async () => {
  db = await createTestDatabase();
  await migrate(db.pool, MIGRATIONS_DIRECTORY);
});

afterEach(async () => {
  await db.drop();
});

describe("users (D2: ObjectId strings kept as TEXT)", () => {
  test("accepts the existing ObjectId and bcrypt formats", async () => {
    await insertUser();
    const { rows } = await sql("SELECT id, is_admin FROM users");
    expect(rows).toEqual([{ id: USER_ID, is_admin: false }]);
  });

  test.each([
    ["uppercase hex", USER_ID.toUpperCase()],
    ["a UUID", PRODUCT_ID],
    ["23 characters", USER_ID.slice(1)],
    ["non-hex", "zzzzzzzzzzzzzzzzzzzzzzzz"],
  ])("rejects %s as a user id", async (_label, id) => {
    await expectSqlState(insertUser(id), SQLSTATE.checkViolation, "users_id_object_id");
  });

  test("requires normalised, unique emails", async () => {
    await expectSqlState(insertUser(USER_ID, " User@Example.com"), SQLSTATE.checkViolation, "users_email_normalised");
    await insertUser();
    await expectSqlState(insertUser(OTHER_USER_ID, "user@example.com"), SQLSTATE.uniqueViolation, "users_email_key");
  });

  test("requires a bcrypt hash and a non-blank name", async () => {
    await expectSqlState(
      sql("INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'A', 'a@example.com', 'plaintext')", [USER_ID]),
      SQLSTATE.checkViolation, "users_password_hash_bcrypt",
    );
    await expectSqlState(
      sql("INSERT INTO users (id, name, email, password_hash) VALUES ($1, '  ', 'a@example.com', $2)", [USER_ID, BCRYPT_HASH]),
      SQLSTATE.checkViolation, "users_name_not_blank",
    );
  });

  test("updated_at follows updates", async () => {
    await sql(
      `INSERT INTO users (id, name, email, password_hash, created_at, updated_at)
       VALUES ($1, 'A', 'a@example.com', $2, '2024-01-01', '2024-01-01')`,
      [USER_ID, BCRYPT_HASH],
    );
    await sql("UPDATE users SET name = 'B'");
    const { rows } = await db.pool.query<{ created_at: Date; updated_at: Date }>("SELECT created_at, updated_at FROM users");
    expect(rows[0]?.updated_at.getTime()).toBeGreaterThan(rows[0]?.created_at.getTime() ?? Infinity);
  });
});

describe("products", () => {
  test("keeps the supplied UUID and applies defaults (stock 0, not enforced)", async () => {
    await sql("INSERT INTO products (id, image, name, price_cents) VALUES ($1, 'i.jpg', 'Kettle', 1999)", [PRODUCT_ID]);
    const { rows } = await sql("SELECT id, stock, rating_stars, rating_count, highlights, keywords, description FROM products");
    expect(rows).toEqual([{
      id: PRODUCT_ID, stock: 0, rating_stars: "0.0", rating_count: 0, highlights: [], keywords: [], description: "",
    }]);
  });

  test("generates a UUID when none is supplied", async () => {
    const { rows } = await db.pool.query<{ id: string }>(
      "INSERT INTO products (image, name, price_cents) VALUES ('i.jpg', 'Kettle', 1999) RETURNING id",
    );
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test.each([3.5, 4, 4.5, 5, 0])("accepts half-step rating %s", async (stars) => {
    await insertProduct(PRODUCT_ID, { rating_stars: stars });
  });

  test.each([
    ["negative price", { price_cents: -1 }, "products_price_cents_non_negative"],
    ["rating above 5", { rating_stars: 5.5 }, "products_rating_stars_half_steps"],
    ["rating not a half step", { rating_stars: 4.3 }, "products_rating_stars_half_steps"],
    ["negative rating count", { rating_count: -1 }, "products_rating_count_non_negative"],
    ["negative stock", { stock: -1 }, "products_stock_non_negative"],
    ["null highlight", { highlights: ["ok", null] }, "products_highlights_no_nulls"],
    ["null keyword", { keywords: [null] }, "products_keywords_no_nulls"],
    ["blank name", { name: "  " }, "products_name_not_blank"],
    ["blank image", { image: "" }, "products_image_not_blank"],
  ])("rejects %s", async (_label, overrides, constraint) => {
    await expectSqlState(insertProduct(PRODUCT_ID, overrides), SQLSTATE.checkViolation, constraint);
  });

  test("rejects fractional cents and malformed UUIDs instead of rounding", async () => {
    await expectSqlState(insertProduct(PRODUCT_ID, { price_cents: 10.5 }), SQLSTATE.invalidTextRepresentation);
    await expectSqlState(insertProduct("not-a-uuid"), SQLSTATE.invalidTextRepresentation);
  });
});

describe("delivery_options (digit-string ids kept)", () => {
  test("accepts the existing ids", async () => {
    await insertDeliveryOptions();
    const { rows } = await sql("SELECT id FROM delivery_options ORDER BY id");
    expect(rows).toEqual([{ id: "1" }, { id: "2" }, { id: "3" }]);
  });

  test.each(["", "abc", "1.5", PRODUCT_ID, "12345678901"])("rejects id %j", async (id) => {
    await expectSqlState(
      sql("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ($1, 1, 0)", [id]),
      SQLSTATE.checkViolation, "delivery_options_id_digits",
    );
  });

  test("rejects negative days and prices", async () => {
    await expectSqlState(
      sql("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', -1, 0)"),
      SQLSTATE.checkViolation, "delivery_options_days_non_negative",
    );
    await expectSqlState(
      sql("INSERT INTO delivery_options (id, delivery_days, price_cents) VALUES ('1', 1, -1)"),
      SQLSTATE.checkViolation, "delivery_options_price_cents_non_negative",
    );
  });
});

describe("carts and cart_items (D1 per-user carts, D3, FD1)", () => {
  beforeEach(async () => {
    await insertUser();
    await insertUser(OTHER_USER_ID, "other@example.com");
    await insertProduct();
    await insertDeliveryOptions();
  });

  test("each user has at most one cart, and a cart needs an existing user", async () => {
    await insertCart();
    await expectSqlState(insertCart(), SQLSTATE.uniqueViolation, "carts_user_id_key");
    await expectSqlState(insertCart("aaaaaaaaaaaaaaaaaaaaaaaa"), SQLSTATE.foreignKeyViolation, "carts_user_id_fkey");
  });

  test.each([1, 10])("accepts quantity %s", async (quantity) => {
    await insertCartItem(await insertCart(), PRODUCT_ID, quantity);
  });

  test.each([0, 11, -1])("rejects quantity %s", async (quantity) => {
    await expectSqlState(insertCartItem(await insertCart(), PRODUCT_ID, quantity), SQLSTATE.checkViolation, "cart_items_quantity_range");
  });

  test("rejects a fractional quantity instead of rounding it", async () => {
    await expectSqlState(insertCartItem(await insertCart(), PRODUCT_ID, 1.5), SQLSTATE.invalidTextRepresentation);
  });

  test("one line per product per cart, but different users can hold the same product", async () => {
    const cart = await insertCart();
    await insertCartItem(cart);
    await expectSqlState(insertCartItem(cart), SQLSTATE.uniqueViolation, "cart_items_cart_id_product_id_key");
    await insertCartItem(await insertCart(OTHER_USER_ID));
  });

  test("D3: a line may reference a product that does not exist, and survives product deletion", async () => {
    const cart = await insertCart();
    await insertCartItem(cart, DELETED_PRODUCT_ID);
    await insertCartItem(cart, PRODUCT_ID);
    await sql("DELETE FROM products WHERE id = $1", [PRODUCT_ID]);
    const { rows } = await sql("SELECT count(*)::int AS lines FROM cart_items");
    expect(rows).toEqual([{ lines: 2 }]);
  });

  test("delivery options must exist and cannot be deleted while in use", async () => {
    const cart = await insertCart();
    await expectSqlState(insertCartItem(cart, PRODUCT_ID, 1, "9"), SQLSTATE.foreignKeyViolation, "cart_items_delivery_option_id_fkey");
    await insertCartItem(cart, PRODUCT_ID, 1, "3");
    await expectSqlState(sql("DELETE FROM delivery_options WHERE id = '3'"), SQLSTATE.foreignKeyViolation);
  });

  test("deleting a user removes their cart and its lines", async () => {
    await insertCartItem(await insertCart());
    await sql("DELETE FROM users WHERE id = $1", [USER_ID]);
    const { rows } = await sql("SELECT (SELECT count(*) FROM carts)::int AS carts, (SELECT count(*) FROM cart_items)::int AS lines");
    expect(rows).toEqual([{ carts: 0, lines: 0 }]);
  });
});

describe("orders (D4 legacy history)", () => {
  beforeEach(async () => {
    await insertUser();
  });

  test("legacy orders may lack a user and customer details (6 of 8 existing orders)", async () => {
    await insertOrder({ isLegacy: true, userId: null, customer: [null, null, null, null, null, null, null] });
  });

  test("legacy orders with a user and complete customer details are accepted (2 of 8)", async () => {
    await insertOrder({ isLegacy: true });
  });

  test("application orders require a user and customer details", async () => {
    await expectSqlState(insertOrder({ userId: null }), SQLSTATE.checkViolation, "orders_new_order_has_user_and_customer");
    await expectSqlState(
      insertOrder({ customer: [null, null, null, null, null, null, null] }),
      SQLSTATE.checkViolation, "orders_new_order_has_user_and_customer",
    );
  });

  test("customer details are all present or all absent, and never blank", async () => {
    await expectSqlState(
      insertOrder({ isLegacy: true, customer: ["Ada", null, null, null, null, null, null] }),
      SQLSTATE.checkViolation, "orders_customer_all_or_nothing",
    );
    await expectSqlState(
      insertOrder({ customer: ["Ada", "a@example.com", " ", "1 Way", "London", "N1", "UK"] }),
      SQLSTATE.checkViolation, "orders_customer_not_blank",
    );
  });

  test("an order's user must exist, and a user with orders cannot be deleted", async () => {
    await expectSqlState(insertOrder({ userId: OTHER_USER_ID }), SQLSTATE.foreignKeyViolation, "orders_user_id_fkey");
    await insertOrder();
    await expectSqlState(sql("DELETE FROM users WHERE id = $1", [USER_ID]), SQLSTATE.foreignKeyViolation, "orders_user_id_fkey");
  });

  test("totals are non-negative whole cents", async () => {
    await expectSqlState(insertOrder({ totalCostCents: -1 }), SQLSTATE.checkViolation, "orders_total_cost_cents_non_negative");
    await expectSqlState(insertOrder({ totalCostCents: 10.5 }), SQLSTATE.invalidTextRepresentation);
  });

  test("order time keeps millisecond precision (orderTimeMs round-trips exactly)", async () => {
    await insertOrder();
    const { rows } = await db.pool.query<{ ordered_at: Date }>("SELECT ordered_at FROM orders");
    expect(rows[0]?.ordered_at.getTime()).toBe(1_790_167_054_005);
  });
});

describe("order_items (D4 snapshots and immutability)", () => {
  const LEGACY_ORDER_ID = "0e4111b0-cf69-448b-a3d1-ca2f5d6ba563";

  beforeEach(async () => {
    await insertUser();
    await insertOrder();
    await insertOrder({ id: LEGACY_ORDER_ID, isLegacy: true, userId: null, customer: [null, null, null, null, null, null, null] });
  });

  test("new-order lines with a complete snapshot are accepted", async () => {
    await insertOrderItem();
    const { rows } = await sql("SELECT snapshot_name, snapshot_price_cents, quantity FROM order_items");
    expect(rows).toEqual([{ snapshot_name: "Socks", snapshot_price_cents: 1090, quantity: 2 }]);
  });

  test("new-order lines without a snapshot are rejected", async () => {
    await expect(insertOrderItem({ snapshot: NO_SNAPSHOT })).rejects.toMatchObject({
      code: SQLSTATE.checkViolation,
      message: "order_items of a non-legacy order require a product snapshot",
    });
  });

  test("legacy lines may lack a snapshot and reference a deleted product (no invented data)", async () => {
    await insertOrderItem({ orderId: LEGACY_ORDER_ID, productId: DELETED_PRODUCT_ID, snapshot: NO_SNAPSHOT });
    const { rows } = await sql(
      `SELECT oi.product_id, oi.snapshot_name, p.id AS current_product
         FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id`,
    );
    expect(rows).toEqual([{ product_id: DELETED_PRODUCT_ID, snapshot_name: null, current_product: null }]);
  });

  test("snapshots are all-or-nothing with a non-blank name", async () => {
    await expectSqlState(
      insertOrderItem({ snapshot: ["Socks", null, 1090, null, null] }),
      SQLSTATE.checkViolation, "order_items_snapshot_all_or_nothing",
    );
    await expectSqlState(
      insertOrderItem({ orderId: LEGACY_ORDER_ID, snapshot: ["Socks", "i.jpg", null, "", ""] }),
      SQLSTATE.checkViolation, "order_items_snapshot_all_or_nothing",
    );
    await expectSqlState(
      insertOrderItem({ snapshot: [" ", "i.jpg", 1090, "", ""] }),
      SQLSTATE.checkViolation, "order_items_snapshot_name_not_blank",
    );
  });

  test("lines are immutable: snapshot, price and quantity cannot be updated", async () => {
    await insertOrderItem();
    for (const change of ["snapshot_price_cents = 1", "snapshot_name = 'Renamed'", "quantity = 3"]) {
      await expect(sql(`UPDATE order_items SET ${change}`)).rejects.toMatchObject({
        code: SQLSTATE.restrictViolation,
        message: "order_items are immutable",
      });
    }
    const { rows } = await sql("SELECT snapshot_name, snapshot_price_cents, quantity FROM order_items");
    expect(rows).toEqual([{ snapshot_name: "Socks", snapshot_price_cents: 1090, quantity: 2 }]);
  });

  test("quantity is at least 1 but has no upper bound (history may exceed the cart limit)", async () => {
    await expectSqlState(insertOrderItem({ quantity: 0 }), SQLSTATE.checkViolation, "order_items_quantity_positive");
    await insertOrderItem({ quantity: 16 });
  });

  test("line positions are unique per order", async () => {
    await insertOrderItem();
    await expectSqlState(insertOrderItem(), SQLSTATE.uniqueViolation, "order_items_pkey");
    await insertOrderItem({ position: 1, productId: OTHER_PRODUCT_ID });
  });
});

describe("order status and financial history (0002)", () => {
  const LEGACY_ORDER_ID = "0e4111b0-cf69-448b-a3d1-ca2f5d6ba563";

  const status = async (id = ORDER_ID) => (
    await db.pool.query<{ status: string | null; status_updated_at: Date | null }>(
      "SELECT status, status_updated_at FROM orders WHERE id = $1", [id],
    )
  ).rows[0];

  // 0003: status changes go through the audited function only.
  const setStatus = (to: string | null, id = ORDER_ID) => sql(
    "SELECT * FROM change_order_status($1, $2, $3, $4)", [id, to, USER_ID, "test transition"],
  );

  beforeEach(async () => {
    await insertUser();
    await insertOrder();
    await insertOrder({ id: LEGACY_ORDER_ID, isLegacy: true, userId: null, customer: [null, null, null, null, null, null, null] });
    await insertOrderItem();
  });

  test("application orders must have a known status with its timestamp", async () => {
    await expectSqlState(
      insertOrder({ id: OTHER_PRODUCT_ID, status: null }), SQLSTATE.checkViolation, "orders_new_order_has_status",
    );
    await expectSqlState(insertOrder({ id: OTHER_PRODUCT_ID, status: "lost" }), SQLSTATE.checkViolation, "orders_status_known");
    await expectSqlState(
      sql(
        `INSERT INTO orders (id, is_legacy, ordered_at, total_cost_cents, status, status_updated_at)
         VALUES ($1, true, now(), 0, NULL, now())`,
        [OTHER_PRODUCT_ID],
      ),
      SQLSTATE.checkViolation, "orders_status_timestamp_together",
    );
  });

  test("follows the allowed path placed -> processing -> shipped -> delivered, stamping each change", async () => {
    const placed = await status();
    expect(placed?.status).toBe("placed");
    for (const next of ["processing", "shipped", "delivered"]) {
      await setStatus(next);
      const current = await status();
      expect(current?.status).toBe(next);
      expect(current?.status_updated_at?.getTime()).toBeGreaterThanOrEqual(placed?.status_updated_at?.getTime() ?? Infinity);
    }
  });

  test.each([
    ["placed", "cancelled", true],
    ["placed", "shipped", false],
    ["placed", "delivered", false],
    ["placed", null, false],
  ])("transition %s -> %s allowed: %s", async (_from, to, allowed) => {
    if (allowed) {
      await setStatus(to);
      expect((await status())?.status).toBe(to);
    } else {
      await expect(setStatus(to)).rejects.toMatchObject({
        code: SQLSTATE.checkViolation,
        message: `order status transition placed -> ${to ?? "none"} is not allowed`,
      });
    }
  });

  test("terminal states cannot move again", async () => {
    await setStatus("cancelled");
    await expectSqlState(setStatus("processing"), SQLSTATE.checkViolation);
    await setStatus("delivered").catch(() => {});
    expect((await status())?.status).toBe("cancelled");
  });

  test("legacy orders keep no invented status; only an audited change may close them (0003)", async () => {
    expect(await status(LEGACY_ORDER_ID)).toEqual({ status: null, status_updated_at: null });
    await expect(setStatus("shipped", LEGACY_ORDER_ID)).rejects.toMatchObject({
      message: "order status transition none -> shipped is not allowed",
    });
    await setStatus("delivered", LEGACY_ORDER_ID);
    expect((await status(LEGACY_ORDER_ID))?.status).toBe("delivered");
  });

  test("a direct UPDATE of status is rejected; only change_order_status() may change it (0003)", async () => {
    await expect(sql("UPDATE orders SET status = 'processing' WHERE id = $1", [ORDER_ID])).rejects.toMatchObject({
      code: SQLSTATE.restrictViolation,
      message: "order status changes must go through change_order_status()",
    });
    expect((await status())?.status).toBe("placed");
  });

  test("status_updated_at cannot be edited without a status change", async () => {
    const before = await status();
    await sql("UPDATE orders SET status_updated_at = '2000-01-01' WHERE id = $1", [ORDER_ID]);
    expect(await status()).toEqual(before);
  });

  test.each([
    ["total_cost_cents = 1"],
    ["customer_email = 'changed@example.com'"],
    ["user_id = NULL"],
    ["ordered_at = now()"],
    ["is_legacy = true"],
    ["created_at = now()"],
  ])("financial history is immutable: SET %s is rejected", async (change) => {
    await expect(sql(`UPDATE orders SET ${change} WHERE id = $1`, [ORDER_ID])).rejects.toMatchObject({
      code: SQLSTATE.restrictViolation,
      message: "order financial history is immutable",
    });
  });

  test("orders and their lines cannot be deleted row by row; TRUNCATE (controlled rollback) still works", async () => {
    await expect(sql("DELETE FROM order_items")).rejects.toMatchObject({
      code: SQLSTATE.restrictViolation, message: "order_items rows cannot be deleted",
    });
    await expect(sql("DELETE FROM orders WHERE id = $1", [ORDER_ID])).rejects.toMatchObject({
      code: SQLSTATE.restrictViolation, message: "orders rows cannot be deleted",
    });
    // order_status_events references orders (0003), so a controlled TRUNCATE names it too.
    await sql("TRUNCATE order_status_events, order_items, orders");
    const { rows } = await sql("SELECT (SELECT count(*) FROM orders)::int AS orders, (SELECT count(*) FROM order_items)::int AS lines");
    expect(rows).toEqual([{ orders: 0, lines: 0 }]);
  });
});

describe("timestamps and import audit (0002)", () => {
  test("an explicitly supplied updated_at is kept; otherwise updates stamp now()", async () => {
    await sql(
      `INSERT INTO delivery_options (id, delivery_days, price_cents, created_at, updated_at)
       VALUES ('1', 7, 0, '2024-06-10T10:00:00.123Z', '2024-06-10T10:00:00.123Z')`,
    );
    await sql("UPDATE delivery_options SET price_cents = 5, updated_at = '2024-06-11T09:30:00.456Z'");
    const kept = await db.pool.query<{ updated_at: Date }>("SELECT updated_at FROM delivery_options");
    expect(kept.rows[0]?.updated_at.toISOString()).toBe("2024-06-11T09:30:00.456Z");

    await sql("UPDATE delivery_options SET price_cents = 6");
    const stamped = await db.pool.query<{ updated_at: Date }>("SELECT updated_at FROM delivery_options");
    expect(stamped.rows[0]?.updated_at.getUTCFullYear()).toBeGreaterThan(2024);
  });

  test("data_import_runs accepts only known operations and outcomes", async () => {
    const insertRun = (operation: string, outcome: string) => sql(
      `INSERT INTO data_import_runs (operation, outcome, started_at, finished_at, summary)
       VALUES ($1, $2, now(), now(), '{}')`,
      [operation, outcome],
    );
    await insertRun("import", "succeeded");
    await expectSqlState(insertRun("delete", "succeeded"), SQLSTATE.checkViolation, "data_import_runs_operation_known");
    await expectSqlState(insertRun("import", "partial"), SQLSTATE.checkViolation, "data_import_runs_outcome_known");
  });
});
