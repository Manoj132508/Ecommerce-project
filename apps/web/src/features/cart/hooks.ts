"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requireCsrfToken, useSession } from "@/features/auth/hooks";
import {
  cartQueryKey,
  cartQueryRoot,
  checkoutQueryKey,
  checkoutQueryRoot,
} from "@/lib/queryKeys";
import { refetchAfterWrite } from "@/lib/refetchAfterWrite";
import { addCartItem, fetchCart, fetchCheckoutData, removeCartItem, updateCartItem } from "./api";

export function useCartQuery() {
  const session = useSession();
  const userId = session.data?.user._id;
  return useQuery({
    queryKey: userId ? cartQueryKey(userId) : [...cartQueryRoot, "signed-out"],
    queryFn: fetchCart,
    enabled: Boolean(userId),
    staleTime: 10_000,
  });
}

export function useCheckoutQuery(enabled = true) {
  const session = useSession();
  const userId = session.data?.user._id;
  return useQuery({
    queryKey: userId ? checkoutQueryKey(userId) : [...checkoutQueryRoot, "signed-out"],
    queryFn: fetchCheckoutData,
    enabled: enabled && Boolean(userId),
    staleTime: 10_000,
  });
}

function useCartMutation<T>(key: string, request: (variables: T, csrfToken: string) => Promise<unknown>) {
  const queryClient = useQueryClient();
  const reconcile = () => refetchAfterWrite(queryClient, [cartQueryRoot, checkoutQueryRoot]);
  return useMutation({
    mutationKey: ["cart", key],
    mutationFn: async (variables: T) => request(variables, await requireCsrfToken(queryClient)),
    onSuccess: reconcile,
    onError: reconcile,
  });
}

export const useAddCartItem = () => useCartMutation(
  "add",
  ({ productId, quantity }: { productId: string; quantity: number }, csrf) => addCartItem(productId, quantity, csrf),
);

export const useUpdateCartItem = () => useCartMutation(
  "update",
  ({ productId, changes }: { productId: string; changes: { quantity?: number; deliveryOptionId?: string } }, csrf) => (
    updateCartItem(productId, changes, csrf)
  ),
);

export const useRemoveCartItem = () => useCartMutation(
  "remove",
  (productId: string, csrf) => removeCartItem(productId, csrf),
);
