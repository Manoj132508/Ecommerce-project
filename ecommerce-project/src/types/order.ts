export interface CustomerData {
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
}

export interface OrderProductSnapshot {
  id: string;
  image: string;
  name: string;
  priceCents: number;
  description: string;
  category: string;
}

export interface OrderProduct {
  productId: string;
  product?: OrderProductSnapshot;
  quantity: number;
  estimatedDeliveryTimeMs: number;
}

export interface OrderData {
  id: string;
  userId?: string;
  customer?: CustomerData;
  orderTimeMs: number;
  totalCostCents: number;
  products: OrderProduct[];
}

// Kept as aliases so the Admin feature can use a descriptive name without
// duplicating the server response shape.
export type AdminOrderProduct = OrderProduct;
export type AdminOrderData = OrderData;
