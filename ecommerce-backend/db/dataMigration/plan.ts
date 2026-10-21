// Validates MongoDB documents against the PostgreSQL schema and maps them to
// target rows. Pure (no I/O): the dry-run and the import share these decisions.
//
// Rules (MIGRATION_PLAN.md D2–D4 and the Phase 3B decisions):
//   - Source ids are kept exactly. A value that does not fit is an error, never
//     coerced (no lower-casing, trimming or rounding).
//   - Missing historical data is never invented. The only defaults are the
//     Mongoose schema defaults the API already reports today (for example
//     stock 0); every use is listed in defaultsApplied.
//   - Orders of deleted users are imported with NULL ownership and listed in
//     orphanedOrders.
//   - The shared cart (cartItems) is excluded; only counts are reported.
import mongoose from "mongoose";
import type { SourceDocument, SourceSnapshot } from "./source.js";

const { ObjectId } = mongoose.mongo;

export type ImportedCollection = "deliveryOptions" | "products" | "users" | "orders";
export const IMPORTED_COLLECTIONS: readonly ImportedCollection[] = ["deliveryOptions", "products", "users", "orders"];
const isImportedCollection = (name: string): name is ImportedCollection => (
  IMPORTED_COLLECTIONS.some((collection) => collection === name)
);
export const EXCLUDED_CART_COLLECTION = "cartItems";

export type Severity = "error" | "warning" | "info";

export type IssueCode =
  | "invalid-id"
  | "duplicate-key"
  | "missing-field"
  | "invalid-field"
  | "unknown-field"
  | "invalid-reference"
  | "orphaned-order"
  | "missing-ownership"
  | "missing-snapshot"
  | "deleted-product-reference"
  | "skipped-product-reference"
  | "unknown-collection";

/** One finding. Ids and field names only: never values that could be personal data. */
export interface Issue {
  severity: Severity;
  code: IssueCode;
  collection: string;
  id: string;
  field?: string;
  message: string;
}

export interface DeliveryOptionRow {
  id: string;
  delivery_days: number;
  price_cents: number;
  created_at: Date;
  updated_at: Date;
}

export interface ProductRow {
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

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  is_admin: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface CustomerColumns {
  customer_full_name: string;
  customer_email: string;
  customer_phone: string;
  customer_address: string;
  customer_city: string;
  customer_postal_code: string;
  customer_country: string;
}

export interface SnapshotColumns {
  snapshot_name: string;
  snapshot_image: string;
  snapshot_price_cents: number;
  snapshot_description: string;
  snapshot_category: string;
}

export interface OrderItemRow {
  position: number;
  product_id: string;
  quantity: number;
  estimated_delivery_at: Date;
  snapshot: SnapshotColumns | null;
}

export interface OrderRow {
  id: string;
  user_id: string | null;
  customer: CustomerColumns | null;
  ordered_at: Date;
  total_cost_cents: number;
  created_at: Date;
  updated_at: Date;
  items: OrderItemRow[];
}

export interface DefaultApplied {
  collection: string;
  field: string;
  value: string;
  ids: string[];
}

export interface MigrationPlan {
  sourceDatabase: string;
  sourceFingerprint: string;
  sourceCounts: Record<string, number>;
  deliveryOptions: DeliveryOptionRow[];
  products: ProductRow[];
  users: UserRow[];
  orders: OrderRow[];
  /** Source ids that fail validation (or depend on a record that does). */
  invalid: Record<ImportedCollection, string[]>;
  issues: Issue[];
  excluded: {
    cartItems: { count: number; totalQuantity: number; distinctProducts: number; reason: string };
    otherCollections: { name: string; count: number }[];
  };
  orphanedOrders: { orderId: string; originalUserId: string }[];
  ordersWithoutOwnership: string[];
  missingSnapshots: { orderId: string; positions: number[] }[];
  deletedProductReferences: { orderId: string; productId: string }[];
  defaultsApplied: DefaultApplied[];
}

// Formats verified against every identifier in the development data (R18).
const UUID_LOWERCASE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/;
const DELIVERY_OPTION_ID = /^[0-9]{1,10}$/;
const BCRYPT_HASH = /^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/;
// Source field names of the embedded customer, in column order.
const CUSTOMER_FIELDS: readonly string[] = ["fullName", "email", "phone", "address", "city", "postalCode", "country"];
const INT_MAX = 2_147_483_647;

// Fields each collection's Mongoose model defines. Anything else would be
// lost by the import, so it is reported.
const KNOWN_FIELDS: Record<ImportedCollection, ReadonlySet<string>> = {
  deliveryOptions: new Set(["_id", "deliveryDays", "priceCents", "createdAt", "updatedAt"]),
  products: new Set([
    "_id", "image", "name", "description", "howItWorks", "highlights", "careInstructions",
    "category", "stock", "rating", "priceCents", "keywords", "createdAt", "updatedAt",
  ]),
  users: new Set(["_id", "name", "email", "password", "isAdmin", "createdAt", "updatedAt"]),
  orders: new Set(["_id", "userId", "customer", "orderTimeMs", "totalCostCents", "products", "createdAt", "updatedAt"]),
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
  && !(value instanceof Date) && !(value instanceof ObjectId)
);

const isNonBlankString = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const isIntegerInRange = (value: unknown, min: number, max = INT_MAX): value is number => (
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
);

const describeType = (value: unknown) => (
  value === null ? "null"
    : Array.isArray(value) ? "array"
      : value instanceof Date ? "date"
        : value instanceof ObjectId ? "ObjectId"
          : typeof value
);

const idOf = (document: SourceDocument) => (
  document._id instanceof ObjectId ? document._id.toHexString() : String(document._id)
);

/** Collects the issues of one record; the record is valid if it has no errors. */
class RecordCheck {
  private errors = 0;

