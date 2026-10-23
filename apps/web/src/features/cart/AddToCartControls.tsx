"use client";

// Add a product to the signed-in user's cart from the catalogue and product
// pages (signed-out visitors are sent to sign in and brought back).
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CartIcon } from "@/components/ui/icons";
import { endLocalSession, useSession } from "@/features/auth/hooks";
import { NOTICES } from "@/features/auth/notices";
import { ApiError, apiFetch } from "@/lib/api/client";
import { cartQueryRoot, checkoutQueryRoot } from "@/lib/queryKeys";
import { refetchAfterWrite } from "@/lib/refetchAfterWrite";
import { safeReturnPath } from "@/lib/returnPath";
import { cn } from "@/lib/utils";
import { useAppDispatch } from "@/store/hooks";
import { noticeShown } from "@/store/uiSlice";
import { QuantitySelector } from "./QuantitySelector";

interface AddToCartControlsProps {
  productId: string;
  productName: string;
  /** Where to come back to after signing in (the current page). */
  returnTo: string;
  compact?: boolean;
}

export function AddToCartControls({ productId, productName, returnTo, compact = false }: AddToCartControlsProps) {
  const session = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const selectId = useId();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const sendToSignIn = (notice: string) => {
    dispatch(noticeShown(notice));
    router.push(`/login?from=${encodeURIComponent(safeReturnPath(returnTo))}`);
  };

  const add = useMutation({
    mutationKey: ["cart", "add"],
    mutationFn: (csrfToken: string) => apiFetch("/cart-items", { method: "POST", body: { productId, quantity }, csrfToken }),
    onSuccess: () => {
      void refetchAfterWrite(queryClient, [cartQueryRoot, checkoutQueryRoot]);
      setAdded(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAdded(false), 2000);
    },
    onError: (error) => {
      setAdded(false);
      if (error instanceof ApiError && error.status === 401) {
        endLocalSession(queryClient);
        sendToSignIn(NOTICES.sessionExpired);
      }
    },
  });

  const onAdd = () => {
    const csrfToken = session.data?.csrfToken;
    if (!csrfToken) {
      sendToSignIn(NOTICES.cartLogin);
      return;
    }
    add.mutate(csrfToken);
  };

  const failure = add.isError && !(add.error instanceof ApiError && add.error.status === 401) ? add.error.message : "";

  return (
    <div className={cn("flex flex-col", compact ? "gap-2" : "gap-3")}>
      <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
        <label htmlFor={selectId} className={compact ? "sr-only" : "text-sm font-medium"}>
          Quantity{compact ? ` for ${productName}` : ""}
        </label>
        <QuantitySelector
          id={selectId}
          value={quantity}
          onChange={(value) => { setQuantity(value); setAdded(false); }}
          className={compact ? "min-h-10 w-16 px-2 lg:min-h-9" : "w-24"}
        />
      </div>
      {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
      <Button
        onClick={onAdd}
        disabled={add.isPending || session.isPending}
        aria-busy={add.isPending || undefined}
        aria-label={compact ? `Add ${productName} to cart` : undefined}
        size={compact ? "default" : "lg"}
        className={cn("w-full", compact ? "px-3" : "sm:max-w-sm")}
      >
        <CartIcon className="size-4" />
        {add.isPending ? "Adding…" : "Add to Cart"}
      </Button>
      {/* Space is kept for the confirmation so the card does not change height. */}
      <p aria-live="polite" className={cn("font-medium text-primary", compact ? "min-h-5 text-sm" : "min-h-6")}>
        {added ? `Added ${quantity} to your cart` : ""}
      </p>
    </div>
  );
}
