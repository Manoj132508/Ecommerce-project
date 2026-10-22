import { ApiError, apiFetch } from "@/lib/api/client";
import { parseProduct, type Product } from "@/features/catalog/product";

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  deliveryOptionId: string;
  product: Product | null;
  unavailable: boolean;
}

export interface DeliveryOption {
  id: string;
  deliveryDays: number;
  priceCents: number;
  estimatedDeliveryTimeMs: number;
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

export interface CheckoutData {
  deliveryOptions: DeliveryOption[];
  paymentSummary: PaymentSummary;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseCart(data: unknown): CartItem[] {
  if (!Array.isArray(data)) throw new ApiError(502, "Unexpected cart response from the API.");
  return data.map((value) => {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.productId !== "string"
      || !Number.isInteger(value.quantity) || typeof value.deliveryOptionId !== "string") {
      throw new ApiError(502, "Unexpected cart response from the API.");
    }
    const product = value.product === null ? null : parseProduct(value.product);
    if (value.product !== null && product === null) throw new ApiError(502, "Unexpected cart response from the API.");
    return {
      id: value.id,
      productId: value.productId,
      quantity: value.quantity as number,
      deliveryOptionId: value.deliveryOptionId,
      product,
      unavailable: value.unavailable === true || product === null,
    };
  });
}

function parseDeliveryOptions(data: unknown): DeliveryOption[] {
  if (!Array.isArray(data)) throw new ApiError(502, "Unexpected delivery response from the API.");
  return data.map((value) => {
    if (!isRecord(value) || typeof value.id !== "string" || !finite(value.deliveryDays)
      || !finite(value.priceCents) || !finite(value.estimatedDeliveryTimeMs)) {
      throw new ApiError(502, "Unexpected delivery response from the API.");
    }
    return {
      id: value.id,
      deliveryDays: value.deliveryDays,
      priceCents: value.priceCents,
      estimatedDeliveryTimeMs: value.estimatedDeliveryTimeMs,
    };
  });
}

function parsePaymentSummary(data: unknown): PaymentSummary {
  if (!isRecord(data)) throw new ApiError(502, "Unexpected total response from the API.");
  const fields = ["totalItems", "productCostCents", "shippingCostCents", "totalCostBeforeTaxCents", "taxCents", "totalCostCents"] as const;
  if (!fields.every((field) => finite(data[field])) || !Array.isArray(data.unavailableProductIds)
    || !data.unavailableProductIds.every((id) => typeof id === "string")) {
    throw new ApiError(502, "Unexpected total response from the API.");
  }
  return {
    totalItems: data.totalItems as number,
    productCostCents: data.productCostCents as number,
    shippingCostCents: data.shippingCostCents as number,
    totalCostBeforeTaxCents: data.totalCostBeforeTaxCents as number,
    taxCents: data.taxCents as number,
    totalCostCents: data.totalCostCents as number,
    unavailableProductIds: data.unavailableProductIds as string[],
  };
}

export const fetchCart = async () => parseCart(await apiFetch("/cart-items?expand=product"));

export async function fetchCheckoutData(): Promise<CheckoutData> {
  const [delivery, summary] = await Promise.all([
    apiFetch("/delivery-options?expand=estimatedDeliveryTime"),
    apiFetch("/payment-summary"),
  ]);
  return { deliveryOptions: parseDeliveryOptions(delivery), paymentSummary: parsePaymentSummary(summary) };
}

export const addCartItem = (productId: string, quantity: number, csrfToken: string) => (
  apiFetch("/cart-items", { method: "POST", body: { productId, quantity }, csrfToken })
);

export const updateCartItem = (productId: string, changes: { quantity?: number; deliveryOptionId?: string }, csrfToken: string) => (
  apiFetch(`/cart-items/${encodeURIComponent(productId)}`, { method: "PUT", body: changes, csrfToken })
);

export const removeCartItem = (productId: string, csrfToken: string) => (
  apiFetch(`/cart-items/${encodeURIComponent(productId)}`, { method: "DELETE", csrfToken })
);