  constructor(
    private readonly issues: Issue[],
    readonly collection: string,
    readonly id: string,
  ) {}

  get valid() {
    return this.errors === 0;
  }

  report(severity: Severity, code: IssueCode, message: string, field?: string) {
    if (severity === "error") this.errors += 1;
    this.issues.push({ severity, code, collection: this.collection, id: this.id, ...(field ? { field } : {}), message });
  }

  error(code: IssueCode, field: string, message: string) {
    this.report("error", code, message, field);
  }

  date(document: SourceDocument, field: string): Date | null {
    const value = document[field];
    if (value === undefined || value === null) {
      this.error("missing-field", field, `${field} is missing; timestamps are never invented`);
      return null;
    }
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      this.error("invalid-field", field, `${field} must be a date, found ${describeType(value)}`);
      return null;
    }
    return value;
  }

  integer(document: Record<string, unknown>, field: string, min: number, max = INT_MAX, label = field): number | null {
    const value = document[field];
    if (value === undefined || value === null) {
      this.error("missing-field", label, `${label} is missing`);
      return null;
    }
    if (!isIntegerInRange(value, min, max)) {
      this.error("invalid-field", label, `${label} must be an integer from ${min} to ${max}, found ${describeType(value)}${typeof value === "number" ? ` ${value}` : ""}`);
      return null;
    }
    return value;
  }

  nonBlank(document: Record<string, unknown>, field: string, label = field): string | null {
    const value = document[field];
    if (!isNonBlankString(value)) {
      this.error(value === undefined || value === null ? "missing-field" : "invalid-field", label, `${label} must be a non-blank string`);
      return null;
    }
    return value;
  }
}

class DefaultTracker {
  private readonly entries = new Map<string, DefaultApplied>();

  record(collection: string, field: string, value: string, id: string) {
    const key = `${collection}.${field}`;
    const entry = this.entries.get(key) ?? { collection, field, value, ids: [] };
    entry.ids.push(id);
    this.entries.set(key, entry);
  }

  /** A string field with a Mongoose default of "": missing means "". */
  optionalString(check: RecordCheck, document: Record<string, unknown>, field: string, label = field): string {
    const value = document[field];
    if (value === undefined || value === null) {
      this.record(check.collection, label, '""', check.id);
      return "";
    }
    if (typeof value !== "string") {
      check.error("invalid-field", label, `${label} must be a string, found ${describeType(value)}`);
      return "";
    }
    return value;
  }

