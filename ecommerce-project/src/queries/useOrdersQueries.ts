import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { CustomerData, OrderData } from '../types/order';
import { cartRootKey, checkoutRootKey, orderQueryKey, ordersQueryKey, ordersRootKey } from './queryKeys';
import { useUserScope } from './useAuthQuery';

async function fetchOrders(): Promise<OrderData[]> {
  const { data } = await api.get<OrderData[]>('/orders?expand=products');
  return data;
}

async function fetchOrder(orderId: string): Promise<OrderData> {
  const { data } = await api.get<OrderData>(
    `/orders/${encodeURIComponent(orderId)}?expand=products`,
  );
  return data;
}

export function useOrdersQuery(enabled = true) {
  const { userId, identityKnown } = useUserScope();

  return useQuery({
    queryKey: ordersQueryKey(userId),
    queryFn: fetchOrders,
    enabled: enabled && identityKnown,
  });
}

export function useOrderQuery(orderId: string | null) {
  const { userId, identityKnown } = useUserScope();

  return useQuery({
    queryKey: orderQueryKey(userId, orderId ?? ''),
    queryFn: () => fetchOrder(orderId ?? ''),
    enabled: Boolean(orderId) && identityKnown,
  });
}

export function useCreateOrderMutation() {
  const queryClient = useQueryClient();
  const { userId } = useUserScope();
  const refreshCart = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: cartRootKey }),
    queryClient.invalidateQueries({ queryKey: checkoutRootKey }),
  ]);

  return useMutation({
    mutationKey: ['orders', 'create'],
    mutationFn: async (customer: CustomerData) => {
      const { data } = await api.post<OrderData>('/orders', { customer });
      return data;
    },
    onSuccess: async (order) => {
      queryClient.setQueryData(orderQueryKey(userId, order.id), order);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersRootKey }),
        refreshCart(),
      ]);
    },
    // 409 (unavailable products, insufficient stock) or 400 (empty cart):
    // refresh so the page shows the cart as the server sees it.
    onError: refreshCart,
  });
}
