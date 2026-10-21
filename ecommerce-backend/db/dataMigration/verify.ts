// Compares PostgreSQL with the MongoDB source, field by field.
//
// The expected values are read straight from the raw source documents here,
// independently of plan.ts's mapping, so a mapping bug in the importer shows
// up as a mismatch instead of being confirmed by the same code. Only the set
// of valid records (and the deleted-owner rule) comes from the plan.
import mongoose from "mongoose";
import type { Pool } from "pg";
import { EXCLUDED_CART_COLLECTION, IMPORTED_COLLECTIONS, type ImportedCollection, type MigrationPlan } from "./plan.js";
import type { FieldMismatch, TableVerification, VerificationResult } from "./report.js";
import type { SourceDocument, SourceSnapshot } from "./source.js";

const { ObjectId } = mongoose.mongo;
const MAX_REPORTED_MISMATCHES = 500;

type Row = Record<string, unknown>;

const sourceId = (document: SourceDocument) => (
  document._id instanceof ObjectId ? document._id.toHexString() : String(document._id)
);

const asRecord = (value: unknown): Row => (
  typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {}
);

// Dates compare by epoch milliseconds; numeric strings (rating_stars) by value.
const normalise = (value: unknown): unknown => {
  if (value instanceof Date) return value.getTime();
  if (value instanceof ObjectId) return value.toHexString();
  if (Array.isArray(value)) return value.map(normalise);
  return value;
};

const same = (expected: unknown, actual: unknown) => JSON.stringify(normalise(expected)) === JSON.stringify(normalise(actual));

const timeOf = (value: unknown) => (typeof value === "number" ? new Date(value) : value);

// [destination column, expected value from the raw source document]
function expectedDeliveryOption(document: SourceDocument): [string, unknown][] {
  return [
    ["delivery_days", document.deliveryDays],
    ["price_cents", document.priceCents],
    ["created_at", document.createdAt],
    ["updated_at", document.updatedAt],
  ];
}

function expectedProduct(document: SourceDocument): [string, unknown][] {
  const rating = asRecord(document.rating);
  return [
    ["image", document.image],
    ["name", document.name],
    ["description", document.description ?? ""],
    ["how_it_works", document.howItWorks ?? ""],
    ["highlights", document.highlights ?? []],
    ["care_instructions", document.careInstructions ?? ""],
    ["category", document.category ?? ""],
    ["stock", document.stock ?? 0],
    ["rating_stars", rating.stars],
    ["rating_count", rating.count],
    ["price_cents", document.priceCents],
    ["keywords", document.keywords ?? []],
    ["created_at", document.createdAt],
    ["updated_at", document.updatedAt],
  ];
}

function expectedUser(document: SourceDocument): [string, unknown][] {
  return [
    ["name", document.name],
    ["email", document.email],
    ["password_hash", document.password],
    ["is_admin", document.isAdmin ?? false],
    ["created_at", document.createdAt],
    ["updated_at", document.updatedAt],
  ];
}

function expectedOrder(document: SourceDocument, ownerExists: (id: string) => boolean): [string, unknown][] {
  const customer = document.customer === undefined || document.customer === null ? null : asRecord(document.customer);
  const owner = document.userId instanceof ObjectId ? document.userId.toHexString() : document.userId;
  const lines = Array.isArray(document.products) ? document.products.map(asRecord) : [];
  return [
    ["is_legacy", true],
    ["user_id", typeof owner === "string" && ownerExists(owner) ? owner : null],
    ["customer_full_name", customer?.fullName ?? null],
    ["customer_email", customer?.email ?? null],
    ["customer_phone", customer?.phone ?? null],
    ["customer_address", customer?.address ?? null],
    ["customer_city", customer?.city ?? null],
    ["customer_postal_code", customer?.postalCode ?? null],
    ["customer_country", customer?.country ?? null],
    ["ordered_at", timeOf(document.orderTimeMs)],
    ["total_cost_cents", document.totalCostCents],
    ["created_at", document.createdAt],
    ["updated_at", document.updatedAt],
    ["status", null],
    ["items", lines.map((line, position) => {
      const snapshot = line.product === undefined || line.product === null ? null : asRecord(line.product);
      return [
        position, line.productId, line.quantity, timeOf(line.estimatedDeliveryTimeMs),
        snapshot?.name ?? null, snapshot?.image ?? null, snapshot?.priceCents ?? null,
        snapshot ? snapshot.description ?? "" : null, snapshot ? snapshot.category ?? "" : null,
      ];
    })],
  ];
}