  /** A string array with a Mongoose default of []. */
  optionalStringArray(check: RecordCheck, document: SourceDocument, field: string): string[] {
    const value = document[field];
    if (value === undefined || value === null) {
      this.record(check.collection, field, "[]", check.id);
      return [];
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      check.error("invalid-field", field, `${field} must be an array of strings`);
      return [];
    }
    return [...value];
  }

  list(): DefaultApplied[] {
    return [...this.entries.values()].sort((a, b) => `${a.collection}.${a.field}`.localeCompare(`${b.collection}.${b.field}`));
  }
}

function reportUnknownFields(check: RecordCheck, document: SourceDocument, known: ReadonlySet<string>) {
  for (const field of Object.keys(document).sort()) {
    if (field === "__v") continue; // Mongoose version key; versionKey is disabled and the value carries no data
    if (!known.has(field)) {
      check.report("warning", "unknown-field", `${field} is not in the model and would not be copied`, field);
    }
  }
}

function planDeliveryOptions(documents: SourceDocument[], issues: Issue[]) {
  const rows: DeliveryOptionRow[] = [];
  const invalid: string[] = [];

  for (const document of documents) {
    const check = new RecordCheck(issues, "deliveryOptions", idOf(document));
    if (typeof document._id !== "string" || !DELIVERY_OPTION_ID.test(document._id)) {
      check.error("invalid-id", "_id", "delivery option ids must be digit strings (\"1\", \"2\", \"3\")");
    }
    const deliveryDays = check.integer(document, "deliveryDays", 0);
    const priceCents = check.integer(document, "priceCents", 0);
    const createdAt = check.date(document, "createdAt");
    const updatedAt = check.date(document, "updatedAt");
    reportUnknownFields(check, document, KNOWN_FIELDS.deliveryOptions);

    if (check.valid && deliveryDays !== null && priceCents !== null && createdAt && updatedAt) {
      rows.push({ id: check.id, delivery_days: deliveryDays, price_cents: priceCents, created_at: createdAt, updated_at: updatedAt });
    } else {
      invalid.push(check.id);
    }
  }

  return { rows, invalid };
}

function planProducts(documents: SourceDocument[], issues: Issue[], defaults: DefaultTracker) {
  const rows: ProductRow[] = [];
  const invalid: string[] = [];

  for (const document of documents) {
    const check = new RecordCheck(issues, "products", idOf(document));
    if (typeof document._id !== "string" || !UUID_LOWERCASE.test(document._id)) {
      check.error("invalid-id", "_id", "product ids must be lowercase UUID strings");
    }
    const image = check.nonBlank(document, "image");
    const name = check.nonBlank(document, "name");
    const description = defaults.optionalString(check, document, "description");
    const howItWorks = defaults.optionalString(check, document, "howItWorks");
    const careInstructions = defaults.optionalString(check, document, "careInstructions");
    const category = defaults.optionalString(check, document, "category");
    const highlights = defaults.optionalStringArray(check, document, "highlights");
    const keywords = defaults.optionalStringArray(check, document, "keywords");

    let stock = 0;
    if (document.stock === undefined || document.stock === null) {
      defaults.record("products", "stock", "0", check.id);
    } else {
      stock = check.integer(document, "stock", 0) ?? 0;
    }

    let ratingStars: number | null = null;
    let ratingCount: number | null = null;
    if (!isRecord(document.rating)) {
      check.error("missing-field", "rating", "rating { stars, count } is required by the model");
    } else {
      const stars = document.rating.stars;
      if (typeof stars !== "number" || !Number.isFinite(stars) || stars < 0 || stars > 5 || !Number.isInteger(stars * 2)) {
        check.error("invalid-field", "rating.stars", "rating.stars must be a half step from 0 to 5");
      } else {
        ratingStars = stars;
      }
      ratingCount = check.integer(document.rating, "count", 0, INT_MAX, "rating.count");
    }

    const priceCents = check.integer(document, "priceCents", 0);
    const createdAt = check.date(document, "createdAt");
    const updatedAt = check.date(document, "updatedAt");
    reportUnknownFields(check, document, KNOWN_FIELDS.products);

    if (check.valid && image && name && ratingStars !== null && ratingCount !== null && priceCents !== null && createdAt && updatedAt) {
      rows.push({
        id: check.id, image, name, description, how_it_works: howItWorks, highlights, care_instructions: careInstructions,
        category, stock, rating_stars: ratingStars, rating_count: ratingCount, price_cents: priceCents, keywords,
        created_at: createdAt, updated_at: updatedAt,
      });
    } else {
      invalid.push(check.id);
    }
  }

  return { rows, invalid };
}

