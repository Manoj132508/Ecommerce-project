import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type {
  CartItem,
  CheckoutData,
  DeliveryOption,
  PaymentSummaryData,
  UpdateCartItemDetails,
} from '../types/cart';

export const cartQueryKey = ['cart'] as const;
export const checkoutQueryKey = ['checkout'] as const;

async function fetchCart(): Promise<CartItem[]> {
  const { data } = await api.get<CartItem[]>('/cart-items?expand=product');
  return data;
}

async function fetchCheckoutData(): Promise<CheckoutData> {
  const [deliveryResponse, summaryResponse] = await Promise.all([
    api.get<DeliveryOption[]>('/delivery-options?expand=estimatedDeliveryTime'),
    api.get<PaymentSummaryData>('/payment-summary'),
  ]);

  return {
    deliveryOptions: deliveryResponse.data,
    paymentSummary: summaryResponse.data,
  };
}

export function useCartQuery(enabled = true) {
  return useQuery({
    queryKey: cartQueryKey,
    queryFn: fetchCart,
    enabled,
  });
}

export function useCheckoutQuery(enabled = true) {
  return useQuery({
    queryKey: checkoutQueryKey,
    queryFn: fetchCheckoutData,
    enabled,
  });
}

function useCartMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: cartQueryKey }),
        queryClient.invalidateQueries({ queryKey: checkoutQueryKey }),
      ]);
    },
  });
}

export function useAddToCartMutation() {
  return useCartMutation(({ productId, quantity }: { productId: string; quantity: number }) => (
    api.post('/cart-items', { productId, quantity })
  ));
}

export function useUpdateCartItemMutation() {
  return useCartMutation(({
    productId,
    updates,
  }: { productId: string; updates: UpdateCartItemDetails }) => (
    api.put(`/cart-items/${encodeURIComponent(productId)}`, updates)
  ));
}

export function useRemoveCartItemMutation() {
  return useCartMutation((productId: string) => (
    api.delete(`/cart-items/${encodeURIComponent(productId)}`)
  ));
}
