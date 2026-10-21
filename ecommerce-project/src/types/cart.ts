import type { ProductData } from './product';

export interface CartItem {
  id?: string;
  productId: string;
  quantity: number;
  deliveryOptionId: string;
  product: ProductData | null;
  unavailable?: boolean;
}

export interface DeliveryOption {
  id: string;
  deliveryDays: number;
  priceCents: number;
  estimatedDeliveryTimeMs: number;
}

export interface PaymentSummaryData {
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
  paymentSummary: PaymentSummaryData;
}

export interface UpdateCartItemDetails {
  quantity?: number;
  deliveryOptionId?: string;
}
