// PostgreSQL implementations (Phase 3C). Parameterised SQL only: every value
// is a $n parameter; identifiers are constants. Responses use the same wire
// shapes as the MongoDB implementation (types/api.ts), with the intentional
// differences documented in MIGRATION_PLAN.md (owned carts, order status).
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import type { Pool, PoolClient } from "pg";
import { sqlState, constraintOf, withTransaction } from "../db/pool.js";
import type { CustomerDetails } from "../types/api.js";
import { isDeliveryOptionId, isOrderId, isProductId, isUserId } from "../utils/identifiers.js";
import {
  CartQuantityError,
  DataValidationError,
  DuplicateKeyError,
  type AuthUser,
  type CartLineRecord,
  type CartOwner,
  type CartRepository,
  type CheckoutResult,
  type DeliveryOptionRecord,
  type DeliveryOptionRepository,
  type OrderRepository,
  type OrderStatus,
  type ProductDetails,
  type ProductRecord,
  type ProductRepository,
  type StatusChangeResult,
  type UserRepository,
  type Viewer,
} from "./types.js";
import { verifyWithoutAccount } from "../utils/passwords.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// ------------------------------------------------------------ delivery options

interface DeliveryOptionRow {
  id: string;
  delivery_days: number;
  price_cents: number;
  created_at: Date;
  updated_at: Date;
}

const DELIVERY_OPTION_COLUMNS = "id, delivery_days, price_cents, created_at, updated_at";

const toDeliveryOption = (row: DeliveryOptionRow): DeliveryOptionRecord => ({
  deliveryDays: row.delivery_days,
  priceCents: row.price_cents,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  id: row.id,
});

export class PostgresDeliveryOptionRepository implements DeliveryOptionRepository {
  readonly source = "postgres";

  constructor(private readonly pool: Pool) {}

  async list() {
    const { rows } = await this.pool.query<DeliveryOptionRow>(
      `SELECT ${DELIVERY_OPTION_COLUMNS} FROM delivery_options ORDER BY created_at, id`,
    );
    return rows.map(toDeliveryOption);
  }

  async findById(id: string) {
    if (!isDeliveryOptionId(id)) return null;
    const { rows: [row] } = await this.pool.query<DeliveryOptionRow>(
      `SELECT ${DELIVERY_OPTION_COLUMNS} FROM delivery_options WHERE id = $1`, [id],
    );
    return row ? toDeliveryOption(row) : null;
  }
}

// ------------------------------------------------------------------- products

interface ProductRow {
  id: string;
  image: string;
  name: string;
  description: string;
  how_it_works: string;
  highlights: string[];
  care_instructions: string;
  category: string;
  stock: number;
  rating_stars: number;
  rating_count: number;
  price_cents: number;
  keywords: string[];
  created_at: Date;
  updated_at: Date;
}

const PRODUCT_COLUMNS = `id::text AS id, image, name, description, how_it_works, highlights, care_instructions,
  category, stock, rating_stars::float8 AS rating_stars, rating_count, price_cents, keywords, created_at, updated_at`;

// Field order of a product created through the API (schema order, id last).
const toProduct = (row: ProductRow): ProductRecord => ({
  image: row.image,
  name: row.name,
  description: row.description,
  howItWorks: row.how_it_works,
  highlights: row.highlights,
  careInstructions: row.care_instructions,
  category: row.category,
  stock: row.stock,
  rating: { stars: row.rating_stars, count: row.rating_count },
  priceCents: row.price_cents,
  keywords: row.keywords,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  id: row.id,
});

const productParameters = (details: ProductDetails) => [
  details.image, details.name, details.description, details.howItWorks, details.highlights,
  details.careInstructions, details.category, details.stock, details.priceCents, details.keywords,
];

/** Turns CHECK/NOT NULL violations into the ValidationError the controllers map to 400. */
function rethrowValidation(error: unknown): never {
  const state = sqlState(error);
  if (state === "23514" || state === "23502" || state === "22P02") {
    throw new DataValidationError(`Invalid data${constraintOf(error) ? ` (${constraintOf(error)})` : ""}`, { cause: error });
  }
  throw error;
}

export class PostgresProductRepository implements ProductRepository {
  readonly source = "postgres";

  constructor(private readonly pool: Pool) {}

