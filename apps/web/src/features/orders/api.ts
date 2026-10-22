import { parseProduct, type Product } from "@/features/catalog/product";
import { ApiError, apiFetch } from "@/lib/api/client";

export interface CustomerDetails {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface ProductSnapshot {
  id: string;
  image: string;
  name: string;
  priceCents: number;
  description: string;
  category: string;
}

export interface OrderLine {
  productId: string;
  product?: Product | ProductSnapshot | null;
  quantity: number;
  estimatedDeliveryTimeMs: number;
}

export interface Order {
  id: string;
  userId?: string;
  customer?: CustomerDetails;
  orderTimeMs: number;
  totalCostCents: number;
  products: OrderLine[];
  createdAt: string;
  updatedAt: string;
  status?: "placed" | "processing" | "shipped" | "delivered" | "cancelled" | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function parseCustomer(value: unknown): CustomerDetails | undefined {
  if (!isRecord(value)) return undefined;
  const fields = ["fullName", "email", "phone", "address", "city", "postalCode", "country"] as const;
  if (!fields.every((field) => typeof value[field] === "string")) return undefined;
  return Object.fromEntries(fields.map((field) => [field, value[field]])) as unknown as CustomerDetails;
}

function parseSnapshot(value: unknown): ProductSnapshot | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.image !== "string"
    || typeof value.name !== "string" || !finite(value.priceCents)
    || typeof value.description !== "string" || typeof value.category !== "string") return null;
  return {
    id: value.id,
    image: value.image,
    name: value.name,
    priceCents: value.priceCents,
    description: value.description,
    category: value.category,
  };
}

export function parseOrder(value: unknown): Order {
  if (!isRecord(value) || typeof value.id !== "string" || !finite(value.orderTimeMs)
    || !finite(value.totalCostCents) || !Array.isArray(value.products)
    || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") {
    throw new ApiError(502, "Unexpected order response from the API.");
  }
  const products = value.products.map((line): OrderLine => {
    if (!isRecord(line) || typeof line.productId !== "string" || !Number.isInteger(line.quantity)
      || !finite(line.estimatedDeliveryTimeMs)) throw new ApiError(502, "Unexpected order response from the API.");
    let product: Product | ProductSnapshot | null | undefined;
    if (line.product === null) product = null;
    else if (line.product !== undefined) product = parseProduct(line.product) ?? parseSnapshot(line.product);
    return {
      productId: line.productId,
      product,
      quantity: line.quantity as number,
      estimatedDeliveryTimeMs: line.estimatedDeliveryTimeMs,
    };
  });
  const status = ["placed", "processing", "shipped", "delivered", "cancelled"].includes(String(value.status))
    ? value.status as Order["status"]
    : value.status === null ? null : undefined;
  return {
    id: value.id,
    ...(typeof value.userId === "string" ? { userId: value.userId } : {}),
    ...(parseCustomer(value.customer) ? { customer: parseCustomer(value.customer) } : {}),
    orderTimeMs: value.orderTimeMs,
    totalCostCents: value.totalCostCents,
    products,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    status,
  };
}

export async function fetchOrders(): Promise<Order[]> {
  // scope=own: "Your orders" is personal, also for an administrator (the admin area lists every order).
  const data = await apiFetch("/orders?scope=own&expand=products");
  if (!Array.isArray(data)) throw new ApiError(502, "Unexpected orders response from the API.");
  return data.map(parseOrder);
}

export const fetchOrder = async (orderId: string) => parseOrder(
  await apiFetch(`/orders/${encodeURIComponent(orderId)}?scope=own&expand=products`),
);

export const createOrder = async (customer: CustomerDetails, csrfToken: string, idempotencyKey: string) => parseOrder(
  await apiFetch("/orders", {
    method: "POST",
    body: { customer },
    csrfToken,
    idempotencyKey,
  }),
);