function planUsers(documents: SourceDocument[], issues: Issue[], defaults: DefaultTracker) {
  const rows: UserRow[] = [];
  const invalid = new Set<string>();

  // Duplicate emails would break the unique constraint; flag every holder.
  const emailHolders = new Map<string, string[]>();
  for (const document of documents) {
    if (typeof document.email === "string") {
      emailHolders.set(document.email, [...(emailHolders.get(document.email) ?? []), idOf(document)]);
    }
  }

  for (const document of documents) {
    const check = new RecordCheck(issues, "users", idOf(document));
    if (!(document._id instanceof ObjectId) && !(typeof document._id === "string" && OBJECT_ID_HEX.test(document._id))) {
      check.error("invalid-id", "_id", "user ids must be MongoDB ObjectIds");
    }
    const name = check.nonBlank(document, "name");

    let email: string | null = null;
    if (typeof document.email !== "string" || document.email === "") {
      check.error("missing-field", "email", "email is required");
    } else if (document.email !== document.email.trim().toLowerCase()) {
      check.error("invalid-field", "email", "email is not normalised (lowercase, trimmed); it is never rewritten silently");
    } else if ((emailHolders.get(document.email) ?? []).length > 1) {
      check.error("duplicate-key", "email", `email is shared by users ${(emailHolders.get(document.email) ?? []).join(", ")}`);
    } else {
      email = document.email;
    }

    let passwordHash: string | null = null;
    if (typeof document.password !== "string" || !BCRYPT_HASH.test(document.password)) {
      check.error("invalid-field", "password", "password must be a bcrypt hash");
    } else {
      passwordHash = document.password;
    }

    let isAdmin = false;
    if (document.isAdmin === undefined || document.isAdmin === null) {
      defaults.record("users", "isAdmin", "false", check.id);
    } else if (typeof document.isAdmin !== "boolean") {
      check.error("invalid-field", "isAdmin", "isAdmin must be a boolean");
    } else {
      isAdmin = document.isAdmin;
    }

    const createdAt = check.date(document, "createdAt");
    const updatedAt = check.date(document, "updatedAt");
    reportUnknownFields(check, document, KNOWN_FIELDS.users);

    if (check.valid && name && email && passwordHash && createdAt && updatedAt) {
      rows.push({ id: check.id, name, email, password_hash: passwordHash, is_admin: isAdmin, created_at: createdAt, updated_at: updatedAt });
    } else {
      invalid.add(check.id);
    }
  }

  return { rows, invalid: [...invalid] };
}

interface OrderContext {
  validUserIds: ReadonlySet<string>;
  invalidUserIds: ReadonlySet<string>;
  validProductIds: ReadonlySet<string>;
  invalidProductIds: ReadonlySet<string>;
}

