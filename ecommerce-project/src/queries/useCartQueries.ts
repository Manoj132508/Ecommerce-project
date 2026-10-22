import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type {
  CartItem,
  CheckoutData,
  DeliveryOption,
  PaymentSummaryData,
  UpdateCartItemDetails,
} from '../types/cart';
import { cartQueryKey, cartRootKey, checkoutQueryKey, checkoutRootKey } from './queryKeys';
import { useUserScope } from './useAuthQuery';

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
  const { userId, identityKnown } = useUserScope();

  return useQuery({
    queryKey: cartQueryKey(userId),
    queryFn: fetchCart,
    enabled: enabled && identityKnown,
  });
}

export function useCheckoutQuery(enabled = true) {
  const { userId, identityKnown } = useUserScope();

  return useQuery({
    queryKey: checkoutQueryKey(userId),
    queryFn: fetchCheckoutData,
    enabled: enabled && identityKnown,
  });
}

function useCartMutation<TVariables>(
  action: string,
  mutationFn: (variables: TVariables) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  const refreshCart = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: cartRootKey }),
    queryClient.invalidateQueries({ queryKey: checkoutRootKey }),
  ]);

  return useMutation({
    mutationKey: ['cart', action],
    mutationFn,
    onSuccess: refreshCart,
    // A rejected change (quantity limit, removed product) may mean the cart
    // changed elsewhere; show the server's current state.
    onError: refreshCart,
  });
}

export function useAddToCartMutation() {
  return useCartMutation('add', ({ productId, quantity }: { productId: string; quantity: number }) => (
    api.post('/cart-items', { productId, quantity })
  ));
}

export function useUpdateCartItemMutation() {
  return useCartMutation('update', ({
    productId,
    updates,
  }: { productId: string; updates: UpdateCartItemDetails }) => (
    api.put(`/cart-items/${encodeURIComponent(productId)}`, updates)
  ));
}

export function useRemoveCartItemMutation() {
  return useCartMutation('remove', (productId: string) => (
    api.delete(`/cart-items/${encodeURIComponent(productId)}`)
  ));
}
