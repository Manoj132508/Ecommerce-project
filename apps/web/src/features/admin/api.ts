// Admin API calls (same-origin /api, CSRF-protected writes) and the rules the
// admin screens share. Express and PostgreSQL enforce the role, the allowed
// status transitions, the required reason and the audit trail; the copies
// here only decide what the screens offer.
import { parseProduct, type Product } from "@/features/catalog/product";
import { parseOrder, type Order } from "@/features/orders/api";
import { ApiError, apiFetch } from "@/lib/api/client";

export type OrderStatus = NonNullable<Order["status"]>;
export const ORDER_STATUSES: readonly OrderStatus[] = ["placed", "processing", "shipped", "delivered", "cancelled"];

/** Mirrors order_status_transitions (migrations 0002/0003); "none" is a legacy order without a status. */
const TRANSITIONS: Record<OrderStatus | "none", readonly OrderStatus[]> = {
  none: ["delivered", "cancelled"],
  placed: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export const nextStatuses = (status: Order["status"]): readonly OrderStatus[] => TRANSITIONS[status ?? "none"];

export const statusLabel = (status: Order["status"]) => (status ? status[0]!.toUpperCase() + status.slice(1) : "Not recorded (legacy)");

export interface StatusEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: string;
  changedAt: string;
  changedBy: { id: string; name: string };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStatus = (value: unknown): value is OrderStatus => ORDER_STATUSES.includes(value as OrderStatus);

export function parseStatusEvents(data: unknown): StatusEvent[] {
  if (!Array.isArray(data)) throw new ApiError(502, "Unexpected order history response from the API.");
  return data.map((value) => {
    if (!isRecord(value) || !(value.fromStatus === null || isStatus(value.fromStatus)) || !isStatus(value.toStatus)
      || typeof value.reason !== "string" || typeof value.changedAt !== "string" || !isRecord(value.changedBy)
      || typeof value.changedBy.id !== "string" || typeof value.changedBy.name !== "string") {
      throw new ApiError(502, "Unexpected order history response from the API.");
    }
    return {
      fromStatus: value.fromStatus as OrderStatus | null,
      toStatus: value.toStatus,
      reason: value.reason,
      changedAt: value.changedAt,
      changedBy: { id: value.changedBy.id, name: value.changedBy.name },
    };
  });
}

// ------------------------------------------------------------------ products

/** The form as typed (strings), sent to Express as it is; Express validates again. */
export interface ProductForm {
  name: string;
  price: string;
  category: string;
  stock: string;
  image: string;
  description: string;
  howItWorks: string;
  highlights: string;
  careInstructions: string;
  keywords: string;
}

export const EMPTY_PRODUCT_FORM: ProductForm = {
  name: "", price: "", category: "", stock: "0", image: "", description: "", howItWorks: "", highlights: "", careInstructions: "", keywords: "",
};

export const productToForm = (product: Product): ProductForm => ({
  name: product.name,
  price: (product.priceCents / 100).toFixed(2),
  category: product.category,
  stock: String(product.stock),
  image: product.image,
  description: product.description,
  howItWorks: product.howItWorks,
  highlights: product.highlights.join(", "),
  careInstructions: product.careInstructions,
  keywords: product.keywords.join(", "),
});

export type ProductFormErrors = Partial<Record<keyof ProductForm, string>>;

const list = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

/** The same rules as Express (productController), with messages per field. */
export function validateProductForm(form: ProductForm): ProductFormErrors {
  const errors: ProductFormErrors = {};
  const required: [keyof ProductForm, string][] = [
    ["name", "Enter the product name."], ["category", "Enter a category."], ["image", "Enter the image path."],
    ["description", "Describe the product."], ["howItWorks", "Explain how it works."], ["careInstructions", "Add care and guidance."],
  ];
  for (const [field, message] of required) if (!form[field].trim()) errors[field] = message;
  if (!/^\d+(\.\d{1,2})?$/.test(form.price.trim())) errors.price = "Enter a price such as 19.99 (no currency sign).";
  if (!/^\d+$/.test(form.stock.trim())) errors.stock = "Enter a whole number of 0 or more.";
  if (list(form.highlights).length === 0) errors.highlights = "Add at least one highlight, separated by commas.";
  const keywords = list(form.keywords);
  if (keywords.length > 20) errors.keywords = "Use at most 20 keywords.";
  else if (keywords.some((keyword) => keyword.length > 40)) errors.keywords = "Each keyword can have at most 40 characters.";
  return errors;
}

/** What is sent. Keywords always go with an admin edit: an empty field means "use the category" on create. */
const productBody = (form: ProductForm) => ({ ...form, keywords: list(form.keywords) });

const parseSavedProduct = (data: unknown): Product => {
  const product = parseProduct(data);
  if (!product) throw new ApiError(502, "Unexpected product response from the API.");
  return product;
};

export const createProduct = async (form: ProductForm, csrfToken: string) => (
  parseSavedProduct(await apiFetch("/products", { method: "POST", body: productBody(form), csrfToken }))
);

export const updateProduct = async (productId: string, form: ProductForm, csrfToken: string) => (
  parseSavedProduct(await apiFetch(`/products/${encodeURIComponent(productId)}`, { method: "PUT", body: productBody(form), csrfToken }))
);

export const deleteProduct = (productId: string, csrfToken: string) => (
  apiFetch(`/products/${encodeURIComponent(productId)}`, { method: "DELETE", csrfToken })
);

// -------------------------------------------------------------------- orders

export const changeOrderStatus = async (orderId: string, status: OrderStatus, reason: string, csrfToken: string) => (
  parseOrder(await apiFetch(`/orders/${encodeURIComponent(orderId)}/status`, { method: "PATCH", body: { status, reason }, csrfToken }))
);

// ---------------------------------------------------------------- statistics

export interface DashboardStatistics {
  products: number;
  categories: number;
  orders: number;
  byStatus: Record<OrderStatus | "none", number>;
  /** Sum of stored order totals, cancelled orders excluded (no payment provider: recorded value, not revenue received). */
  orderValueCents: number;
  last30Days: { orders: number; valueCents: number };
  recent: Order[];
}

const DAY = 86_400_000;

export function dashboardStatistics(products: Product[], orders: Order[], now = Date.now()): DashboardStatistics {
  const byStatus: DashboardStatistics["byStatus"] = { none: 0, placed: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
  let orderValueCents = 0;
  const last30Days = { orders: 0, valueCents: 0 };
  for (const order of orders) {
    byStatus[order.status ?? "none"] += 1;
    if (order.status === "cancelled") continue;
    orderValueCents += order.totalCostCents;
    if (order.orderTimeMs >= now - 30 * DAY) {
      last30Days.orders += 1;
      last30Days.valueCents += order.totalCostCents;
    }
  }
  return {
    products: products.length,
    categories: new Set(products.map((product) => product.category.trim().toLowerCase()).filter(Boolean)).size,
    orders: orders.length,
    byStatus,
    orderValueCents,
    last30Days,
    recent: [...orders].sort((a, b) => b.orderTimeMs - a.orderTimeMs).slice(0, 5),
  };
}