function planOrders(documents: SourceDocument[], issues: Issue[], defaults: DefaultTracker, context: OrderContext) {
  const rows: OrderRow[] = [];
  const invalid: string[] = [];
  const orphanedOrders: MigrationPlan["orphanedOrders"] = [];
  const ordersWithoutOwnership: string[] = [];
  const missingSnapshots: MigrationPlan["missingSnapshots"] = [];
  const deletedProductReferences: MigrationPlan["deletedProductReferences"] = [];

  for (const document of documents) {
    const check = new RecordCheck(issues, "orders", idOf(document));
    if (typeof document._id !== "string" || !UUID_LOWERCASE.test(document._id)) {
      check.error("invalid-id", "_id", "order ids must be lowercase UUID strings");
    }

    // Ownership
    let userId: string | null = null;
    let orphanedFrom: string | null = null;
    const rawUserId = document.userId instanceof ObjectId ? document.userId.toHexString() : document.userId;
    if (rawUserId === undefined || rawUserId === null) {
      check.report("info", "missing-ownership", "order has no userId (legacy order); imported without an owner");
    } else if (typeof rawUserId !== "string" || !OBJECT_ID_HEX.test(rawUserId)) {
      check.error("invalid-reference", "userId", "userId is not an ObjectId string; ownership cannot be decided");
    } else if (context.validUserIds.has(rawUserId)) {
      userId = rawUserId;
    } else if (context.invalidUserIds.has(rawUserId)) {
      check.error("invalid-reference", "userId", `owner ${rawUserId} exists in the source but is invalid, so it is not imported`);
    } else {
      orphanedFrom = rawUserId;
      check.report("warning", "orphaned-order", `owner ${rawUserId} no longer exists; imported with NULL ownership`, "userId");
    }

    // Customer: all seven fields or none.
    let customer: CustomerColumns | null = null;
    if (document.customer !== undefined && document.customer !== null) {
      if (!isRecord(document.customer)) {
        check.error("invalid-field", "customer", "customer must be an object");
      } else {
        const source = document.customer;
        const values = CUSTOMER_FIELDS.map((field) => source[field]);
        if (!values.every(isNonBlankString)) {
          check.error("invalid-field", "customer", "customer details are incomplete; partial details are never filled in");
        } else {
          const [fullName, email, phone, address, city, postalCode, country] = values;
          if (fullName && email && phone && address && city && postalCode && country) {
            customer = {
              customer_full_name: fullName, customer_email: email, customer_phone: phone, customer_address: address,
              customer_city: city, customer_postal_code: postalCode, customer_country: country,
            };
          }
        }
      }
    }

    const orderTimeMs = check.integer(document, "orderTimeMs", 0, Number.MAX_SAFE_INTEGER);
    const totalCostCents = check.integer(document, "totalCostCents", 0);
    const createdAt = check.date(document, "createdAt");
    const updatedAt = check.date(document, "updatedAt");

    // Lines
    const items: OrderItemRow[] = [];
    const missingSnapshotPositions: number[] = [];
    if (!Array.isArray(document.products)) {
      check.error("missing-field", "products", "products must be an array");
    } else {
      if (document.products.length === 0) {
        check.report("warning", "invalid-field", "order has no lines", "products");
      }
      document.products.forEach((line: unknown, position) => {
        const label = `products[${position}]`;
        if (!isRecord(line)) {
          check.error("invalid-field", label, `${label} must be an object`);
          return;
        }
        const productId = line.productId;
        if (typeof productId !== "string" || !UUID_LOWERCASE.test(productId)) {
          check.error("invalid-reference", `${label}.productId`, "productId must be a lowercase UUID string");
          return;
        }
        const quantity = check.integer(line, "quantity", 1, INT_MAX, `${label}.quantity`);
        const estimated = check.integer(line, "estimatedDeliveryTimeMs", 0, Number.MAX_SAFE_INTEGER, `${label}.estimatedDeliveryTimeMs`);

        if (context.invalidProductIds.has(productId)) {
          check.report("warning", "skipped-product-reference", `${label} references product ${productId}, which is invalid and not imported`, `${label}.productId`);
        } else if (!context.validProductIds.has(productId)) {
          deletedProductReferences.push({ orderId: check.id, productId });
          check.report("info", "deleted-product-reference", `${label} references deleted product ${productId}; kept as history`, `${label}.productId`);
        }

        let snapshot: SnapshotColumns | null = null;
        if (line.product === undefined || line.product === null) {
          missingSnapshotPositions.push(position);
        } else if (!isRecord(line.product)) {
          check.error("invalid-field", `${label}.product`, "product snapshot must be an object");
        } else {
          const product = line.product;
          if (product.id !== productId) {
            check.error("invalid-field", `${label}.product.id`, "snapshot id differs from productId; one of them would be lost");
          }
          const name = check.nonBlank(product, "name", `${label}.product.name`);
          const image = check.nonBlank(product, "image", `${label}.product.image`);
          const priceCents = check.integer(product, "priceCents", 0, INT_MAX, `${label}.product.priceCents`);
          const description = defaults.optionalString(check, product, "description", "products[].product.description");
          const category = defaults.optionalString(check, product, "category", "products[].product.category");
          if (name && image && priceCents !== null) {
            snapshot = {
              snapshot_name: name, snapshot_image: image, snapshot_price_cents: priceCents,
              snapshot_description: description, snapshot_category: category,
            };
          }
        }

        if (quantity !== null && estimated !== null) {
          items.push({ position, product_id: productId, quantity, estimated_delivery_at: new Date(estimated), snapshot });
        }
      });
    }

    if (missingSnapshotPositions.length > 0) {
      check.report("info", "missing-snapshot", `${missingSnapshotPositions.length} line(s) have no product snapshot; none is invented`);
    }
    reportUnknownFields(check, document, KNOWN_FIELDS.orders);

    if (check.valid && orderTimeMs !== null && totalCostCents !== null && createdAt && updatedAt) {
      rows.push({
        id: check.id, user_id: userId, customer, ordered_at: new Date(orderTimeMs), total_cost_cents: totalCostCents,
        created_at: createdAt, updated_at: updatedAt, items,
      });
      if (orphanedFrom) orphanedOrders.push({ orderId: check.id, originalUserId: orphanedFrom });
      if (rawUserId === undefined || rawUserId === null) ordersWithoutOwnership.push(check.id);
      if (missingSnapshotPositions.length > 0) missingSnapshots.push({ orderId: check.id, positions: missingSnapshotPositions });
    } else {
      invalid.push(check.id);
    }
  }

  // References are only meaningful for orders that will be imported.
  const imported = new Set(rows.map((row) => row.id));
  return {
    rows,
    invalid,
    orphanedOrders,
    ordersWithoutOwnership,
    missingSnapshots,
    deletedProductReferences: deletedProductReferences.filter((reference) => imported.has(reference.orderId)),
  };
}