  async list() {
    const { rows } = await this.pool.query<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY created_at, id`);
    return rows.map(toProduct);
  }

  async findById(id: string) {
    // Ids that cannot be UUIDs cannot exist (and would be a cast error).
    if (!isProductId(id)) return null;
    const { rows: [row] } = await this.pool.query<ProductRow>(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = $1`, [id]);
    return row ? toProduct(row) : null;
  }

  async create(details: ProductDetails) {
    try {
      const { rows: [row] } = await this.pool.query<ProductRow>(
        `INSERT INTO products (image, name, description, how_it_works, highlights, care_instructions,
                               category, stock, price_cents, keywords, rating_stars, rating_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, 0)
         RETURNING ${PRODUCT_COLUMNS}`,
        productParameters(details),
      );
      if (!row) throw new Error("INSERT returned no row");
      return toProduct(row);
    } catch (error) {
      return rethrowValidation(error);
    }
  }

  async update(id: string, details: ProductDetails) {
    if (!isProductId(id)) return null;
    try {
      const { rows: [row] } = await this.pool.query<ProductRow>(
        `UPDATE products
            SET image = $2, name = $3, description = $4, how_it_works = $5, highlights = $6,
                care_instructions = $7, category = $8, stock = $9, price_cents = $10, keywords = $11
          WHERE id = $1
          RETURNING ${PRODUCT_COLUMNS}`,
        [id, ...productParameters(details)],
      );
      return row ? toProduct(row) : null;
    } catch (error) {
      return rethrowValidation(error);
    }
  }

  async delete(id: string) {
    if (!isProductId(id)) return null;
    // Cart and order lines keep the id (no foreign key): D3 and D4.
    const { rows: [row] } = await this.pool.query<{ id: string }>("DELETE FROM products WHERE id = $1 RETURNING id::text AS id", [id]);
    return row ? { id: row.id } : null;
  }
}

// ---------------------------------------------------------------------- users

interface UserRow {
  id: string;
  name: string;
  email: string;
  is_admin: boolean;
}

const toUser = (row: UserRow): AuthUser => ({ id: row.id, name: row.name, email: row.email, isAdmin: row.is_admin });

export class PostgresUserRepository implements UserRepository {
  readonly source = "postgres";

  constructor(private readonly pool: Pool) {}

  async findById(id: string) {
    if (!isUserId(id)) return null;
    const { rows: [row] } = await this.pool.query<UserRow>("SELECT id, name, email, is_admin FROM users WHERE id = $1", [id]);
    return row ? toUser(row) : null;
  }

  async findByEmail(email: string) {
    const { rows: [row] } = await this.pool.query<UserRow>("SELECT id, name, email, is_admin FROM users WHERE email = $1", [email]);
    return row ? toUser(row) : null;
  }

  async authenticate(email: string, password: string) {
    const { rows: [row] } = await this.pool.query<UserRow & { password_hash: string }>(
      "SELECT id, name, email, is_admin, password_hash FROM users WHERE email = $1", [email],
    );
    if (!row?.password_hash) {
      return verifyWithoutAccount(password).then(() => null);
    }
    if (!(await bcrypt.compare(password, row.password_hash))) {
      return null;
    }
    return toUser(row);
  }

  async create(details: { name: string; email: string; password: string }) {
    // Same rules as the Mongoose model: bcrypt reads at most 72 bytes; cost 12.
    if (Buffer.byteLength(details.password, "utf8") > 72) {
      throw new DataValidationError("Password must be no more than 72 bytes");
    }
    if (details.password.length < 8) {
      throw new DataValidationError("Password must be at least 8 characters");
    }
    const passwordHash = await bcrypt.hash(details.password, 12);
    // D2: user ids stay MongoDB-style ObjectIds, now generated by the application.
    const id = new mongoose.Types.ObjectId().toHexString();

    try {
      const { rows: [row] } = await this.pool.query<UserRow>(
        `INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, is_admin`,
        [id, details.name, details.email, passwordHash],
      );
      if (!row) throw new Error("INSERT returned no row");
      return toUser(row);
    } catch (error) {
      if (sqlState(error) === "23505") throw new DuplicateKeyError("User already exists", { cause: error });
      return rethrowValidation(error);
    }
  }
}

// ---------------------------------------------------------------------- carts

interface CartLineRow {
  id: string;
  product_id: string;
  quantity: number;
  delivery_option_id: string;
  created_at: Date;
  updated_at: Date;
}

const CART_LINE_COLUMNS = `ci.id::text AS id, ci.product_id::text AS product_id, ci.quantity, ci.delivery_option_id,
  ci.created_at, ci.updated_at`;

