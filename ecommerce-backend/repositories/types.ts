// Data-access contracts shared by the MongoDB and PostgreSQL implementations.
//
// Records are structural: a Mongoose document satisfies them as-is, so the
// MongoDB implementations return documents and their JSON stays byte-for-byte
// what the API returned before. PostgreSQL implementations return plain
// objects with the same fields (types/api.ts wire shapes).

import type { CustomerDetails } from "../types/api.js";

export type DataSource = "mongo" | "postgres";

export interface DeliveryOptionRecord {
  id: string;
  deliveryDays: number;
  priceCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductRecord {
  id: string;
  image: string;
  name: string;
  description: string;
  howItWorks: string;
  highlights: readonly string[];
  careInstructions: string;
  category: string;
  stock: number;
  rating: { stars: number; count: number };
  priceCents: number;
  keywords: readonly string[];
  createdAt: Date;
  updatedAt: Date;
}

/** Validated admin form values (productController builds them). */
export interface ProductDetails {
  name: string;
  description: string;
  howItWorks: string;
  highlights: string[];
  careInstructions: string;
  image: string;
  category: string;
  stock: number;
  priceCents: number;
  keywords: string[];
}

/** The authenticated user attached to req.user (password never included). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface CartLineRecord {
  productId: string;
  quantity: number;
  deliveryOptionId: string;
  createdAt: Date;
  updatedAt: Date;
  id: string;
}

/** null: the legacy shared MongoDB cart. A user id: that user's own cart (D1). */
export type CartOwner = string | null;

export interface Viewer {
  id: string;
  isAdmin: boolean;
}

export type OrderStatus = "placed" | "processing" | "shipped" | "delivered" | "cancelled";
export const ORDER_STATUSES: readonly OrderStatus[] = ["placed", "processing", "shipped", "delivered", "cancelled"];

export type CheckoutResult =
  | { kind: "placed"; order: unknown }
  | { kind: "empty" }
  /** The Idempotency-Key already belongs to this user's order for different details. */
  | { kind: "key-reused" }
  | { kind: "unavailable"; productIds: string[] }
  | { kind: "invalid-delivery" }
  | { kind: "insufficient-stock"; productIds: string[] };

export type StatusChangeResult =
  | { kind: "changed"; order: unknown }
  | { kind: "not-found" }
  | { kind: "not-allowed"; message: string }
  | { kind: "unsupported" };

export interface DeliveryOptionRepository {
  readonly source: DataSource;
  list(): Promise<DeliveryOptionRecord[]>;
  findById(id: string): Promise<DeliveryOptionRecord | null>;
}

export interface ProductRepository {
  readonly source: DataSource;
  list(): Promise<ProductRecord[]>;
  findById(id: string): Promise<ProductRecord | null>;
  create(details: ProductDetails): Promise<ProductRecord>;
  update(id: string, details: ProductDetails): Promise<ProductRecord | null>;
  delete(id: string): Promise<{ id: string } | null>;
}

export interface UserRepository {
  readonly source: DataSource;
  findById(id: string): Promise<AuthUser | null>;
  findByEmail(email: string): Promise<AuthUser | null>;
  /** The user when the password matches, otherwise null. */
  authenticate(email: string, password: string): Promise<AuthUser | null>;
  create(details: { name: string; email: string; password: string }): Promise<AuthUser>;
}

export interface CartRepository {
  readonly source: DataSource;
  /** "shared": one unauthenticated cart (legacy MongoDB). "per-user": D1 owned carts. */
  readonly ownership: "shared" | "per-user";
  list(owner: CartOwner): Promise<CartLineRecord[]>;
  find(owner: CartOwner, productId: string): Promise<CartLineRecord | null>;
  /** Adds quantity to the line, creating it with delivery option "1" when new. */
  add(owner: CartOwner, productId: string, quantity: number): Promise<CartLineRecord>;
  update(owner: CartOwner, productId: string, changes: { quantity?: number; deliveryOptionId?: string }): Promise<CartLineRecord | null>;
  remove(owner: CartOwner, productId: string): Promise<boolean>;
}

export interface OrderRepository {
  readonly source: DataSource;
  list(viewer: Viewer, expandProducts: boolean): Promise<unknown[]>;
  /** null when the order does not exist or the viewer may not see it. */
  get(orderId: string, viewer: Viewer, expandProducts: boolean): Promise<unknown>;
  checkout(owner: CartOwner, user: AuthUser, customer: CustomerDetails, idempotencyKey?: string): Promise<CheckoutResult>;
  changeStatus(orderId: string, status: OrderStatus, actor: AuthUser, reason: string): Promise<StatusChangeResult>;
}

export interface Repositories {
  deliveryOptions: DeliveryOptionRepository;
  products: ProductRepository;
  users: UserRepository;
  carts: CartRepository;
  orders: OrderRepository;
}

/** Thrown by repositories for invalid data. Named like Mongoose's so callers treat both alike. */
export class DataValidationError extends Error {
  override name = "ValidationError";
}

/** Thrown for a unique-key conflict (MongoDB code 11000, PostgreSQL 23505). */
export class DuplicateKeyError extends Error {
  override name = "DuplicateKeyError";
  readonly code = 11000;
}

/** Thrown when a cart line would leave the FD1 range of 1 to 10. */
export class CartQuantityError extends Error {
  override name = "CartQuantityError";
}
