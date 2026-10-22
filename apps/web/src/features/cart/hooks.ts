"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/features/auth/hooks";
import { ApiError } from "@/lib/api/client";
import {
  cartQueryKey,
  cartQueryRoot,
  checkoutQueryKey,
  checkoutQueryRoot,
} from "@/lib/queryKeys";
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
  const session = useSession();
  const queryClient = useQueryClient();
  const reconcile = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: cartQueryRoot }),
    queryClient.invalidateQueries({ queryKey: checkoutQueryRoot }),
  ]);
  return useMutation({
    mutationKey: ["cart", key],
    mutationFn: (variables: T) => {
      const csrfToken = session.data?.csrfToken;
      if (!csrfToken) throw new ApiError(401, "Sign in again to continue.");
      return request(variables, csrfToken);
    },
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
