// JSON wire contracts of the HTTP API (MIGRATION_PLAN.md §2), mirroring
// ecommerce-project/src/types. Pinned by the regression tests in test/.
// Responses that serialise Mongoose documents produce these shapes through
// each model's toJSON transform; the PostgreSQL repositories in Phase 3 must
// return them directly.

/** Body of every handled error response. */
export interface ErrorResponse {
  message: string;
}

export interface UserProfile {
  _id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthResponse extends UserProfile {
  token: string;
}

export interface ProductRating {
  stars: number;
  count: number;
}

export interface ProductJSON {
  id: string;
  image: string;
  name: string;
  description: string;
  howItWorks: string;
  highlights: string[];
  careInstructions: string;
  category: string;
  stock: number;
  rating: ProductRating;
  priceCents: number;
  keywords: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryOptionJSON {
  id: string;
  deliveryDays: number;
  priceCents: number;
  createdAt: string;
  updatedAt: string;
  /** Only with ?expand=estimatedDeliveryTime. */
  estimatedDeliveryTimeMs?: number;
}

export interface CartItemJSON {
  id: string;
  productId: string;
  quantity: number;
  deliveryOptionId: string;
  createdAt: string;
  updatedAt: string;
  /** Only with ?expand=product; null when the product was deleted (D3). */
  product?: ProductJSON | null;
  unavailable?: boolean;
}

export interface PaymentSummary {
  totalItems: number;
  productCostCents: number;
  shippingCostCents: number;
  totalCostBeforeTaxCents: number;
  taxCents: number;
  totalCostCents: number;
  unavailableProductIds: string[];
}

export interface CustomerDetails {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

/** Immutable copy of the product taken when the order is placed (D4). */
export interface ProductSnapshot {
  id: string;
  image: string;
  name: string;
  priceCents: number;
  description: string;
  category: string;
}

export interface OrderProductJSON {
  productId: string;
  /**
   * Snapshot for orders placed since snapshots were introduced. Legacy lines
   * have none; with ?expand=products they get the current product or null.
   */
  product?: ProductSnapshot | ProductJSON | null;
  quantity: number;
  estimatedDeliveryTimeMs: number;
}

export interface OrderJSON {
  id: string;
  /** Absent on legacy orders. */
  userId?: string;
  /** Absent on legacy orders. */
  customer?: CustomerDetails;
  orderTimeMs: number;
  totalCostCents: number;
  products: OrderProductJSON[];
  createdAt: string;
  updatedAt: string;
}

export interface DeleteProductResponse {
  id: string;
}