const toCartLine = (row: CartLineRow): CartLineRecord => ({
  productId: row.product_id,
  quantity: row.quantity,
  deliveryOptionId: row.delivery_option_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  id: row.id,
});

function requireOwner(owner: CartOwner): string {
  if (!owner) throw new Error("PostgreSQL carts belong to a user (D1); an authenticated owner is required");
  return owner;
}

/** Maps constraint violations to the errors the cart controller understands. */
function rethrowCartError(error: unknown): never {
  if (constraintOf(error) === "cart_items_quantity_range") {
    throw new CartQuantityError("Quantity must be between 1 and 10", { cause: error });
  }
  if (constraintOf(error) === "cart_items_delivery_option_id_fkey") {
    throw new DataValidationError("Invalid delivery option", { cause: error });
  }
  throw error;
}

/** D1: one cart per user, created on first use. */
export class PostgresCartRepository implements CartRepository {
  readonly source = "postgres";
  readonly ownership = "per-user";

  constructor(private readonly pool: Pool) {}

  async list(owner: CartOwner) {
    const { rows } = await this.pool.query<CartLineRow>(
      `SELECT ${CART_LINE_COLUMNS}
         FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
        WHERE c.user_id = $1
        ORDER BY ci.created_at, ci.id`,
      [requireOwner(owner)],
    );
    return rows.map(toCartLine);
  }

  async find(owner: CartOwner, productId: string) {
    if (!isProductId(productId)) return null;
    const { rows: [row] } = await this.pool.query<CartLineRow>(
      `SELECT ${CART_LINE_COLUMNS}
         FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
        WHERE c.user_id = $1 AND ci.product_id = $2`,
      [requireOwner(owner), productId],
    );
    return row ? toCartLine(row) : null;
  }

  async add(owner: CartOwner, productId: string, quantity: number) {
    // One statement: creates the cart if needed, then inserts the line or adds
    // to it atomically. The CHECK constraint enforces the 1-10 limit (FD1).
    try {
      const { rows: [row] } = await this.pool.query<CartLineRow>(
        `WITH cart AS (
           INSERT INTO carts (user_id) VALUES ($1)
           ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
           RETURNING id
         )
         INSERT INTO cart_items AS ci (cart_id, product_id, quantity, delivery_option_id)
         SELECT cart.id, $2, $3, '1' FROM cart
         ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = ci.quantity + EXCLUDED.quantity
         RETURNING ${CART_LINE_COLUMNS}`,
        [requireOwner(owner), productId, quantity],
      );
      if (!row) throw new Error("INSERT returned no row");
      return toCartLine(row);
    } catch (error) {
      return rethrowCartError(error);
    }
  }

  async update(owner: CartOwner, productId: string, changes: { quantity?: number; deliveryOptionId?: string }) {
    if (!isProductId(productId)) return null;
    try {
      const { rows: [row] } = await this.pool.query<CartLineRow>(
        `UPDATE cart_items ci
            SET quantity = COALESCE($3, ci.quantity),
                delivery_option_id = COALESCE($4, ci.delivery_option_id)
           FROM carts c
          WHERE c.id = ci.cart_id AND c.user_id = $1 AND ci.product_id = $2
          RETURNING ${CART_LINE_COLUMNS}`,
        [requireOwner(owner), productId, changes.quantity ?? null, changes.deliveryOptionId ?? null],
      );
      return row ? toCartLine(row) : null;
    } catch (error) {
      return rethrowCartError(error);
    }
  }

  async remove(owner: CartOwner, productId: string) {
    if (!isProductId(productId)) return false;
    const { rowCount } = await this.pool.query(
      `DELETE FROM cart_items ci USING carts c
        WHERE c.id = ci.cart_id AND c.user_id = $1 AND ci.product_id = $2`,
      [requireOwner(owner), productId],
    );
    return (rowCount ?? 0) > 0;
  }
}

// --------------------------------------------------------------------- orders

interface OrderRow {
  id: string;
  user_id: string | null;
  customer_full_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_postal_code: string | null;
  customer_country: string | null;
  ordered_at: Date;
  total_cost_cents: number;
  created_at: Date;
  updated_at: Date;
  status: string | null;
}

const sameCustomer = (row: OrderRow, customer: CustomerDetails) => (
  row.customer_full_name === customer.fullName && row.customer_email === customer.email
  && row.customer_phone === customer.phone && row.customer_address === customer.address
  && row.customer_city === customer.city && row.customer_postal_code === customer.postalCode
  && row.customer_country === customer.country
);

