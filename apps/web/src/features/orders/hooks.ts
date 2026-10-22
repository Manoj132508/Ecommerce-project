"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requireCsrfToken, useSession } from "@/features/auth/hooks";
import {
  cartQueryRoot,
  checkoutQueryRoot,
  orderQueryKey,
  ordersQueryKey,
  ordersQueryRoot,
} from "@/lib/queryKeys";
import { refetchAfterWrite } from "@/lib/refetchAfterWrite";
import { createOrder, fetchOrder, fetchOrders, type CustomerDetails, type Order } from "./api";

export function useOrdersQuery() {
  const session = useSession();
  const userId = session.data?.user._id;
  return useQuery({
    queryKey: userId ? ordersQueryKey(userId) : ["orders", "signed-out"],
    queryFn: fetchOrders,
    enabled: Boolean(userId),
  });
}

export function useOrderQuery(orderId: string, initialData?: Order) {
  const session = useSession();
  const userId = session.data?.user._id;
  return useQuery({
    queryKey: userId ? orderQueryKey(userId, orderId) : ["order", "signed-out", orderId],
    queryFn: () => fetchOrder(orderId),
    enabled: Boolean(userId),
    initialData,
    staleTime: initialData ? 30_000 : 0,
  });
}

export function useCreateOrder() {
  const session = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["orders", "create"],
    mutationFn: async ({ customer, idempotencyKey }: { customer: CustomerDetails; idempotencyKey: string }) => (
      createOrder(customer, await requireCsrfToken(queryClient), idempotencyKey)
    ),
    onSuccess: async (order) => {
      const userId = session.data?.user._id;
      if (userId) queryClient.setQueryData(orderQueryKey(userId, order.id), order);
      await refetchAfterWrite(queryClient, [cartQueryRoot, checkoutQueryRoot, ordersQueryRoot]);
    },
    onError: () => refetchAfterWrite(queryClient, [cartQueryRoot, checkoutQueryRoot]),
  });
}
