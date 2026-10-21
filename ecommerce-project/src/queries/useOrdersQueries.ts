import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import type { CustomerData, OrderData } from '../types/order';
import { cartQueryKey, checkoutQueryKey } from './useCartQueries';

export const ordersQueryKey = ['orders'] as const;
export const orderQueryKey = (orderId: string) => ['orders', orderId] as const;

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
  return useQuery({
    queryKey: ordersQueryKey,
    queryFn: fetchOrders,
    enabled,
  });
}

export function useOrderQuery(orderId: string | null) {
  return useQuery({
    queryKey: orderQueryKey(orderId ?? ''),
    queryFn: () => fetchOrder(orderId ?? ''),
    enabled: Boolean(orderId),
  });
}

export function useCreateOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (customer: CustomerData) => {
      const { data } = await api.post<OrderData>('/orders', { customer });
      return data;
    },
    onSuccess: async (order) => {
      queryClient.setQueryData(orderQueryKey(order.id), order);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ordersQueryKey }),
        queryClient.invalidateQueries({ queryKey: cartQueryKey }),
        queryClient.invalidateQueries({ queryKey: checkoutQueryKey }),
      ]);
    },
  });
}