interface OrderLineRow {
  order_id: string;
  position: number;
  product_id: string;
  quantity: number;
  estimated_delivery_at: Date;
  snapshot_name: string | null;
  snapshot_image: string | null;
  snapshot_price_cents: number | null;
  snapshot_description: string | null;
  snapshot_category: string | null;
}

/** An order line joined with the current product (for legacy lines). */
type OrderLineWithProduct = OrderLineRow & { [Key in keyof ProductRow as `p_${Key}`]: ProductRow[Key] | null };

const ORDER_COLUMNS = `id::text AS id, user_id, customer_full_name, customer_email, customer_phone, customer_address,
  customer_city, customer_postal_code, customer_country, ordered_at, total_cost_cents, created_at, updated_at, status`;

const ORDER_LINE_SELECT = `
  SELECT oi.order_id::text AS order_id, oi.position, oi.product_id::text AS product_id, oi.quantity,
         oi.estimated_delivery_at, oi.snapshot_name, oi.snapshot_image, oi.snapshot_price_cents,
         oi.snapshot_description, oi.snapshot_category,
         p.id::text AS p_id, p.image AS p_image, p.name AS p_name, p.description AS p_description,
         p.how_it_works AS p_how_it_works, p.highlights AS p_highlights, p.care_instructions AS p_care_instructions,
         p.category AS p_category, p.stock AS p_stock, p.rating_stars::float8 AS p_rating_stars,
         p.rating_count AS p_rating_count, p.price_cents AS p_price_cents, p.keywords AS p_keywords,
         p.created_at AS p_created_at, p.updated_at AS p_updated_at
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
   WHERE oi.order_id = ANY($1::uuid[])
   ORDER BY oi.order_id, oi.position`;

function currentProduct(line: OrderLineWithProduct): ProductRecord | null {
  if (line.p_id === null || line.p_image === null || line.p_name === null || line.p_description === null
    || line.p_how_it_works === null || line.p_highlights === null || line.p_care_instructions === null
    || line.p_category === null || line.p_stock === null || line.p_rating_stars === null || line.p_rating_count === null
    || line.p_price_cents === null || line.p_keywords === null || line.p_created_at === null || line.p_updated_at === null) {
    return null;
  }
  return toProduct({
    id: line.p_id, image: line.p_image, name: line.p_name, description: line.p_description,
    how_it_works: line.p_how_it_works, highlights: line.p_highlights, care_instructions: line.p_care_instructions,
    category: line.p_category, stock: line.p_stock, rating_stars: line.p_rating_stars, rating_count: line.p_rating_count,
    price_cents: line.p_price_cents, keywords: line.p_keywords, created_at: line.p_created_at, updated_at: line.p_updated_at,
  });
}

/** Same wire shape as the MongoDB order JSON; legacy fields are omitted, never invented. */
function toOrderJson(row: OrderRow, lines: OrderLineWithProduct[], expandProducts: boolean) {
  const json: Record<string, unknown> = {};
  if (row.user_id !== null) json.userId = row.user_id;
  if (row.customer_full_name !== null) {
    json.customer = {
      fullName: row.customer_full_name,
      email: row.customer_email,
      phone: row.customer_phone,
      address: row.customer_address,
      city: row.customer_city,
      postalCode: row.customer_postal_code,
      country: row.customer_country,
    };
  }
  json.orderTimeMs = row.ordered_at.getTime();
  json.totalCostCents = row.total_cost_cents;
  json.products = lines.map((line) => {
    const base = { productId: line.product_id };
    const timing = { quantity: line.quantity, estimatedDeliveryTimeMs: line.estimated_delivery_at.getTime() };
    if (line.snapshot_name !== null) {
      return {
        ...base,
        product: {
          id: line.product_id,
          image: line.snapshot_image,
          name: line.snapshot_name,
          priceCents: line.snapshot_price_cents,
          description: line.snapshot_description,
          category: line.snapshot_category,
        },
        ...timing,
      };
    }
    // Legacy line: no snapshot. With ?expand=products the current product
    // (or null when it was deleted) is attached, as the MongoDB API does.
    return expandProducts ? { ...base, ...timing, product: currentProduct(line) } : { ...base, ...timing };
  });
  json.createdAt = row.created_at;
  json.updatedAt = row.updated_at;
  json.id = row.id;
  // Phase 3C addition: operational status (null for legacy orders).
  json.status = row.status;
  return json;
}