async function destinationRows(pool: Pool): Promise<Record<ImportedCollection, Map<string, Row>>> {
  const load = async (sql: string) => new Map((await pool.query<Row>(sql)).rows.map((row) => [String(row.id), row]));
  const orders = await load("SELECT *, id::text AS id FROM orders");
  const items = (await pool.query<Row>(
    `SELECT order_id::text AS order_id, position, product_id::text AS product_id, quantity, estimated_delivery_at,
            snapshot_name, snapshot_image, snapshot_price_cents, snapshot_description, snapshot_category
       FROM order_items ORDER BY order_id, position`,
  )).rows;
  for (const [id, order] of orders) {
    order.items = items.filter((item) => item.order_id === id).map((item) => [
      item.position, item.product_id, item.quantity, item.estimated_delivery_at, item.snapshot_name, item.snapshot_image,
      item.snapshot_price_cents, item.snapshot_description, item.snapshot_category,
    ]);
  }
  return {
    deliveryOptions: await load("SELECT * FROM delivery_options"),
    // numeric arrives as a string; compare stars by value.
    products: await load("SELECT *, id::text AS id, rating_stars::float8 AS rating_stars FROM products"),
    users: await load("SELECT * FROM users"),
    orders,
  };
}

/** Field-by-field comparison of PostgreSQL with the source. Read-only on both sides. */
export async function verifyAgainstSource(pool: Pool, source: SourceSnapshot, plan: MigrationPlan): Promise<VerificationResult> {
  const destination = await destinationRows(pool);
  const importedOwners = new Set(plan.users.map((user) => user.id));
  const mismatches: FieldMismatch[] = [];

  const expectedFor: Record<ImportedCollection, (document: SourceDocument) => [string, unknown][]> = {
    deliveryOptions: expectedDeliveryOption,
    products: expectedProduct,
    users: expectedUser,
    orders: (document) => expectedOrder(document, (id) => importedOwners.has(id)),
  };

  const tables = Object.fromEntries(IMPORTED_COLLECTIONS.map((collection): [ImportedCollection, TableVerification] => {
    const skipped = new Set(plan.invalid[collection]);
    const documents = (source.collections.get(collection) ?? []).filter((document) => !skipped.has(sourceId(document)));
    const rows = destination[collection];
    const result: TableVerification = { expected: documents.length, actual: rows.size, matched: 0, mismatched: 0, missing: [], unexpected: [] };

    for (const document of documents) {
      const id = sourceId(document);
      const row = rows.get(id);
      if (!row) {
        result.missing.push(id);
        continue;
      }
      const differing = expectedFor[collection](document).filter(([column, expected]) => !same(expected, row[column]));
      if (differing.length === 0) {
        result.matched += 1;
      } else {
        result.mismatched += 1;
        for (const [field] of differing) {
          if (mismatches.length < MAX_REPORTED_MISMATCHES) mismatches.push({ table: collection, id, field });
        }
      }
    }

    const expectedIds = new Set(documents.map(sourceId));
    result.unexpected = [...rows.keys()].filter((id) => !expectedIds.has(id)).sort();
    return [collection, result];
  }));

  const { rows: [cart] } = await pool.query<{ carts: number; cart_items: number }>(
    "SELECT (SELECT count(*) FROM carts)::int AS carts, (SELECT count(*) FROM cart_items)::int AS cart_items",
  );
  const { rows: [lastImport] } = await pool.query<{ source_fingerprint: string | null }>(
    `SELECT source_fingerprint FROM data_import_runs
      WHERE operation = 'import' AND outcome = 'succeeded' ORDER BY id DESC LIMIT 1`,
  );

  const verification: VerificationResult = {
    outcome: "match",
    tables: {
      deliveryOptions: tables.deliveryOptions ?? emptyTable(),
      products: tables.products ?? emptyTable(),
      users: tables.users ?? emptyTable(),
      orders: tables.orders ?? emptyTable(),
    },
    mismatches,
    excludedCart: {
      sourceCartItems: source.collections.get(EXCLUDED_CART_COLLECTION)?.length ?? 0,
      destinationCarts: cart?.carts ?? 0,
      destinationCartItems: cart?.cart_items ?? 0,
    },
    lastImportFingerprint: lastImport?.source_fingerprint ?? null,
    sourceChangedSinceLastImport: lastImport?.source_fingerprint ? lastImport.source_fingerprint !== source.fingerprint : false,
  };

  const clean = Object.values(verification.tables).every((table) => (
    table.mismatched === 0 && table.missing.length === 0 && table.unexpected.length === 0 && table.expected === table.actual
  ));
  verification.outcome = clean && verification.excludedCart.destinationCartItems === 0 ? "match" : "mismatch";
  return verification;
}

function emptyTable(): TableVerification {
  return { expected: 0, actual: 0, matched: 0, mismatched: 0, missing: [], unexpected: [] };
}