/** Builds the full migration plan. Deterministic: same source, same plan. */
export function buildPlan(source: SourceSnapshot): MigrationPlan {
  const issues: Issue[] = [];
  const defaults = new DefaultTracker();
  const documents = (name: string) => source.collections.get(name) ?? [];

  const deliveryOptions = planDeliveryOptions(documents("deliveryOptions"), issues);
  const products = planProducts(documents("products"), issues, defaults);
  const users = planUsers(documents("users"), issues, defaults);
  const orders = planOrders(documents("orders"), issues, defaults, {
    validUserIds: new Set(users.rows.map((row) => row.id)),
    invalidUserIds: new Set(users.invalid),
    validProductIds: new Set(products.rows.map((row) => row.id)),
    invalidProductIds: new Set(products.invalid),
  });

  const cartItems = documents(EXCLUDED_CART_COLLECTION);
  const otherCollections = [...source.collections.keys()]
    .filter((name) => !isImportedCollection(name) && name !== EXCLUDED_CART_COLLECTION)
    .map((name) => ({ name, count: documents(name).length }));
  for (const { name, count } of otherCollections) {
    issues.push({
      severity: count > 0 ? "warning" : "info",
      code: "unknown-collection",
      collection: name,
      id: "*",
      message: `collection "${name}" (${count} documents) is not part of the schema and is not imported`,
    });
  }

  return {
    sourceDatabase: source.databaseName,
    sourceFingerprint: source.fingerprint,
    sourceCounts: Object.fromEntries([...source.collections.entries()].map(([name, docs]) => [name, docs.length])),
    deliveryOptions: deliveryOptions.rows,
    products: products.rows,
    users: users.rows,
    orders: orders.rows,
    invalid: {
      deliveryOptions: deliveryOptions.invalid,
      products: products.invalid,
      users: users.invalid,
      orders: orders.invalid,
    },
    issues,
    excluded: {
      cartItems: {
        count: cartItems.length,
        totalQuantity: cartItems.reduce((total, item) => total + (typeof item.quantity === "number" ? item.quantity : 0), 0),
        distinctProducts: new Set(cartItems.map((item) => String(item.productId))).size,
        reason: "D1: the shared MongoDB cart has no owner and is not assigned to any user; it stays in MongoDB and the backups",
      },
      otherCollections,
    },
    orphanedOrders: orders.orphanedOrders,
    ordersWithoutOwnership: orders.ordersWithoutOwnership,
    missingSnapshots: orders.missingSnapshots,
    deletedProductReferences: orders.deletedProductReferences,
    defaultsApplied: defaults.list(),
  };
}

export const errorCount = (plan: MigrationPlan) => plan.issues.filter((issue) => issue.severity === "error").length;