class InsufficientStock extends Error {
  constructor(readonly productIds: string[]) {
    super("Insufficient stock");
  }
}

interface CheckoutLineRow {
  product_id: string;
  quantity: number;
  delivery_option_id: string;
  p_id: string | null;
  p_image: string | null;
  p_name: string | null;
  p_price_cents: number | null;
  p_description: string | null;
  p_category: string | null;
  p_inventory_tracked: boolean | null;
  d_days: number | null;
  d_price_cents: number | null;
}

export class PostgresOrderRepository implements OrderRepository {
  readonly source = "postgres";

  constructor(private readonly pool: Pool) {}

  private async withLines(queryable: Pool | PoolClient, rows: OrderRow[], expandProducts: boolean) {
    if (rows.length === 0) return [];
    const { rows: lines } = await queryable.query<OrderLineWithProduct>(ORDER_LINE_SELECT, [rows.map((row) => row.id)]);
    return rows.map((row) => toOrderJson(row, lines.filter((line) => line.order_id === row.id), expandProducts));
  }

  async list(viewer: Viewer, expandProducts: boolean): Promise<unknown[]> {
    const { rows } = await this.pool.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE $1 OR user_id = $2 ORDER BY ordered_at DESC, id`,
      [viewer.isAdmin, viewer.id],
    );
    return this.withLines(this.pool, rows, expandProducts);
  }

  async get(orderId: string, viewer: Viewer, expandProducts: boolean): Promise<unknown> {
    if (!isOrderId(orderId)) return null;
    const { rows } = await this.pool.query<OrderRow>(
      `SELECT ${ORDER_COLUMNS} FROM orders WHERE id = $1 AND ($2 OR user_id = $3)`,
      [orderId, viewer.isAdmin, viewer.id],
    );
    const [order] = await this.withLines(this.pool, rows, expandProducts);
    return order ?? null;
  }

  async checkout(owner: CartOwner, user: AuthUser, customer: CustomerDetails, idempotencyKey?: string): Promise<CheckoutResult> {
    const userId = requireOwner(owner);
    try {
      return await withTransaction(this.pool, async (client): Promise<CheckoutResult> => {
        // A key replays only the request it was first used with. The customer
        // details are the whole request body and are stored on the order in
        // the same normalised form, so they identify that request exactly.
        const existingOrder = async (): Promise<CheckoutResult | null> => {
          if (!idempotencyKey) return null;
          const { rows } = await client.query<OrderRow>(
            `SELECT ${ORDER_COLUMNS} FROM orders WHERE user_id = $1 AND checkout_key = $2`,
            [userId, idempotencyKey],
          );
          const [row] = rows;
          if (!row) return null;
          if (!sameCustomer(row, customer)) return { kind: "key-reused" };
          const [order] = await this.withLines(client, [row], false);
          return { kind: "placed", order };
        };

        // A retry can still recover its order even if the cart row was later
        // removed administratively. This first lookup is only a fast path;
        // the lookup after the cart lock is the concurrency guarantee.
        const replay = await existingOrder();
        if (replay) return replay;

        // Locks this user's cart: concurrent checkouts of the same cart run one at a time.
        const { rows: [cart] } = await client.query<{ id: string }>(
          "SELECT id::text AS id FROM carts WHERE user_id = $1 FOR UPDATE", [userId],
        );
        if (!cart) return { kind: "empty" };

        const replayAfterLock = await existingOrder();
        if (replayAfterLock) return replayAfterLock;

        const { rows: lines } = await client.query<CheckoutLineRow>(
          `SELECT ci.product_id::text AS product_id, ci.quantity, ci.delivery_option_id,
                  p.id::text AS p_id, p.image AS p_image, p.name AS p_name, p.price_cents AS p_price_cents,
                  p.description AS p_description, p.category AS p_category, p.inventory_tracked AS p_inventory_tracked,
                  d.delivery_days AS d_days, d.price_cents AS d_price_cents
             FROM cart_items ci
             LEFT JOIN products p ON p.id = ci.product_id
             LEFT JOIN delivery_options d ON d.id = ci.delivery_option_id
            WHERE ci.cart_id = $1
            ORDER BY ci.created_at, ci.id`,
          [cart.id],
        );
        if (lines.length === 0) return { kind: "empty" };

        const unavailable = lines.filter((line) => line.p_id === null).map((line) => line.product_id);
        if (unavailable.length > 0) return { kind: "unavailable", productIds: unavailable };

        const priced = lines.flatMap((line) => (
          line.p_image !== null && line.p_name !== null && line.p_price_cents !== null && line.p_description !== null
          && line.p_category !== null && line.d_days !== null && line.d_price_cents !== null
            ? [{
              productId: line.product_id, quantity: line.quantity, deliveryOptionId: line.delivery_option_id,
              image: line.p_image, name: line.p_name, priceCents: line.p_price_cents, description: line.p_description,
              category: line.p_category, inventoryTracked: line.p_inventory_tracked === true,
              deliveryDays: line.d_days, deliveryPriceCents: line.d_price_cents,
            }]
            : []
        ));
        if (priced.length !== lines.length) return { kind: "invalid-delivery" };

        // Stock is enforced only where inventory is tracked. Updates run in
        // product-id order so concurrent checkouts lock rows consistently.
        const tracked = priced.filter((line) => line.inventoryTracked).sort((a, b) => a.productId.localeCompare(b.productId));
        const shortages: string[] = [];
        for (const line of tracked) {
          const { rowCount } = await client.query(
            "UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2", [line.productId, line.quantity],
          );
          if ((rowCount ?? 0) === 0) shortages.push(line.productId);
        }
        if (shortages.length > 0) throw new InsufficientStock(shortages);

        // Same arithmetic as the MongoDB implementation (rounding included).
        const now = Date.now();
        let totalCostBeforeTaxCents = 0;
        for (const line of priced) {
          totalCostBeforeTaxCents += line.priceCents * line.quantity + line.deliveryPriceCents;
        }

        const { rows: [order] } = await client.query<OrderRow>(
          `INSERT INTO orders (is_legacy, user_id, customer_full_name, customer_email, customer_phone, customer_address,
                               customer_city, customer_postal_code, customer_country, ordered_at, total_cost_cents,
                               status, status_updated_at, checkout_key)
           VALUES (false, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'placed', now(), $11)
           RETURNING ${ORDER_COLUMNS}`,
          [userId, customer.fullName, customer.email, customer.phone, customer.address, customer.city,
            customer.postalCode, customer.country, new Date(now), Math.round(totalCostBeforeTaxCents * 1.1),
            idempotencyKey ?? null],
        );
        if (!order) throw new Error("INSERT returned no order");

        // Immutable snapshots (D4): name, image, price, description, category as sold.
        const values: unknown[] = [];
        const tuples = priced.map((line, position) => {
          values.push(order.id, position, line.productId, line.quantity, new Date(now + line.deliveryDays * DAY_MS),
            line.name, line.image, line.priceCents, line.description, line.category);
          const offset = position * 10;
          return `(${Array.from({ length: 10 }, (_, column) => `$${offset + column + 1}`).join(", ")})`;
        });
        await client.query(
          `INSERT INTO order_items (order_id, position, product_id, quantity, estimated_delivery_at, snapshot_name,
                                   snapshot_image, snapshot_price_cents, snapshot_description, snapshot_category)
           VALUES ${tuples.join(", ")}`,
          values,
        );

        await client.query(
          `INSERT INTO order_status_events (order_id, from_status, to_status, changed_by, reason)
           VALUES ($1, NULL, 'placed', $2, 'order placed')`,
          [order.id, user.id],
        );

        // D1: only this user's cart is cleared.
        await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cart.id]);

        const [json] = await this.withLines(client, [order], false);
        return { kind: "placed", order: json };
      });
    } catch (error) {
      if (error instanceof InsufficientStock) {
        return { kind: "insufficient-stock", productIds: error.productIds };
      }
      throw error;
    }
  }

  async changeStatus(orderId: string, status: OrderStatus, actor: AuthUser, reason: string): Promise<StatusChangeResult> {
    if (!isOrderId(orderId)) return { kind: "not-found" };
    try {
      await this.pool.query("SELECT id FROM change_order_status($1, $2, $3, $4)", [orderId, status, actor.id, reason]);
    } catch (error) {
      if (sqlState(error) === "P0002") return { kind: "not-found" };
      if (sqlState(error) === "23514" && error instanceof Error && error.message.startsWith("order status transition")) {
        return { kind: "not-allowed", message: `Order status transition ${error.message.replace("order status transition ", "")}` };
      }
      throw error;
    }
    const order = await this.get(orderId, { id: actor.id, isAdmin: true }, false);
    return order ? { kind: "changed", order } : { kind: "not-found" };
  }
}
